# 個人記帳 · 手機 App（GitHub Pages）

收據相片上傳 → 手機上用你自己嘅 AI 即時辨識（產品、數量、金額、日期、商店）→ 自動分類 11 類 → 帳簿同步到你嘅 **GitHub 私有 repo** → 一按匯出 Excel。

**呢個 repo 只放介面程式碼。帳簿同收據相片全部放喺另一個私有 repo，唔會出現喺呢度。**

---

## 一、設定（第一次，約 3 分鐘）

### 1. 開兩個 repo

| 用途 | 名 | 可見性 |
|---|---|---|
| 介面（即係呢個） | `receipt-ledger` | **Public**（GitHub Pages 免費用公開 repo） |
| 帳簿＋相片 | `receipt-ledger-data` | **Private** |

> 兩個都開好之後，叫 Hermes 幫你推程式碼上去（或自己 push 呢個資料夾嘅內容到 `receipt-ledger` 嘅 `main`，再到 Settings → Pages 選 **Deploy from a branch → main / (root)**）。

### 2. 建一個 GitHub Token（App 用來讀寫私有 repo）

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token：

- **Repository access**：Only select repositories → 揀 `receipt-ledger-data`
- **Permissions → Repository permissions → Contents**：**Read and write**
- 有效期自選（過期後重新產生再貼入 App）

> 想 Hermes 順手幫你推程式碼同種入現有帳目？同一個 token 加埋 `receipt-ledger`（Contents: Read and write）就得。

### 3. 揀一個 AI

| 服務商 | 免費？ | 備註 |
|---|---|---|
| **Google Gemini**（推薦） | 有免費額度 | 去 Google AI Studio 攞 API key |
| OpenRouter | 部分模型免費 | 一個 key 用多個模型 |
| OpenAI | 無 | ⚠️ 官方 API **唔開 CORS**，瀏覽器直接呼叫會失敗 |

### 4. 喺 App 填設定

開 App → **⚙️ 設定** → 填 API Key、模型、資料 repo（`你的名/receipt-ledger-data`）、GitHub Token → 每個都有 **測試** 掣可即時驗證 → **儲存設定**。

---

## 二、加到主畫面（iPhone）

Safari 開 App 網址 → 底部 **分享** → **加到主畫面** → 之後由主畫面開就係全螢幕 App。

Android Chrome：右上選單 → **安裝應用程式**／**加到主畫面**。

---

## 三、日常用法

1. **📷 上傳**：影相或揀相簿（可一次多張）→ AI 逐張辨識
2. **📝 待確認**：覆核／改品名、數量、金額、幣別、類別、日期、商店 → 「全部入帳」
3. **📒 明細**：分類統計、每日合計、改類別、刪除、**🌐 譯成中文**、**⬇ 下載 Excel**
4. 資料會自動寫入你嘅私有 repo（`ledger.json` + `photos/`）

---

## 四、功能對照

| 功能 | 有 | 說明 |
|---|---|---|
| 11 個固定類別 | ✅ | 餐飲／超市雜貨／交通／日用百貨／電子產品／服飾美容／醫療保健／家居／娛樂／教育／其他 |
| 12 欄明細 | ✅ | 日期、時間、產品名稱、數量、原幣金額、幣別、匯率、金額(HKD)、類別、商店／來源、備註、原文／譯名前 |
| 多幣別 → HKD | ✅ | 匯率每日自動更新（open.er-api.com），可手動覆寫 |
| 非中英文品名 → 中文 | ✅ | 假名／諺文／泰文等自動譯成繁中，原文保留喺第 12 欄 |
| Excel 匯出 | ✅ | 5 個工作表：消費明細、每日小計、類別分析、匯率參考、類別定義 |
| Excel 原生圖表 | ❌ | 瀏覽器環境（SheetJS）做唔到 Excel 內嵌圖表；網頁上有圓餅／長條圖 |
| PDF 收據 | ❌ | 請用手機相簿嘅相片或截圖 |
| 離線 | 部分 | 介面可離線開；辨識同同步要上網 |

---

## 五、私隱

- API key、GitHub token **只存喺你部手機嘅 localStorage**，唔會上傳去任何地方。
- 收據相片：只送去你揀嘅 AI 服務商做辨識，同時存喺你嘅**私有** repo。
- 呢個公開 repo 只有程式碼，冇任何個人資料。
- 換手機：重新填一次設定即可（資料喺 GitHub，會自動同步落嚟）。

## 六、授權

`vendor/xlsx.full.min.js` = SheetJS Community Edition（Apache-2.0）。
