"""pipeline/health.py — 環境健檢 + 自我修復報告 (Environment health-check).

掃描 App 實際**安裝了什麼、缺了什麼**,讓 UI 能在啟動 (與隨時) 明確警告使用者
「缺了哪些東西」,並只補抓真正缺少的部分 (重用已快取者)。涵蓋三類檢查:

  - deps  : 每個關鍵 Python 套件能否 import + 版本 (torch / faster_whisper / av …)
  - cuda  : torch.cuda 是否可用 + 版本 + GPU 名稱 + 顯存
  - models: 重用 pipeline.models.list_models() 的偵測 (whisper / demucs / aligner / LaMa)

設計原則 (與所有 pipeline 子模組一致):
  * **匯入永不崩潰**:本模組 import 階段純資料 + 純函式,永遠安全。所有重型相依
    都在「探測時」才 import,且每個探測各自包 try/except —— 單一失敗只讓它自己那欄
    變成 not-ok,絕不讓整份報告 raise。
  * **離線優先**:dep 探測只做 import (不發網路);model 偵測委派給 pipeline.models
    的離線快取掃描。整份報告反應快,離線也能用 (這正是它的重點 —— 缺一堆重型套件
    時也要能算出「缺什麼」)。

對外 API:
  full_report() -> dict   —— 完整健檢報告 (schema 見下)

full_report() 回傳 schema (全 JSON-safe):
  {
    "healthy": bool,            # 沒有任何 REQUIRED 項目缺失才為 True
    "deps": {                   # 每個關鍵相依
      "<name>": {"ok": bool, "version": str|None, "error": str|None,
                 "required": bool, "label": str},
      ...
    },
    "cuda": {"available": bool, "version": str|None,
             "gpuName": str|None, "vramTotalMB": int|None},
    "models": [ {id, kind, label, installed, sizeOnDiskMB, sizeMB, required}, ... ],
    "missing": [ {category: "dep"|"model", id, label, required, sizeMB?, reason}, ... ],
    "features": {"songLyrics": bool, "videoSubtitles": bool, "cleanText": bool},
    "version": str,
  }
"""

from __future__ import annotations

import importlib
import logging
from typing import Any, Optional

logger = logging.getLogger("autolyrics.health")


# --------------------------------------------------------------------------- #
# 關鍵相依清單。每筆: (import 名稱, 顯示標籤 zh+en, required)
#   required 的小子集 = 任一缺席就會擋住核心功能 (辨識/解碼/伺服器本身):
#     torch          — 所有模型推論的基礎
#     faster_whisper — 語音辨識引擎 (三種模式都靠它)
#     av (PyAV)      — 音/視訊解碼 + 影片字幕/文字移除的編解碼
#     soundfile      — 音檔讀寫
#     fastapi        — API 伺服器本身
#   其餘為 optional —— 缺席只停用「某個」進階功能,核心仍可運作:
#     demucs            — 人聲分離 (歌詞模式品質)
#     simple_lama_*     — LaMa 文字移除 (缺則退回 OpenCV)
#     cv2 (opencv)      — 文字移除的 OpenCV 後備
#     pypinyin/pycantonese — CJK 對齊/羅馬化輔助
#     torchvision/torchaudio/ctranslate2/numpy/uvicorn/pydantic … — 支援角色
# --------------------------------------------------------------------------- #
# import 名稱 → pip 套件名 (僅在兩者不同時列出,給 UI 顯示安裝指令用)
_PIP_NAME = {
    "faster_whisper": "faster-whisper",
    "av": "av",
    "cv2": "opencv-python",
    "simple_lama_inpainting": "simple-lama-inpainting",
    "soundfile": "soundfile",
}

# (module, label, required)
_DEP_SPECS: tuple[tuple[str, str, bool], ...] = (
    # ── REQUIRED 子集 ──────────────────────────────────────────────────────
    ("torch", "PyTorch", True),
    ("faster_whisper", "faster-whisper (辨識引擎 · ASR)", True),
    ("av", "PyAV (音視訊解碼 · media decode)", True),
    ("soundfile", "soundfile (音檔讀寫 · audio I/O)", True),
    ("fastapi", "FastAPI (API 伺服器 · server)", True),
    # ── OPTIONAL ───────────────────────────────────────────────────────────
    ("torchvision", "torchvision", False),
    ("torchaudio", "torchaudio (MMS 對齊器 · aligner)", False),
    ("ctranslate2", "CTranslate2 (Whisper 後端 · backend)", False),
    ("demucs", "Demucs (人聲分離 · vocal separation)", False),
    ("simple_lama_inpainting", "simple-lama-inpainting (LaMa 文字移除 · text removal)", False),
    ("cv2", "OpenCV (文字移除後備 · inpaint fallback)", False),
    ("numpy", "NumPy", False),
    ("uvicorn", "Uvicorn (ASGI 伺服器 · server)", False),
    ("pypinyin", "pypinyin (中文拼音 · Mandarin pinyin)", False),
    ("pycantonese", "PyCantonese (粵語對齊 · Cantonese)", False),
)


def _probe_dep(module: str) -> dict[str, Any]:
    """探測單一相依:能否 import + 取版本。永不 raise。

    回傳 {"ok": bool, "version": str|None, "error": str|None}。
    """
    try:
        mod = importlib.import_module(module)
    except Exception as exc:  # noqa: BLE001 - 缺席/載入失敗都算 not-ok
        return {"ok": False, "version": None, "error": f"{type(exc).__name__}: {exc}"}

    version: Optional[str] = None
    try:
        ver = getattr(mod, "__version__", None)
        if ver is None:
            # 部分套件 (如 cv2 的早期版本) 把版本放別處;盡量取,失敗就 None。
            ver = getattr(mod, "version", None)
            if callable(ver):
                ver = None
        if ver is not None:
            version = str(ver)
    except Exception:  # noqa: BLE001 - 版本取不到不影響 ok 判定
        version = None

    return {"ok": True, "version": version, "error": None}


def _probe_all_deps() -> dict[str, dict[str, Any]]:
    """探測所有 _DEP_SPECS,回 {module: {ok, version, error, required, label, pip}}。"""
    out: dict[str, dict[str, Any]] = {}
    for module, label, required in _DEP_SPECS:
        try:
            info = _probe_dep(module)
        except Exception as exc:  # noqa: BLE001 - 防禦:任何意外都收斂成 not-ok
            info = {"ok": False, "version": None, "error": f"{type(exc).__name__}: {exc}"}
        info["required"] = bool(required)
        info["label"] = label
        info["pip"] = _PIP_NAME.get(module, module)
        out[module] = info
    return out


# --------------------------------------------------------------------------- #
# CUDA 探測 (torch — 延後 import,逐項各自 guard)
# --------------------------------------------------------------------------- #
def _probe_cuda() -> dict[str, Any]:
    """探測 CUDA 可用性 / 版本 / GPU 名稱 / 顯存。torch 缺席或無 GPU → available=False。

    回傳 {"available": bool, "version": str|None, "gpuName": str|None,
          "vramTotalMB": int|None}。每子項各自 guard,單一失敗不沉沒其餘。
    """
    out: dict[str, Any] = {
        "available": False,
        "version": None,
        "gpuName": None,
        "vramTotalMB": None,
    }
    try:
        import torch  # type: ignore
    except Exception as exc:  # noqa: BLE001 - torch 缺席很常見且可接受
        logger.debug("torch 不可用,CUDA 探測回 unavailable: %r", exc)
        return out

    # CUDA build 版本 (即使無可用裝置 torch.version.cuda 仍可能有值,獨立探測)。
    try:
        out["version"] = getattr(getattr(torch, "version", None), "cuda", None) or None
    except Exception:  # noqa: BLE001
        out["version"] = None

    try:
        available = bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        available = False
    out["available"] = available
    if not available:
        out["version"] = None  # 無裝置 → build 版本對 UI 無意義
        return out

    try:
        out["gpuName"] = str(torch.cuda.get_device_name(0))
    except Exception:  # noqa: BLE001
        out["gpuName"] = None

    try:
        props = torch.cuda.get_device_properties(0)
        out["vramTotalMB"] = int(props.total_memory / (1024 * 1024))
    except Exception:  # noqa: BLE001
        out["vramTotalMB"] = None

    return out


# --------------------------------------------------------------------------- #
# 模型偵測 (重用 pipeline.models —— 單一事實來源)
# --------------------------------------------------------------------------- #
def _probe_models() -> list[dict[str, Any]]:
    """重用 pipeline.models.list_models();失敗回 []。

    只挑出 health/repair 關心的欄位 (id/kind/label/installed/sizeOnDiskMB/sizeMB/
    required),避免把整包 metadata 灌給 UI。
    """
    try:
        from . import models as _models  # type: ignore
    except Exception as exc:  # noqa: BLE001
        logger.warning("pipeline.models 載入失敗,健檢的模型清單為空: %r", exc)
        return []

    try:
        raw = _models.list_models()
    except Exception as exc:  # noqa: BLE001
        logger.warning("pipeline.models.list_models 失敗: %r", exc)
        return []

    out: list[dict[str, Any]] = []
    for m in raw:
        try:
            out.append(
                {
                    "id": m.get("id"),
                    "kind": m.get("kind"),
                    "label": m.get("label"),
                    "installed": bool(m.get("installed")),
                    "sizeOnDiskMB": m.get("sizeOnDiskMB", 0.0),
                    "sizeMB": m.get("sizeMB"),
                    "required": bool(m.get("required")),
                }
            )
        except Exception:  # noqa: BLE001 - 單筆異常不影響其餘
            continue
    return out


# --------------------------------------------------------------------------- #
# 缺失清單 + 每功能可用性 + 整體健康
# --------------------------------------------------------------------------- #
def _build_missing(
    deps: dict[str, dict[str, Any]], models: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """彙整所有「不存在」的項目 —— UI 警告 + 修復就吃這份清單。

    dep:import 失敗才算 missing;model:installed==False 才算 missing。
    required 反映該項是否擋住核心功能。
    """
    missing: list[dict[str, Any]] = []

    for module, info in deps.items():
        if info.get("ok"):
            continue
        missing.append(
            {
                "category": "dep",
                "id": module,
                "label": info.get("label", module),
                "required": bool(info.get("required")),
                "reason": info.get("error") or "import 失敗 · import failed",
                # 給 UI 顯示安裝指令用 (pip 套件名);依賴由 setup 重跑安裝。
                "pip": info.get("pip", module),
            }
        )

    for m in models:
        if m.get("installed"):
            continue
        missing.append(
            {
                "category": "model",
                "id": m.get("id"),
                "label": m.get("label"),
                "required": bool(m.get("required")),
                "sizeMB": m.get("sizeMB"),
                "reason": "模型未下載 · model not downloaded",
            }
        )

    return missing


def _feature_summary(
    deps: dict[str, dict[str, Any]], models: list[dict[str, Any]]
) -> dict[str, bool]:
    """每個模式是否「具備所需」。寬鬆判斷:只要該模式的關鍵件齊全即 True。

      * songLyrics    : 歌詞辨識 —— 需 torch + faster_whisper (+ av 解碼)。
                        Demucs/aligner 缺席只降品質/停用對齊,核心辨識仍可跑,故不列入硬需求。
      * videoSubtitles: 影片字幕 —— 需 torch + faster_whisper + av (解碼影片抽音軌)。
      * cleanText     : 文字移除 —— 需 av + (simple_lama 或 cv2) + (LaMa 模型 或 OpenCV 後備)。
                        OpenCV 路徑 (cv2) 免模型即可運作,故 cv2 在即視為具備後備。
    """
    def _dep_ok(name: str) -> bool:
        d = deps.get(name)
        return bool(d and d.get("ok"))

    def _model_installed(model_id: str) -> bool:
        for m in models:
            if m.get("id") == model_id:
                return bool(m.get("installed"))
        return False

    torch_ok = _dep_ok("torch")
    fw_ok = _dep_ok("faster_whisper")
    av_ok = _dep_ok("av")
    lama_dep_ok = _dep_ok("simple_lama_inpainting")
    cv2_ok = _dep_ok("cv2")

    song = torch_ok and fw_ok and av_ok
    video = torch_ok and fw_ok and av_ok

    # cleanText:要能解碼 (av) + 至少一條修補路徑可走。
    #   LaMa 路徑 = simple_lama 套件 + big-lama 權重 (或可即時下載,但這裡只認已具備者保守判斷)。
    #   OpenCV 路徑 = cv2 套件 (免模型,Telea 法即時可跑) —— 只要 cv2 在就算有後備。
    lama_path = lama_dep_ok and _model_installed("lama-bigvlama")
    clean = av_ok and (lama_path or cv2_ok)

    return {
        "songLyrics": bool(song),
        "videoSubtitles": bool(video),
        "cleanText": bool(clean),
    }


def _version() -> str:
    """取得 app 版本 (與 app.py 的 VERSION 同步);取不到回 'unknown'。"""
    try:
        from . import config  # type: ignore

        ver = getattr(config, "VERSION", None)
        if ver:
            return str(ver)
    except Exception:  # noqa: BLE001
        pass
    return "0.1.0"


# --------------------------------------------------------------------------- #
# 對外:完整健檢報告
# --------------------------------------------------------------------------- #
def full_report() -> dict[str, Any]:
    """產出完整環境健檢報告。完全防禦 —— 任何子探測失敗都收斂成安全預設,絕不 raise。

    schema 見模組 docstring。``healthy`` 為 True 僅當沒有任何 REQUIRED 項目缺失
    (required dep import 失敗 或 required model 未安裝)。
    """
    try:
        deps = _probe_all_deps()
    except Exception as exc:  # noqa: BLE001
        logger.error("dep 探測整體失敗,回空集: %r", exc)
        deps = {}

    try:
        cuda = _probe_cuda()
    except Exception as exc:  # noqa: BLE001
        logger.error("CUDA 探測失敗,回 unavailable: %r", exc)
        cuda = {"available": False, "version": None, "gpuName": None, "vramTotalMB": None}

    try:
        models = _probe_models()
    except Exception as exc:  # noqa: BLE001
        logger.error("模型探測失敗,回空集: %r", exc)
        models = []

    try:
        missing = _build_missing(deps, models)
    except Exception as exc:  # noqa: BLE001
        logger.error("缺失清單彙整失敗: %r", exc)
        missing = []

    try:
        features = _feature_summary(deps, models)
    except Exception as exc:  # noqa: BLE001
        logger.error("功能摘要計算失敗: %r", exc)
        features = {"songLyrics": False, "videoSubtitles": False, "cleanText": False}

    # healthy:沒有任何 required 項目缺失。
    try:
        healthy = not any(item.get("required") for item in missing)
    except Exception:  # noqa: BLE001
        healthy = False

    # deps 輸出給 UI 時,把 module 名也帶進每筆 (key 已是 module,但複製進值更好用)。
    deps_out: dict[str, Any] = {}
    for module, info in deps.items():
        entry = dict(info)
        entry["id"] = module
        deps_out[module] = entry

    return {
        "healthy": bool(healthy),
        "deps": deps_out,
        "cuda": cuda,
        "models": models,
        "missing": missing,
        "features": features,
        "version": _version(),
    }
