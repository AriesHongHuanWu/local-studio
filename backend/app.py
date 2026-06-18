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
import tempfile
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
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

VERSION = "0.1.0"
HOST = "127.0.0.1"
PORT = 8756

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
    from pipeline import to_ass, to_json, to_lrc, to_srt
except Exception as _e:  # pragma: no cover
    logger.error("無法載入 pipeline 套件:%r — API 仍會啟動,但工作會回報錯誤。", _e)
    _pipeline_err = _e

    def pipeline_run(*_a: Any, **_k: Any) -> dict:  # type: ignore[misc]
        raise ImportError(f"pipeline.run 不可用:{_pipeline_err!r}")

    def to_lrc(*_a: Any, **_k: Any) -> str:  # type: ignore[misc]
        raise ImportError(f"pipeline.to_lrc 不可用:{_pipeline_err!r}")

    def to_srt(*_a: Any, **_k: Any) -> str:  # type: ignore[misc]
        raise ImportError(f"pipeline.to_srt 不可用:{_pipeline_err!r}")

    def to_ass(*_a: Any, **_k: Any) -> str:  # type: ignore[misc]
        raise ImportError(f"pipeline.to_ass 不可用:{_pipeline_err!r}")

    def to_json(*_a: Any, **_k: Any) -> str:  # type: ignore[misc]
        raise ImportError(f"pipeline.to_json 不可用:{_pipeline_err!r}")


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
_FALLBACK_MODEL_SIZES = ["large-v3", "medium", "small"]


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

    mode: str = "auto"  # "auto" | "biasing" | "align"
    referenceLyrics: str = ""
    referenceContent: str = ""
    styleKeys: list[str] = Field(default_factory=list)
    language: Optional[str] = None  # whisper code 或 None=auto
    modelSize: str = "large-v3"
    separate: bool = True
    device: str = "auto"  # "auto" | "cuda" | "cpu"
    engine: str = "whisper"


class ExportBody(BaseModel):
    """POST /api/export 的 JSON body。"""

    result: dict
    fmt: str = "lrc"  # "lrc" | "srt" | "ass" | "json"
    level: str = "line"  # "line" | "word"


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
    "ass": ("text/x-ssa; charset=utf-8", "ass"),
    "json": ("application/json; charset=utf-8", "json"),
}


def _render_export(result: dict, fmt: str, level: str) -> tuple[str, str, str]:
    """把 result 轉成指定格式,回傳 (內容文字, mime, 副檔名)。"""
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
            text = to_srt(result)
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
# 模型管理 — /api/models 端點群
# 偵測 / 下載 / 刪除統一委派給 pipeline.models;本檔保留輕量回退偵測,
# 確保 pipeline.models 缺席時 GET /api/models 仍可回應。
# ─────────────────────────────────────────────────────────────────────────────

# 下載作業 in-memory 登記表  job_id -> dict
MODEL_JOBS: dict[str, dict] = {}
_MODEL_JOBS_LOCK = threading.Lock()


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


def _is_demucs_installed() -> tuple[bool, float]:
    """Demucs htdemucs 模型偵測。"""
    torch_hub = _demucs_cache_dir()
    # torch.hub 下會有 demucs_audio_sep_local 或 facebookresearch_demucs_* 目錄
    candidates = list(torch_hub.glob("facebookresearch_demucs_*")) if torch_hub.exists() else []
    if not candidates:
        return False, 0.0
    size = sum(_dir_size_mb(c) for c in candidates)
    return True, size


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
        "label": "Demucs htdemucs",
        "description": "人聲分離模型。讓辨識在乾淨人聲上運作，大幅提升準確度。Vocal separator — greatly improves transcription accuracy.",
        "sizeMB": 310,
        "recommended": True,
        "vramHint": "~2 GB VRAM",
        "whisperSize": None,
        "required": True,
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
        installed, on_disk = _is_demucs_installed()
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
    for d in _MODEL_DEFS:
        if d["kind"] == "whisper":
            _, mb = _is_whisper_installed(d["whisperSize"])
        elif d["kind"] == "demucs":
            _, mb = _is_demucs_installed()
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

    return JSONResponse(
        {
            "styles": styles,
            "languages": languages,
            "modelSizes": model_sizes,
            "engines": ["whisper"],
            "gpu": _gpu_available(),
            "demucs": _demucs_available(),
            "aligner": _aligner_available(),
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

    # 2) 存上傳檔到暫存目錄 (保留原副檔名,讓解碼器好認)
    job_id = uuid.uuid4().hex
    suffix = Path(audio.filename or "").suffix or ".bin"
    dest = UPLOAD_DIR / f"{job_id}{suffix}"
    try:
        data = await audio.read()
        if not data:
            raise ValueError("上傳的音檔是空的")
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
def api_export_original(job_id: str, fmt: str = "lrc", level: str = "line") -> Response:
    """下載「原始」(未編輯) 結果檔。"""
    with _JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到此工作 jobId")
        if job["status"] != "done" or not job.get("result"):
            raise HTTPException(status_code=409, detail="工作尚未完成,無法匯出")
        result = job["result"]

    text, mime, ext = _render_export(result, fmt, level)
    filename = f"{job_id}.{ext}"
    return _download_response(text, mime, filename)


@app.post("/api/export")
def api_export_edited(body: ExportBody) -> Response:
    """匯出「編輯後」結果。JSON body { result, fmt, level } → 下載文字檔。"""
    if not isinstance(body.result, dict) or "segments" not in body.result:
        raise HTTPException(status_code=400, detail="result 結構不正確 (缺 segments)")
    text, mime, ext = _render_export(body.result, body.fmt, body.level)
    filename = f"autolyrics.{ext}"
    return _download_response(text, mime, filename)


# ─────────────────────────────────────────────────────────────────────────────
# 模型管理端點
# ─────────────────────────────────────────────────────────────────────────────

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
