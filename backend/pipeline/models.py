"""pipeline/models.py — AutoLyrics 模型管理器 (Model Manager)。

讓使用者能在 App 內**選擇**並**安裝**辨識所需的模型（download-on-demand），
而不必只靠首次使用時的自動下載。涵蓋三類模型:

  - whisper : faster-whisper 語音辨識權重 (tiny/base/small/medium/large-v3/turbo)
  - demucs  : htdemucs 人聲分離權重 (separate.py 用)
  - aligner : torchaudio MMS_FA 強制對齊模型 (align.py 用)

設計原則 (與其他 pipeline 子模組一致):
  * **匯入永不崩潰**:所有重型相依 (torch / faster_whisper / demucs / huggingface_hub)
    都延後到實際使用時才 import,缺席時優雅降級;本模組 import 階段純資料,永遠安全。
  * **偵測優先用離線檢查**:掃 HuggingFace cache / torch hub checkpoints 的檔案存在性,
    不發網路請求,確保 /api/models 反應快且離線也能用。
  * **下載走背景執行緒 + 輪詢進度**:呼叫各框架的阻塞式下載函式於子執行緒,
    主執行緒每 ~0.5s 量測目標 cache 目錄的大小成長,換算 pct 回報。

對外契約 (app.py 依此實作端點):
  REGISTRY              — 靜態模型 metadata 清單
  list_models()         — REGISTRY + live installed / sizeOnDiskMB
  get_meta(id)          — 單一模型 metadata (含 live 欄位) 或 None
  is_installed(id)      — bool
  download(id, progress)— progress(pct: float, message: str);失敗丟 RuntimeError
  delete(id)            — {"freedMB": float};未安裝則丟例外
  disk_used_mb()        — 所有 AutoLyrics 模型快取的總用量 (MB)
  cache_root()          — 主要快取根目錄字串 (給 UI 顯示)
  gpu_vram_total_mb()   — GPU 顯存總量 (MB) 或 None
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Callable, Optional

logger = logging.getLogger("autolyrics.models")

# 進度回呼:progress(pct: float, message: str) -> None
ProgressFn = Callable[[float, str], None]

class ModelDeleteGuardError(RuntimeError):
    """刪除被守門規則拒絕 (required 模型 / 最後一個 Whisper)。

    app.py 對此例外回 HTTP 409 (Conflict),其餘刪除失敗回 500。
    """


# htdemucs 4-stem 單檔權重雜湊 (demucs 4.0.1 pretrained "htdemucs")。
_HTDEMUCS_CKPT = "955717e8-8726e21a.th"
# MMS_FA 對齊模型下載後的本地檔名 (torch.hub 以 URL basename 命名)。
# ⚠️ 碰撞風險:'model.pt' 是泛用名,任何其他 torch.hub 模型也可能寫到
# checkpoints/model.pt。因此偵測與刪除不能只看檔名 — 額外用「大小帶」把關
# (MMS_FA 權重約 1.2GB),避免把無關模型的 model.pt 誤判為對齊器或誤刪。
_MMS_FILE = "model.pt"
# MMS_FA 權重大小帶 (bytes):實測約 1.2GB,給寬鬆 800MB–1.6GB 區間以容版本差異。
_MMS_MIN_BYTES = 800 * 1024 * 1024
_MMS_MAX_BYTES = 1600 * 1024 * 1024


# --------------------------------------------------------------------------- #
# 靜態模型登記表 (REGISTRY)
# --------------------------------------------------------------------------- #
# 每筆: id, kind, label, description(zh+en 短), sizeMB(約略下載大小),
#       recommended, vramHint, whisperSize(whisper 用,其餘 None), required。
# sizeOnDiskMB / installed 由 list_models() 在執行期補上。
REGISTRY: list[dict[str, Any]] = [
    # ── Whisper 辨識模型 ──────────────────────────────────────────────────
    {
        "id": "whisper-tiny",
        "kind": "whisper",
        "label": "Whisper Tiny",
        "description": "最小最快，準確度最低 · Smallest & fastest, lowest accuracy",
        "sizeMB": 75,
        "recommended": False,
        "vramHint": "CPU-friendly",
        "whisperSize": "tiny",
        "required": False,
    },
    {
        "id": "whisper-base",
        "kind": "whisper",
        "label": "Whisper Base",
        "description": "輕量快速，適合測試 · Lightweight & fast, good for testing",
        "sizeMB": 145,
        "recommended": False,
        "vramHint": "CPU-friendly",
        "whisperSize": "base",
        "required": False,
    },
    {
        "id": "whisper-small",
        "kind": "whisper",
        "label": "Whisper Small",
        "description": "速度與準確的平衡點 · Balanced speed and accuracy",
        "sizeMB": 480,
        "recommended": False,
        "vramHint": "~1GB VRAM",
        "whisperSize": "small",
        "required": False,
    },
    {
        "id": "whisper-medium",
        "kind": "whisper",
        "label": "Whisper Medium",
        "description": "高準確度，速度適中 · High accuracy, moderate speed",
        "sizeMB": 1530,
        "recommended": False,
        "vramHint": "~2GB VRAM",
        "whisperSize": "medium",
        "required": False,
    },
    {
        "id": "whisper-large-v3",
        "kind": "whisper",
        "label": "Whisper Large-v3",
        "description": "最高準確度，推薦使用 · Best accuracy, recommended",
        "sizeMB": 3090,
        "recommended": True,
        "vramHint": "~4GB VRAM",
        "whisperSize": "large-v3",
        "required": False,
    },
    {
        "id": "whisper-large-v3-turbo",
        "kind": "whisper",
        "label": "Whisper Large-v3 Turbo",
        "description": "近 large-v3 準確度但更快 · Near large-v3 accuracy, much faster",
        "sizeMB": 1620,
        "recommended": False,
        "vramHint": "~3GB VRAM",
        "whisperSize": "large-v3-turbo",
        "required": False,
    },
    # ── Demucs 人聲分離 (必需) ────────────────────────────────────────────
    {
        "id": "demucs-htdemucs",
        "kind": "demucs",
        "label": "Demucs htdemucs",
        "description": "人聲／伴奏分離模型 · Vocal/instrument separation",
        "sizeMB": 80,
        "recommended": True,
        "vramHint": "~3GB VRAM",
        "whisperSize": None,
        "required": True,
    },
    # ── 強制對齊器 (必需) ─────────────────────────────────────────────────
    {
        "id": "aligner-mms",
        "kind": "aligner",
        "label": "MMS Forced Aligner",
        "description": "完整歌詞逐字對齊模型 · Word-level forced alignment",
        "sizeMB": 1160,
        "recommended": True,
        "vramHint": "~2GB VRAM",
        "whisperSize": None,
        "required": True,
    },
]

# id -> meta 的快速索引
_BY_ID: dict[str, dict[str, Any]] = {m["id"]: m for m in REGISTRY}

# 序列化模型下載:demucs 與 MMS 共用 torch hub checkpoints/ 目錄,兩個大型
# 下載並行會互相污染各自的進度基準。以模組級鎖序列化,確保進度量測乾淨。
_DOWNLOAD_LOCK = threading.Lock()


# --------------------------------------------------------------------------- #
# 低階工具:延後 import (絕不在 import 期崩潰)
# --------------------------------------------------------------------------- #
def _torch_hub_dir() -> Optional[str]:
    """torch.hub.get_dir();torch 缺席回 None。"""
    try:
        import torch  # type: ignore

        return torch.hub.get_dir()
    except Exception:  # noqa: BLE001
        return None


def _checkpoints_dir() -> Optional[str]:
    """torch hub 的 checkpoints/ 目錄 (demucs + mms 都下載到這)。"""
    hub = _torch_hub_dir()
    if not hub:
        return None
    return os.path.join(hub, "checkpoints")


def _whisper_repo_id(whisper_size: str) -> Optional[str]:
    """由 whisper size 字串取得對應的 HuggingFace repo id。"""
    try:
        from faster_whisper.utils import _MODELS  # type: ignore

        return _MODELS.get(whisper_size)
    except Exception:  # noqa: BLE001
        return None


def _whisper_repo_blob_dir(whisper_size: str) -> Optional[str]:
    """此 whisper repo 在 HF cache 的 blobs/ 目錄路徑 (權重實體就寫在這)。

    把下載進度量測 scope 到單一 repo 的 blobs/,而非整個 HF cache,
    避免其他進程/下載寫入污染進度,也免去每 0.5s 掃整棵快取樹。
    """
    repo_id = _whisper_repo_id(whisper_size)
    if not repo_id:
        return None
    dirname = "models--" + repo_id.replace("/", "--")
    return os.path.join(cache_root(), dirname, "blobs")


def _scan_hf_cache() -> dict[str, int]:
    """掃 HuggingFace cache,回 {repo_id: size_on_disk_bytes}。失敗回 {}。"""
    out: dict[str, int] = {}
    try:
        from huggingface_hub import scan_cache_dir  # type: ignore

        info = scan_cache_dir()
        for repo in info.repos:
            try:
                out[repo.repo_id] = int(repo.size_on_disk or 0)
            except Exception:  # noqa: BLE001
                continue
    except Exception as exc:  # noqa: BLE001
        logger.debug("scan_cache_dir 失敗 (已忽略): %s", exc)
    return out


def _hf_repo_has_model_bin(repo_id: str) -> bool:
    """檢查某 HF repo 的某個 revision 是否含 model.bin (真正可用的權重)。"""
    try:
        from huggingface_hub import scan_cache_dir  # type: ignore

        info = scan_cache_dir()
        for repo in info.repos:
            if repo.repo_id != repo_id:
                continue
            for rev in repo.revisions:
                for f in rev.files:
                    if os.path.basename(str(f.file_name)) == "model.bin":
                        return True
        return False
    except Exception:  # noqa: BLE001
        return False


def _dir_size_bytes(path: Optional[str]) -> int:
    """遞迴計算目錄總位元組數;不存在 / 失敗回 0。"""
    if not path or not os.path.isdir(path):
        return 0
    total = 0
    try:
        for root, _dirs, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    continue
    except OSError:
        return total
    return total


def _file_size_bytes(path: Optional[str]) -> int:
    if not path or not os.path.isfile(path):
        return 0
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


# 下載期間 torch.hub / HF 會先寫到含這些後綴的暫存檔,完成後改名為最終檔。
# 量測單一目標檔的成長時,把這些 in-progress 暫存也算進去。
_PARTIAL_SUFFIXES = ("", ".partial", ".incomplete", ".tmp", ".lock", ".download")


def _target_file_bytes(final_path: Optional[str]) -> int:
    """量測「單一目標檔」目前的位元組數,含其 in-progress 暫存檔。

    下載中最終檔可能尚未存在 (還叫 model.pt.incomplete 之類),故把已知的
    暫存後綴一併納入,讓進度條在下載過程就能成長。回傳所有相符檔的總和。
    """
    if not final_path:
        return 0
    total = 0
    for suffix in _PARTIAL_SUFFIXES:
        total += _file_size_bytes(final_path + suffix)
    return total


def _bytes_to_mb(b: float) -> float:
    return round(float(b) / (1024.0 * 1024.0), 1)


# --------------------------------------------------------------------------- #
# 偵測:installed / sizeOnDisk (全離線,不發網路)
# --------------------------------------------------------------------------- #
def _whisper_status(whisper_size: str) -> tuple[bool, float]:
    """(installed, sizeOnDiskMB) — repo 在 HF cache 且含 model.bin 才算裝好。"""
    repo_id = _whisper_repo_id(whisper_size)
    if not repo_id:
        return False, 0.0
    sizes = _scan_hf_cache()
    size_bytes = sizes.get(repo_id, 0)
    # 大小需非微量 (>1MB) 且確實有 model.bin,才視為可用。
    installed = size_bytes > 1_000_000 and _hf_repo_has_model_bin(repo_id)
    return installed, (_bytes_to_mb(size_bytes) if installed else 0.0)


def _demucs_ckpt_path() -> Optional[str]:
    ck = _checkpoints_dir()
    if not ck:
        return None
    return os.path.join(ck, _HTDEMUCS_CKPT)


def _demucs_status() -> tuple[bool, float]:
    p = _demucs_ckpt_path()
    sz = _file_size_bytes(p)
    if sz > 1_000_000:
        return True, _bytes_to_mb(sz)
    return False, 0.0


def _mms_ckpt_path() -> Optional[str]:
    ck = _checkpoints_dir()
    if not ck:
        return None
    return os.path.join(ck, _MMS_FILE)


def _is_mms_bundle(path: Optional[str]) -> bool:
    """content-aware 判斷 checkpoints/model.pt 是否真為 MMS_FA 對齊權重。

    'model.pt' 是泛用檔名,別的 torch.hub 模型也可能寫同名檔。為避免把無關
    模型誤判成對齊器 (或誤刪),這裡用 MMS_FA 權重的大小帶 (~1.2GB) 把關;
    在合理區間外的 model.pt 一律不視為 MMS 對齊器。
    """
    sz = _file_size_bytes(path)
    return _MMS_MIN_BYTES <= sz <= _MMS_MAX_BYTES


def _mms_status() -> tuple[bool, float]:
    """MMS_FA 偵測:torch hub checkpoints/model.pt 存在且落在 MMS 大小帶才算已安裝。

    best-effort 純檔案檢查 (不發網路);torch hub 以 URL basename 命名,故為 model.pt。
    大小帶把關避免同名 model.pt 碰撞 (見 _MMS_FILE 註解)。
    """
    p = _mms_ckpt_path()
    if _is_mms_bundle(p):
        return True, _bytes_to_mb(_file_size_bytes(p))
    return False, 0.0


def _status_for(meta: dict[str, Any]) -> tuple[bool, float]:
    kind = meta.get("kind")
    if kind == "whisper":
        return _whisper_status(str(meta.get("whisperSize") or ""))
    if kind == "demucs":
        return _demucs_status()
    if kind == "aligner":
        return _mms_status()
    return False, 0.0


# --------------------------------------------------------------------------- #
# 對外:metadata 查詢
# --------------------------------------------------------------------------- #
def get_meta(model_id: str) -> Optional[dict[str, Any]]:
    """回傳單一模型的 metadata (含 live installed / sizeOnDiskMB),或 None。"""
    base = _BY_ID.get(model_id)
    if base is None:
        return None
    installed, on_disk = _status_for(base)
    out = dict(base)
    out["installed"] = installed
    out["sizeOnDiskMB"] = on_disk
    return out


def list_models() -> list[dict[str, Any]]:
    """REGISTRY + 每筆即時的 installed / sizeOnDiskMB。"""
    out: list[dict[str, Any]] = []
    for base in REGISTRY:
        installed, on_disk = _status_for(base)
        item = dict(base)
        item["installed"] = installed
        item["sizeOnDiskMB"] = on_disk
        out.append(item)
    return out


def is_installed(model_id: str) -> bool:
    meta = _BY_ID.get(model_id)
    if meta is None:
        return False
    installed, _ = _status_for(meta)
    return installed


# --------------------------------------------------------------------------- #
# 磁碟用量 + 快取位置 + GPU 顯存
# --------------------------------------------------------------------------- #
def disk_used_mb() -> float:
    """所有 AutoLyrics 模型快取的總用量 (MB):已安裝 whisper repos + demucs + mms。"""
    total_bytes = 0

    # whisper:各已安裝 repo 的 size_on_disk
    sizes = _scan_hf_cache()
    for base in REGISTRY:
        if base.get("kind") != "whisper":
            continue
        repo_id = _whisper_repo_id(str(base.get("whisperSize") or ""))
        if repo_id and repo_id in sizes:
            total_bytes += sizes[repo_id]

    # demucs htdemucs 單檔
    total_bytes += _file_size_bytes(_demucs_ckpt_path())
    # mms 對齊模型單檔
    total_bytes += _file_size_bytes(_mms_ckpt_path())

    return _bytes_to_mb(total_bytes)


def cache_root() -> str:
    """主要快取根目錄 (給 UI 顯示);優先 HF hub cache,缺席回 torch hub。"""
    try:
        from huggingface_hub.constants import HF_HUB_CACHE  # type: ignore

        if HF_HUB_CACHE:
            return str(HF_HUB_CACHE)
    except Exception:  # noqa: BLE001
        pass
    hub = _torch_hub_dir()
    if hub:
        return hub
    return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def gpu_vram_total_mb() -> Optional[float]:
    """GPU 顯存總量 (MB);無 CUDA / torch 回 None。"""
    try:
        import torch  # type: ignore

        if not torch.cuda.is_available():
            return None
        props = torch.cuda.get_device_properties(0)
        return _bytes_to_mb(props.total_memory)
    except Exception:  # noqa: BLE001
        return None


# --------------------------------------------------------------------------- #
# 下載:背景執行緒跑阻塞式下載 + 主執行緒輪詢目錄成長回報進度
# --------------------------------------------------------------------------- #
def _poll_progress_until_done(
    worker: threading.Thread,
    holder: dict[str, Any],
    measure: Callable[[], int],
    *,
    size_mb: float,
    start_bytes: int,
    message: str,
    progress: Optional[ProgressFn],
) -> None:
    """主執行緒迴圈:量測目標成長換算 pct,回報直到 worker 結束。

    ``measure`` 回傳目前「已量測位元組數」(scoped 到此下載的單一檔/單一 repo,
    而非整個共享目錄),避免並行下載互相污染進度。grown = measure() - start_bytes。

    worker 內存放例外於 holder["error"];結束後若有錯則丟 RuntimeError。
    """
    total_target = max(1.0, float(size_mb) * 1024.0 * 1024.0)

    def _emit(pct: float, msg: str) -> None:
        if progress is None:
            return
        try:
            progress(max(0.0, min(99.0, pct)), msg)
        except Exception:  # noqa: BLE001 - 進度回呼不得影響主流程
            logger.debug("progress 回呼丟出例外 (已忽略)", exc_info=True)

    _emit(0.0, message)
    while worker.is_alive():
        cur = measure()
        grown = max(0, cur - start_bytes)
        pct = (grown / total_target) * 100.0
        _emit(pct, message)
        time.sleep(0.5)
    worker.join(timeout=5.0)

    err = holder.get("error")
    if err is not None:
        raise RuntimeError(str(err))

    if progress is not None:
        try:
            progress(100.0, "done")
        except Exception:  # noqa: BLE001
            logger.debug("progress 回呼丟出例外 (已忽略)", exc_info=True)


def _spawn_worker(fn: Callable[[], Any]) -> tuple[threading.Thread, dict[str, Any]]:
    """把阻塞式下載 fn 包進子執行緒;例外存入 holder['error']。"""
    holder: dict[str, Any] = {"error": None}

    def _run() -> None:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - 收斂成 holder,讓主緒丟 RuntimeError
            holder["error"] = f"{type(exc).__name__}: {exc}"
            logger.error("模型下載 worker 失敗: %s", exc, exc_info=True)

    t = threading.Thread(target=_run, name="autolyrics-model-dl", daemon=True)
    return t, holder


def _download_whisper(whisper_size: str, progress: Optional[ProgressFn], size_mb: float) -> None:
    try:
        from faster_whisper.utils import download_model as fw_download  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"faster-whisper 不可用,無法下載 Whisper: {exc}") from exc

    # 量測 scope 到此 repo 的 blobs/ 目錄成長 (而非整個 HF cache),避免其他
    # 下載/進程污染進度,也省去每 0.5s 掃整棵快取樹。repo 目錄下載前可能不存在,
    # _dir_size_bytes 對不存在路徑回 0,故起始基準 0、隨 blobs 寫入成長。
    blob_dir = _whisper_repo_blob_dir(whisper_size)
    start_bytes = _dir_size_bytes(blob_dir)

    worker, holder = _spawn_worker(lambda: fw_download(whisper_size))
    worker.start()
    _poll_progress_until_done(
        worker, holder, lambda: _dir_size_bytes(blob_dir),
        size_mb=size_mb, start_bytes=start_bytes,
        message=f"下載 Whisper {whisper_size}…", progress=progress,
    )


def _download_demucs(progress: Optional[ProgressFn], size_mb: float) -> None:
    try:
        from demucs.pretrained import get_model  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"demucs 不可用,無法下載 htdemucs: {exc}") from exc

    # 量測 scope 到 htdemucs 那「單一權重檔」(含 in-progress 暫存),而非整個
    # 共享 checkpoints/ 目錄 — 否則並行的 MMS 下載會灌爆 demucs 的進度。
    ckpt = _demucs_ckpt_path()
    start_bytes = _target_file_bytes(ckpt)

    worker, holder = _spawn_worker(lambda: get_model("htdemucs"))
    worker.start()
    _poll_progress_until_done(
        worker, holder, lambda: _target_file_bytes(ckpt),
        size_mb=size_mb, start_bytes=start_bytes,
        message="下載 Demucs htdemucs…", progress=progress,
    )


def _download_mms(progress: Optional[ProgressFn], size_mb: float) -> None:
    try:
        from torchaudio.pipelines import MMS_FA  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"torchaudio 不可用,無法下載 MMS 對齊器: {exc}") from exc

    # 量測 scope 到 MMS 的 checkpoints/model.pt 單檔 (含 in-progress 暫存),
    # 而非整個共享 checkpoints/ 目錄,避免並行 demucs 下載污染進度。
    ckpt = _mms_ckpt_path()
    start_bytes = _target_file_bytes(ckpt)

    worker, holder = _spawn_worker(lambda: MMS_FA.get_model())
    worker.start()
    _poll_progress_until_done(
        worker, holder, lambda: _target_file_bytes(ckpt),
        size_mb=size_mb, start_bytes=start_bytes,
        message="下載 MMS 對齊模型…", progress=progress,
    )


def download(model_id: str, progress: Optional[ProgressFn] = None) -> None:
    """下載指定模型;進度經 progress(pct, message) 回報。失敗丟 RuntimeError。"""
    meta = _BY_ID.get(model_id)
    if meta is None:
        raise RuntimeError(f"未知的模型 id: {model_id!r}")

    kind = meta.get("kind")
    size_mb = float(meta.get("sizeMB") or 100)

    # 序列化下載:避免兩個大型下載 (尤其共用 checkpoints/ 的 demucs 與 MMS)
    # 同時跑而互相污染進度基準。鎖的範圍只包住實際下載 + 量測迴圈。
    try:
        with _DOWNLOAD_LOCK:
            if kind == "whisper":
                _download_whisper(str(meta.get("whisperSize") or ""), progress, size_mb)
            elif kind == "demucs":
                _download_demucs(progress, size_mb)
            elif kind == "aligner":
                _download_mms(progress, size_mb)
            else:
                raise RuntimeError(f"不支援的模型類型: {kind!r}")
    except RuntimeError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"下載 {model_id} 失敗: {type(exc).__name__}: {exc}") from exc

    # 下載後驗證確實裝好。
    if not is_installed(model_id):
        raise RuntimeError(
            f"下載 {model_id} 後仍偵測不到安裝結果 (可能網路中斷或快取路徑異常)。"
        )


# --------------------------------------------------------------------------- #
# 刪除:清掉對應快取,回傳釋放的 MB
# --------------------------------------------------------------------------- #
def _delete_whisper(whisper_size: str) -> float:
    """刪掉 whisper repo 的 HF cache。回傳釋放 MB。"""
    repo_id = _whisper_repo_id(whisper_size)
    if not repo_id:
        raise RuntimeError(f"找不到 Whisper {whisper_size} 對應的 repo")

    freed_bytes = 0
    try:
        from huggingface_hub import scan_cache_dir  # type: ignore

        info = scan_cache_dir()
        revisions: list[str] = []
        for repo in info.repos:
            if repo.repo_id != repo_id:
                continue
            freed_bytes = int(repo.size_on_disk or 0)
            for rev in repo.revisions:
                revisions.append(rev.commit_hash)
        if revisions:
            strategy = info.delete_revisions(*revisions)
            strategy.execute()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"刪除 Whisper {whisper_size} 失敗: {exc}") from exc

    return _bytes_to_mb(freed_bytes)


def _delete_file(path: Optional[str], label: str) -> float:
    if not path or not os.path.isfile(path):
        raise RuntimeError(f"{label} 未安裝,無可刪除檔案")
    freed = _file_size_bytes(path)
    try:
        os.remove(path)
    except OSError as exc:
        raise RuntimeError(f"刪除 {label} 失敗: {exc}") from exc
    return _bytes_to_mb(freed)


def delete(model_id: str) -> dict[str, float]:
    """刪除已安裝模型,回傳 {"freedMB": float}。未安裝丟 RuntimeError。

    守門 (guards):
      * required 模型 (demucs / aligner) 不可刪除 — 刪了會停用人聲分離 / 強制對齊。
      * whisper 至少保留一個 — 不可刪掉最後一個已安裝的 Whisper。
    這些守門丟 RuntimeError;app.py 會對應成 HTTP 409 回前端。
    """
    meta = _BY_ID.get(model_id)
    if meta is None:
        raise RuntimeError(f"未知的模型 id: {model_id!r}")

    if not is_installed(model_id):
        raise RuntimeError(f"模型 {model_id} 尚未安裝,無法刪除")

    kind = meta.get("kind")

    # 守門 1:required 模型 (demucs htdemucs / MMS aligner) 不可刪。
    if meta.get("required"):
        label = meta.get("label", model_id)
        raise ModelDeleteGuardError(
            f"{label} 為必需模型,刪除將停用對應功能 (人聲分離 / 強制對齊),已拒絕。"
        )

    # 守門 2:至少保留一個已安裝的 Whisper 模型。
    if kind == "whisper":
        installed_whisper = [
            m for m in list_models()
            if m.get("kind") == "whisper" and m.get("installed")
        ]
        if len(installed_whisper) <= 1:
            raise ModelDeleteGuardError("至少需保留一個 Whisper 模型,無法刪除最後一個。")

    if kind == "whisper":
        freed = _delete_whisper(str(meta.get("whisperSize") or ""))
    elif kind == "demucs":
        freed = _delete_file(_demucs_ckpt_path(), "Demucs htdemucs")
    elif kind == "aligner":
        # content-aware:刪前再確認 checkpoints/model.pt 落在 MMS 大小帶,
        # 避免同名 model.pt 碰撞時誤刪無關模型權重 (見 _MMS_FILE 註解)。
        mms_path = _mms_ckpt_path()
        if not _is_mms_bundle(mms_path):
            raise RuntimeError(
                "checkpoints/model.pt 不在 MMS 對齊器的預期大小範圍,為避免誤刪其他模型已中止。"
            )
        freed = _delete_file(mms_path, "MMS 對齊器")
    else:
        raise RuntimeError(f"不支援的模型類型: {kind!r}")

    return {"freedMB": freed}
