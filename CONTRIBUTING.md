# Contributing to AutoLyrics · LocalAiLyrics

感謝你願意貢獻!Thanks for helping make local-first lyric recognition better.

## 專案結構 / Project layout

```
.
├── backend/                  # Python 準確度引擎 + FastAPI (port 8756)
│   ├── app.py                # API 服務 + 任務佇列 + 模型管理端點 + 內建測試 UI
│   ├── pipeline/
│   │   ├── config.py         # 風格預設、語言對應
│   │   ├── separate.py       # Demucs 人聲分離
│   │   ├── transcribe.py     # faster-whisper 辨識 (+ initial_prompt 偏置)
│   │   ├── align.py          # torchaudio MMS_FA 強制對齊 (+ uroman CJK)
│   │   ├── export.py         # LRC / SRT / ASS-karaoke / JSON
│   │   ├── models.py         # 模型登錄 + 下載/偵測/刪除
│   │   └── pipeline.py       # 串接整條管線 (三模式派發)
│   ├── web/index.html        # 內建單頁測試 UI
│   └── requirements.txt
├── frontend/                 # React 19 + Vite + TypeScript
│   ├── src/                  # tabs/ · components/ · state/ · api/ · lib/ · styles/
│   └── src-tauri/            # Tauri v2 桌面殼 (Rust) + Python sidecar 生命週期
└── DESIGN.md / API_CONTRACT.md   # 設計規格 + API 單一真相
```

## 開發環境 / Dev setup

```bash
# 後端
cd backend && ./install.ps1   # (或 ./install.sh) → 建 .venv + cu128 PyTorch
# 前端 / 桌面
cd frontend && npm install && npm run tauri dev
```

需求:Python 3.10–3.12、Node 20+、(桌面打包) Rust + Windows MSVC「使用 C++ 的桌面開發」。

## 提交前檢查 / Before you PR

| 範圍 | 指令 |
|---|---|
| 前端型別 | `cd frontend && npx tsc --noEmit` |
| 前端建置 | `cd frontend && npm run build` |
| Rust 編譯 | `cd frontend/src-tauri && cargo check` |
| 後端語法 | `python -m compileall backend/pipeline backend/app.py` |

> CI(`.github/workflows/ci.yml`)會自動跑前端型別/建置 + 後端語法檢查。

## 慣例 / Conventions

- **API 契約**:`API_CONTRACT.md` 是前後端的單一真相;改 API 時前後端 + 文件一起更新。
- **優雅降級**:後端任何重型相依(torch/demucs/aligner)缺席都不可讓伺服器崩潰 —— 包 try/except、記警告、回退。
- **設計 token**:UI 顏色/字級一律用 `frontend/src/styles/tokens.css` 的變數,不要硬編色碼。
- **語意化配色紀律**:金=正在播/主要動作、琥珀=低信心(事件式)、綠=完成/上線。
- 提交訊息建議用 [Conventional Commits](https://www.conventionalcommits.org/)(`feat:` / `fix:` / `docs:` …)。

## 回報問題 / Issues

附上:作業系統、GPU、Python/Node 版本、重現步驟,以及(若辨識相關)歌曲語言與模式(自動/偏置/強制對齊)。

歡迎一起讓它更好 🎧
