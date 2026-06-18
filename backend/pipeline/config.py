"""AutoLyrics — 設定與共用常數 (config)。

集中管理風格 preset、語言清單、模型尺寸、預設值,以及兩個共用的小工具:
- ``build_bias_prompt``:把風格提示 + 內容 + 部分歌詞組成 Whisper 的 ``initial_prompt``。
- ``to_iso3``:把 Whisper 語言代碼轉成對齊器 (ctc-forced-aligner / MMS) 用的 ISO-639-3。

本模組「純資料 + 純函式」,不依賴任何重型套件,匯入永遠安全。
"""

from __future__ import annotations

# --------------------------------------------------------------------------- #
# 風格 / 曲風 preset
# --------------------------------------------------------------------------- #
# prompt 是會被塞進 Whisper initial_prompt 的偏好「詞句」,用簡短自然語句,
# 中英混合給模型一點 domain bias;lang 可為 None(不強制語言)。
STYLE_PRESETS: dict[str, dict] = {
    "pop": {
        "label": "流行 Pop",
        "prompt": "一首流行歌曲 a modern pop song with clear catchy vocals",
        "lang": None,
    },
    "ballad": {
        "label": "抒情 Ballad",
        "prompt": "一首抒情慢歌 a slow emotional ballad, gentle sustained singing",
        "lang": None,
    },
    "rock": {
        "label": "搖滾 Rock",
        "prompt": "一首搖滾歌曲 a rock song with energetic powerful vocals",
        "lang": None,
    },
    "rap": {
        "label": "饒舌 Rap / Hip-hop",
        "prompt": "一首饒舌歌曲 a rap hip-hop track, fast rhythmic spoken lyrics",
        "lang": None,
    },
    "rnb": {
        "label": "節奏藍調 R&B",
        "prompt": "一首節奏藍調 an R&B soul song with smooth melismatic vocals",
        "lang": None,
    },
    "folk": {
        "label": "民謠 Folk",
        "prompt": "一首民謠 an acoustic folk song with storytelling lyrics",
        "lang": None,
    },
    "electronic": {
        "label": "電子 Electronic",
        "prompt": "一首電子舞曲 an electronic dance track with processed vocals",
        "lang": None,
    },
    "mandopop": {
        "label": "華語流行 Mandopop",
        "prompt": "一首華語流行歌曲,歌詞為標準書面中文,使用正體中文與正確標點",
        "lang": "zh",
    },
    "cantopop": {
        "label": "粵語流行 Cantopop",
        "prompt": "一首粵語流行歌曲,歌詞以正體中文書寫",
        "lang": "zh",
    },
    "jpop": {
        "label": "日本流行 J-Pop",
        "prompt": "日本のポップソング、歌詞は自然な日本語で正しい漢字とかなを使う",
        "lang": "ja",
    },
    "kpop": {
        "label": "韓國流行 K-Pop",
        "prompt": "한국 가요, 가사는 자연스러운 한국어로 작성",
        "lang": "ko",
    },
}

# --------------------------------------------------------------------------- #
# 語言清單(UI 下拉用)
# --------------------------------------------------------------------------- #
# code 為 faster-whisper 的語言代碼(None = 自動偵測)。
# 粵語 (yue) Whisper 無原生支援,實務上以 zh 辨識,iso3 仍給對齊器 zho。
LANGUAGES: list[dict] = [
    {"code": None, "label": "自動偵測 Auto", "iso3": "zho"},
    {"code": "zh", "label": "中文國語 Mandarin", "iso3": "zho"},
    {"code": "yue", "label": "粵語 Cantonese", "iso3": "zho"},
    {"code": "en", "label": "English", "iso3": "eng"},
    {"code": "ja", "label": "日本語 Japanese", "iso3": "jpn"},
    {"code": "ko", "label": "한국어 Korean", "iso3": "kor"},
]

# --------------------------------------------------------------------------- #
# 模型尺寸
# --------------------------------------------------------------------------- #
MODEL_SIZES: list[str] = ["large-v3", "medium", "small"]

# --------------------------------------------------------------------------- #
# 預設值
# --------------------------------------------------------------------------- #
DEFAULTS: dict = {
    "mode": "auto",
    "modelSize": "large-v3",
    "separate": True,
    "device": "auto",
    "engine": "whisper",
    "language": None,
    "beamSize": 5,
    "demucsModel": "htdemucs",
    "version": "0.1.0",
}

# Whisper initial_prompt 上限約 224 tokens;CJK 一字常 1~2 tokens,
# 取保守 ~200 字元上限避免超出而被截斷。
_PROMPT_MAX_CHARS = 200

# Whisper code -> ISO-639-3(對齊器 / MMS 用)
_ISO3_MAP: dict[str, str] = {
    "zh": "zho",
    "yue": "zho",  # 粵語以中文模型對齊
    "en": "eng",
    "ja": "jpn",
    "ko": "kor",
    "es": "spa",
    "fr": "fra",
    "de": "deu",
    "ru": "rus",
    "it": "ita",
    "pt": "por",
    "id": "ind",
    "th": "tha",
    "vi": "vie",
}


def to_iso3(whisper_code: str | None) -> str:
    """把 Whisper 語言代碼轉成 ISO-639-3(給對齊器用)。

    未知或 None 時,因本工具以 CJK 為主,回傳 ``"zho"`` 作為安全預設。

    參數:
        whisper_code: faster-whisper 的語言代碼(如 ``"zh"`` / ``"en"``),可為 ``None``。

    回傳:
        ISO-639-3 三碼字串。
    """
    if not whisper_code:
        return "zho"
    return _ISO3_MAP.get(whisper_code.strip().lower(), "zho")


def build_bias_prompt(
    style_keys: list[str],
    reference_content: str,
    partial_lyrics: str,
) -> str:
    """組出 Whisper 的 ``initial_prompt`` 偏好提示字串。

    Whisper 的 prompt 是「尾端加權」的——越靠後的詞對解碼影響越大,
    所以把最重要的內容(部分歌詞片段)放在最後。整體裁切到 ~200 字元。

    組合順序(由弱到強):
        1. 各風格 preset 的 prompt 詞句
        2. 使用者提供的 referenceContent(自由提示)
        3. partial_lyrics 的「尾段」片段(最重要,放最後)

    參數:
        style_keys: 風格 key 清單(對應 ``STYLE_PRESETS``);未知 key 會被忽略。
        reference_content: 自由文字提示。
        partial_lyrics: 使用者已知的部分歌詞(多行字串)。

    回傳:
        裁切後的 prompt 字串(可能為空字串)。
    """
    style_keys = style_keys or []
    reference_content = (reference_content or "").strip()
    partial_lyrics = (partial_lyrics or "").strip()

    parts: list[str] = []

    # 1) 風格詞句(去重、保序)
    seen: set[str] = set()
    for key in style_keys:
        preset = STYLE_PRESETS.get(key)
        if not preset:
            continue
        phrase = (preset.get("prompt") or "").strip()
        if phrase and phrase not in seen:
            seen.add(phrase)
            parts.append(phrase)

    # 2) 自由提示內容
    if reference_content:
        parts.append(reference_content)

    # 3) 部分歌詞——最重要,壓在最後。把多行壓成單行。
    if partial_lyrics:
        snippet = " ".join(partial_lyrics.split())
        parts.append(snippet)

    prompt = "。".join(p for p in parts if p).strip()
    if not prompt:
        return ""

    # 尾端加權:超長時保留「尾段」(最重要的歌詞片段在後面)。
    if len(prompt) > _PROMPT_MAX_CHARS:
        prompt = prompt[-_PROMPT_MAX_CHARS:].lstrip("。 ,，、")
    return prompt
