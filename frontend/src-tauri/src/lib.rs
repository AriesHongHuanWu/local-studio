//! AutoLyrics 桌面殼層 —— Python 後端 sidecar 生命週期管理 + 首次啟動安裝精靈。
//!
//! 本模組負責:
//!   1. 解析一個**可寫**的後端工作目錄 (WORK)。發佈版的後端原始碼隨安裝包落在
//!      唯讀的 resource 目錄 (Program Files);venv 與模型快取需要可寫位置,所以
//!      WORK = 每位使用者的 app data 目錄 (`<app_data_dir>/backend`)。首次啟動時把
//!      bundle 進 resource 的後端原始碼**複製**到 WORK,之後在 WORK 建立 venv 並
//!      從 WORK 啟動。DEV (本 repo,`../../backend` 已有 `.venv`) 直接用 repo 後端,
//!      不複製。
//!   2. App 啟動 (`.setup`) 時若 venv 已存在 → 以子行程啟動本機 FastAPI/uvicorn 後端
//!      (`<WORK>/.venv/Scripts/python.exe app.py`)。Windows 上帶 `CREATE_NO_WINDOW`
//!      旗標,避免閃出主控台視窗。venv **不存在則不啟動** —— 等首次安裝精靈
//!      (`setup_backend`) 建好 venv 後才啟動。
//!   3. 後端 PID 存進 Tauri managed state (`Mutex<Option<Child>>`),供結束時收尾。
//!   4. App 結束 (`RunEvent::ExitRequested` / `Exit`) 時可靠地 `kill()` 子行程,
//!      避免留下孤兒 uvicorn;`BackendProcess` 的 `Drop` 再作為最後安全網。
//!
//! 對前端開放的指令:
//!   • `backend_status()` —— 回報後端目錄 / venv / 系統 python 狀態,供首次精靈 UI。
//!   • `setup_backend(app)` —— 背景執行緒跑安裝 (建 venv → pip → torch → requirements),
//!     沿途 `emit` `setup-progress` / `setup-done` 事件給前端進度條,成功後啟動後端。
//!   • `restart_backend(app)` —— 安裝完成後手動 (重) 啟動後端。
//!
//! 設計原則:**永不因後端缺席而崩潰**。若找不到 venv python,只記一筆警告 —
//! 前端本身已能優雅顯示「後端離線」狀態 (它會輪詢 `http://127.0.0.1:8756/api/meta`)。

use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

/// 後端服務的固定位址 (與 `backend/app.py` 內的 HOST/PORT 一致)。
const BACKEND_PORT: u16 = 8756;

/// Windows:`CREATE_NO_WINDOW` (0x08000000),避免子行程閃出主控台視窗。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 包住後端子行程的 managed state。
///
/// 收尾有三道防線:
///   1. `RunEvent::ExitRequested` / `Exit` → 明確 `kill()` (優雅路徑)。
///   2. `BackendProcess` 的 `Drop` → 再 `kill()` 一次 (一般結束的安全網)。
///   3. Windows Job Object (`_job`) → 父行程「異常」死亡 (Task Manager 結束工作 /
///      `taskkill /F` / crash / debugger stop) 時,作業系統自動連帶殺掉子行程,
///      避免孤兒 uvicorn 卡住 8756 埠。job handle 必須隨 state 活著。
#[derive(Default)]
struct BackendProcess {
    child: Mutex<Option<Child>>,
    /// 安裝/啟動序列化旗標 —— 防止 `setup_backend` 與 `restart_backend` (或 setup
    /// hook) 並行 spawn 兩個 uvicorn 搶同一個 8756 埠。為 `true` 時第二個呼叫直接放棄。
    setup_in_progress: AtomicBool,
    /// Windows Job Object handle;保持存活以維持 KILL_ON_JOB_CLOSE 語意。
    #[cfg(windows)]
    _job: Mutex<Option<windows::JobHandle>>,
}

impl BackendProcess {
    /// 把一個剛啟動好的後端塞進 state。
    ///
    /// **呼叫端必須先 `kill()` 任何舊 child** (見 `guarded_spawn_install` 的
    /// kill-before-spawn) —— 故此處不再 kill,以免誤殺剛 spawn 好的新 child。
    fn store(&self, spawned: SpawnedBackend) {
        if let Ok(mut guard) = self.child.lock() {
            *guard = Some(spawned.child);
        }
        #[cfg(windows)]
        {
            if let Ok(mut guard) = self._job.lock() {
                *guard = spawned.job;
            }
        }
    }

    /// 序列化、防搶埠地 (重) 啟動後端並收進 state。回傳是否真的有後端在跑。
    ///
    /// 去除「兩個 uvicorn 同時搶 8756 埠」的時窗:
    ///   1. `setup_in_progress` 旗標序列化並行呼叫 —— 第二個直接放棄。
    ///   2. spawn 前**先** `kill()` 收掉自己追蹤的舊 child (kill-before-spawn),
    ///      再探測 8756 埠;若仍有人在聽 (非本 state 追蹤的孤兒/外部行程),
    ///      就不再 spawn 第二個搶埠,直接回 `true` (已有後端可用)。
    fn guarded_spawn_install(&self, app: &AppHandle) -> bool {
        // (1) 序列化:已有安裝/啟動進行中 → 放棄,避免雙重 spawn。
        if self
            .setup_in_progress
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            log::info!("已有後端啟動序列進行中,略過這次重複請求。");
            return self.is_alive();
        }
        // 確保旗標一定會被清掉 (即使中途 early-return)。
        struct Guard<'a>(&'a AtomicBool);
        impl Drop for Guard<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _guard = Guard(&self.setup_in_progress);

        // (2) kill-before-spawn:先收掉自己追蹤的舊 child,消除兩行程搶埠時窗。
        self.kill();
        // 若仍有人在聽 8756 (外部/孤兒行程),不再 spawn 第二個搶埠。
        if backend_already_listening() {
            log::info!("偵測到 8756 埠已有後端在聽,沿用之,不再 spawn。");
            return true;
        }
        match try_spawn_backend(app) {
            Some(spawned) => {
                self.store(spawned);
                true
            }
            None => false,
        }
    }

    /// 本 state 目前是否仍追蹤一個尚未結束的 child。
    fn is_alive(&self) -> bool {
        self.child
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// 終止後端子行程 (若仍在執行)。多次呼叫安全 (idempotent)。
    fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let pid = child.id();
                match child.kill() {
                    Ok(_) => {
                        // 回收 (reap),避免殭屍行程。
                        let _ = child.wait();
                        log::info!("已終止後端子行程 (pid {})", pid);
                    }
                    Err(e) => log::warn!("終止後端子行程 (pid {}) 失敗: {}", pid, e),
                }
            }
        }
    }
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        // 最後安全網:若一般結束流程沒收掉,Drop 時再殺一次。
        self.kill();
    }
}

// ============================================================================
// 後端目錄解析
// ============================================================================

/// 由後端目錄推得 venv python 路徑 (跨平台:Windows = Scripts/python.exe,其他 = bin/python)。
fn venv_python(backend_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        backend_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        backend_dir.join(".venv").join("bin").join("python")
    }
}

/// DEV repo 後端目錄 (相對 `src-tauri` = `CARGO_MANIFEST_DIR` 的 `../../backend`)。
///
/// `src-tauri` 在 `frontend/` 底下,`backend` 是其 sibling:
///   `autolyrics/frontend/src-tauri`  ->  `autolyrics/backend`
fn dev_repo_backend_dir() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent() // frontend/
        .and_then(|p| p.parent()) // autolyrics/
        .map(|p| p.join("backend"))
}

/// 解析**可寫**的後端工作目錄。
///
/// 優先序:
///   1. 環境變數 `AUTOLYRICS_BACKEND_DIR` (DEV 覆寫;假設可寫)。
///   2. DEV 模式:repo `../../backend` 存在**且有 `app.py`** → 直接用它
///      (這台開發機維持原樣,不複製;venv 不存在時就地在 repo 建,如同 install.ps1)。
///      注意:**不**要求 `.venv` 已存在 —— 否則開發者刪掉 .venv 測試安裝精靈時會
///      被誤判成發佈模式、去複製不存在的 Resource 目錄而死路。
///   3. 發佈模式:`<app_local_data_dir>/backend` (WORK) —— 首次啟動會把 resource
///      後端原始碼複製進來。用 **local** (非 roaming) app data:沉重的 venv+torch
///      (數 GB、上千個小檔) 絕不該落在會被 OneDrive/roaming 同步的資料夾 —— 同步
///      會鎖住 python.exe (spawn os error 32)、灌爆雲端配額。Local AppData 永不同步。
///
/// 回傳 `(dir, is_work)`:`is_work=true` 代表這是需要「首次複製原始碼」的 WORK 目錄。
fn resolve_backend_dir(app: &AppHandle) -> Option<(PathBuf, bool)> {
    // (1) 環境變數覆寫 —— 最高優先 (DEV)。
    if let Ok(dir) = std::env::var("AUTOLYRICS_BACKEND_DIR") {
        let p = PathBuf::from(dir);
        if p.is_dir() {
            return Some((p, false));
        }
        log::warn!("AUTOLYRICS_BACKEND_DIR 指向的目錄不存在: {}", p.display());
    }

    // (2) DEV:repo backend 存在且有 app.py → 沿用,完全不複製。
    //     不檢查 .venv —— 安裝精靈可在 repo 內就地建 venv (與 install.ps1 行為一致),
    //     讓開發者能刪 .venv 測試全新機器精靈而不被踢出 DEV 模式。
    if let Some(dev) = dev_repo_backend_dir() {
        if dev.is_dir() && dev.join("app.py").exists() {
            return Some((dev, false));
        }
    }

    // (3) 發佈:WORK = <app_local_data_dir>/backend (可寫、非 roaming/同步)。
    match app.path().app_local_data_dir() {
        Ok(data) => Some((data.join("backend"), true)),
        Err(e) => {
            log::warn!("無法取得 app_local_data_dir: {} —— 後端目錄無法解析。", e);
            None
        }
    }
}

/// 遞迴複製目錄 (用於把 resource 後端原始碼搬進 WORK)。永不複製 `.venv` —
/// resource 內本就沒有 venv,但仍明確跳過,以防萬一。
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        // 安全網:絕不複製重型/衍生目錄。
        if matches!(
            name.to_str(),
            Some(".venv") | Some("__pycache__") | Some("out") | Some("jobs") | Some("tmp")
        ) {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// 寫在「成功複製原始碼」最後一步的哨兵檔名。內容為 bundle 的 app 版本字串。
/// 唯有此檔存在**且**內容與目前版本相符,才視為 WORK 原始碼已就緒。
const SRC_OK_SENTINEL: &str = ".autolyrics_src_ok";

/// 確保 WORK 目錄已有**完整且最新**的後端原始碼。
///
/// 以版本化哨兵 `WORK/.autolyrics_src_ok` 判斷,而非單看 `app.py`:
///   • 哨兵在「完整複製成功」後才寫入 (LAST step) —— 中途失敗 (OneDrive 同步停滯、
///     磁碟滿、crash) 不會留下哨兵,下次啟動會**重新複製覆寫**,可自我修復,不會
///     卡在「app.py 已在但 pipeline 缺檔」的永久壞掉狀態。
///   • 哨兵內容綁 app 版本:安裝包帶來更新版後端覆蓋舊 WORK 時,版本不符會觸發
///     重新複製,避免「新前端跑舊後端原始碼」的隱性過期。
///
/// `is_work=false` (DEV / 環境變數) 時什麼都不做。
fn ensure_work_source(app: &AppHandle, backend_dir: &Path, is_work: bool) -> std::io::Result<()> {
    if !is_work {
        return Ok(());
    }
    let version = app.package_info().version.to_string();
    let sentinel = backend_dir.join(SRC_OK_SENTINEL);
    // 哨兵存在且版本相符 → 已完整複製且未過期,直接放行。
    if let Ok(existing) = std::fs::read_to_string(&sentinel) {
        if existing.trim() == version {
            return Ok(());
        }
        log::info!(
            "WORK 後端原始碼版本不符 (哨兵 {:?} ≠ {:?}) → 以新版重新複製覆寫。",
            existing.trim(),
            version
        );
    }

    let resource_backend = app
        .path()
        .resolve("backend", BaseDirectory::Resource)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string()))?;
    if !resource_backend.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("找不到 bundle 後端 resource: {}", resource_backend.display()),
        ));
    }
    log::info!(
        "準備後端原始碼:複製 {} → {} (版本 {})",
        resource_backend.display(),
        backend_dir.display(),
        version
    );
    // 完整複製 (覆寫既有檔)。複製完成後才寫哨兵 —— 任何中途失敗都不會留下哨兵。
    copy_dir_recursive(&resource_backend, backend_dir)?;
    std::fs::write(&sentinel, version)?;
    Ok(())
}

// ============================================================================
// 後端啟動 (spawn)
// ============================================================================

/// `spawn_backend` 的成功結果:子行程 + (Windows) 連帶清理用的 Job handle。
struct SpawnedBackend {
    child: Child,
    #[cfg(windows)]
    job: Option<windows::JobHandle>,
}

/// 在指定後端目錄啟動後端子行程。找不到 python / app.py 時回傳 `None` (不視為錯誤)。
fn spawn_backend_at(backend_dir: &Path) -> Option<SpawnedBackend> {
    let python = venv_python(backend_dir);
    let app_py = backend_dir.join("app.py");

    if !python.exists() {
        log::warn!(
            "找不到後端虛擬環境 python: {} —— 請先在 App 內執行「安裝後端」精靈。前端將顯示離線狀態。",
            python.display()
        );
        return None;
    }
    if !app_py.exists() {
        log::warn!(
            "找不到後端進入點: {} —— 前端將顯示離線狀態。",
            app_py.display()
        );
        return None;
    }

    let mut cmd = Command::new(&python);
    cmd.arg(&app_py).current_dir(backend_dir);

    // Windows:CREATE_NO_WINDOW,避免閃出主控台視窗。
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(child) => {
            log::info!(
                "已啟動後端子行程 (pid {}):{} {} (cwd {})",
                child.id(),
                python.display(),
                app_py.display(),
                backend_dir.display()
            );
            log::info!(
                "等待後端就緒於 http://127.0.0.1:{}/api/meta …",
                BACKEND_PORT
            );

            // Windows:把子行程綁進 kill-on-close 的 Job Object,父行程被
            // 強制結束時 OS 會連帶殺掉它 (孤兒防護的第三道防線)。失敗只記
            // 警告,不影響啟動 —— 仍有 RunEvent / Drop 兩道防線。
            #[cfg(windows)]
            let job = match windows::assign_child_to_kill_on_close_job(&child) {
                Ok(handle) => Some(handle),
                Err(code) => {
                    log::warn!(
                        "無法建立/指派 Job Object (Win32 error {});父行程若被強制結束可能殘留後端。",
                        code
                    );
                    None
                }
            };

            Some(SpawnedBackend {
                child,
                #[cfg(windows)]
                job,
            })
        }
        Err(e) => {
            log::warn!("啟動後端子行程失敗: {} —— 前端將顯示離線狀態。", e);
            None
        }
    }
}

/// 探測本機 8756 埠是否已有後端在聽 (短逾時的 TCP connect)。
/// 用來避免在「已有一個 uvicorn 活著」時又 spawn 第二個搶埠。
fn backend_already_listening() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], BACKEND_PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// 解析後端目錄 → (若 WORK) 確保原始碼就位 → 嘗試啟動後端。
/// 任一步失敗都只記警告、回傳 `None`,絕不崩潰。
fn try_spawn_backend(app: &AppHandle) -> Option<SpawnedBackend> {
    let (backend_dir, is_work) = resolve_backend_dir(app)?;
    if let Err(e) = ensure_work_source(app, &backend_dir, is_work) {
        log::warn!("準備後端工作目錄失敗: {} —— 前端將顯示離線狀態。", e);
        // 即便複製失敗,仍嘗試啟動 (也許目錄部份存在);多半會在 venv 缺席時優雅放棄。
    }
    spawn_backend_at(&backend_dir)
}

// ============================================================================
// Tauri 指令:backend_status
// ============================================================================

/// 系統 python 探測結果。
struct PythonProbe {
    /// 可呼叫的命令 + 參數,例如 `["py","-3"]` 或 `["python"]`。
    argv: Vec<String>,
    version: String,
}

/// 嘗試找一個可用的系統 python (非 venv)。依序試 `python` / `py -3` / `python3`。
fn find_system_python() -> Option<PythonProbe> {
    let candidates: [&[&str]; 3] = [&["python"], &["py", "-3"], &["python3"]];
    for argv in candidates {
        let (exe, rest) = argv.split_first().unwrap();
        let mut cmd = Command::new(exe);
        cmd.args(rest).arg("--version");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                // `--version` 可能寫到 stdout 或 stderr,兩邊都看。
                let mut v = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if v.is_empty() {
                    v = String::from_utf8_lossy(&out.stderr).trim().to_string();
                }
                return Some(PythonProbe {
                    argv: argv.iter().map(|s| s.to_string()).collect(),
                    version: v,
                });
            }
        }
    }
    None
}

/// `backend_status` 回傳結構。
///
/// **欄位名必須與前端 `state/useSetup.ts` 的 `BackendStatus` 介面一致** —— 它是
/// 唯一的消費端 (首次安裝精靈 + App.tsx 路由)。其中 `python_cmd` 額外提供探測到的
/// python 指令字串 (前端目前忽略,但對除錯/未來有用,不影響相容性)。
#[derive(Serialize, Clone)]
struct BackendStatus {
    /// venv python 實際存在。
    venv_exists: bool,
    /// backend dir 存在且有 app.py。
    backend_dir_exists: bool,
    /// 解析出的後端目錄 (供 Debug;尚未解析時為 None)。
    backend_dir: Option<String>,
    /// 系統 PATH 上找得到 python。
    python_found: bool,
    /// 找到的 python 指令 (e.g. "py -3");找不到時 None。
    python_cmd: Option<String>,
    /// 找到的 python 版本字串 (e.g. "Python 3.11.4");找不到時 None。
    python_version: Option<String>,
}

/// 回報後端目錄與 python/venv 狀態,供首次安裝精靈 UI 判斷該顯示什麼。
#[tauri::command]
fn backend_status(app: AppHandle) -> BackendStatus {
    let backend_dir = resolve_backend_dir(&app).map(|(d, _)| d);
    let venv_exists = backend_dir
        .as_ref()
        .map(|d| venv_python(d).exists())
        .unwrap_or(false);
    let backend_dir_exists = backend_dir
        .as_ref()
        .map(|d| d.join("app.py").exists())
        .unwrap_or(false);

    let (python_found, python_cmd, python_version) = match find_system_python() {
        Some(p) => (true, Some(p.argv.join(" ")), Some(p.version)),
        None => (false, None, None),
    };

    BackendStatus {
        venv_exists,
        backend_dir_exists,
        backend_dir: backend_dir.map(|d| d.display().to_string()),
        python_found,
        python_cmd,
        python_version,
    }
}

// ============================================================================
// Tauri 指令:setup_backend (首次安裝精靈) + restart_backend
// ============================================================================

/// `setup-progress` 事件 payload。
#[derive(Serialize, Clone)]
struct SetupProgress {
    line: String,
    pct: f64,
}

/// `setup-done` 事件 payload。
///
/// **欄位名必須與前端 `state/useSetup.ts` 的 `SetupDonePayload` 一致** (`success` + `error`)。
#[derive(Serialize, Clone)]
struct SetupDone {
    success: bool,
    error: Option<String>,
}

/// 發一筆進度事件 (失敗只記 log,不阻斷安裝)。
fn emit_progress(app: &AppHandle, pct: f64, line: impl Into<String>) {
    let line = line.into();
    log::info!("[setup {:>3.0}%] {}", pct, line);
    let _ = app.emit("setup-progress", SetupProgress { line, pct });
}

/// 偵測 NVIDIA GPU (有 `nvidia-smi` 且回傳 0)。
fn has_nvidia() -> bool {
    let mut cmd = Command::new("nvidia-smi");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 執行一個命令並把 stdout 逐行串成 `setup-progress` 事件,stderr 收集備用。
/// `pct_from`..`pct_to` 為這步在整體進度中的區間 (依輸出行數平滑遞增)。
/// 回傳 `Ok(())` 代表 exit code 0,否則 `Err(描述)`。
fn run_streaming(
    app: &AppHandle,
    label: &str,
    mut cmd: Command,
    pct_from: f64,
    pct_to: f64,
) -> Result<(), String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("{} 啟動失敗: {}", label, e))?;

    // stderr 丟到另一執行緒讀,避免管線塞滿造成死結 (stdout 在本執行緒讀)。
    let stderr = child.stderr.take();
    let app_err = app.clone();
    let stderr_handle = stderr.map(|err| {
        std::thread::spawn(move || {
            let mut lines = Vec::new();
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    // stderr 也轉成進度行 (pip 把不少正常訊息寫到 stderr),pct 不動。
                    let _ = app_err.emit(
                        "setup-progress",
                        SetupProgress {
                            line: line.clone(),
                            pct: -1.0,
                        },
                    );
                }
                lines.push(line);
            }
            lines
        })
    });

    // stdout 逐行 → 進度事件。pct 在區間內隨行數平滑爬升 (上限 pct_to)。
    if let Some(out) = child.stdout.take() {
        let mut count: f64 = 0.0;
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            count += 1.0;
            // 以漸近方式逼近 pct_to,行數越多越接近但永不越界。
            let frac = 1.0 - 1.0 / (1.0 + count / 20.0);
            let pct = pct_from + (pct_to - pct_from) * frac;
            emit_progress(app, pct, line);
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("{} 等待結束失敗: {}", label, e))?;

    // 收集 stderr 尾段 (失敗時用得上)。
    let stderr_lines = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();

    if status.success() {
        Ok(())
    } else {
        let mut tail: Vec<String> = stderr_lines
            .into_iter()
            .filter(|l| !l.trim().is_empty())
            .rev()
            .take(12)
            .collect();
        tail.reverse();
        let detail = if tail.is_empty() {
            String::new()
        } else {
            format!("\n{}", tail.join("\n"))
        };
        Err(format!(
            "{} 失敗 (exit {}){}",
            label,
            status.code().unwrap_or(-1),
            detail
        ))
    }
}

/// 安裝流程的實作 (在背景執行緒跑)。回傳安裝好的後端目錄,供成功後 spawn。
fn run_setup(app: &AppHandle) -> Result<PathBuf, String> {
    emit_progress(app, 1.0, "開始準備後端環境 …");

    let (backend_dir, is_work) = resolve_backend_dir(app)
        .ok_or_else(|| "無法解析後端目錄 (app_data_dir 取得失敗)".to_string())?;

    // (a) 確保原始碼就位 (WORK 首次複製;DEV 不動)。
    emit_progress(app, 4.0, "準備後端原始碼 …");
    ensure_work_source(app, &backend_dir, is_work)
        .map_err(|e| format!("複製後端原始碼失敗: {}", e))?;

    // (b) 找系統 python。
    let py = find_system_python().ok_or_else(|| {
        "找不到系統 Python。請先安裝 Python 3.10–3.12 並勾選 Add to PATH。".to_string()
    })?;
    emit_progress(
        app,
        6.0,
        format!("使用 Python: {} ({})", py.argv.join(" "), py.version),
    );

    let venv_dir = backend_dir.join(".venv");
    let vpython = venv_python(&backend_dir);

    // (c) 建立 venv (若尚未存在)。
    if vpython.exists() {
        emit_progress(app, 12.0, "偵測到既有 .venv,沿用。");
    } else {
        emit_progress(app, 8.0, "建立虛擬環境 .venv …");
        let (exe, rest) = py.argv.split_first().unwrap();
        let mut cmd = Command::new(exe);
        cmd.args(rest)
            .arg("-m")
            .arg("venv")
            .arg(&venv_dir)
            .current_dir(&backend_dir);
        run_streaming(app, "建立虛擬環境", cmd, 8.0, 12.0)?;
    }
    if !vpython.exists() {
        return Err(format!(
            "建立 venv 後仍找不到 python: {}",
            vpython.display()
        ));
    }

    // (d) 升級 pip。
    emit_progress(app, 14.0, "升級 pip / setuptools / wheel …");
    {
        let mut cmd = Command::new(&vpython);
        cmd.args([
            "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel",
        ])
        .current_dir(&backend_dir);
        run_streaming(app, "升級 pip", cmd, 14.0, 22.0)?;
    }

    // (e) 安裝 PyTorch + torchaudio (偵測 NVIDIA → cu128,否則 CPU 版)。
    let nvidia = has_nvidia();
    if nvidia {
        emit_progress(
            app,
            24.0,
            "偵測到 NVIDIA GPU → 安裝 CUDA (cu128) 版 PyTorch …",
        );
        let mut cmd = Command::new(&vpython);
        cmd.args([
            "-m",
            "pip",
            "install",
            "torch",
            "torchaudio",
            "--index-url",
            "https://download.pytorch.org/whl/cu128",
        ])
        .current_dir(&backend_dir);
        // cu128 失敗 → 後備 CPU 版 (與 install.ps1 一致)。
        if let Err(e) = run_streaming(app, "安裝 CUDA PyTorch", cmd, 24.0, 65.0) {
            emit_progress(
                app,
                65.0,
                format!("cu128 安裝失敗,改裝 CPU 版作後備 ({})", e),
            );
            let mut cpu = Command::new(&vpython);
            cpu.args(["-m", "pip", "install", "torch", "torchaudio"])
                .current_dir(&backend_dir);
            run_streaming(app, "安裝 CPU PyTorch (後備)", cpu, 65.0, 75.0)?;
        }
    } else {
        emit_progress(app, 24.0, "未偵測到 NVIDIA GPU → 安裝 CPU 版 PyTorch …");
        let mut cmd = Command::new(&vpython);
        cmd.args(["-m", "pip", "install", "torch", "torchaudio"])
            .current_dir(&backend_dir);
        run_streaming(app, "安裝 CPU PyTorch", cmd, 24.0, 65.0)?;
    }

    // (f) 安裝 requirements.txt。
    let req = backend_dir.join("requirements.txt");
    if req.exists() {
        emit_progress(app, 78.0, "安裝 requirements.txt 相依套件 …");
        let mut cmd = Command::new(&vpython);
        cmd.arg("-m")
            .arg("pip")
            .arg("install")
            .arg("-r")
            .arg(&req)
            .current_dir(&backend_dir);
        run_streaming(app, "安裝 requirements", cmd, 78.0, 98.0)?;
    } else {
        emit_progress(app, 98.0, "找不到 requirements.txt,略過。");
    }

    emit_progress(app, 99.0, "後端環境安裝完成。");
    Ok(backend_dir)
}

/// 首次安裝精靈:在背景執行緒執行安裝,沿途 `emit` 進度事件;成功後啟動後端。
/// 立即回傳 (不阻塞 invoke 執行緒);結果透過 `setup-done` 事件通知前端。
#[tauri::command]
fn setup_backend(app: AppHandle) {
    std::thread::spawn(move || match run_setup(&app) {
        Ok(_backend_dir) => {
            // 安裝成功 → 立刻啟動後端 (序列化、防搶埠、kill-before-spawn)。
            if app.state::<BackendProcess>().guarded_spawn_install(&app) {
                emit_progress(&app, 100.0, "後端已啟動。");
                let _ = app.emit(
                    "setup-done",
                    SetupDone {
                        success: true,
                        error: None,
                    },
                );
            } else {
                let _ = app.emit(
                    "setup-done",
                    SetupDone {
                        success: false,
                        error: Some("安裝完成但後端啟動失敗,請重啟 App 再試。".to_string()),
                    },
                );
            }
        }
        Err(e) => {
            log::warn!("setup_backend 失敗: {}", e);
            let _ = app.emit(
                "setup-done",
                SetupDone {
                    success: false,
                    error: Some(e),
                },
            );
        }
    });
}

/// (重新) 啟動後端的指令 —— 供前端在安裝已完成、但後端尚未跑時手動觸發。
/// 回傳是否成功啟動。
#[tauri::command]
fn restart_backend(app: AppHandle, state: State<'_, BackendProcess>) -> bool {
    state.guarded_spawn_install(&app)
}

// ============================================================================
// 進入點
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // tauri-plugin-log 無條件註冊,debug 時 Info、release 時 Warn —— 這樣
    // spawn/resolve/kill 的診斷在「已安裝、無主控台」的發佈版也看得到。
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Info
    } else {
        log::LevelFilter::Warn
    };

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log_level)
                // 用 .targets() 取代預設 (預設只有 Stdout),明確指定兩個目標:
                //   • Stdout  —— 開發時看得到。
                //   • LogDir  —— release/「無主控台」版把警告寫到 app log 目錄,
                //                事後可排查後端為何沒起來 (否則優雅離線路徑無從除錯)。
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(BackendProcess::default())
        .invoke_handler(tauri::generate_handler![
            backend_status,
            setup_backend,
            restart_backend
        ])
        .setup(|app| {
            // 啟動後端 sidecar。venv 不存在 (全新機器、尚未跑安裝精靈) 時回 false,
            // 不崩潰 —— 前端會輪詢 /api/meta 顯示離線並引導使用者安裝。
            // 走 guarded 路徑:與日後 setup_backend/restart_backend 並行時不會雙重 spawn。
            let handle = app.handle().clone();
            app.state::<BackendProcess>().guarded_spawn_install(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 視窗關閉 / App 結束時,可靠地收掉後端子行程,避免孤兒 uvicorn。
            match event {
                RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                    app_handle.state::<BackendProcess>().kill();
                }
                _ => {}
            }
        });
}

// ============================================================================
// Windows Job Object 支援
// ============================================================================

/// 把後端子行程放進一個 `KILL_ON_JOB_CLOSE` 的 Job,父行程 (本 Tauri 程式) 的
/// 所有 handle 關閉時 —— 包含被 Task Manager「結束工作」、`taskkill /F`、crash、
/// debugger stop 等「異常」死法 —— OS 會自動殺掉 Job 內的所有行程。這補上了
/// `kill()` / `Drop` 都跑不到的那條邊界,確保不留孤兒 uvicorn。
#[cfg(windows)]
mod windows {
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// 持有 Job Object handle 的 RAII 包裝。
    ///
    /// **關鍵**:這個 handle 必須在 app 的整個生命週期保持開啟 (存進
    /// `BackendProcess::_job`)。一旦最後一個 handle 關閉 (正常結束時的
    /// `Drop`,或父行程死亡時 OS 強制關閉),`KILL_ON_JOB_CLOSE` 就會觸發,
    /// Job 內的後端被連帶終止。
    pub struct JobHandle(HANDLE);

    // HANDLE 是裸指標;此 handle 僅由我們獨佔持有並在 Drop 關閉,跨執行緒移動安全。
    unsafe impl Send for JobHandle {}

    impl Drop for JobHandle {
        fn drop(&mut self) {
            // SAFETY: self.0 是 CreateJobObjectW 成功回傳的有效 handle,只關閉一次。
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    /// 建立一個 kill-on-close 的 Job Object 並把 `child` 指派進去。
    ///
    /// 成功回傳必須保活的 [`JobHandle`];失敗回傳 Win32 error code (`GetLastError`)。
    pub fn assign_child_to_kill_on_close_job(child: &Child) -> Result<JobHandle, u32> {
        // SAFETY: 全部都是標準 Win32 呼叫,參數與 MSDN 文件一致;每個結果都檢查。
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() || job == INVALID_HANDLE_VALUE {
                return Err(last_error());
            }
            let job = JobHandle(job);

            // 設定 KILL_ON_JOB_CLOSE:job handle 全部關閉時,OS 殺光 job 內行程。
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                return Err(last_error());
            }

            // 由 PID 取得有 SET_QUOTA|TERMINATE 權限的 process handle 來指派。
            let proc = OpenProcess(
                PROCESS_SET_QUOTA | PROCESS_TERMINATE,
                0, // bInheritHandle = FALSE
                child.id(),
            );
            if proc.is_null() {
                return Err(last_error());
            }

            let assigned = AssignProcessToJobObject(job.0, proc);
            // 立刻關閉這個臨時 process handle;Job 已持有指派關係,不需要它。
            CloseHandle(proc);
            if assigned == 0 {
                return Err(last_error());
            }

            Ok(job)
        }
    }

    fn last_error() -> u32 {
        // SAFETY: GetLastError 無參數、永遠安全。
        unsafe { windows_sys::Win32::Foundation::GetLastError() }
    }
}
