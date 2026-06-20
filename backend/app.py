"""
AutoLyrics — 本地辨識引擎 FastAPI 伺服器.

單一事實來源 = ``API_CONTRACT.md``。前後端都必須完全吻合本檔實作的端點。
本地優先:只在 ``http://127.0.0.1:8756`` 服務,任何資料都不離開本機。

端點 (完全照 API_CONTRACT):
  GET  /api/meta                       —— 能力與選項清單 (給 UI 渲染)
  POST /api/jobs                       —— 建立辨識/對齊工作 (multipart: audio + params)
  GET  /api/jobs/{id}                  —— 輪詢工作狀態 / 取得結果
  GET  /api/jobs/{id}/export           —— 下載「原始」結果檔 (?fmt=&level=)
  POST /api/export                     —— 下載「編輯後」結果檔 (JSON body)

設計原則:永不讓整個伺服器崩潰。所有重相依 (torch / demucs / faster-whisper /
ctc-forced-aligner) 都在 pipeline 子模組內優雅降級;本檔再以 try/except 包覆
能力偵測與工作執行,確保啟動與 API 永遠可用。
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import tempfile
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ─────────────────────────────────────────────────────────────────────────────
# 紀錄
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("autolyrics.app")

# 由 Tauri 殼層在 spawn 時以 APP_VERSION 環境變數注入真實 App 版本;獨立執行時退回。
VERSION = os.environ.get("APP_VERSION", "0.1.0-dev")
HOST = "127.0.0.1"
# 預設 8756;可用 AUTOLYRICS_PORT 覆寫(供開發/測試在備用埠啟動,不影響正式行為)。
PORT = int(os.environ.get("AUTOLYRICS_PORT", "8756"))

# 後端根目錄 / 前端靜態檔目錄
BACKEND_DIR = Path(__file__).resolve().parent
WEB_DIR = BACKEND_DIR / "web"
# 上傳暫存目錄 (本機暫存,工作結束後清掉)
UPLOAD_DIR = Path(tempfile.gettempdir()) / "autolyrics_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# 相依模組:全部優雅載入 (缺席 → 對應能力標 False / 用佔位)
# ─────────────────────────────────────────────────────────────────────────────
try:  # 主管線 + 匯出格式函式 (由 pipeline/__init__.py re-export)
    from pipeline import run as pipeline_run
    from pipeline import to_ass, to_json, to_lrc, to_srt, to_vtt
except Exception as _e:  # pragma: no cover
    logger.error("無法載入 pipeline 套件:%r — API 仍會啟動,但工作會回報錯誤。", _e)
    _pipeline_err = _e

    def pipeline_run(*_a: Any, **_k: Any) -> dict:  # type: ignore[misc]
        raise ImportError(f"pipeline.run 不可用:{_pipeline_err!r}")

    def to_lrc(*_a: Any, **_k: Any) -> str:  # type: ignore[misc]
        raise ImportError(f"pipeline.to_lrc 不可用:{_pipeline_err!r}")

    def to_srt(*_a: Any, **_k: Any) -> str:  # type: ignore[misc]
        raise ImportError(f"pipeline.to_srt 不可用:{_pipeline_err!r}")

    def to_vtt(*_a: Any, **_k: Any) -> str:  # type: ignore[misc]
        raise ImportError(f"pipeline.to_vtt 不可用:{_pipeline_err!r}")

    def to_ass(*_a: Any, **_k: Any) -> str:  # type: ignore[misc]
        raise ImportError(f"pipeline.to_ass 不可用:{_pipeline_err!r}")

    def to_json(*_a: Any, **_k: Any) -> str:  # type: ignore[misc]
        raise ImportError(f"pipeline.to_json 不可用:{_pipeline_err!r}")


# 影片文字 / 區域移除 (AI inpainting) 子模組 —— 防禦式載入。
# inpaint 的重相依 (av / numpy / torch / simple_lama / cv2) 缺席時整個模組仍可
# 匯入 (is_available() 回 False),這裡再以 try/except 包一層:真的連匯入都失敗時
# inpaint=None,對應端點回 503 / avail=false,而非讓伺服器啟動崩潰。
try:
    from pipeline import inpaint as inpaint  # type: ignore[no-redef]
except Exception as _e:  # pragma: no cover
    logger.error("無法載入 pipeline.inpaint:%r — 文字移除功能停用,其餘 API 正常。", _e)
    inpaint = None  # type: ignore[assignment]


def _inpaint_available() -> bool:
    """影片文字移除是否可用 (模組載入成功且其 is_available() 為真)。"""
    if inpaint is None:
        return False
    try:
        return bool(inpaint.is_available())
    except Exception:  # noqa: BLE001
        return False


# 動態字幕燒錄 (hard-sub) 子模組 —— 同樣防禦式載入 (相依 av / numpy / PIL)。
try:
    from pipeline import caption as caption  # type: ignore[no-redef]
except Exception as _e:  # pragma: no cover
    logger.error("無法載入 pipeline.caption:%r — 字幕燒錄停用,其餘 API 正常。", _e)
    caption = None  # type: ignore[assignment]


def _caption_available() -> bool:
    """字幕燒錄是否可用 (模組載入成功且其 is_available() 為真)。"""
    if caption is None:
        return False
    try:
        return bool(caption.is_available())
    except Exception:  # noqa: BLE001
        return False


# 自動母帶 (Auto-Mastering) 子模組 —— 防禦式載入 (相依 scipy / pyloudnorm / numpy)。
try:
    from pipeline import mastering as mastering  # type: ignore[no-redef]
except Exception as _e:  # pragma: no cover
    logger.error("無法載入 pipeline.mastering:%r — 母帶功能停用,其餘 API 正常。", _e)
    mastering = None  # type: ignore[assignment]


def _mastering_available() -> bool:
    if mastering is None:
        return False
    try:
        return bool(mastering.is_available())
    except Exception:  # noqa: BLE001
        return False


def _gpu_available() -> bool:
    """torch.cuda 是否可用 (torch 未安裝 → False,絕不丟例外)。"""
    try:
        import torch  # type: ignore

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def _demucs_available() -> bool:
    """Demucs 人聲分離是否可用。"""
    try:
        from pipeline import separate  # type: ignore

        return bool(separate.is_available())
    except Exception:
        return False


def _aligner_available() -> bool:
    """強制對齊器 (ctc-forced-aligner) 是否可用。"""
    try:
        from pipeline import align  # type: ignore

        return bool(align.is_available())
    except Exception:
        return False


def _config():
    """取得 pipeline.config (給 /api/meta 的 styles / languages / modelSizes)。"""
    try:
        from pipeline import config  # type: ignore

        return config
    except Exception as e:  # pragma: no cover
        logger.warning("pipeline.config 載入失敗,/api/meta 將回退預設清單:%r", e)
        return None


def _models():
    """取得 pipeline.models (模型管理器);載入失敗回 None,絕不丟例外。"""
    try:
        from pipeline import models  # type: ignore

        return models
    except Exception as e:  # pragma: no cover
        logger.warning("pipeline.models 載入失敗,模型管理 API 將回退/回報錯誤:%r", e)
        return None


def _installed_whisper_sizes() -> list[str]:
    """已安裝的 whisper 模型對應的 whisperSize 字串清單 (給 /api/meta 閘控 UI)。"""
    mods = _models()
    if mods is None:
        return []
    try:
        out: list[str] = []
        for m in mods.list_models():
            if m.get("kind") == "whisper" and m.get("installed") and m.get("whisperSize"):
                out.append(str(m["whisperSize"]))
        return out
    except Exception as e:  # noqa: BLE001
        logger.warning("讀取已安裝 whisper 清單失敗:%r", e)
        return []


# ─────────────────────────────────────────────────────────────────────────────
# /api/meta 回退預設 (config 缺席時用,確保 UI 永遠拿得到選項)
# ─────────────────────────────────────────────────────────────────────────────
_FALLBACK_STYLES = [
    {"key": "pop", "label": "流行 Pop"},
    {"key": "ballad", "label": "抒情 Ballad"},
    {"key": "rock", "label": "搖滾 Rock"},
    {"key": "rap", "label": "饒舌 Rap / Hip-Hop"},
    {"key": "rnb", "label": "R&B / Soul"},
    {"key": "folk", "label": "民謠 Folk"},
    {"key": "electronic", "label": "電子 Electronic"},
    {"key": "kids", "label": "兒歌 Kids"},
]
_FALLBACK_LANGUAGES = [
    {"code": None, "label": "自動偵測 Auto", "iso3": "und"},
    {"code": "zh", "label": "中文國語 Mandarin", "iso3": "zho"},
    {"code": "yue", "label": "粵語 Cantonese", "iso3": "yue"},
    {"code": "en", "label": "English", "iso3": "eng"},
    {"code": "ja", "label": "日本語 Japanese", "iso3": "jpn"},
    {"code": "ko", "label": "한국어 Korean", "iso3": "kor"},
]
_FALLBACK_MODEL_SIZES = ["large-v3", "large-v3-turbo", "medium", "small"]
_FALLBACK_MODES = [
    {"key": "auto", "label": "自動辨識 Auto", "kind": "song"},
    {"key": "biasing", "label": "提示偏置 Biasing", "kind": "song"},
    {"key": "align", "label": "強制對齊 Forced-Align", "kind": "song"},
    {"key": "speech", "label": "影片字幕 Video → Subtitles", "kind": "speech"},
]
# 匯出格式清單 (給 UI 渲染下載選項;含新增的 vtt)
_FALLBACK_FORMATS = ["lrc", "srt", "vtt", "ass", "json"]


# ─────────────────────────────────────────────────────────────────────────────
# 工作狀態 (in-memory)
# ─────────────────────────────────────────────────────────────────────────────
# JOBS[id] = {
#   "status": "queued"|"running"|"done"|"error",
#   "stage": str, "pct": float, "message": str,
#   "result": dict|None, "error": str|None,
#   "_audio_path": str,   # 內部:暫存音檔,跑完清掉
# }
JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()


class JobParams(BaseModel):
    """POST /api/jobs 的 ``params`` JSON 結構 (完全照 API_CONTRACT)。"""

    mode: str = "auto"  # "auto" | "biasing" | "align" | "speech"
    referenceLyrics: str = ""
    referenceContent: str = ""
    styleKeys: list[str] = Field(default_factory=list)
    language: Optional[str] = None  # whisper code 或 None=auto
    modelSize: str = "large-v3"
    separate: bool = True
    device: str = "auto"  # "auto" | "cuda" | "cpu"
    engine: str = "whisper"
    # Precision options (forced-align mode)
    refine: bool = True  # snap word boundaries to nearest vocal onset
    demucsModel: str = "htdemucs"  # "htdemucs" | "htdemucs_ft"
    # 精準模式:歌曲/長音檔的進階解碼(hotwords 詞級偏置 + 反幻覺迴圈 + 較寬 beam)。
    # 預設關閉 → 維持舊行為,完全可切換。
    precision: bool = False
    # Video→Subtitles (speech) options
    task: Optional[str] = None  # faster-whisper task; None == "transcribe" (translate hook, not impl)


class ExportBody(BaseModel):
    """POST /api/export 的 JSON body。"""

    result: dict
    fmt: str = "lrc"  # "lrc" | "srt" | "vtt" | "ass" | "json"
    level: str = "line"  # "line" | "word"
    subtitle: bool = False  # apply video-subtitle cue shaping (wrap_cues) for srt/vtt


# ─────────────────────────────────────────────────────────────────────────────
# 進度回呼 + 工作執行緒
# ─────────────────────────────────────────────────────────────────────────────
def _make_progress(job_id: str):
    """產生一個 progress(stage, pct, msg) 回呼,直接就地更新 JOBS[job_id]。"""

    def progress(stage: str, pct: float, message: str = "") -> None:
        with _JOBS_LOCK:
            job = JOBS.get(job_id)
            if job is None:
                return
            # 一旦進入有實質進度的階段就標記 running
            if job["status"] in ("queued", "running"):
                job["status"] = "running"
            job["stage"] = str(stage)
            try:
                job["pct"] = max(0.0, min(100.0, float(pct)))
            except (TypeError, ValueError):
                pass
            if message:
                job["message"] = str(message)

    return progress


def _run_job(job_id: str, audio_path: str, params: JobParams) -> None:
    """背景執行緒主體:跑 pipeline.run,完成/失敗都回寫 JOBS。"""
    progress = _make_progress(job_id)
    try:
        progress("queued", 0.0, "準備中…")
        result = pipeline_run(
            audio_path,
            mode=params.mode,
            reference_lyrics=params.referenceLyrics,
            reference_content=params.referenceContent,
            style_keys=params.styleKeys,
            language=params.language,
            model_size=params.modelSize,
            separate=params.separate,
            device=params.device,
            engine=params.engine,
            refine=params.refine,
            demucs_model=params.demucsModel,
            task=params.task,
            precision=params.precision,
            progress=progress,
        )
        with _JOBS_LOCK:
            job = JOBS.get(job_id)
            if job is not None:
                job["status"] = "done"
                job["stage"] = "完成 Done"
                job["pct"] = 100.0
                job["message"] = "完成"
                job["result"] = result
                job["error"] = None
        logger.info("工作 %s 完成。", job_id)
    except Exception as e:  # noqa: BLE001 - 任何失敗都收斂成 error 狀態
        tb = traceback.format_exc()
        logger.error("工作 %s 失敗:%s\n%s", job_id, e, tb)
        with _JOBS_LOCK:
            job = JOBS.get(job_id)
            if job is not None:
                job["status"] = "error"
                job["stage"] = "錯誤 Error"
                job["message"] = str(e)
                job["error"] = str(e)
    finally:
        # 清掉暫存音檔 (本地優先,不留垃圾)
        try:
            if audio_path and os.path.exists(audio_path):
                os.remove(audio_path)
        except OSError:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# 匯出輔助
# ─────────────────────────────────────────────────────────────────────────────
_FMT_FUNCS = {
    "lrc": ("text/plain; charset=utf-8", "lrc"),
    "srt": ("application/x-subrip; charset=utf-8", "srt"),
    "vtt": ("text/vtt; charset=utf-8", "vtt"),
    "ass": ("text/x-ssa; charset=utf-8", "ass"),
    "json": ("application/json; charset=utf-8", "json"),
}


def _render_export(
    result: dict, fmt: str, level: str, subtitle: bool = False
) -> tuple[str, str, str]:
    """把 result 轉成指定格式,回傳 (內容文字, mime, 副檔名)。

    subtitle=True 時,srt/vtt 會套用影片字幕整形 (wrap_cues):切分過長段落、折成
    至多兩行。歌詞模式 (subtitle=False) 維持原樣輸出,不影響 lrc/ass/json。
    """
    fmt = (fmt or "lrc").lower()
    level = (level or "line").lower()
    if fmt not in _FMT_FUNCS:
        raise HTTPException(status_code=400, detail=f"不支援的格式 fmt={fmt!r}")
    if level not in ("line", "word"):
        raise HTTPException(status_code=400, detail=f"不支援的層級 level={level!r}")

    mime, ext = _FMT_FUNCS[fmt]
    try:
        if fmt == "lrc":
            text = to_lrc(result, level=level)
        elif fmt == "srt":
            text = to_srt(result, subtitle=subtitle)
        elif fmt == "vtt":
            text = to_vtt(result, level=level, subtitle=subtitle)
        elif fmt == "ass":
            text = to_ass(result, karaoke=(level == "word"))
        else:  # json
            text = to_json(result)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.error("匯出 %s 失敗:%s", fmt, e)
        raise HTTPException(status_code=500, detail=f"匯出 {fmt} 失敗:{e}") from e
    return text, mime, ext


def _download_response(text: str, mime: str, filename: str) -> Response:
    """回傳一個會觸發瀏覽器下載的文字檔回應。"""
    return Response(
        content=text,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 上傳輸入:接受的副檔名 (音訊 + 影片)。
# 影片由 PyAV / ffmpeg 解碼抽取音軌 (Demucs / faster-whisper 皆透過它讀檔),
# 因此「影片→字幕」(speech 模式) 可直接吃 mp4/mkv/mov/webm/m4v 等。
# 這裡只是用來保留「解碼器好認」的副檔名;未知副檔名仍接受 (以 .bin 落地),
# 由下游解碼器自行判斷,絕不在此因副檔名而拒收。
# ─────────────────────────────────────────────────────────────────────────────
_AUDIO_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma"}
_VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".webm", ".m4v", ".avi", ".flv", ".ts", ".wmv"}
_MEDIA_EXTS = _AUDIO_EXTS | _VIDEO_EXTS


def _safe_upload_suffix(filename: Optional[str]) -> str:
    """挑一個讓解碼器好認的暫存副檔名。

    已知音訊/影片副檔名原樣保留 (小寫);其他則回退 ``.bin`` 交由解碼器自行嗅探。
    不在此拒絕任何輸入 —— PyAV 能解的影片都應放行。
    """
    suffix = Path(filename or "").suffix.lower()
    if suffix in _MEDIA_EXTS:
        return suffix
    # 保留原副檔名 (即使不在清單內) 仍可能有助解碼;真的沒有才用 .bin。
    return Path(filename or "").suffix or ".bin"


# ─────────────────────────────────────────────────────────────────────────────
# 模型管理 — /api/models 端點群
# 偵測 / 下載 / 刪除統一委派給 pipeline.models;本檔保留輕量回退偵測,
# 確保 pipeline.models 缺席時 GET /api/models 仍可回應。
# ─────────────────────────────────────────────────────────────────────────────

# 下載作業 in-memory 登記表  job_id -> dict
MODEL_JOBS: dict[str, dict] = {}
_MODEL_JOBS_LOCK = threading.Lock()

# ─────────────────────────────────────────────────────────────────────────────
# 文字移除 (inpaint) 作業 in-memory 登記表
# INPAINT_JOBS[id] = {
#   "status": "queued"|"running"|"done"|"error",
#   "pct": float, "message": str, "error": str|None, "meta": dict|None,
#   "_video_path": str,   # 內部:暫存來源影片,跑完清掉
#   "_out_path": str,     # 內部:輸出 mp4,result 端點下載用
# }
INPAINT_JOBS: dict[str, dict[str, Any]] = {}
_INPAINT_JOBS_LOCK = threading.Lock()

# 動態字幕燒錄 (caption) 作業 in-memory 登記表 (結構同 INPAINT_JOBS)。
CAPTION_JOBS: dict[str, dict[str, Any]] = {}
_CAPTION_JOBS_LOCK = threading.Lock()

# 自動母帶 (mastering) 作業 in-memory 登記表 (結構同上)。
MASTER_JOBS: dict[str, dict[str, Any]] = {}
_MASTER_JOBS_LOCK = threading.Lock()


def _gpu_vram_total_mb() -> Optional[int]:
    """取得 GPU 總顯存 (MB)；torch 不可用或無 GPU 則回 None。"""
    try:
        import torch  # type: ignore

        if not torch.cuda.is_available():
            return None
        props = torch.cuda.get_device_properties(0)
        return int(props.total_memory / 1024 / 1024)
    except Exception:
        return None


# 模型目錄採 huggingface_hub 預設路徑或 faster-whisper 預設快取
def _hf_cache_dir() -> Path:
    """回傳 HuggingFace Hub 快取根目錄。"""
    env = os.environ.get("HF_HOME") or os.environ.get("HUGGINGFACE_HUB_CACHE")
    if env:
        return Path(env)
    return Path.home() / ".cache" / "huggingface"


def _demucs_cache_dir() -> Path:
    """Demucs 模型通常放在 torch.hub 快取裡。"""
    env = os.environ.get("TORCH_HOME")
    if env:
        return Path(env) / "hub"
    return Path.home() / ".cache" / "torch" / "hub"


# ── 模型目錄偵測 helpers ─────────────────────────────────────────────────────

def _whisper_repo_id_fallback(model_size: str) -> Optional[str]:
    """由 whisper size 取得 HF repo id (faster_whisper.utils._MODELS)。

    與 pipeline.models._whisper_repo_id 同源,確保 fallback 路徑對
    large-v3-turbo (mobiuslabsgmbh 組織) 等非 Systran repo 也判得正確。
    """
    try:
        from faster_whisper.utils import _MODELS  # type: ignore

        return _MODELS.get(model_size)
    except Exception:
        return None


def _repo_id_to_cache_dirname(repo_id: str) -> str:
    """把 HF repo id 'org/name' 轉成快取目錄名 'models--org--name'。"""
    return "models--" + repo_id.replace("/", "--")


def _whisper_model_dir(model_size: str) -> Optional[Path]:
    """回傳 faster-whisper 下載的模型目錄 (可能不存在)。"""
    hf = _hf_cache_dir()
    candidates: list[Path] = []

    # 優先:由 _MODELS 推導真正的 repo 目錄 (涵蓋 large-v3-turbo 的 mobiuslabsgmbh)
    repo_id = _whisper_repo_id_fallback(model_size)
    if repo_id:
        candidates.append(hf / "hub" / _repo_id_to_cache_dirname(repo_id))

    # 回退:常見作者命名 + 舊版佈局
    candidates += [
        hf / "hub" / f"models--Systran--faster-whisper-{model_size}",
        hf / "hub" / f"models--guillaumekln--faster-whisper-{model_size}",
        # 較舊版直接放在 faster_whisper/ 下
        Path.home() / ".cache" / "faster_whisper" / model_size,
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def _dir_size_mb(path: Path) -> float:
    """回傳目錄（含子目錄）的總大小 MB；路徑不存在則回 0。"""
    if not path or not path.exists():
        return 0.0
    total = 0
    try:
        for f in path.rglob("*"):
            if f.is_file():
                try:
                    total += f.stat().st_size
                except OSError:
                    pass
    except OSError:
        pass
    return total / 1024 / 1024


def _is_whisper_installed(model_size: str) -> tuple[bool, float]:
    """回傳 (是否已安裝, 磁碟用量 MB)。"""
    d = _whisper_model_dir(model_size)
    if d is None:
        return False, 0.0
    # 確認裡面有實際權重 (snapshots/ 下有 model.bin 或 .bin 檔)
    has_weights = any(d.rglob("model.bin")) or any(d.rglob("*.bin"))
    if not has_weights:
        return False, 0.0
    return True, _dir_size_mb(d)


def _demucs_checkpoint_files() -> list[Path]:
    """Demucs 權重以 .th checkpoint 存在 torch.hub/checkpoints/ 下(每個 .th 為一個子模型)。

    舊版本可能改放 facebookresearch_demucs_* 目錄;兩處都納入。
    """
    torch_hub = _demucs_cache_dir()
    files: list[Path] = []
    if torch_hub.exists():
        ckpt_dir = torch_hub / "checkpoints"
        if ckpt_dir.exists():
            files += [p for p in ckpt_dir.glob("*.th") if p.is_file()]
        # 舊佈局:facebookresearch_demucs_* 目錄內的 .th
        for d in torch_hub.glob("facebookresearch_demucs_*"):
            files += [p for p in d.rglob("*.th") if p.is_file()]
    return files


def _is_demucs_installed(ft: bool = False) -> tuple[bool, float]:
    """Demucs 模型偵測,回傳 (是否已安裝, 磁碟用量 MB)。

    ft=False(標準 htdemucs):只要有任一 .th checkpoint 即視為已安裝。
    ft=True(htdemucs_ft 微調 bag):需 ≥4 個 .th(該 bag 由 4 個子模型組成),否則回報
    未安裝 —— 否則使用者選「高品質」會在首次執行靜默下載 ~1.5 GB 而 UI 毫無提示。
    """
    files = _demucs_checkpoint_files()
    if not files:
        return False, 0.0
    total = sum(_dir_size_mb(p) for p in files)
    if ft:
        # htdemucs_ft = bag-of-4;少於 4 個 .th 代表微調權重尚未下載完整。
        if len(files) < 4:
            return False, total
        return True, total
    return True, total


def _is_aligner_installed() -> tuple[bool, float]:
    """torchaudio MMS_FA 模型偵測 (放在 torchaudio bundle 快取)。"""
    torch_hub = _demucs_cache_dir()
    # torchaudio 有自己的 hub 快取
    ta_hub = Path.home() / ".cache" / "torchaudio"
    aligner_dirs = []
    if ta_hub.exists():
        aligner_dirs += list(ta_hub.rglob("MMS_FA*"))
    if torch_hub.exists():
        aligner_dirs += list(torch_hub.glob("*torchaudio*"))
    # torchaudio bundle 也可能以 HF checkpoint 存放
    hf_aligner = _hf_cache_dir() / "hub"
    if hf_aligner.exists():
        aligner_dirs += list(hf_aligner.glob("*mms*"))
    if not aligner_dirs:
        return False, 0.0
    size = sum(_dir_size_mb(p) for p in aligner_dirs if Path(p).exists())
    return True, max(1.0, size)


# ── 模型靜態清單 ─────────────────────────────────────────────────────────────

# 每個模型的靜態描述 (不包含 installed / sizeOnDiskMB — 這些在執行期計算)
_MODEL_DEFS = [
    {
        "id": "whisper-large-v3",
        "kind": "whisper",
        "label": "Whisper large-v3",
        "description": "最高準確度，建議 8 GB 卡使用。Best accuracy — recommended for 8 GB.",
        "sizeMB": 3100,
        "recommended": True,
        "vramHint": "~6.2 GB VRAM",
        "whisperSize": "large-v3",
        "required": False,
    },
    {
        "id": "whisper-large-v3-turbo",
        "kind": "whisper",
        "label": "Whisper large-v3-turbo",
        "description": "large-v3 速度的 8× 加速蒸餾版，準確度略降。8× faster distilled, slightly less accurate.",
        "sizeMB": 1600,
        "recommended": False,
        "vramHint": "~3 GB VRAM",
        "whisperSize": "large-v3-turbo",
        "required": False,
    },
    {
        "id": "whisper-medium",
        "kind": "whisper",
        "label": "Whisper medium",
        "description": "速度與準度的平衡點。A balanced speed / accuracy pick.",
        "sizeMB": 1500,
        "recommended": False,
        "vramHint": "~3.1 GB VRAM",
        "whisperSize": "medium",
        "required": False,
    },
    {
        "id": "whisper-small",
        "kind": "whisper",
        "label": "Whisper small",
        "description": "最快，適合草稿或低階卡。Fastest — good for drafts or low VRAM.",
        "sizeMB": 500,
        "recommended": False,
        "vramHint": "~1.6 GB VRAM",
        "whisperSize": "small",
        "required": False,
    },
    {
        "id": "demucs-htdemucs",
        "kind": "demucs",
        "demucsModel": "htdemucs",
        "label": "Demucs htdemucs",
        "description": "人聲分離模型。讓辨識在乾淨人聲上運作，大幅提升準確度。Vocal separator — greatly improves transcription accuracy.",
        "sizeMB": 310,
        "recommended": True,
        "vramHint": "~2 GB VRAM",
        "whisperSize": None,
        "required": True,
    },
    {
        "id": "demucs-htdemucs-ft",
        "kind": "demucs",
        "demucsModel": "htdemucs_ft",
        "label": "Demucs htdemucs_ft",
        "description": "高品質微調人聲分離(bag-of-4，~4× 慢、需 8GB+)。首次選用「高品質」會額外下載此權重。High-quality fine-tuned separator — extra download on first use.",
        "sizeMB": 1500,
        "recommended": False,
        "vramHint": "~4 GB VRAM",
        "whisperSize": None,
        "required": False,
    },
    {
        "id": "aligner-mms",
        "kind": "aligner",
        "label": "MMS-FA Aligner",
        "description": "強制對齊模型 (torchaudio MMS_FA)。Forced-Align 模式必需。Required for Forced-Align mode.",
        "sizeMB": 1200,
        "recommended": True,
        "vramHint": "CPU-friendly",
        "whisperSize": None,
        "required": True,
    },
]

# whisperSize 字串 → model def id 的快查表
_WHISPER_SIZE_TO_ID: dict[str, str] = {
    d["whisperSize"]: d["id"]
    for d in _MODEL_DEFS
    if d["whisperSize"] is not None
}


def _build_model_info(defn: dict) -> dict:
    """把靜態定義合並執行期 installed / sizeOnDisk。"""
    kid = defn["id"]
    if defn["kind"] == "whisper":
        installed, on_disk = _is_whisper_installed(defn["whisperSize"])
    elif defn["kind"] == "demucs":
        # demucsModel 標記區分標準 htdemucs 與微調 bag htdemucs_ft(後者需 4 個子權重)。
        installed, on_disk = _is_demucs_installed(ft=defn.get("demucsModel") == "htdemucs_ft")
    else:  # aligner
        installed, on_disk = _is_aligner_installed()
    return {
        **defn,
        "installed": installed,
        "sizeOnDiskMB": round(on_disk, 1),
    }


def _disk_used_mb() -> float:
    """所有 AutoLyrics 相關模型快取的總磁碟用量 (MB)。"""
    total = 0.0
    counted_demucs = False
    for d in _MODEL_DEFS:
        if d["kind"] == "whisper":
            _, mb = _is_whisper_installed(d["whisperSize"])
        elif d["kind"] == "demucs":
            # htdemucs 與 htdemucs_ft 共用同一個 checkpoints/ 目錄;只計一次避免重複加總。
            if counted_demucs:
                continue
            _, mb = _is_demucs_installed()
            counted_demucs = True
        else:
            _, mb = _is_aligner_installed()
        total += mb
    return round(total, 1)


def _cache_dir_display() -> str:
    """UI 顯示用的快取目錄路徑。"""
    return str(_hf_cache_dir() / "hub")


# 註:實際的下載 / 偵測邏輯統一委派給 pipeline.models (單一事實來源);
# 上面的 _is_*_installed / _build_model_info 等僅作為 pipeline.models 缺席時的回退。


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI app
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="AutoLyrics Local API", version=VERSION)

# 本地使用:CORS 全開 (前端 dev server / Tauri / file:// 都能打)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/meta")
def api_meta() -> JSONResponse:
    """能力與選項清單。完全照 API_CONTRACT 的 GET /api/meta 形狀。"""
    cfg = _config()

    # styles:[{key,label}] — 從 config.STYLE_PRESETS 取,缺席用回退
    styles: list[dict] = []
    if cfg is not None and getattr(cfg, "STYLE_PRESETS", None):
        try:
            for key, preset in cfg.STYLE_PRESETS.items():
                styles.append({"key": key, "label": preset.get("label", key)})
        except Exception as e:  # noqa: BLE001
            logger.warning("讀取 STYLE_PRESETS 失敗,改用回退:%r", e)
    if not styles:
        styles = list(_FALLBACK_STYLES)

    # languages:[{code,label,iso3}]
    languages: list[dict] = []
    if cfg is not None and getattr(cfg, "LANGUAGES", None):
        try:
            for lang in cfg.LANGUAGES:
                languages.append(
                    {
                        "code": lang.get("code"),
                        "label": lang.get("label", lang.get("code") or "Auto"),
                        "iso3": lang.get("iso3", "und"),
                    }
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("讀取 LANGUAGES 失敗,改用回退:%r", e)
    if not languages:
        languages = list(_FALLBACK_LANGUAGES)

    # modelSizes
    model_sizes = _FALLBACK_MODEL_SIZES
    if cfg is not None and getattr(cfg, "MODEL_SIZES", None):
        try:
            model_sizes = list(cfg.MODEL_SIZES)
        except Exception:  # noqa: BLE001
            model_sizes = _FALLBACK_MODEL_SIZES

    # modes:[{key,label,kind}] — 含新增的 "speech" (影片→字幕);缺席用回退
    modes: list[dict] = []
    if cfg is not None and getattr(cfg, "MODES", None):
        try:
            for m in cfg.MODES:
                modes.append(
                    {
                        "key": m.get("key"),
                        "label": m.get("label", m.get("key")),
                        "kind": m.get("kind", "song"),
                    }
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("讀取 MODES 失敗,改用回退:%r", e)
    if not modes:
        modes = list(_FALLBACK_MODES)

    return JSONResponse(
        {
            "styles": styles,
            "languages": languages,
            "modelSizes": model_sizes,
            "modes": modes,
            "formats": _FALLBACK_FORMATS,
            "engines": ["whisper"],
            "gpu": _gpu_available(),
            "demucs": _demucs_available(),
            "aligner": _aligner_available(),
            "inpaint": _inpaint_available(),
            "caption": _caption_available(),
            "captionTemplates": caption.templates() if caption is not None else ["clean", "karaoke", "bold"],
            "mastering": _mastering_available(),
            "masterGenres": mastering.genres() if mastering is not None else [],
            "masterLoudness": mastering.loudness_targets() if mastering is not None else ["streaming", "balanced", "social"],
            "installedWhisper": _installed_whisper_sizes(),
            "version": VERSION,
        }
    )


@app.post("/api/jobs")
async def api_create_job(
    audio: UploadFile = File(...),
    params: str = Form(...),
) -> JSONResponse:
    """建立辨識/對齊工作。multipart:audio=檔案,params=JSON 字串。"""
    # 1) 解析 params JSON
    try:
        raw = json.loads(params) if params else {}
        if not isinstance(raw, dict):
            raise ValueError("params 必須是 JSON 物件")
        job_params = JobParams(**raw)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"params 解析失敗:{e}") from e

    # 2) 存上傳檔到暫存目錄 (保留音訊/影片副檔名,讓 PyAV/ffmpeg 好認)
    #    影片 (mp4/mkv/mov/webm/m4v…) 一律放行,由下游解碼抽音軌。
    job_id = uuid.uuid4().hex
    suffix = _safe_upload_suffix(audio.filename)
    dest = UPLOAD_DIR / f"{job_id}{suffix}"
    try:
        data = await audio.read()
        if not data:
            raise ValueError("上傳的檔案是空的")
        dest.write_bytes(data)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"上傳檔案儲存失敗:{e}") from e
    finally:
        await audio.close()

    # 3) 登記工作 + 起背景執行緒
    with _JOBS_LOCK:
        JOBS[job_id] = {
            "status": "queued",
            "stage": "排隊中 Queued",
            "pct": 0.0,
            "message": "已建立工作,等待開始…",
            "result": None,
            "error": None,
            "_audio_path": str(dest),
        }

    thread = threading.Thread(
        target=_run_job,
        args=(job_id, str(dest), job_params),
        name=f"autolyrics-job-{job_id[:8]}",
        daemon=True,
    )
    thread.start()

    return JSONResponse({"jobId": job_id})


@app.get("/api/jobs/{job_id}")
def api_get_job(job_id: str) -> JSONResponse:
    """輪詢工作狀態。status==done 才有 result;status==error 才有 error。"""
    with _JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此工作 jobId")
        payload: dict[str, Any] = {
            "status": job["status"],
            "stage": job["stage"],
            "pct": job["pct"],
            "message": job["message"],
        }
        if job["status"] == "done" and job.get("result") is not None:
            payload["result"] = job["result"]
        if job["status"] == "error" and job.get("error"):
            payload["error"] = job["error"]
    return JSONResponse(payload)


@app.get("/api/jobs/{job_id}/export")
def api_export_original(
    job_id: str, fmt: str = "lrc", level: str = "line", subtitle: bool = False
) -> Response:
    """下載「原始」(未編輯) 結果檔。

    subtitle=true 時,srt/vtt 會套用影片字幕整形 (適用「影片→字幕」模式)。
    """
    with _JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此工作 jobId")
        if job["status"] != "done" or not job.get("result"):
            raise HTTPException(status_code=409, detail="工作尚未完成,無法匯出")
        result = job["result"]

    text, mime, ext = _render_export(result, fmt, level, subtitle=subtitle)
    filename = f"{job_id}.{ext}"
    return _download_response(text, mime, filename)


@app.post("/api/export")
def api_export_edited(body: ExportBody) -> Response:
    """匯出「編輯後」結果。JSON body { result, fmt, level, subtitle } → 下載文字檔。"""
    if not isinstance(body.result, dict) or "segments" not in body.result:
        raise HTTPException(status_code=400, detail="result 結構不正確 (缺 segments)")
    text, mime, ext = _render_export(body.result, body.fmt, body.level, subtitle=body.subtitle)
    filename = f"autolyrics.{ext}"
    return _download_response(text, mime, filename)


# ─────────────────────────────────────────────────────────────────────────────
# 模型管理端點
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def api_health() -> JSONResponse:
    """GET /api/health — 環境健檢 + 自我修復報告。

    回報 Python 相依 (可 import + 版本)、CUDA、每個模型「有 vs 缺」,並彙整一份
    missing 清單供 UI 警告 + 只補抓缺少的部分。委派給 pipeline.health.full_report()。

    防禦式:即使 pipeline.health 或一堆重型相依缺席 (這正是它要偵測的情形),也絕不
    回 500 —— 退回一個最小化的 degraded 報告 (healthy=false),讓 UI 仍能引導修復。
    """
    try:
        from pipeline import health  # type: ignore

        return JSONResponse(health.full_report())
    except Exception as e:  # noqa: BLE001 - 連 health 模組都載不進來也不能 500
        logger.error("健檢模組不可用,回退最小化 degraded 報告:%r", e)
        return JSONResponse(
            {
                "healthy": False,
                "backend": "degraded",
                "deps": {},
                "cuda": {
                    "available": False,
                    "version": None,
                    "gpuName": None,
                    "vramTotalMB": None,
                },
                "models": [],
                "missing": [
                    {
                        "category": "dep",
                        "id": "pipeline.health",
                        "label": "Health module",
                        "required": True,
                        "reason": f"健檢模組載入失敗 · health module failed to load: {e}",
                    }
                ],
                "features": {
                    "songLyrics": False,
                    "videoSubtitles": False,
                    "cleanText": False,
                },
                "version": VERSION,
            }
        )


@app.get("/api/hardware")
def api_hardware() -> JSONResponse:
    """GET /api/hardware — machine hardware detection + model recommendation.

    Returns GPU name, VRAM, CUDA, CPU, RAM plus a recommended whisper model
    and a tier list showing which sizes fit the detected hardware.
    Never crashes: all fields fall back to safe defaults if detection fails.
    """
    try:
        from pipeline.hardware import get_hardware_info  # type: ignore
        info = get_hardware_info()
    except Exception as e:  # noqa: BLE001
        logger.error("硬體偵測失敗，回傳 CPU 安全預設值：%r", e)
        info = {
            "gpu": False,
            "gpuName": None,
            "vramTotalMB": None,
            "vramFreeMB": None,
            "cuda": False,
            "cudaVersion": None,
            "cpu": "Unknown",
            "cpuCount": 1,
            "ramTotalMB": None,
            "recommended": {
                "model": "whisper-small",
                "device": "cpu",
                "whisperSize": "small",
                "reasonCode": "cpu_only",
            },
            "tiers": [
                {"model": "whisper-small", "whisperSize": "small", "fits": True},
                {"model": "whisper-medium", "whisperSize": "medium", "fits": False},
                {"model": "whisper-large-v3", "whisperSize": "large-v3", "fits": False},
            ],
        }
    return JSONResponse(info)


@app.get("/api/models")
def api_list_models() -> JSONResponse:
    """列出所有模型及其安裝狀態。GET /api/models

    委派給 pipeline.models (單一事實來源);模組缺席時回退到本檔內建偵測,
    確保端點永不崩潰。
    """
    mods = _models()
    if mods is not None:
        try:
            return JSONResponse({
                "models": mods.list_models(),
                "diskUsedMB": mods.disk_used_mb(),
                "cacheDir": mods.cache_root(),
                "gpuVramTotalMB": mods.gpu_vram_total_mb(),
            })
        except Exception as e:  # noqa: BLE001
            logger.error("pipeline.models.list_models 失敗,回退內建偵測:%r", e)

    # 回退:本檔內建靜態定義 + 偵測 (pipeline.models 不可用時)
    models = [_build_model_info(d) for d in _MODEL_DEFS]
    return JSONResponse({
        "models": models,
        "diskUsedMB": _disk_used_mb(),
        "cacheDir": _cache_dir_display(),
        "gpuVramTotalMB": _gpu_vram_total_mb(),
    })


# ─────────────────────────────────────────────────────────────────────────────
# 儲存空間 (Storage) — 用量明細 + 清除所有模型
# 給設定頁「儲存空間」面板:讓使用者分層選擇要刪什麼 (單一模型 / 全部模型 /
# 完整重置)。本檔負責「全部模型」與用量明細;venv / WORK 重置由 Tauri 殼層 (lib.rs)
# 的 reset_backend 指令處理 (它知道 venv 路徑且能先 kill 後端釋放 python.exe 鎖)。
# ─────────────────────────────────────────────────────────────────────────────

def _venv_size_mb() -> float:
    """量測「目前執行中的 venv」磁碟用量 (MB) = sys.prefix 目錄遞迴加總。

    防禦式:逐檔 try/except 跳過讀不到的檔 (鎖定/權限);整體再包一層 try/except,
    任何失敗都回 0.0 而非崩潰 —— 用量明細缺一個數字也不該讓端點掛掉。
    """
    try:
        root = sys.prefix
        if not root or not os.path.isdir(root):
            return 0.0
        total = 0
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                fp = os.path.join(dirpath, name)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    continue
        return round(total / (1024.0 * 1024.0), 1)
    except Exception as e:  # noqa: BLE001 - 用量量測絕不崩潰
        logger.warning("量測 venv 大小失敗 (回 0):%r", e)
        return 0.0


@app.get("/api/storage")
def api_storage() -> JSONResponse:
    """GET /api/storage — 儲存空間用量明細,供設定頁「儲存空間」面板。

    回傳:
      { venvMB, modelsMB, models:[{id,label,kind,sizeOnDiskMB,required,installed}],
        cacheDir, totalMB }

    venvMB = 目前執行中 venv (sys.prefix) 的遞迴大小;無法計算則 0。
    modelsMB = pipeline.models.disk_used_mb() (所有模型快取總用量)。
    models = 全部模型 (含未安裝;只有 installed 者真正佔空間)。
    防禦式:任何子項失敗都回退安全值,端點永不 500。
    """
    venv_mb = _venv_size_mb()

    mods = _models()
    models_mb = 0.0
    cache_dir = ""
    model_rows: list[dict[str, Any]] = []
    if mods is not None:
        try:
            models_mb = float(mods.disk_used_mb())
        except Exception as e:  # noqa: BLE001
            logger.warning("disk_used_mb 失敗 (回 0):%r", e)
        try:
            cache_dir = str(mods.cache_root())
        except Exception as e:  # noqa: BLE001
            logger.warning("cache_root 失敗 (回退):%r", e)
        try:
            for m in mods.list_models():
                model_rows.append({
                    "id": m.get("id"),
                    "label": m.get("label"),
                    "kind": m.get("kind"),
                    "sizeOnDiskMB": round(float(m.get("sizeOnDiskMB") or 0.0), 1),
                    "required": bool(m.get("required")),
                    "installed": bool(m.get("installed")),
                })
        except Exception as e:  # noqa: BLE001
            logger.warning("list_models 失敗 (回退空清單):%r", e)
    else:
        # pipeline.models 缺席 → 回退到本檔內建偵測 (與 /api/models 一致)。
        try:
            models_mb = _disk_used_mb()
            cache_dir = _cache_dir_display()
            for d in _MODEL_DEFS:
                info = _build_model_info(d)
                model_rows.append({
                    "id": info.get("id"),
                    "label": info.get("label"),
                    "kind": info.get("kind"),
                    "sizeOnDiskMB": round(float(info.get("sizeOnDiskMB") or 0.0), 1),
                    "required": bool(info.get("required")),
                    "installed": bool(info.get("installed")),
                })
        except Exception as e:  # noqa: BLE001
            logger.warning("儲存明細回退偵測失敗:%r", e)

    total_mb = round(venv_mb + models_mb, 1)
    return JSONResponse({
        "venvMB": round(venv_mb, 1),
        "modelsMB": round(models_mb, 1),
        "models": model_rows,
        "cacheDir": cache_dir,
        "totalMB": total_mb,
    })


@app.post("/api/models/clear-all")
def api_clear_all_models() -> JSONResponse:
    """POST /api/models/clear-all — 刪除「所有」已安裝的模型檔。

    回傳 { clearedIds:[...], freedMB }。

    對每個已安裝模型呼叫 pipeline.models.delete(id, force=True),旁路 required /
    最後一個 Whisper 守門 —— 使用者明確選擇「清除所有模型」,health/self-heal 會在
    下次需要時自動補抓必需模型。防禦式:單一模型刪除失敗只記 log、不中止其餘刪除。
    """
    mods = _models()
    if mods is None:
        raise HTTPException(status_code=500, detail="pipeline.models 不可用,無法清除模型")

    try:
        all_models = mods.list_models()
    except Exception as e:  # noqa: BLE001
        logger.error("清除所有模型:列出模型失敗:%r", e)
        raise HTTPException(status_code=500, detail=f"列出模型失敗:{e}") from e

    cleared_ids: list[str] = []
    freed_mb = 0.0
    for m in all_models:
        if not m.get("installed"):
            continue
        model_id = m.get("id")
        if not model_id:
            continue
        try:
            # force=True 旁路守門 (required / 最後一個 whisper);單一失敗不影響其餘。
            result = mods.delete(model_id, force=True)
            freed_mb += float(result.get("freedMB", 0.0))
            cleared_ids.append(str(model_id))
            logger.info("清除所有模型:已刪除 %s (釋放 %.1f MB)", model_id, result.get("freedMB", 0.0))
        except Exception as exc:  # noqa: BLE001 - 一個失敗不可中止其餘
            logger.error("清除所有模型:刪除 %s 失敗 (已略過):%s", model_id, exc)

    return JSONResponse({
        "clearedIds": cleared_ids,
        "freedMB": round(freed_mb, 1),
    })


def _run_model_download(model_id: str, job_id: str) -> None:
    """背景執行緒主體:跑 pipeline.models.download 並把進度回寫 MODEL_JOBS。"""
    def _set(pct: float, msg: str, status: str = "running") -> None:
        with _MODEL_JOBS_LOCK:
            job = MODEL_JOBS.get(job_id)
            if job is not None:
                try:
                    job["pct"] = max(0.0, min(100.0, float(pct)))
                except (TypeError, ValueError):
                    pass
                if msg:
                    job["message"] = str(msg)
                job["status"] = status

    def _progress(pct: float, message: str) -> None:
        # pipeline.models.download 回呼 progress(pct, message)
        _set(pct, message, "running")

    mods = _models()
    if mods is None:
        _set(0, "pipeline.models 不可用,無法下載模型", "error")
        with _MODEL_JOBS_LOCK:
            if job_id in MODEL_JOBS:
                MODEL_JOBS[job_id]["error"] = "pipeline.models 不可用"
        return

    try:
        _set(0, f"準備下載 {model_id}…")
        mods.download(model_id, progress=_progress)
        _set(100, "下載完成 Done", "done")
        logger.info("模型 %s 下載完成 (job=%s)", model_id, job_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("模型下載失敗 %s: %s", model_id, exc)
        with _MODEL_JOBS_LOCK:
            if job_id in MODEL_JOBS:
                MODEL_JOBS[job_id].update({
                    "status": "error",
                    "message": str(exc),
                    "error": str(exc),
                })


@app.post("/api/models/{model_id}/download")
def api_download_model(model_id: str) -> JSONResponse:
    """啟動模型下載作業。POST /api/models/{id}/download → { jobId }"""
    mods = _models()
    meta = mods.get_meta(model_id) if mods is not None else None
    if meta is None:
        # 未知 id → 404 (與 contract 一致)
        raise HTTPException(status_code=404, detail=f"未知模型 id={model_id!r}")

    job_id = uuid.uuid4().hex
    with _MODEL_JOBS_LOCK:
        MODEL_JOBS[job_id] = {
            "status": "running",
            "pct": 0.0,
            "message": "準備中…",
            "error": None,
        }

    t = threading.Thread(
        target=_run_model_download,
        args=(model_id, job_id),
        daemon=True,
        name=f"dl-{model_id[:24]}",
    )
    t.start()
    return JSONResponse({"jobId": job_id})


@app.get("/api/models/jobs/{job_id}")
def api_get_model_job(job_id: str) -> JSONResponse:
    """輪詢模型下載作業進度。GET /api/models/jobs/{jobId}"""
    with _MODEL_JOBS_LOCK:
        job = MODEL_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"找不到下載作業 jobId={job_id!r}")
    payload: dict[str, Any] = {
        "status": job["status"],
        "pct": job["pct"],
        "message": job["message"],
    }
    if job.get("error"):
        payload["error"] = job["error"]
    return JSONResponse(payload)


@app.delete("/api/models/{model_id}")
def api_delete_model(model_id: str) -> JSONResponse:
    """刪除已安裝的模型。DELETE /api/models/{id} → { ok, freedMB }"""
    mods = _models()
    if mods is None:
        raise HTTPException(status_code=500, detail="pipeline.models 不可用,無法刪除模型")

    meta = mods.get_meta(model_id)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"未知模型 id={model_id!r}")
    if not meta.get("installed"):
        raise HTTPException(status_code=409, detail="模型尚未安裝 Not installed")

    # 守門例外 (required 模型 / 最後一個 Whisper) → 409 Conflict;其餘 → 500。
    guard_exc = getattr(mods, "ModelDeleteGuardError", None)
    try:
        result = mods.delete(model_id)
    except Exception as exc:  # noqa: BLE001
        if guard_exc is not None and isinstance(exc, guard_exc):
            logger.info("拒絕刪除受保護模型 %s: %s", model_id, exc)
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        logger.error("刪除模型失敗 %s: %s", model_id, exc)
        raise HTTPException(status_code=500, detail=f"刪除模型失敗:{exc}") from exc

    return JSONResponse({"ok": True, "freedMB": round(float(result.get("freedMB", 0.0)), 1)})


# ─────────────────────────────────────────────────────────────────────────────
# 文字移除 (inpaint) 端點群 —— 「文字移除 / Clean Text」模式
# 使用者框出燒錯的文字 (固定位置),AI inpainting (LaMa) 逐幀抹除該區域,
# 輸出保留原音軌的新 mp4。重相依缺席時整組端點回 503 / avail=false,絕不崩潰。
# ─────────────────────────────────────────────────────────────────────────────

def _require_inpaint() -> None:
    """inpaint 不可用時丟 503,讓相依缺席優雅降級而非 500/崩潰。"""
    if not _inpaint_available():
        raise HTTPException(
            status_code=503,
            detail="文字移除功能不可用 (缺 PyAV/numpy)。請重新執行安裝以取得相依套件。",
        )


def _make_inpaint_progress(job_id: str):
    """產生 progress(stage, pct, msg) 回呼,就地更新 INPAINT_JOBS[job_id]。"""

    def progress(stage: str, pct: float, message: str = "") -> None:
        with _INPAINT_JOBS_LOCK:
            job = INPAINT_JOBS.get(job_id)
            if job is None:
                return
            if job["status"] in ("queued", "running"):
                job["status"] = "running"
            try:
                job["pct"] = max(0.0, min(100.0, float(pct)))
            except (TypeError, ValueError):
                pass
            if message:
                job["message"] = str(message)

    return progress


def _run_inpaint_job(
    job_id: str,
    video_path: str,
    out_path: str,
    regions: list[dict],
    engine: str,
    time_range: Optional[tuple[float, float]],
    track: bool = False,
) -> None:
    """背景執行緒主體:跑 inpaint.remove_text,完成/失敗都回寫 INPAINT_JOBS。

    來源影片在結束時清掉;輸出 mp4 保留供 result 端點下載 (由前端取走後再清,
    或隨暫存目錄被作業系統回收)。永不讓伺服器崩潰。

    track=True 且恰好一個 region 時 → 動態追蹤該移動文字/浮水印的位置逐幀抹除
    (見 inpaint.remove_text 的 track 參數);否則固定位置整片同框。
    """
    progress = _make_inpaint_progress(job_id)
    try:
        progress("inpaint", 0.0, "準備中…")
        if inpaint is None:  # pragma: no cover - 已由 _require_inpaint 擋住,雙保險
            raise RuntimeError("pipeline.inpaint 不可用")
        result = inpaint.remove_text(
            video_path,
            regions,
            out_path,
            engine=engine,
            device="auto",
            time_range=time_range,
            track=track,
            progress=progress,
        )
        with _INPAINT_JOBS_LOCK:
            job = INPAINT_JOBS.get(job_id)
            if job is not None:
                job["status"] = "done"
                job["pct"] = 100.0
                job["message"] = "完成 Done"
                job["meta"] = result
                job["error"] = None
        logger.info("文字移除工作 %s 完成。", job_id)
    except Exception as e:  # noqa: BLE001 - 任何失敗都收斂成 error 狀態
        tb = traceback.format_exc()
        logger.error("文字移除工作 %s 失敗:%s\n%s", job_id, e, tb)
        with _INPAINT_JOBS_LOCK:
            job = INPAINT_JOBS.get(job_id)
            if job is not None:
                job["status"] = "error"
                job["message"] = str(e)
                job["error"] = str(e)
    finally:
        # 清掉暫存來源影片 (輸出 mp4 留著給 result 端點)。
        try:
            if video_path and os.path.exists(video_path):
                os.remove(video_path)
        except OSError:
            pass


@app.post("/api/inpaint/frame")
async def api_inpaint_frame(
    video: UploadFile = File(...),
    at: float = Form(0.0),
) -> Response:
    """擷取影片某時間點的單幀為 JPEG,供前端畫布讓使用者框選要移除的區域。

    multipart:video=影片檔,at=秒 (預設 0)。回傳 image/jpeg。
    """
    _require_inpaint()

    # 存上傳影片到暫存 (保留副檔名讓 PyAV 好認),抽幀後立刻刪除。
    tmp_id = uuid.uuid4().hex
    suffix = _safe_upload_suffix(video.filename)
    dest = UPLOAD_DIR / f"frame_{tmp_id}{suffix}"
    try:
        data = await video.read()
        if not data:
            raise HTTPException(status_code=400, detail="上傳的影片是空的")
        dest.write_bytes(data)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"上傳影片儲存失敗:{e}") from e
    finally:
        await video.close()

    try:
        jpeg = inpaint.first_frame_jpeg(str(dest), at_sec=float(at))  # type: ignore[union-attr]
    except Exception as e:  # noqa: BLE001
        logger.error("擷取影格失敗:%s", e)
        raise HTTPException(status_code=500, detail=f"擷取影格失敗:{e}") from e
    finally:
        try:
            if dest.exists():
                dest.unlink()
        except OSError:
            pass

    return Response(content=jpeg, media_type="image/jpeg")


@app.post("/api/inpaint")
async def api_inpaint(
    video: UploadFile = File(...),
    regions: str = Form(...),
    engine: str = Form("lama"),
    startSec: Optional[float] = Form(None),
    endSec: Optional[float] = Form(None),
    track: bool = Form(False),
) -> JSONResponse:
    """建立文字移除工作。multipart:video=影片,regions=JSON 字串
    ([{x,y,w,h} 正規化 0..1]),engine=lama|opencv,選用 startSec/endSec/track。

    track=true 且**恰好一個** region 時 = **動態追蹤**:把使用者在第一幀框出的框
    內當模板,逐幀以 cv2.matchTemplate 追蹤移動文字/浮水印/物件並於追蹤位置抹除。
    track=false(預設)或 region 數 != 1 時 = 固定位置整片同框(行為與舊版相同)。

    回傳 { jobId };背景執行緒跑 inpaint.remove_text → 暫存 <jobId>.mp4。
    """
    _require_inpaint()

    # 1) 解析 regions JSON
    try:
        parsed = json.loads(regions) if regions else []
        if not isinstance(parsed, list) or not parsed:
            raise ValueError("regions 必須是非空陣列")
        clean_regions: list[dict] = []
        for r in parsed:
            if not isinstance(r, dict):
                raise ValueError("每個區域必須是物件 {x,y,w,h}")
            clean_regions.append(
                {
                    "x": float(r["x"]),
                    "y": float(r["y"]),
                    "w": float(r["w"]),
                    "h": float(r["h"]),
                }
            )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"regions 解析失敗:{e}") from e

    eng = (engine or "lama").strip().lower()
    if eng not in ("lama", "opencv"):
        eng = "lama"

    # time_range:兩端都有才成立;只給一端則視為無效時間窗 → 全片處理。
    time_range: Optional[tuple[float, float]] = None
    if startSec is not None and endSec is not None:
        try:
            time_range = (float(startSec), float(endSec))
        except (TypeError, ValueError):
            time_range = None

    # 2) 存上傳影片到暫存 (保留副檔名)
    job_id = uuid.uuid4().hex
    suffix = _safe_upload_suffix(video.filename)
    src = UPLOAD_DIR / f"inpaint_{job_id}{suffix}"
    out = UPLOAD_DIR / f"{job_id}.mp4"
    try:
        data = await video.read()
        if not data:
            raise HTTPException(status_code=400, detail="上傳的影片是空的")
        src.write_bytes(data)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"上傳影片儲存失敗:{e}") from e
    finally:
        await video.close()

    # 3) 登記工作 + 起背景執行緒
    with _INPAINT_JOBS_LOCK:
        INPAINT_JOBS[job_id] = {
            "status": "queued",
            "pct": 0.0,
            "message": "已建立工作,等待開始…",
            "error": None,
            "meta": None,
            "_video_path": str(src),
            "_out_path": str(out),
        }

    thread = threading.Thread(
        target=_run_inpaint_job,
        args=(job_id, str(src), str(out), clean_regions, eng, time_range, bool(track)),
        name=f"autolyrics-inpaint-{job_id[:8]}",
        daemon=True,
    )
    thread.start()

    return JSONResponse({"jobId": job_id})


@app.get("/api/inpaint/jobs/{job_id}")
def api_get_inpaint_job(job_id: str) -> JSONResponse:
    """輪詢文字移除工作狀態。GET /api/inpaint/jobs/{jobId}"""
    with _INPAINT_JOBS_LOCK:
        job = INPAINT_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此文字移除工作 jobId")
        payload: dict[str, Any] = {
            "status": job["status"],
            "pct": job["pct"],
            "message": job["message"],
            "error": job.get("error"),
            "meta": job.get("meta"),
        }
    return JSONResponse(payload)


@app.get("/api/inpaint/jobs/{job_id}/result")
def api_get_inpaint_result(job_id: str) -> FileResponse:
    """下載文字移除輸出的 mp4。GET /api/inpaint/jobs/{jobId}/result

    工作未完成 (或檔案不存在) → 404;完成 → video/mp4 附件下載。
    """
    with _INPAINT_JOBS_LOCK:
        job = INPAINT_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此文字移除工作 jobId")
        if job["status"] != "done":
            raise HTTPException(status_code=404, detail="工作尚未完成,結果尚未就緒")
        out_path = job.get("_out_path")
    if not out_path or not os.path.exists(out_path):
        raise HTTPException(status_code=404, detail="找不到輸出檔案")
    return FileResponse(
        out_path,
        media_type="video/mp4",
        filename="cleaned.mp4",
    )


# ─────────────────────────────────────────────────────────────────────────────
# 動態字幕燒錄 (caption / hard-sub) 端點群 —— 把辨識結果的逐字字幕燒進影片。
# 重相依 (av/numpy/PIL) 缺席時回 503 / avail=false,絕不崩潰。
# ─────────────────────────────────────────────────────────────────────────────
def _require_caption() -> None:
    if not _caption_available():
        raise HTTPException(
            status_code=503,
            detail="字幕燒錄功能不可用 (缺 PyAV/numpy/PIL)。請重新執行安裝以取得相依套件。",
        )


def _make_caption_progress(job_id: str):
    def progress(stage: str, pct: float, message: str = "") -> None:
        with _CAPTION_JOBS_LOCK:
            job = CAPTION_JOBS.get(job_id)
            if job is None:
                return
            if job["status"] in ("queued", "running"):
                job["status"] = "running"
            try:
                job["pct"] = max(0.0, min(100.0, float(pct)))
            except (TypeError, ValueError):
                pass
            if message:
                job["message"] = str(message)

    return progress


def _run_caption_job(
    job_id: str,
    video_path: str,
    out_path: str,
    segments: list[dict],
    template: str,
) -> None:
    """背景執行緒主體:跑 caption.burn_captions,完成/失敗都回寫 CAPTION_JOBS。"""
    progress = _make_caption_progress(job_id)
    try:
        progress("caption", 0.0, "準備中…")
        if caption is None:  # pragma: no cover - 已由 _require_caption 擋住
            raise RuntimeError("pipeline.caption 不可用")
        result = caption.burn_captions(
            video_path,
            segments,
            out_path,
            template=template,
            device="auto",
            progress=progress,
        )
        with _CAPTION_JOBS_LOCK:
            job = CAPTION_JOBS.get(job_id)
            if job is not None:
                job["status"] = "done"
                job["pct"] = 100.0
                job["message"] = "完成 Done"
                job["meta"] = result
                job["error"] = None
        logger.info("字幕燒錄工作 %s 完成。", job_id)
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc()
        logger.error("字幕燒錄工作 %s 失敗:%s\n%s", job_id, e, tb)
        with _CAPTION_JOBS_LOCK:
            job = CAPTION_JOBS.get(job_id)
            if job is not None:
                job["status"] = "error"
                job["message"] = str(e)
                job["error"] = str(e)
    finally:
        try:
            if video_path and os.path.exists(video_path):
                os.remove(video_path)
        except OSError:
            pass


@app.post("/api/caption")
async def api_caption(
    video: UploadFile = File(...),
    segments: str = Form(...),
    template: str = Form("clean"),
) -> JSONResponse:
    """建立字幕燒錄工作。multipart:video=影片,segments=JSON 字串
    (辨識結果的 segments 陣列,含 words 逐字時間),template=clean|karaoke|bold。

    回傳 { jobId };背景執行緒跑 caption.burn_captions → 暫存 <jobId>.mp4。
    """
    _require_caption()

    # 1) 解析 segments JSON
    try:
        parsed = json.loads(segments) if segments else []
        if not isinstance(parsed, list) or not parsed:
            raise ValueError("segments 必須是非空陣列")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"segments 解析失敗:{e}") from e

    tpl = (template or "clean").strip().lower()
    valid_templates = caption.templates() if caption is not None else ["clean"]  # type: ignore[union-attr]
    if tpl not in valid_templates:
        tpl = "clean"

    # 2) 存上傳影片
    job_id = uuid.uuid4().hex
    suffix = _safe_upload_suffix(video.filename)
    src = UPLOAD_DIR / f"caption_{job_id}{suffix}"
    out = UPLOAD_DIR / f"cap_{job_id}.mp4"
    try:
        data = await video.read()
        if not data:
            raise HTTPException(status_code=400, detail="上傳的影片是空的")
        src.write_bytes(data)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"上傳影片儲存失敗:{e}") from e
    finally:
        await video.close()

    # 3) 登記工作 + 起背景執行緒
    with _CAPTION_JOBS_LOCK:
        CAPTION_JOBS[job_id] = {
            "status": "queued",
            "pct": 0.0,
            "message": "已建立工作,等待開始…",
            "error": None,
            "meta": None,
            "_video_path": str(src),
            "_out_path": str(out),
        }

    thread = threading.Thread(
        target=_run_caption_job,
        args=(job_id, str(src), str(out), parsed, tpl),
        name=f"autolyrics-caption-{job_id[:8]}",
        daemon=True,
    )
    thread.start()

    return JSONResponse({"jobId": job_id})


@app.get("/api/caption/jobs/{job_id}")
def api_get_caption_job(job_id: str) -> JSONResponse:
    """輪詢字幕燒錄工作狀態。GET /api/caption/jobs/{jobId}"""
    with _CAPTION_JOBS_LOCK:
        job = CAPTION_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此字幕燒錄工作 jobId")
        payload: dict[str, Any] = {
            "status": job["status"],
            "pct": job["pct"],
            "message": job["message"],
            "error": job.get("error"),
            "meta": job.get("meta"),
        }
    return JSONResponse(payload)


@app.get("/api/caption/jobs/{job_id}/result")
def api_get_caption_result(job_id: str) -> FileResponse:
    """下載字幕燒錄輸出的 mp4。GET /api/caption/jobs/{jobId}/result"""
    with _CAPTION_JOBS_LOCK:
        job = CAPTION_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此字幕燒錄工作 jobId")
        if job["status"] != "done":
            raise HTTPException(status_code=404, detail="工作尚未完成,結果尚未就緒")
        out_path = job.get("_out_path")
    if not out_path or not os.path.exists(out_path):
        raise HTTPException(status_code=404, detail="找不到輸出檔案")
    return FileResponse(out_path, media_type="video/mp4", filename="captioned.mp4")


# ─────────────────────────────────────────────────────────────────────────────
# 自動母帶 (mastering / Auto-Mastering) 端點群 —— 「母帶」模式。
# 把一首混音處理成可發佈母帶(EQ/壓縮/寬度/響度/限幅)。重相依缺席時回 503。
# ─────────────────────────────────────────────────────────────────────────────
def _require_mastering() -> None:
    if not _mastering_available():
        raise HTTPException(
            status_code=503,
            detail="母帶功能不可用 (缺 scipy/pyloudnorm)。請重新執行安裝以取得相依套件。",
        )


def _make_master_progress(job_id: str):
    def progress(stage: str, pct: float, message: str = "") -> None:
        with _MASTER_JOBS_LOCK:
            job = MASTER_JOBS.get(job_id)
            if job is None:
                return
            if job["status"] in ("queued", "running"):
                job["status"] = "running"
            try:
                job["pct"] = max(0.0, min(100.0, float(pct)))
            except (TypeError, ValueError):
                pass
            if message:
                job["message"] = str(message)

    return progress


def _run_master_job(
    job_id: str,
    audio_path: str,
    out_path: str,
    matched_path: str,
    genre: str,
    loudness: str,
    reference_path: Optional[str],
    opts: dict,
) -> None:
    progress = _make_master_progress(job_id)
    try:
        progress("master", 0.0, "準備中…")
        if mastering is None:  # pragma: no cover
            raise RuntimeError("pipeline.mastering 不可用")
        result = mastering.master(
            audio_path,
            out_path,
            matched_output_path=matched_path,
            genre=genre,
            loudness=loudness,
            reference_path=reference_path,
            width=opts.get("width"),
            dynamics=opts.get("dynamics", 0.0),
            eq=opts.get("eq"),
            comp_scale=opts.get("comp_scale", 1.0),
            ceiling_db=opts.get("ceiling_db"),
            auto=opts.get("auto", False),
            auto_strength=opts.get("auto_strength", 0.7),
            de_ess=opts.get("de_ess"),
            de_ess_amount=opts.get("de_ess_amount"),
            multiband=opts.get("multiband"),
            saturation=opts.get("saturation", 0.0),
            residual_eq=opts.get("residual_eq"),
            progress=progress,
        )
        with _MASTER_JOBS_LOCK:
            job = MASTER_JOBS.get(job_id)
            if job is not None:
                job["status"] = "done"
                job["pct"] = 100.0
                job["message"] = "完成 Done"
                job["meta"] = result
                job["error"] = None
        logger.info("母帶工作 %s 完成。", job_id)
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc()
        logger.error("母帶工作 %s 失敗:%s\n%s", job_id, e, tb)
        with _MASTER_JOBS_LOCK:
            job = MASTER_JOBS.get(job_id)
            if job is not None:
                job["status"] = "error"
                job["message"] = str(e)
                job["error"] = str(e)
    finally:
        for p in (audio_path, reference_path):
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass


@app.post("/api/master")
async def api_master(
    audio: UploadFile = File(...),
    genre: str = Form("auto"),
    loudness: str = Form("streaming"),
    reference: Optional[UploadFile] = File(None),
    # 進階(皆選用):立體聲寬度 / 區段動態 / 4 段 EQ / 壓縮倍率 / 真峰天花板
    width: Optional[float] = Form(None),
    dynamics: Optional[float] = Form(None),
    eqBass: Optional[float] = Form(None),
    eqLowMid: Optional[float] = Form(None),
    eqPresence: Optional[float] = Form(None),
    eqAir: Optional[float] = Form(None),
    compScale: Optional[float] = Form(None),
    ceiling: Optional[float] = Form(None),
    auto: Optional[bool] = Form(None),
    autoStrength: Optional[float] = Form(None),
    deEss: Optional[bool] = Form(None),
    deEssAmount: Optional[float] = Form(None),
    multiband: Optional[bool] = Form(None),
    saturation: Optional[float] = Form(None),
    residualEq: Optional[bool] = Form(None),
) -> JSONResponse:
    """建立母帶工作。multipart:audio=混音檔,genre,loudness,選用 reference=參考曲,
    以及選用的進階參數(width/dynamics/eq*/compScale/ceiling)。
    回傳 { jobId };背景跑 mastering.master → 暫存 mastered_<jobId>.wav。"""
    _require_mastering()

    def _f(v: Optional[float], lo: float, hi: float) -> Optional[float]:
        if v is None:
            return None
        try:
            return max(lo, min(hi, float(v)))
        except (TypeError, ValueError):
            return None

    eq_bands = {
        "bass": _f(eqBass, -12, 12) or 0.0,
        "lowMid": _f(eqLowMid, -12, 12) or 0.0,
        "presence": _f(eqPresence, -12, 12) or 0.0,
        "air": _f(eqAir, -12, 12) or 0.0,
    }
    opts = {
        "width": _f(width, 0.0, 2.0),
        "dynamics": _f(dynamics, -1.0, 1.0) or 0.0,
        "eq": eq_bands if any(abs(v) > 1e-3 for v in eq_bands.values()) else None,
        "comp_scale": _f(compScale, 0.0, 2.0) if compScale is not None else 1.0,
        "ceiling_db": _f(ceiling, -6.0, 0.0),
        "auto": bool(auto) if auto is not None else False,
        "auto_strength": _f(autoStrength, 0.2, 1.0) if autoStrength is not None else 0.7,
        "de_ess": bool(deEss) if deEss is not None else None,
        "de_ess_amount": _f(deEssAmount, 0.0, 1.0) if deEssAmount is not None else None,
        "multiband": bool(multiband) if multiband is not None else None,
        "saturation": _f(saturation, 0.0, 1.0) if saturation is not None else 0.0,
        "residual_eq": bool(residualEq) if residualEq is not None else None,
    }

    valid_genres = [g["key"] for g in mastering.genres()] if mastering is not None else ["auto"]  # type: ignore[union-attr]
    g = (genre or "auto").strip().lower()
    if g not in valid_genres:
        g = "auto"
    loud = (loudness or "streaming").strip().lower()
    valid_loud = mastering.loudness_targets() if mastering is not None else ["streaming"]  # type: ignore[union-attr]
    if loud not in valid_loud:
        loud = "streaming"

    job_id = uuid.uuid4().hex
    # 來源與輸出**必須不同檔名** —— 否則 .wav 輸入時兩者撞名,清理來源會把輸出刪掉。
    src = UPLOAD_DIR / f"masterin_{job_id}{_safe_upload_suffix(audio.filename)}"
    out = UPLOAD_DIR / f"mastered_{job_id}.wav"
    matched = UPLOAD_DIR / f"matched_{job_id}.wav"  # 響度匹配原曲(A/B);前綴與其他不撞
    ref_path: Optional[str] = None
    try:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="上傳的音檔是空的")
        src.write_bytes(data)
        if reference is not None:
            rdata = await reference.read()
            if rdata:
                rp = UPLOAD_DIR / f"masterref_{job_id}{_safe_upload_suffix(reference.filename)}"
                rp.write_bytes(rdata)
                ref_path = str(rp)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"上傳音檔儲存失敗:{e}") from e
    finally:
        await audio.close()
        if reference is not None:
            await reference.close()

    with _MASTER_JOBS_LOCK:
        MASTER_JOBS[job_id] = {
            "status": "queued",
            "pct": 0.0,
            "message": "已建立工作,等待開始…",
            "error": None,
            "meta": None,
            "_out_path": str(out),
            "_matched_path": str(matched),
        }

    thread = threading.Thread(
        target=_run_master_job,
        args=(job_id, str(src), str(out), str(matched), g, loud, ref_path, opts),
        name=f"autolyrics-master-{job_id[:8]}",
        daemon=True,
    )
    thread.start()
    return JSONResponse({"jobId": job_id})


@app.get("/api/master/jobs/{job_id}")
def api_get_master_job(job_id: str) -> JSONResponse:
    """輪詢母帶工作狀態。GET /api/master/jobs/{jobId}"""
    with _MASTER_JOBS_LOCK:
        job = MASTER_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此母帶工作 jobId")
        payload: dict[str, Any] = {
            "status": job["status"],
            "pct": job["pct"],
            "message": job["message"],
            "error": job.get("error"),
            "meta": job.get("meta"),
        }
    return JSONResponse(payload)


@app.get("/api/master/jobs/{job_id}/result")
def api_get_master_result(job_id: str) -> FileResponse:
    """下載母帶輸出的 wav。GET /api/master/jobs/{jobId}/result"""
    with _MASTER_JOBS_LOCK:
        job = MASTER_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此母帶工作 jobId")
        if job["status"] != "done":
            raise HTTPException(status_code=404, detail="工作尚未完成,結果尚未就緒")
        out_path = job.get("_out_path")
    if not out_path or not os.path.exists(out_path):
        raise HTTPException(status_code=404, detail="找不到輸出檔案")
    return FileResponse(out_path, media_type="audio/wav", filename="mastered.wav")


@app.get("/api/master/jobs/{job_id}/result/matched")
def api_get_master_matched(job_id: str) -> FileResponse:
    """下載「響度匹配原曲」wav(把原始混音調到母帶的響度,給公平 A/B)。
    GET /api/master/jobs/{jobId}/result/matched"""
    with _MASTER_JOBS_LOCK:
        job = MASTER_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此母帶工作 jobId")
        if job["status"] != "done":
            raise HTTPException(status_code=404, detail="工作尚未完成,結果尚未就緒")
        matched_path = job.get("_matched_path")
    if not matched_path or not os.path.exists(matched_path):
        raise HTTPException(status_code=404, detail="找不到響度匹配原曲檔案")
    return FileResponse(matched_path, media_type="audio/wav", filename="matched-original.wav")


@app.post("/api/master/analyze")
async def api_master_analyze(
    audio: UploadFile = File(...),
    genre: str = Form("auto"),
    strength: Optional[float] = Form(None),
) -> JSONResponse:
    """智慧分析一首混音(不做母帶,只回診斷 + 視覺化資料 + 自動修正建議)。
    multipart:audio=混音檔,選用 genre、strength(自動校正力度 0.2..1.0)。
    回傳 MasterAnalysis(同步,於 threadpool 跑)。"""
    _require_mastering()

    g = (genre or "auto").strip().lower()
    valid_genres = [x["key"] for x in mastering.genres()] if mastering is not None else ["auto"]  # type: ignore[union-attr]
    if g not in valid_genres:
        g = "auto"
    try:
        s = max(0.2, min(1.0, float(strength))) if strength is not None else 0.7
    except (TypeError, ValueError):
        s = 0.7

    tmp = UPLOAD_DIR / f"analyzein_{uuid.uuid4().hex}{_safe_upload_suffix(audio.filename)}"
    try:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="上傳的音檔是空的")
        tmp.write_bytes(data)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"上傳音檔儲存失敗:{e}") from e
    finally:
        await audio.close()

    try:
        if mastering is None:  # pragma: no cover
            raise RuntimeError("pipeline.mastering 不可用")
        result = await run_in_threadpool(mastering.analyze_file, str(tmp), genre=g, strength=s)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.error("母帶分析失敗:%s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"分析失敗:{e}") from e
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass

    return JSONResponse(result)


@app.post("/api/master/match")
async def api_master_match(
    audio: UploadFile = File(...),
    targetLufs: float = Form(...),
) -> Response:
    """把上傳的音檔(例如外部母帶)調到 targetLufs(只縮放),回傳匹配後的 wav 位元組。
    供前端做「原始 / 本軟體母帶 / 外部母帶」三方等響度 A/B/C 比較。"""
    _require_mastering()
    try:
        tl = max(-30.0, min(0.0, float(targetLufs)))
    except (TypeError, ValueError):
        tl = -14.0
    uid = uuid.uuid4().hex
    tin = UPLOAD_DIR / f"matchin_{uid}{_safe_upload_suffix(audio.filename)}"
    tout = UPLOAD_DIR / f"matchout_{uid}.wav"
    try:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="上傳的音檔是空的")
        tin.write_bytes(data)
        if mastering is None:  # pragma: no cover
            raise RuntimeError("pipeline.mastering 不可用")
        await run_in_threadpool(mastering.match_loudness, str(tin), str(tout), tl)
        wav_bytes = tout.read_bytes()
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.error("響度匹配失敗:%s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"響度匹配失敗:{e}") from e
    finally:
        await audio.close()
        for p in (tin, tout):
            try:
                if p.exists():
                    p.unlink()
            except OSError:
                pass
    return Response(content=wav_bytes, media_type="audio/wav")


# ─────────────────────────────────────────────────────────────────────────────
# 靜態前端:掛在 "/" (html=True → 自動服務 index.html / SPA fallback)
# 注意:必須在所有 /api/* 路由「之後」掛載,否則 "/" 會吃掉 API。
# web/ 不存在時跳過 (例如純後端開發期),避免啟動崩潰。
# ─────────────────────────────────────────────────────────────────────────────
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
else:
    logger.warning("找不到前端目錄 %s — 略過靜態檔掛載 (API 仍正常)。", WEB_DIR)

    @app.get("/")
    def _no_web() -> JSONResponse:
        return JSONResponse(
            {
                "app": "AutoLyrics Local API",
                "version": VERSION,
                "note": f"前端尚未建置 ({WEB_DIR} 不存在);API 於 /api/* 可用。",
            }
        )


# ─────────────────────────────────────────────────────────────────────────────
# 入口
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    try:
        import uvicorn  # type: ignore

        logger.info("AutoLyrics 本地伺服器啟動於 http://%s:%d", HOST, PORT)
        uvicorn.run(app, host=HOST, port=PORT, log_level="info")
    except Exception as e:  # noqa: BLE001
        logger.error("uvicorn 啟動失敗:%r", e)
        raise
