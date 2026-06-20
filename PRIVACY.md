# Privacy Policy · 隱私權政策

_Last updated: 2026-06-19_

## TL;DR
**Ai Caption runs entirely on your computer. Your video, audio, subtitles, lyrics, and personal data never leave your device. No accounts, no analytics, no tracking, no telemetry.**
**Ai Caption 完全在你的電腦上運作。你的影片、音訊、字幕、歌詞與個人資料不會離開你的裝置。沒有帳號、沒有分析、沒有追蹤、沒有遙測。**

---

## English

### What we collect
**Nothing.** Ai Caption has no servers, no accounts, no analytics, and no telemetry. We (the maintainers) never receive your video, your audio, your subtitles or lyrics, your file names, your IP address, or any usage data.

### Where your data goes
All processing — speech recognition, subtitle/caption generation, and (for songs) vocal separation, forced alignment, and export — happens **locally** on your machine via on-device models. Your videos, audio, subtitles, and lyrics stay in memory / on your own disk. Nothing is uploaded.

### The only network activity
Ai Caption contacts the network in exactly **two** situations, both initiated by you and both to official open-source sources — never to us:
1. **Downloading models** you choose (e.g. Whisper, Demucs, the MMS aligner) from their official hosts — **Hugging Face** (`huggingface.co`) and **PyTorch** (`download.pytorch.org`). These transfers are governed by those services' own privacy policies.
2. **Checking for app updates / opening links** only if you click them.

That's it. There is no background "phone-home", no crash reporting, no fingerprinting.

### Local storage on your device
The app stores, **only on your machine**: downloaded models (in your user cache), your past runs / preferences (local app data + `localStorage`), and the subtitle / lyric files you choose to export. You can delete any of these at any time (Settings → Model Manager, or your OS file manager).

### Third parties
We use no third-party analytics, ads, or trackers. The model hosts above are the only third parties, and only when you download a model.

### Children's privacy
Ai Caption collects no data from anyone, including children.

### Changes
If this policy ever changes, the updated version will be committed to this repository with a new "Last updated" date.

### Contact
Questions? Open an issue: <https://github.com/AriesHongHuanWu/local-studio/issues>

---

## 中文

### 我們收集什麼
**什麼都不收集。** Ai Caption 沒有伺服器、沒有帳號、沒有分析、沒有遙測。維護者永遠不會收到你的影片、音訊、字幕或歌詞、檔名、IP 位址或任何使用資料。

### 你的資料去哪裡
所有處理 —— 語音辨識、字幕生成,以及(歌曲)人聲分離、強制對齊、匯出 —— 都在你的電腦上**本地**完成,使用裝置上的模型。你的影片、音訊、字幕與歌詞留在你自己的記憶體/硬碟,不會上傳。

### 唯一的網路活動
Ai Caption 只在兩種情況下連網,都是由你發起、且連向官方開源來源 —— 絕不連向我們:
1. **下載你選擇的模型**(如 Whisper、Demucs、MMS 對齊器),來自其官方主機 **Hugging Face**(`huggingface.co`)與 **PyTorch**(`download.pytorch.org`)。這些傳輸受該服務各自的隱私政策規範。
2. **檢查更新 / 開啟連結**,只有在你點擊時。

就這樣。沒有背景回傳、沒有當機回報、沒有指紋追蹤。

### 裝置上的本地儲存
App **僅在你的機器上**儲存:下載的模型(使用者快取)、過往紀錄/偏好(本地 app data 與 `localStorage`)、以及你選擇匯出的字幕/歌詞檔。你可以隨時刪除(設定 → 模型管理器,或你的檔案總管)。

### 第三方
我們不使用任何第三方分析、廣告或追蹤器。上述模型主機是唯一的第三方,且僅在你下載模型時。

### 兒童隱私
Ai Caption 不向任何人(包含兒童)收集資料。

### 變更
若本政策變更,新版本會以新的「最後更新」日期提交至本儲存庫。

### 聯絡
有疑問?開 issue:<https://github.com/AriesHongHuanWu/local-studio/issues>
