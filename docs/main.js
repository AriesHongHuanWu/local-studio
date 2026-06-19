/* ─── Ai Caption — Landing Page JS ───────────────────────────────────────────
   Responsibilities:
   • Bilingual toggle (zh / en) + localStorage + ?lang= / navigator.language
   • Mobile hamburger nav
   • FAQ accordion
   • Scroll-reveal via IntersectionObserver
   • Hero lyric mockup animation (word-sweep cycling through lines)
   • Waveform playhead animation
────────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── 1. Language data ───────────────────────────────────────────────────── */
  const STRINGS = {
    zh: {
      // Nav
      'nav.modes':     '模式',
      'nav.features':  '功能',
      'nav.how':       '原理',
      'nav.who':       '為誰',
      'nav.download':  '下載',
      'nav.privacy':   '隱私',
      'nav.cta':       '下載',
      'nav.lang':      'EN',

      // Top-level modes (headline)
      'topmodes.eyebrow': '三大模式',
      'topmodes.title':   '一個 App，三件事。',
      'topmodes.sub':     '歌詞、字幕、清字——挑你需要的那一個，全部在你自己的電腦上完成。',
      'topmodes.a.name':  '歌詞模式',
      'topmodes.a.desc':  'Demucs 人聲分離 → faster-whisper → 強制對齊，產出逐字時間軸歌詞。匯出 LRC / SRT / ASS 卡拉 OK / JSON。',
      'topmodes.b.name':  '影片轉字幕',
      'topmodes.b.desc':  '任何影片或音訊直接語音轉寫，產出乾淨字幕——自動斷行、每段 ≤2 行、依閱讀速度切分。不需要人聲分離。',
      'topmodes.c.name':  '清除字幕（Clean Text）',
      'topmodes.c.desc':  '框選你自己影片裡誤燒進去的固定位置文字，LaMa AI 修補逐格抹除，原始聲音原封保留。（固定位置；模型首次使用時下載。）',

      // Hero
      'hero.eyebrow':  '免費 · 開源 · 本地優先 · 免獨立顯卡',
      'hero.tagline':  '任何影片或歌曲，\n都能變成精準的字幕與歌詞。',
      'hero.sub':      '把影片或音訊轉成乾淨字幕（SRT、WebVTT），或把歌曲轉成逐字時間軸歌詞（LRC、SRT、ASS 卡拉 OK、JSON）。faster-whisper 辨識，全跑在你自己的機器上——不上傳、不追蹤，連獨立顯卡都不用。',
      'hero.cta.win':  '下載 Windows 版',
      'hero.cta.gh':   'GitHub',
      'hero.badge.1':  'MIT 開源',
      'hero.badge.2':  '100% 本地',
      'hero.badge.3':  '不上傳',
      'hero.badge.4':  '免獨立顯卡',

      // Mockup
      'mock.title':    '辨識 · 編輯 · 匯出',
      'mock.status':   'CPU 就緒',

      // Features
      'feat.eyebrow':  '為什麼選它',
      'feat.title':    '準確、私密、隨時可用。',
      'feat.sub':      '不需要帳號，不需要訂閱，不需要網路——開啟就能用。',
      'feat.1.name':   '免獨立顯卡・筆電也能跑',
      'feat.1.desc':   '預設自動挑選適合 CPU 的 int8 模型，Intel Core Ultra / Ryzen 筆電也能順跑。偵測到 GPU 時自動使用，只會更快。',
      'feat.2.name':   '免裝 Python・開箱即用',
      'feat.2.desc':   '內建可攜式 Python，不必自己安裝任何執行環境。首次啟動會自動把一切準備就緒。',
      'feat.3.name':   '100% 本地・完全私密',
      'feat.3.desc':   '所有處理都在裝置上完成，不上傳任何檔案、無遙測、不連雲端。你的影片與歌詞永遠留在你的電腦。',
      'feat.4.name':   '自我修復・自動補齊',
      'feat.4.desc':   '每次啟動都會檢查自己的引擎與模型是否完整，只重新抓回缺少的部分——不必重裝整包。',
      'feat.5.name':   '儲存空間管理',
      'feat.5.desc':   '分層查看磁碟用量與剩餘空間：刪除單一模型、清空所有模型，或完整重設——把每一 GB 都看得清清楚楚。',
      'feat.6.name':   'App 內自動更新',
      'feat.6.desc':   '新版本一鍵更新，並附上版本說明。介面支援中文 / English，Windows / macOS（Apple Silicon）/ Linux 皆可。',

      // How
      'how.eyebrow':   '運作原理',
      'how.title':     '四步流水線，一氣呵成。',
      'how.sub':       '這是歌詞模式的完整管道——從音訊到逐字時間軸，全程本地推理。模型一次下載，永久離線使用。（影片轉字幕只走語音辨識，更快；清字模式用 LaMa 逐格修補。）',
      'step.1.num':    '① 人聲分離',
      'step.1.name':   'Demucs',
      'step.1.desc':   '深度學習模型將人聲從混音中分離，為後續辨識提供乾淨的聲源。',
      'step.2.num':    '② 語音辨識',
      'step.2.name':   'faster-whisper',
      'step.2.desc':   'CTranslate2 加速的 Whisper large-v3，逐字時間戳，支援多語。',
      'step.3.num':    '③ 對齊 / 偏置',
      'step.3.name':   '強制對齊 · 偏置',
      'step.3.desc':   '完整歌詞→強制對齊（近完美）；部分歌詞/風格→Whisper biasing。',
      'step.4.num':    '④ 匯出',
      'step.4.name':   'LRC · SRT · ASS · JSON',
      'step.4.desc':   '生成標準格式文件，可在編輯器中 QA 後再存檔。',
      'modes.title':   '歌詞模式的三種子模式，按需選擇',
      'mode.auto':     '自動',
      'mode.auto.name':'自動辨識',
      'mode.auto.desc':'無需任何參考——直接轉寫，適合快速草稿或沒有歌詞的歌曲。',
      'mode.bias':     '偏置',
      'mode.bias.name':'歌詞偏置',
      'mode.bias.desc':'貼入部分歌詞或風格提示，引導 Whisper 貼近正確用詞，適合口音濃或混語歌。',
      'mode.forced':   '強制對齊',
      'mode.forced.name':'強制對齊',
      'mode.forced.desc':'貼入完整歌詞，逐字對齊聲學特徵——準確度最高，推薦製作卡拉 OK。',

      // Who it's for
      'who.eyebrow':   '為誰打造',
      'who.title':     '不論你做影片還是音樂，都適合。',
      'who.sub':       '從影片字幕到逐字歌詞，Ai Caption 讓字幕與歌詞不再是門檻。',
      'who.1.name':    '音樂製作人・詞曲創作者',
      'who.1.desc':    '把自己的 demo 或 rough mix 直接拿來對齊歌詞，精確到每個字，不再靠耳朵逐字計時。',
      'who.2.name':    '歌詞影片・卡拉 OK 製作者',
      'who.2.desc':    '直接匯出 ASS 逐字 \\k 掃光格式，丟進 Aegisub 或 After Effects 零人工對時——省去數小時手動作業。',
      'who.3.name':    '影片剪輯師・字幕製作者',
      'who.3.desc':    'SRT 格式直接導入 Premiere、Final Cut、DaVinci——逐字時間點讓歌詞字幕不再需要手動校對。',
      'who.4.name':    '語言學習者',
      'who.4.desc':    '跟著精準時間軸學唱日文歌、英文歌——每個字都有起止時間，配合 LRC 播放器逐字跟唱。',

      // Under the hood
      'tech.eyebrow':  '引擎內幕',
      'tech.title':    '真正的工程，不是噱頭。',
      'tech.sub':      '每一層都選用業界最佳開源模型，組合成一條完整的本地推理管道。',
      'tech.demucs':   'Meta AI 開源的深度學習人聲分離模型，精準隔離人聲與伴奏，大幅降低背景噪訊對辨識的干擾。',
      'tech.whisper':  '以 CTranslate2 最佳化的 Whisper，在相同硬體上比原版快 4 倍，支援 99 種語言逐字時間戳。',
      'tech.cfa':      '基於 torchaudio MMS_FA 的原生 CTC 強制對齊（forced_align），以 uroman 做音素化、免 C++ 編譯器——在有完整歌詞時達到幾近完美的逐字精度。',
      'tech.torch':    '支援 NVIDIA sm_120 架構（RTX 5000 系列），cu128 編譯確保最新 GPU 能充分發揮效能。',
      'tech.tauri':    '輕量 Rust 框架打包 React 介面，執行檔小於 10 MB，不捆綁 Electron 的龐大執行環境。',
      'tech.fastapi':  '本地 IPC 伺服器橋接 Tauri 前端與 Python 推理後端，跨平台（Windows / macOS / Linux）。',

      // Comparison
      'cmp.eyebrow':        '與其他方式比較',
      'cmp.title':          '不藏私的誠實比較。',
      'cmp.sub':            'Ai Caption 不是萬能的，但在本地、精確、免費這三點上，沒有妥協。',
      'cmp.col.feature':    '功能 / 特性',
      'cmp.col.cloud':      '雲端歌詞服務',
      'cmp.col.rawwhisper': '裸 Whisper CLI',
      'cmp.row.privacy':    '隱私・本地執行',
      'cmp.row.wordlevel':  '逐字時間軸',
      'cmp.row.reflyrics':  '參考歌詞強制對齊',
      'cmp.row.cost':       '費用',
      'cmp.row.gui':        '視覺化 QA 編輯器',
      'cmp.row.vocal':      '人聲分離前處理',
      'cmp.row.cleantext':  '清除燒錄字幕（AI 修補）',
      'cmp.yes':            '是',
      'cmp.no':             '否',
      'cmp.free':           '永久免費',
      'cmp.free.src':       '免費（自行部署）',
      'cmp.paid':           '訂閱制 / 計次',
      'cmp.partial.line':   '逐行',
      'cmp.partial.word':   '逐字（無 GUI）',
      'cmp.partial.varies': '部分提供',

      // Download (v2)
      'dl.eyebrow':          '立即下載',
      'dl.title':            '免費取得，永遠如此。',
      'dl.sub':              '現成安裝包或從原始碼建置，MIT 授權，完全自由使用。',
      'dl.wizard':           '首次啟動精靈會<strong>自動偵測你的 GPU 型號與 VRAM</strong>，推薦最適合的 AI 模型，並引導你一鍵下載或略過。',
      'dl.badge.recommended':'推薦 Recommended',
      'dl.badge.it':         'IT / silent deploy',
      'dl.badge.planned':    '規劃中 Planned',
      'dl.badge.source':     '從原始碼建置',
      'dl.exe.fmt':          '.EXE 安裝包',
      'dl.exe.name':         'Windows 安裝精靈',
      'dl.exe.desc':         'NSIS 封裝，雙擊安裝。內建 Python，首次啟動自動備妥引擎並引導你下載 AI 模型。',
      'dl.msi.fmt':          '.MSI 安裝包',
      'dl.msi.name':         'Windows MSI',
      'dl.msi.desc':         '適合企業部署或偏好 MSI 的使用者，同樣包含引擎安裝精靈。',
      'dl.zip.fmt':          '.ZIP 免安裝',
      'dl.zip.name':         'Windows Portable',
      'dl.zip.desc':         '解壓即用，不寫入登錄機碼。同樣內建 Python，首次啟動自動備妥引擎。',
      'dl.mac.name':         'macOS — 從原始碼',
      'dl.mac.desc':         'Python 後端跨平台，Tauri 支援 macOS。請參閱 README 的建置說明。',
      'dl.linux.name':       'Linux — 從原始碼',
      'dl.linux.desc':       '支援 Ubuntu 22.04+、Arch 等主流發行版。請參閱 README 的建置說明。',
      'dl.cta.download':     '下載',
      'dl.cta.soon':         '即將推出',
      'dl.cta.readme':       '見 README',
      'dl.note':             '<strong>首次啟動：</strong>內建可攜式 Python，無需自行安裝。App 會自動備妥引擎並引導你下載所需 AI 模型（需要幾 GB 空間，僅下載一次）。',
      'dl.sysreq':           '需求：Windows 10/11 · 免獨立顯卡（NVIDIA GPU 可選，加速用）· 8 GB RAM · 10 GB 磁碟空間',
      'dl.allreleases':      '所有版本 All releases →',

      // Roadmap
      'road.eyebrow':        '持續開發',
      'road.title':          '路線圖',
      'road.sub':            'Ai Caption 仍在積極開發中——以下是正在進行或計劃中的項目。',
      'road.status.done':    '已完成',
      'road.status.wip':     '進行中',
      'road.status.planned': '計劃中',
      'road.1.title':        'Windows EXE / MSI 安裝包',
      'road.1.desc':         'NSIS 與 WiX 封裝，含首次啟動精靈，一鍵完成引擎安裝。',
      'road.2.title':        'GPU / VRAM 自動偵測與模型推薦',
      'road.2.desc':         '首次啟動精靈偵測你的顯卡型號與 VRAM，自動推薦 large-v3 或較輕量模型。',
      'road.3.title':        '強制對齊・歌詞偏置・自動轉寫 三模式',
      'road.3.desc':         '完整的三模式管道，覆蓋從零歌詞到完整歌詞的所有情境。',
      'road.4.title':        'Windows Portable ZIP（免安裝）',
      'road.4.desc':         '解壓即用版本，不寫入登錄機碼，適合 USB 隨身碟或受限環境。',
      'road.5.title':        '自帶 Python 捆包（免需手動安裝 Python）',
      'road.5.desc':         '將 Python 執行環境與模型完整打包在安裝檔內，消除對系統 Python 的依賴。',
      'road.6.title':        '粵語強制對齊支援',
      'road.6.desc':         '針對粵語音素的特化對齊器，讓廣東歌同樣達到逐字精準對齊。',
      'road.7.title':        '更多辨識引擎選項',
      'road.7.desc':         '評估整合 Whisper.cpp、WhisperX 等替代後端，讓使用者按需求切換。',
      'road.8.title':        '批次處理模式',
      'road.8.desc':         '一次拖入整個資料夾，自動排隊處理多首歌曲並匯出結果。',

      // Privacy
      'priv.eyebrow':  '隱私承諾',
      'priv.title':    '你的歌曲，只在你的電腦上。',
      'priv.sub':      '這不是行銷術語——這是設計的核心。',
      'priv.p1':       '不收集音訊或歌詞資料',
      'priv.p2':       '不上傳個人資料',
      'priv.p3':       '無帳號・無分析・無 Cookie',
      'priv.p4':       '不需要網路連線即可使用',
      'priv.p5':       '沒有第三方追蹤器',
      'priv.p6':       '完全在裝置本地執行',
      'priv.net':      '<span class="amber-dot"></span><strong>唯一的網路活動：</strong>當你選擇下載 AI 模型時，程式會從官方來源（Hugging Face、pytorch.org）取得模型檔案。除此之外，Ai Caption 不向任何伺服器傳送任何使用資料。',
      'priv.date':     '最後更新：2026 年 6 月',
      'priv.full':     '閱讀完整隱私政策 →',

      // FAQ
      'faq.eyebrow':   '常見問題',
      'faq.title':     '還有疑問？',
      'faq.q1':        'Ai Caption 免費嗎？',
      'faq.a1':        '完全免費，MIT 開源授權。你可以自由使用、修改、再發布，商業用途亦可。',
      'faq.q2':        '它會上傳我的影片或歌曲嗎？',
      'faq.a2':        '不會。所有影片與音訊處理均在你的裝置本地完成。Ai Caption 不與任何伺服器通訊，除非你主動觸發模型下載。',
      'faq.q3':        '支援 Mac / Linux 嗎？',
      'faq.a3':        '目前提供 Windows 安裝包。Mac 和 Linux 使用者可從原始碼建置——Python 後端跨平台，Tauri 前端支援三大系統。',
      'faq.q4':        '支援哪些語言？',
      'faq.a4':        '支援 faster-whisper large-v3 能辨識的所有語言，包括中文（國語/粵語）、英語、日語、韓語及更多。可在設定中選擇語言或使用自動偵測。',
      'faq.q5':        '一定需要獨立顯卡嗎？',
      'faq.a5':        '不需要。Ai Caption 在純 CPU / 內顯筆電（如 Intel Core Ultra）上也能跑——影片轉字幕模式預設挑選適合 CPU 的快速 int8 模型，反應俐落。NVIDIA GPU 是可選的，只是加快速度，尤其是較重的歌詞管線。',
      'faq.q6':        '模型有多大？需要下載多少？',
      'faq.a6':        'Demucs htdemucs 約 320 MB，faster-whisper large-v3 約 3.1 GB，torchaudio MMS_FA 對齊模型約 1.2 GB，清字模式的 LaMa 修補模型約 200 MB。各模型在首次使用對應功能時才下載，之後完全離線。',
      'faq.q7':        '「清除字幕」能去掉什麼？',
      'faq.a7':        '清字模式針對你自己影片中誤燒進去的「固定位置」文字（例如硬燒字幕、浮水印文字）。你框選一個區域，LaMa AI 會逐格修補抹除，並原封保留原始聲音。它僅支援固定位置的文字，不處理移動中的物件。LaMa 模型於首次使用時下載。',
      'faq.q8':        '需要先安裝 Python 嗎？目前是哪個版本？',
      'faq.a8':        '不需要。App 內建可攜式 Python，首次啟動會自動把引擎與相依套件準備好——你不必自己裝任何東西。目前最新版本為 v0.1.3，可在 App 內一鍵自動更新。',

      // System Requirements
      'sysreq.eyebrow':    '系統需求',
      'sysreq.title':      '你的電腦夠用嗎？',
      'sysreq.wizard':     '首次啟動精靈會<strong>自動偵測 GPU 型號與 VRAM</strong>，推薦最適合的模型——不需要手動查規格。',
      'sysreq.col.item':   '項目',
      'sysreq.col.min':    '最低需求',
      'sysreq.col.rec':    '建議配置',
      'sysreq.row.os':     '作業系統',
      'sysreq.min.os':     'Windows 10 / 11（64-bit）',
      'sysreq.rec.os':     'Windows 11（64-bit）',
      'sysreq.row.cpu':    '處理器',
      'sysreq.min.cpu':    '現代 x86-64 CPU（Intel / AMD）',
      'sysreq.rec.cpu':    '同左；GPU 推理時 CPU 不是瓶頸',
      'sysreq.row.gpu':    '顯示卡',
      'sysreq.min.gpu':    '不需要——CPU 模式可用（較慢）',
      'sysreq.rec.gpu':    'NVIDIA GPU，6–8 GB+ VRAM（RTX 系列最佳，支援 CUDA）',
      'sysreq.row.ram':    '記憶體',
      'sysreq.min.ram':    '8 GB RAM',
      'sysreq.rec.ram':    '16 GB RAM',
      'sysreq.row.disk':   '磁碟空間',
      'sysreq.min.disk':   '~6 GB（small / medium 模型）',
      'sysreq.rec.disk':   '~10 GB SSD（large-v3 全套）',
      'sysreq.row.model':  '推薦模型',
      'sysreq.min.model':  'whisper small / medium（較快，準確度次之）',
      'sysreq.rec.model':  'faster-whisper large-v3（最高準確度，近即時）',

      // Local vs Cloud cost comparison
      'cost.eyebrow':              '本地 vs 雲端',
      'cost.title':                '成本與隱私的誠實對比',
      'cost.sub':                  '雲端服務有其優點；這裡只是把數字攤開來，讓你自己判斷。',
      'cost.cloud.label':          '雲端方案',
      'cost.cloud.api.name':       'ASR API（按分計費）',
      'cost.cloud.api.val':        '~$0.004–0.016 / 分鐘',
      'cost.cloud.api.note':       '一首 4 分鐘歌曲約 $0.02–0.07；每月 100 首 ≈ $2–7',
      'cost.cloud.saas.name':      '歌詞 / 字幕 SaaS（月費）',
      'cost.cloud.saas.val':       '~$12–30 / 月',
      'cost.cloud.saas.note':      '常附月度配額限制；超量另計或需升方案',
      'cost.cloud.privacy.name':   '音訊隱私',
      'cost.cloud.privacy.val':    '音訊上傳至外部伺服器',
      'cost.cloud.privacy.note':   '請參閱各服務的隱私政策與資料保留條款',
      'cost.cloud.quota.name':     '執行次數',
      'cost.cloud.quota.val':      '受配額或計費上限約束',
      'cost.local.label':          'Ai Caption（本地）',
      'cost.local.persong.name':   '每首歌費用',
      'cost.local.persong.val':    '$0',
      'cost.local.persong.note':   '模型一次下載（~5 GB），之後完全離線——無論跑幾次',
      'cost.local.runs.name':      '執行次數',
      'cost.local.runs.val':       '無限制，隨時重跑微調',
      'cost.local.runs.note':      '調整參數、更換模式、反覆對齊——沒有配額壓力',
      'cost.local.privacy.name':   '音訊隱私',
      'cost.local.privacy.val':    '100% 留在你的裝置上',
      'cost.local.privacy.note':   '沒有伺服器、沒有帳號、沒有音訊外流的可能',
      'cost.local.hw.name':        '硬體成本',
      'cost.local.hw.val':         '你已有的電腦（+ 電費）',
      'cost.local.hw.note':        'GPU 可加快速度，但非必需——CPU 模式也能跑',

      // Footer
      'foot.tagline':  'Built for video, subtitles & lyrics',
      'foot.license':  'MIT 授權',
      'foot.privacy':  '隱私政策',
      'foot.copy':     '© 2026 Aries HongHuan Wu',
    },

    en: {
      'nav.modes':     'Modes',
      'nav.features':  'Features',
      'nav.how':       'How It Works',
      'nav.who':       'Who It\'s For',
      'nav.download':  'Download',
      'nav.privacy':   'Privacy',
      'nav.cta':       'Download',
      'nav.lang':      '中文',

      // Top-level modes (headline)
      'topmodes.eyebrow': 'Three Modes',
      'topmodes.title':   'One app, three jobs.',
      'topmodes.sub':     'Lyrics, subtitles, clean-up — pick the one you need. Every job runs on your own machine.',
      'topmodes.a.name':  'Song Lyrics',
      'topmodes.a.desc':  'Demucs vocal separation → faster-whisper → forced alignment for word-level timed lyrics. Export LRC / SRT / ASS karaoke / JSON.',
      'topmodes.b.name':  'Video → Subtitles',
      'topmodes.b.desc':  'Transcribe any video or audio into clean captions — auto line-wrapping, ≤2 lines per cue, reading-speed splitting. No vocal separation needed.',
      'topmodes.c.name':  'Clean Text',
      'topmodes.c.desc':  'Box fixed-position text you accidentally burned into your own video; LaMa AI inpainting erases it every frame and keeps the original audio. (Fixed-position; the model downloads on first use.)',

      'hero.eyebrow':  'Free · Open Source · Local-First · No dGPU',
      'hero.tagline':  'Any video or song becomes\nperfect subtitles and lyrics.',
      'hero.sub':      'Turn any video or audio into clean subtitles (SRT, WebVTT), or turn a song into word-timed lyrics (LRC, SRT, ASS-karaoke, JSON). faster-whisper recognition — all on your own machine. No upload, no tracking, no discrete GPU required.',
      'hero.cta.win':  'Download for Windows',
      'hero.cta.gh':   'GitHub',
      'hero.badge.1':  'MIT Open Source',
      'hero.badge.2':  '100% Local',
      'hero.badge.3':  'No Upload',
      'hero.badge.4':  'No dGPU Needed',

      'mock.title':    'Transcribe · Edit · Export',
      'mock.status':   'CPU Ready',

      'feat.eyebrow':  'Why Choose It',
      'feat.title':    'Accurate, Private, Always Available.',
      'feat.sub':      'No account, no subscription, no internet required — install and go.',
      'feat.1.name':   'No Discrete GPU · Runs on Any Laptop',
      'feat.1.desc':   'Defaults auto-pick fast int8 models, so an Intel Core Ultra / Ryzen laptop runs smoothly. When a GPU is present it\'s used automatically — just faster.',
      'feat.2.name':   'No Python Install · Works Out of the Box',
      'feat.2.desc':   'A portable Python is bundled, so you never install a runtime yourself. The first launch sets everything up automatically.',
      'feat.3.name':   '100% Local · Fully Private',
      'feat.3.desc':   'All processing happens on-device — nothing uploaded, no telemetry, no cloud. Your videos and lyrics never leave your computer.',
      'feat.4.name':   'Self-Healing · Auto Re-Fetch',
      'feat.4.desc':   'On every launch it checks its own engine and models, then re-fetches only what\'s missing — no need to reinstall the whole package.',
      'feat.5.name':   'Storage Management',
      'feat.5.desc':   'See disk usage and free space in tiers: delete a single model, clear all models, or do a full reset — every GB accounted for.',
      'feat.6.name':   'In-App Auto-Update',
      'feat.6.desc':   'Update to a new version in one click, with release notes. UI in 中文 / English; Windows / macOS (Apple Silicon) / Linux.',

      'how.eyebrow':   'How It Works',
      'how.title':     'Four-Stage Pipeline, End to End.',
      'how.sub':       'This is the lyrics-mode pipeline — from audio to word-level timestamps, fully local inference. Models download once, work offline forever. (Video → Subtitles runs speech recognition only, so it\'s faster; Clean Text uses LaMa frame-by-frame inpainting.)',
      'step.1.num':    '① Vocal Separation',
      'step.1.name':   'Demucs',
      'step.1.desc':   'Deep-learning stem separation isolates the vocal track from the mix, giving the recogniser a clean signal.',
      'step.2.num':    '② Speech Recognition',
      'step.2.name':   'faster-whisper',
      'step.2.desc':   'CTranslate2-accelerated Whisper large-v3, with per-word timestamps and multilingual support.',
      'step.3.num':    '③ Alignment / Biasing',
      'step.3.name':   'Forced Align · Bias',
      'step.3.desc':   'Full lyrics → forced alignment (near-perfect); partial lyrics / style → Whisper initial-prompt biasing.',
      'step.4.num':    '④ Export',
      'step.4.name':   'LRC · SRT · ASS · JSON',
      'step.4.desc':   'Standard format files generated instantly. QA in the editor, then save to disk.',
      'modes.title':   'Lyrics Mode — Three Sub-Modes, Pick What You Have',
      'mode.auto':     'Auto',
      'mode.auto.name':'Auto Transcribe',
      'mode.auto.desc':'No reference needed — straight transcription. Good for quick drafts or songs without lyrics.',
      'mode.bias':     'Biasing',
      'mode.bias.name':'Lyrics Biasing',
      'mode.bias.desc':'Paste partial lyrics or a style hint. Guides Whisper toward the right words — ideal for accented or code-switched songs.',
      'mode.forced':   'Forced Align',
      'mode.forced.name':'Forced Alignment',
      'mode.forced.desc':'Paste full lyrics. Word boundaries are aligned to acoustic features — highest accuracy, recommended for karaoke.',

      // Who it's for
      'who.eyebrow':   'Who It\'s For',
      'who.title':     'Whether you work in video or music, Ai Caption fits.',
      'who.sub':       'From video subtitles to word-level lyrics, captions are no longer a bottleneck.',
      'who.1.name':    'Music Producers & Songwriters',
      'who.1.desc':    'Align your own demo or rough mix to lyrics word-for-word — no more ear-timing every syllable by hand.',
      'who.2.name':    'Lyric-Video & Karaoke Creators',
      'who.2.desc':    'Export ASS with per-word \\k sweep tags. Drop it into Aegisub or After Effects with zero manual timing — saving hours per track.',
      'who.3.name':    'Video Editors & Subtitle Makers',
      'who.3.desc':    'SRT imports directly into Premiere, Final Cut, and DaVinci. Word-level timestamps mean no more manual subtitle correction.',
      'who.4.name':    'Language Learners',
      'who.4.desc':    'Study Japanese or English songs with a precise word timeline. Every word has a start and end time — perfect for sing-along with an LRC player.',

      // Under the hood
      'tech.eyebrow':  'Under the Hood',
      'tech.title':    'Real engineering, not buzzwords.',
      'tech.sub':      'Every layer uses the best open-source model available, assembled into a complete local inference pipeline.',
      'tech.demucs':   'Meta AI\'s deep-learning stem separator isolates the vocal track from the mix, removing background noise before recognition.',
      'tech.whisper':  'CTranslate2-optimised Whisper runs 4× faster than the original on the same hardware, with per-word timestamps and 99-language support.',
      'tech.cfa':      'Native CTC forced alignment built on torchaudio MMS_FA (forced_align), with uroman phonemisation and no C++ compiler — near-perfect word-boundary accuracy when full lyrics are provided.',
      'tech.torch':    'Supports NVIDIA sm_120 architecture (RTX 5000 series). cu128 compilation ensures latest GPUs run at full throughput.',
      'tech.tauri':    'Lightweight Rust framework wrapping a React UI. Installer under 10 MB — no Electron runtime bloat.',
      'tech.fastapi':  'Local IPC server bridges the Tauri frontend and the Python inference backend. Cross-platform: Windows, macOS, Linux.',

      // Comparison
      'cmp.eyebrow':        'How It Compares',
      'cmp.title':          'An honest comparison, nothing hidden.',
      'cmp.sub':            'Ai Caption isn\'t a magic bullet, but on privacy, precision, and price there\'s no compromise.',
      'cmp.col.feature':    'Feature',
      'cmp.col.cloud':      'Cloud Lyric Services',
      'cmp.col.rawwhisper': 'Raw Whisper CLI',
      'cmp.row.privacy':    'Privacy / local processing',
      'cmp.row.wordlevel':  'Word-level timestamps',
      'cmp.row.reflyrics':  'Reference-lyrics forced align',
      'cmp.row.cost':       'Cost',
      'cmp.row.gui':        'Visual QA editor',
      'cmp.row.vocal':      'Vocal separation pre-processing',
      'cmp.row.cleantext':  'Erase burned-in text (AI inpainting)',
      'cmp.yes':            'Yes',
      'cmp.no':             'No',
      'cmp.free':           'Free forever',
      'cmp.free.src':       'Free (self-host)',
      'cmp.paid':           'Subscription / per-use',
      'cmp.partial.line':   'Line-level only',
      'cmp.partial.word':   'Word-level (no GUI)',
      'cmp.partial.varies': 'Varies by service',

      // Download (v2)
      'dl.eyebrow':          'Download',
      'dl.title':            'Free to Use, Always.',
      'dl.sub':              'Pre-built installers or build from source — MIT licensed, zero restrictions.',
      'dl.wizard':           'The first-run wizard <strong>auto-detects your GPU model and VRAM</strong>, recommends the right AI model, then guides you through a one-click download — or lets you skip.',
      'dl.badge.recommended':'Recommended',
      'dl.badge.it':         'IT / silent deploy',
      'dl.badge.planned':    'Planned',
      'dl.badge.source':     'Build from source',
      'dl.exe.fmt':          '.EXE Installer',
      'dl.exe.name':         'Windows Setup Wizard',
      'dl.exe.desc':         'NSIS package. Double-click to install. Python is bundled — the first launch sets up the engine and guides you through AI model downloads.',
      'dl.msi.fmt':          '.MSI Package',
      'dl.msi.name':         'Windows MSI',
      'dl.msi.desc':         'For enterprise deployment or users who prefer MSI. Includes the same engine setup wizard.',
      'dl.zip.fmt':          '.ZIP Portable',
      'dl.zip.name':         'Windows Portable',
      'dl.zip.desc':         'Extract and run — no installer, no registry writes. Python is bundled too; the first launch sets up the engine.',
      'dl.mac.name':         'macOS — Build from Source',
      'dl.mac.desc':         'The Python backend is cross-platform and Tauri supports macOS. See the README for build instructions.',
      'dl.linux.name':       'Linux — Build from Source',
      'dl.linux.desc':       'Tested on Ubuntu 22.04+ and Arch. See the README for build instructions.',
      'dl.cta.download':     'Download',
      'dl.cta.soon':         'Coming soon',
      'dl.cta.readme':       'See README',
      'dl.note':             '<strong>First launch:</strong> A portable Python is bundled — no manual install needed. The app sets up the engine automatically and guides you through downloading the AI models (a few GB, downloaded once).',
      'dl.sysreq':           'Requires: Windows 10/11 · No discrete GPU needed (NVIDIA GPU optional, for speed) · 8 GB RAM · 10 GB disk space',
      'dl.allreleases':      'All releases →',

      // Roadmap
      'road.eyebrow':        'Active Development',
      'road.title':          'Roadmap',
      'road.sub':            'Ai Caption is under active development — here\'s what\'s shipped and what\'s coming.',
      'road.status.done':    'Done',
      'road.status.wip':     'In Progress',
      'road.status.planned': 'Planned',
      'road.1.title':        'Windows EXE & MSI Installers',
      'road.1.desc':         'NSIS and WiX packages with a first-run wizard for one-click engine setup.',
      'road.2.title':        'GPU / VRAM Auto-Detection & Model Recommendation',
      'road.2.desc':         'The first-run wizard detects your GPU and VRAM, then recommends large-v3 or a lighter model automatically.',
      'road.3.title':        'Three Pipeline Modes: Forced Align · Biasing · Auto Transcribe',
      'road.3.desc':         'Full pipeline covering every scenario from zero lyrics to complete lyrics.',
      'road.4.title':        'Windows Portable ZIP (no installer)',
      'road.4.desc':         'Extract-and-run build with no registry writes — good for USB drives or restricted environments.',
      'road.5.title':        'Bundled Python (no manual Python install required)',
      'road.5.desc':         'Package the entire Python runtime alongside the app, eliminating the system Python dependency.',
      'road.6.title':        'Cantonese Forced Alignment',
      'road.6.desc':         'A specialised aligner for Cantonese phonemes, bringing word-level precision to Cantonese songs.',
      'road.7.title':        'Additional Recognition Engine Options',
      'road.7.desc':         'Evaluating Whisper.cpp, WhisperX, and other backends as switchable alternatives.',
      'road.8.title':        'Batch Processing Mode',
      'road.8.desc':         'Drag in an entire folder, queue multiple songs automatically, and export results in bulk.',

      'priv.eyebrow':  'Privacy Promise',
      'priv.title':    'Your music stays on your machine.',
      'priv.sub':      "This isn't a marketing claim — it's the architecture.",
      'priv.p1':       'No audio or lyric data collected',
      'priv.p2':       'No personal data uploaded',
      'priv.p3':       'No account · No analytics · No cookies',
      'priv.p4':       'Works entirely offline',
      'priv.p5':       'No third-party trackers',
      'priv.p6':       'All processing runs locally on your device',
      'priv.net':      '<span class="amber-dot"></span><strong>One honest exception:</strong> when you choose to download AI models, Ai Caption fetches them from official sources (Hugging Face, pytorch.org). Beyond that, no usage data is sent anywhere.',
      'priv.date':     'Last updated: June 2026',
      'priv.full':     'Read the full Privacy Policy →',

      'faq.eyebrow':   'FAQ',
      'faq.title':     'Questions?',
      'faq.q1':        'Is Ai Caption free?',
      'faq.a1':        'Completely free, MIT licensed. Use it, modify it, redistribute it — including for commercial purposes.',
      'faq.q2':        'Does it upload my videos or songs?',
      'faq.a2':        'No. All video and audio processing happens locally on your device. Ai Caption does not communicate with any server, except when you explicitly trigger a model download.',
      'faq.q3':        'Does it work on Mac / Linux?',
      'faq.a3':        'Pre-built installers are Windows-only for now. Mac and Linux users can build from source — the Python backend is cross-platform and the Tauri frontend supports all three.',
      'faq.q4':        'Which languages are supported?',
      'faq.a4':        'All languages supported by faster-whisper large-v3, including Mandarin, Cantonese, English, Japanese, Korean, and many more. Pick a language in settings or use auto-detection.',
      'faq.q5':        'Do I need a discrete GPU?',
      'faq.a5':        'No. Ai Caption runs on CPU-only / iGPU laptops (e.g. an Intel Core Ultra) — the Video → Subtitles mode auto-picks a fast int8 model that stays snappy. An NVIDIA GPU is optional and only adds speed, especially for the heavier lyrics pipeline.',
      'faq.q6':        'How large are the models?',
      'faq.a6':        'Demucs htdemucs ~320 MB, faster-whisper large-v3 ~3.1 GB, torchaudio MMS_FA alignment model ~1.2 GB, and the Clean Text LaMa inpainting model ~200 MB. Each downloads once when you first use the corresponding feature, then runs fully offline.',
      'faq.q7':        'What can Clean Text remove?',
      'faq.a7':        'Clean Text targets fixed-position text you accidentally burned into your own video (e.g. hardcoded subtitles or a text watermark). You box a region, and LaMa AI inpaints it away frame by frame while keeping the original audio untouched. It only handles fixed-position text — not moving objects. The LaMa model downloads on first use.',
      'faq.q8':        'Do I need to install Python first? Which version is this?',
      'faq.a8':        'No. A portable Python is bundled, and the first launch sets up the engine and dependencies for you — nothing to install yourself. The current release is v0.1.3, with one-click auto-update built into the app.',

      // System Requirements
      'sysreq.eyebrow':    'System Requirements',
      'sysreq.title':      'Will your PC run it?',
      'sysreq.wizard':     'The first-run wizard <strong>auto-detects your GPU model and VRAM</strong> and recommends the right model — no need to look up your specs.',
      'sysreq.col.item':   'Item',
      'sysreq.col.min':    'Minimum',
      'sysreq.col.rec':    'Recommended',
      'sysreq.row.os':     'Operating system',
      'sysreq.min.os':     'Windows 10 / 11 (64-bit)',
      'sysreq.rec.os':     'Windows 11 (64-bit)',
      'sysreq.row.cpu':    'Processor',
      'sysreq.min.cpu':    'Any modern x86-64 CPU (Intel / AMD)',
      'sysreq.rec.cpu':    'Same — CPU is not the bottleneck when a GPU handles inference',
      'sysreq.row.gpu':    'GPU',
      'sysreq.min.gpu':    'None required — CPU-only mode works (slower)',
      'sysreq.rec.gpu':    'NVIDIA GPU with 6–8 GB+ VRAM (RTX series, CUDA)',
      'sysreq.row.ram':    'RAM',
      'sysreq.min.ram':    '8 GB RAM',
      'sysreq.rec.ram':    '16 GB RAM',
      'sysreq.row.disk':   'Disk space',
      'sysreq.min.disk':   '~6 GB (small / medium models)',
      'sysreq.rec.disk':   '~10 GB SSD (full large-v3 suite)',
      'sysreq.row.model':  'Best model tier',
      'sysreq.min.model':  'whisper small / medium (faster, good accuracy)',
      'sysreq.rec.model':  'faster-whisper large-v3 (highest accuracy, near-realtime)',

      // Local vs Cloud cost comparison
      'cost.eyebrow':              'Local vs Cloud',
      'cost.title':                'Cost & Privacy: An Honest Comparison',
      'cost.sub':                  'Cloud services have their place. Here are the numbers — judge for yourself.',
      'cost.cloud.label':          'Cloud Services',
      'cost.cloud.api.name':       'ASR API (per-minute billing)',
      'cost.cloud.api.val':        '~$0.004–0.016 / min',
      'cost.cloud.api.note':       'A 4-minute song ≈ $0.02–0.07; 100 songs/month ≈ $2–7',
      'cost.cloud.saas.name':      'Lyrics / subtitle SaaS (monthly)',
      'cost.cloud.saas.val':       '~$12–30 / month',
      'cost.cloud.saas.note':      'Often capped at a monthly quota; overages billed separately or require a plan upgrade',
      'cost.cloud.privacy.name':   'Audio privacy',
      'cost.cloud.privacy.val':    'Audio uploaded to external servers',
      'cost.cloud.privacy.note':   'Check each service\'s privacy policy and data-retention terms',
      'cost.cloud.quota.name':     'Run count',
      'cost.cloud.quota.val':      'Capped by quota or billing limits',
      'cost.local.label':          'Ai Caption (local)',
      'cost.local.persong.name':   'Cost per song',
      'cost.local.persong.val':    '$0',
      'cost.local.persong.note':   'Models download once (~5 GB total), then run entirely offline — however many times you like',
      'cost.local.runs.name':      'Run count',
      'cost.local.runs.val':       'Unlimited — re-run and tune freely',
      'cost.local.runs.note':      'Tweak parameters, switch modes, re-align — no quota pressure',
      'cost.local.privacy.name':   'Audio privacy',
      'cost.local.privacy.val':    '100% stays on your device',
      'cost.local.privacy.note':   'No server, no account, no possibility of audio leaving your machine',
      'cost.local.hw.name':        'Hardware cost',
      'cost.local.hw.val':         'A PC you already own (+ electricity)',
      'cost.local.hw.note':        'A GPU speeds things up but is not required — CPU-only mode works',

      'foot.tagline':  'Built for video, subtitles & lyrics',
      'foot.license':  'MIT License',
      'foot.privacy':  'Privacy Policy',
      'foot.copy':     '© 2026 Aries HongHuan Wu',
    }
  };

  /* ── 2. Language toggle ──────────────────────────────────────────────────── */
  function detectDefaultLang() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('lang')) return params.get('lang') === 'en' ? 'en' : 'zh';
    const stored = localStorage.getItem('al-lang');
    if (stored) return stored;
    const nav = (navigator.language || 'zh').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';
    return 'en';
  }

  let currentLang = detectDefaultLang();

  function applyLang(lang) {
    currentLang = lang;
    localStorage.setItem('al-lang', lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-TW' : 'en';

    const dict = STRINGS[lang];

    // Update all data-i18n nodes
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (dict[key] !== undefined) {
        // Use innerHTML for items that contain HTML markup
        const htmlKeys = ['dl.note', 'dl.wizard', 'priv.net', 'sysreq.wizard'];
        if (htmlKeys.includes(key)) {
          el.innerHTML = dict[key];
        } else if (key === 'hero.tagline') {
          el.innerHTML = dict[key].replace(/\n/g, '<br>');
        } else {
          el.textContent = dict[key];
        }
      }
    });

    // Toggle the lang button label
    const toggleEl = document.getElementById('lang-toggle');
    const mobileToggleEl = document.getElementById('lang-toggle-mobile');
    if (toggleEl) toggleEl.textContent = dict['nav.lang'];
    if (mobileToggleEl) mobileToggleEl.textContent = dict['nav.lang'];

    // Re-fit any open FAQ answer to its new-language height (next frame so the
    // DOM text has been applied before we measure scrollHeight).
    if (typeof remeasureOpenFAQ === 'function') {
      requestAnimationFrame(remeasureOpenFAQ);
    }
  }

  /* ── 3. Mobile nav hamburger ─────────────────────────────────────────────── */
  function initNav() {
    const hamburger = document.getElementById('nav-hamburger');
    const mobileMenu = document.getElementById('nav-mobile-menu');

    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', () => {
        const isOpen = mobileMenu.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', String(isOpen));
      });

      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
          mobileMenu.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Lang toggle — native <button> already handles Enter/Space via click; no
    // extra keydown listener needed (a keydown handler on Space would fire
    // applyLang on keydown AND again on the native keyup-click, toggling twice).
    ['lang-toggle', 'lang-toggle-mobile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          applyLang(currentLang === 'zh' ? 'en' : 'zh');
        });
      }
    });
  }

  /* ── 4. FAQ accordion ────────────────────────────────────────────────────── */
  // Open an answer to exactly its content height so no language ever clips.
  function openFaqAnswer(ans) {
    ans.classList.add('open');
    const inner = ans.querySelector('.faq-answer-inner');
    const h = inner ? inner.scrollHeight : ans.scrollHeight;
    ans.style.maxHeight = h + 'px';
  }

  function closeFaqAnswer(ans) {
    ans.classList.remove('open');
    ans.style.maxHeight = '';
  }

  function initFAQ() {
    document.querySelectorAll('.faq-question').forEach(btn => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        // Close all
        document.querySelectorAll('.faq-question').forEach(b => {
          b.setAttribute('aria-expanded', 'false');
          const ans = document.getElementById(b.getAttribute('aria-controls'));
          if (ans) closeFaqAnswer(ans);
        });
        // Toggle clicked
        if (!expanded) {
          btn.setAttribute('aria-expanded', 'true');
          const ans = document.getElementById(btn.getAttribute('aria-controls'));
          if (ans) openFaqAnswer(ans);
        }
      });
    });
  }

  // After a language switch, re-measure any open answer so the new text fits.
  function remeasureOpenFAQ() {
    document.querySelectorAll('.faq-answer.open').forEach(openFaqAnswer);
  }

  /* ── 5. Scroll reveal ────────────────────────────────────────────────────── */
  function initReveal() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
      return;
    }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
  }

  /* ── 6. Hero lyric mockup animation ──────────────────────────────────────── */
  // Cycles through fake lyric "moments" with animated gold sweep
  const LYRIC_SCENES = [
    {
      far:       '月が綺麗ですね',
      near:      '你是我心底一首歌',
      active:    ['城南花', '已開盡', '那', '一年'],
      swept:     [0, 1],
      sweeping:  2,
      amberConf: 3,
      nearAfter: 'words fading out like a sigh',
      farAfter:  'echo in the cold night air',
    },
    {
      far:       'words fading out like a sigh',
      near:      '城南花已開盡那一年',
      active:    ['I', 'close', 'my', 'eyes'],
      swept:     [0, 1, 2],
      sweeping:  3,
      amberConf: 1,
      nearAfter: '月が綺麗ですね',
      farAfter:  '你是我心底一首歌',
    },
    {
      far:       '你是我心底一首歌',
      near:      'I close my eyes',
      active:    ['月', 'が', '綺麗', 'です', 'ね'],
      swept:     [0, 1, 2, 3],
      sweeping:  4,
      amberConf: 2,
      nearAfter: '城南花已開盡那一年',
      farAfter:  'echo in the cold night air',
    },
  ];

  let sceneIndex = 0;

  function buildActiveLine(scene) {
    return scene.active.map((word, i) => {
      let cls = 'lyric-word';
      if (scene.swept.includes(i)) cls += ' swept';
      if (i === scene.sweeping) cls += ' sweep-word animating';
      if (i === scene.amberConf) cls += ' amber-conf';
      return `<span class="${cls}">${word}</span>`;
    }).join(' ');
  }

  function renderScene() {
    const scene = LYRIC_SCENES[sceneIndex % LYRIC_SCENES.length];
    const doc = document.getElementById('lyric-document');
    if (!doc) return;

    // Force reflow for re-animation
    const sweepWord = doc.querySelector('.sweep-word');
    if (sweepWord) sweepWord.classList.remove('animating');

    doc.innerHTML = `
      <div class="lyric-line far">${scene.far}</div>
      <div class="lyric-line near">${scene.near}</div>
      <div class="lyric-line active">${buildActiveLine(scene)}</div>
      <div class="lyric-line near-after">${scene.nearAfter}</div>
      <div class="lyric-line far-after">${scene.farAfter}</div>
    `;

    // Trigger sweep animation on the sweeping word
    requestAnimationFrame(() => {
      const sw = doc.querySelector('.sweep-word');
      if (sw) sw.classList.add('animating');
    });
  }

  function initMockup() {
    const doc = document.getElementById('lyric-document');
    if (!doc) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    renderScene();

    if (!prefersReduced) {
      setInterval(() => {
        sceneIndex++;
        renderScene();
        animateWaveform();
      }, 3200);
    }
  }

  /* ── 7. Waveform mock animation ──────────────────────────────────────────── */
  let waveformPos = 0.28; // 0–1, current playhead fraction

  function buildWaveform() {
    const container = document.getElementById('waveform-bars');
    if (!container) return;

    // Generate deterministic bar heights
    const count = 60;
    const bars = [];
    for (let i = 0; i < count; i++) {
      // Pseudo-random height based on index (not truly random, so it's stable)
      const h = 6 + Math.abs(Math.sin(i * 2.3 + 0.7) * 18 + Math.cos(i * 1.1) * 8);
      bars.push(h);
    }
    container.dataset.bars = JSON.stringify(bars);
    renderWaveform(bars, waveformPos);
  }

  function renderWaveform(bars, pos) {
    const container = document.getElementById('waveform-bars');
    if (!container) return;
    const count = bars.length;
    const headIndex = Math.floor(pos * count);

    container.innerHTML = bars.map((h, i) => {
      let cls = 'waveform-bar';
      let style = `height:${h}px;`;
      if (i < headIndex) cls += ' played';
      if (i === headIndex) { cls += ' head'; style += 'height:' + (h + 4) + 'px;'; }
      return `<div class="${cls}" style="${style}"></div>`;
    }).join('');
  }

  function animateWaveform() {
    const container = document.getElementById('waveform-bars');
    if (!container) return;
    const bars = JSON.parse(container.dataset.bars || '[]');
    if (!bars.length) return;
    waveformPos = (waveformPos + 0.18) % 1;
    renderWaveform(bars, waveformPos);
  }

  /* ── 8. Timecode display ─────────────────────────────────────────────────── */
  function updateTimecode() {
    const el = document.getElementById('timecode-current');
    if (!el) return;
    const totalSec = 214; // mock 3:34
    const current = Math.floor(waveformPos * totalSec);
    const m = Math.floor(current / 60).toString().padStart(2, '0');
    const s = (current % 60).toString().padStart(2, '0');
    el.textContent = `${m}:${s}`;
  }

  /* ── 9. Back-to-top button ───────────────────────────────────────────────── */
  function initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Show after scrolling ~400px
    const onScroll = () => {
      btn.classList.toggle('visible', window.scrollY > 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (prefersReduced) {
        window.scrollTo(0, 0);
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  /* ── 10. Smooth anchor scrolling (nav links) ─────────────────────────────── */
  function initSmoothAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        const hash = link.getAttribute('href');
        if (hash === '#') return; // wordmark home link — let default handle
        const target = document.querySelector(hash);
        if (!target) return;
        e.preventDefault();
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const offset = 72; // nav height
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        if (prefersReduced) {
          window.scrollTo(0, top);
        } else {
          window.scrollTo({ top, behavior: 'smooth' });
        }
        // Close mobile menu if open
        const mobileMenu = document.getElementById('nav-mobile-menu');
        const hamburger  = document.getElementById('nav-hamburger');
        if (mobileMenu && mobileMenu.classList.contains('open')) {
          mobileMenu.classList.remove('open');
          if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  /* ── Boot ────────────────────────────────────────────────────────────────── */
  function boot() {
    applyLang(currentLang);
    initNav();
    initFAQ();
    initReveal();
    initMockup();
    buildWaveform();
    initBackToTop();
    initSmoothAnchors();

    // Timecode update every 3.2 s (in sync with scene)
    setInterval(updateTimecode, 3200);
    updateTimecode();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
