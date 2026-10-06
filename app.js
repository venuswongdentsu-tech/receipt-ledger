/* =====================================================================
   個人記帳 — 獨立 GitHub Pages PWA
   前端：上傳相片 → 你嘅 AI（Gemini／OpenRouter／自訂）即時辨識 → 帳簿
   資料：你嘅 GitHub 私有 repo（ledger.json + photos/*）
   匯出：Excel（SheetJS，5 個工作表，格式同桌面版一致）
   ===================================================================== */
"use strict";

var CATS = ["餐飲", "超市雜貨", "交通", "日用百貨", "電子產品", "服飾美容",
            "醫療保健", "家居", "娛樂", "教育", "其他"];

var DEFAULT_RATES = { HKD: 1.0, CNY: 1.09, JPY: 0.0525, TWD: 0.25, USD: 7.80,
  GBP: 10.20, EUR: 8.60, SGD: 5.90, AUD: 5.10, KRW: 0.0057,
  THB: 0.2200, MYR: 1.7800, PHP: 0.1350, VND: 0.00031 };

var CAT_ALIAS = { "餐飲美食": "餐飲", "飲食": "餐飲", "餐廳": "餐飲", "food": "餐飲",
  "超市": "超市雜貨", "雜貨": "超市雜貨", "grocery": "超市雜貨", "交通運輸": "交通",
  "日用品": "日用百貨", "百貨": "日用百貨", "電子": "電子產品", "3c": "電子產品",
  "服飾": "服飾美容", "美容": "服飾美容", "醫療": "醫療保健", "健康": "醫療保健",
  "家庭": "家居", "家品": "家居", "娛樂休閒": "娛樂", "教育學習": "教育" };

var PROVIDERS = {
  gemini: { style: "gemini", base: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-flash-latest" },
  openrouter: { style: "openai", base: "https://openrouter.ai/api/v1", model: "google/gemma-4-31b-it:free" },
  openai: { style: "openai", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  custom: { style: "openai", base: "", model: "" }
};

var PROMPT = `You are a meticulous receipt data extractor for a personal accounting ledger.

Return ONLY minified JSON (no markdown fence, no commentary) with this exact shape:
{"receipts":[{"store":"","date":"YYYY-MM-DD","time":"HH:MM","currency":"HKD",
"items":[{"product":"","product_zh":"","qty":1,"unit_price":0,"amount":0,
"category":"餐飲"}],"total":0,"note":""}]}

Rules:
- One entry in "receipts" per physical receipt in the image.
- "product" = the item name EXACTLY as printed, in its original language and
  script. Never translate, romanise or re-spell it here.
- "product_zh" = the same item name in Traditional Chinese (Hong Kong usage):
    * printed name already Chinese -> repeat it unchanged;
    * printed name in a NON-Latin script (Japanese, Korean, Thai, Arabic,
      Cyrillic, Greek, Hebrew, Devanagari, ...) -> TRANSLATE it into natural
      Traditional Chinese, keeping brand names recognisable. Examples:
      「ポテトチップス うすしお」->「薯片（薄鹽）」, 「김치라면」->「泡菜拉麵」,
      「น้ำปลา」->「魚露」, 「여성용 양말」->「女裝襪」;
    * printed name in English / Latin script -> give the natural Traditional
      Chinese equivalent (e.g. "Tissue Box" -> "紙巾盒", "Flat White" -> "平白咖啡").
    Never leave "product_zh" empty.
- qty = quantity purchased (default 1). amount = line total for that qty in the
  receipt's own currency. unit_price = amount / qty.
- Never invent items that are not on the receipt. Skip non-purchase lines
  (subtotal, change, cash tendered, loyalty points, tax summary).
- If a line shows a discount, use the net payable amount.
- currency: 3-letter code (HKD, CNY, JPY, USD, ...). Today is {today}.
- date/time: prefer what is printed on the receipt; if absent use {today} and "12:00".
- category: pick EXACTLY ONE from this list, copied character-for-character
  (never invent a new category, never translate it): {cats}
- total = the receipt grand total in the receipt's currency.`;

/* ───────────────────────── 小工具 ───────────────────────── */
var S = { provider: "gemini", style: "gemini", base: PROVIDERS.gemini.base,
          model: PROVIDERS.gemini.model, key: "", repo: "", token: "", rates: "" };
var items = [];          // 帳簿
var pending = [];        // 待確認
var ledgerSha = null;
var rates = {}, ratesDate = "";
var photoCache = {};

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function money(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-HK",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function uid(n) {
  var a = new Uint8Array((n || 10) / 2), s = "";
  (self.crypto || self.msCrypto).getRandomValues(a);
  for (var i = 0; i < a.length; i++) s += ("0" + a[i].toString(16)).slice(-2);
  return s;
}
function toast(msg, isErr) {
  var t = $("toast");
  t.textContent = msg; t.className = "toast on" + (isErr ? " err" : "");
  clearTimeout(t._h); t._h = setTimeout(function () { t.className = "toast"; }, isErr ? 6000 : 3200);
}
function ov(on, txt) { $("ov").hidden = !on; if (txt) $("ovTxt").textContent = txt; }
function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64dec(b64) { return decodeURIComponent(escape(atob((b64 || "").replace(/\s/g, "")))); }

/* ── 保險：無論如何都唔可以卡住喺遮罩 ── */
window.addEventListener("error", function () { try { ov(false); } catch (e) {} });
window.addEventListener("unhandledrejection", function () { try { ov(false); } catch (e) {} });
window.addEventListener("pageshow", function () { try { ov(false); } catch (e) {} });
/* 遮罩最長 90 秒自動收（避免任何未知情況卡死） */
var _ovT = null;
var _ovRaw = ov;
ov = function (on, txt) {
  _ovRaw(on, txt);
  clearTimeout(_ovT);
  if (on) _ovT = setTimeout(function () { try { _ovRaw(false); } catch (e) {} }, 90000);
};

function needsTranslation(name) {
  if (!name) return false;
  if (/[\u4e00-\u9fff]/.test(name)) return false;          // 有中文 -> 唔譯
  if (/^[\x00-\x7F]*$/.test(name)) return false;           // 純英數 -> 唔譯
  return true;                                             // 假名／諺文／泰文…
}

function mapCat(c) {
  c = (c || "").trim();
  if (CATS.indexOf(c) >= 0) return c;
  var k = c.toLowerCase().replace(/\s|\/|／/g, "");
  if (CAT_ALIAS[k]) return CAT_ALIAS[k];
  for (var i = 0; i < CATS.length; i++) if (c.indexOf(CATS[i]) >= 0) return CATS[i];
  return "其他";
}
function fxOf(cur) {
  cur = (cur || "HKD").toUpperCase();
  if (cur === "HKD") return 1;
  return Number(rates[cur] || DEFAULT_RATES[cur] || 1);
}

/* ───────────────────────── 設定 ───────────────────────── */
function loadSettings() {
  try { var raw = localStorage.getItem("ra.settings"); if (raw) Object.assign(S, JSON.parse(raw)); } catch (e) {}
  try { rates = JSON.parse(localStorage.getItem("ra.rates") || "{}"); } catch (e) { rates = {}; }
  ratesDate = localStorage.getItem("ra.ratesDate") || "";
  try { ledgerSha = localStorage.getItem("ra.ledgerSha") || null; } catch (e) {}
  var rawItems = localStorage.getItem("ra.ledger");
  if (rawItems) { try { items = JSON.parse(rawItems) || []; } catch (e) { items = []; } }
  var rawPend = localStorage.getItem("ra.pending");
  if (rawPend) { try { pending = JSON.parse(rawPend) || []; } catch (e) { pending = []; } }
}
function saveSettings() {
  localStorage.setItem("ra.settings", JSON.stringify(S));
}
function saveLocal() {
  localStorage.setItem("ra.ledger", JSON.stringify(items));
  localStorage.setItem("ra.pending", JSON.stringify(pending));
  if (ledgerSha) localStorage.setItem("ra.ledgerSha", ledgerSha);
}
function applyProvider(name) {
  var p = PROVIDERS[name] || PROVIDERS.custom;
  S.provider = name;
  if (name !== "custom") { S.style = p.style; S.base = p.base; S.model = p.model; }
  else S.style = "openai";
}

/* ───────────────────────── 匯率 ───────────────────────── */
function loadRates(force) {
  if (!force && ratesDate === new Date().toISOString().slice(0, 10) && Object.keys(rates).length) {
    renderHeader(); return;
  }
  return fetch("https://open.er-api.com/v6/latest/HKD", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.rates) throw new Error("no rates");
      var out = { HKD: 1 };
      for (var c in d.rates) { if (d.rates[c]) out[c] = 1 / d.rates[c]; }
      rates = out; ratesDate = new Date().toISOString().slice(0, 10);
      localStorage.setItem("ra.rates", JSON.stringify(rates));
      localStorage.setItem("ra.ratesDate", ratesDate);
      renderHeader();
    })
    .catch(function () { /* 用預設匯率 */ });
}

/* ───────────────────────── AI 呼叫 ───────────────────────── */
var AI_DEBUG = null;   /* 出錯時用嚟顯示真正原因（模型、finish_reason、原話） */
function callModel(parts) {
  /* parts: [{text:"…"} | {image:{mime,b64}}] */
  if (!S.key) throw new Error("未設定 API Key（去「設定」）");
  if (!S.base || !S.model) throw new Error("未設定 Base URL／模型（去「設定」）");
  var url, headers = { "Content-Type": "application/json" }, body;

  if (S.style === "gemini") {
    url = S.base.replace(/\/+$/, "") + "/models/" + encodeURIComponent(S.model) + ":generateContent";
    headers["x-goog-api-key"] = S.key;
    body = { contents: [{ parts: parts.map(function (p) {
      if (p.text != null) return { text: p.text };
      return { inline_data: { mime_type: p.image.mime, data: p.image.b64 } };
    }) }], generationConfig: { temperature: 0, maxOutputTokens: 4096 } };
  } else {
    url = S.base.replace(/\/+$/, "") + "/chat/completions";
    headers["Authorization"] = "Bearer " + S.key;
    body = { model: S.model, temperature: 0,
      max_tokens: 4000,
      messages: [{ role: "user", content: parts.map(function (p) {
        if (p.text != null) return { type: "text", text: p.text };
        return { type: "image_url", image_url: { url: "data:" + p.image.mime + ";base64," + p.image.b64 } };
      }) }] };
  }
  AI_DEBUG = { model: S.model, provider: S.provider, style: S.style,
    hasImage: parts.some(function (p) { return !!p.image; }) };
  return fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body) })
    .then(function (r) {
      return r.text().then(function (t) {
        AI_DEBUG.status = r.status;
        if (!r.ok) throw new Error("HTTP " + r.status + "：" + t.slice(0, 320));
        var d; try { d = JSON.parse(t); } catch (e) { AI_DEBUG.raw = t; throw new Error("回應非 JSON：" + t.slice(0, 200)); }
        if (S.style === "gemini") {
          var c = d.candidates && d.candidates[0];
          if (!c) throw new Error("回應無內容：" + t.slice(0, 320));
          AI_DEBUG.finish = c.finishReason || ""; AI_DEBUG.raw = t;
          return ((c.content && c.content.parts) || []).map(function (p) { return p.text || ""; }).join("");
        }
        var m = d.choices && d.choices[0] && d.choices[0].message;
        if (!m) throw new Error("回應無內容：" + t.slice(0, 320));
        AI_DEBUG.finish = d.choices[0].finish_reason || ""; AI_DEBUG.raw = t;
        if (m.content == null || m.content === "") AI_DEBUG.empty = true;
        return m.content || m.reasoning_content || m.reasoning || "";
      });
    });
}

function parseJSONLoose(text) {
  var raw = (text || "").trim();
  text = raw.replace(/```[a-zA-Z]*/g, "").trim();
  var a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < 0) {
    var why = !raw
      ? "模型回覆完全空白 —— 最大機會係呢個模型【唔支援睇圖】（純文字模型），佢根本睇唔到張收據。"
      : "模型冇用 JSON 格式回覆（佢可能只係講咗幾句人話，或者睇唔到圖）。";
    var f = (AI_DEBUG && AI_DEBUG.finish) ? "（finish_reason：" + AI_DEBUG.finish + "）" : "";
    throw new Error("AI 冇回傳 JSON。" + why + f +
      "\n\n模型：" + ((AI_DEBUG && AI_DEBUG.model) || "?") +
      "\n模型實際回覆：" + (raw ? raw.slice(0, 300) : "（空白）") +
      "\n\n👉 去「設定」按「查模型」，揀有 🖼 標記（支援睇圖）嘅模型。");
  }
  var d = JSON.parse(text.slice(a, b + 1));
  var rs = d && d.receipts;
  if (rs == null) rs = d && d.items ? [d] : [];
  return Array.isArray(rs) ? rs : [];
}

function extractRows(photo) {
  var today = new Date().toISOString().slice(0, 10);
  var prompt = PROMPT.replace("{today}", today).replace("{cats}", CATS.join(" / "));
  var img = { image: { mime: photo.mime, b64: photo.b64 } };
  return callModel([{ text: prompt }, img]).then(parseJSONLoose).catch(function (e1) {
    /* 第一次失敗 → 加強指令再試一次（好多模型要人提佢先肯淨係出 JSON） */
    var strict = { text: prompt + "\n\n⚠️ 極重要：只可以輸出一個 JSON 物件。唔可以有任何解釋、問候、道歉或 markdown 代碼框。" };
    return callModel([strict, img]).then(parseJSONLoose).catch(function () { throw e1; });
  }).then(function (receipts) { return normalise(receipts, photo); });
}

function normalise(receipts, photo) {
  var rows = [], rid = photo.rid;
  receipts.forEach(function (rc) {
    if (!rc || typeof rc !== "object") return;
    var store = rc.store || "", date = rc.date || new Date().toISOString().slice(0, 10),
        time = rc.time || "12:00", cur = (rc.currency || "HKD").toUpperCase(),
        note = rc.note || "";
    (rc.items || []).forEach(function (it) {
      var amt = Number(it.amount);
      if (!amt && !it.product) return;
      var qty = Number(it.qty) || 1;
      var zh = (it.product_zh || "").trim();
      var printed = (it.product || "").trim() || zh;
      var display = zh || printed;
      var fx = cur === "HKD" ? 1 : fxOf(cur);
      rows.push({
        id: uid(10), date: date, time: time,
        product: display, product_zh: zh || display,
        product_original: printed === display ? "" : printed,
        qty: qty, amount: r2(amt || 0), currency: cur, fx: fx, hkd: r2((amt || 0) * fx),
        category: mapCat(it.category), store: store, note: note,
        receipt_id: rid, source: photo.name || ""
      });
    });
    if (!(rc.items || []).length && rc.total) {
      rows.push({ id: uid(10), date: date, time: time, product: "（整張收據）", product_zh: "（整張收據）",
        product_original: "", qty: 1, amount: r2(rc.total), currency: cur, fx: fxOf(cur),
        hkd: r2(rc.total * fxOf(cur)), category: "其他", store: store, note: note,
        receipt_id: rid, source: photo.name || "" });
    }
  });
  return rows;
}

function translateRows(rows) {
  /* rows: 需要翻譯嘅帳簿列（用 product_original 重新譯） */
  var names = rows.map(function (r) { return r.product_original || r.product; });
  var ask = "Translate each item name into natural Traditional Chinese (Hong Kong usage). "
    + "Keep brand names recognisable. Return ONLY minified JSON "
    + '{"t":["…","…"]} with exactly ' + names.length + " entries, same order.\n"
    + JSON.stringify(names);
  return callModel([{ text: ask }]).then(function (txt) {
    txt = (txt || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    var a = txt.indexOf("{"), b = txt.lastIndexOf("}");
    var d = JSON.parse(txt.slice(a, b + 1));
    var t = d.t || d.translations || d.names || [];
    if (!Array.isArray(t)) throw new Error("翻譯回應格式有誤");
    return t.map(function (x) {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") return x.zh || x.t || x.text || "";
      return "";
    });
  });
}

/* ───────────────────────── GitHub 私有資料庫 ───────────────────────── */
function ghReady() { return !!(S.repo && S.token); }
function ghUrl(p) { return "https://api.github.com/repos/" + S.repo + "/contents/" + p.split("/").map(encodeURIComponent).join("/"); }
function ghH() {
  return { "Authorization": "Bearer " + S.token, "Accept": "application/vnd.github+json",
           "X-GitHub-Api-Version": "2022-11-28" };
}
function ghGet(p) {
  return fetch(ghUrl(p) + "?t=" + Date.now(), { headers: ghH(), cache: "no-store" })
    .then(function (r) {
      if (r.status === 404) return null;
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.message || ("HTTP " + r.status));
        return d;
      });
    });
}
function ghPut(p, base64, msg, sha) {
  var body = { message: msg, content: base64 };
  if (sha) body.sha = sha;
  return fetch(ghUrl(p), { method: "PUT", headers: ghH(), body: JSON.stringify(body) })
    .then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) { var e = new Error(d.message || ("HTTP " + r.status)); e.status = r.status; throw e; }
        return d;
      });
    });
}
function ghDelete(p, msg, sha) {
  return fetch(ghUrl(p), { method: "DELETE", headers: ghH(),
      body: JSON.stringify({ message: msg, sha: sha }) })
    .then(function (r) { return r.json().then(function (d) {
      if (!r.ok) throw new Error(d.message || ("HTTP " + r.status)); return d; }); });
}

function pullLedger() {
  if (!ghReady()) return Promise.resolve(false);
  return ghGet("ledger.json").then(function (f) {
    if (!f) { ledgerSha = null; return false; }
    var d = JSON.parse(b64dec(f.content));
    items = (d.items || []).map(function (r) { r.hkd = r2(r.amount * (r.currency === "HKD" ? 1 : (r.fx || fxOf(r.currency)))); return r; });
    ledgerSha = f.sha;
    saveLocal(); renderAll();
    return true;
  });
}

function pushLedger() {
  if (!ghReady()) { saveLocal(); return Promise.resolve(false); }
  var payload = JSON.stringify({ version: 1, updated: new Date().toISOString(), items: items }, null, 1);
  var attempt = function (sha) {
    return ghPut("ledger.json", b64enc(payload), "ledger: " + items.length + " items", sha)
      .then(function (d) { ledgerSha = d.content && d.content.sha; saveLocal(); return true; })
      .catch(function (e) {
        if (e.status === 409 || e.status === 422) {          // sha 過期 -> 重新拉再試一次
          return ghGet("ledger.json").then(function (f) {
            return ghPut("ledger.json", b64enc(payload), "ledger: " + items.length + " items", f && f.sha)
              .then(function (d) { ledgerSha = d.content && d.content.sha; saveLocal(); return true; });
          });
        }
        throw e;
      });
  };
  return attempt(ledgerSha);
}

function putPhoto(rid, b64, name) {
  if (!ghReady()) return Promise.resolve(false);
  return ghPut("photos/" + rid + ".jpg", b64, "photo " + rid + " (" + (name || "") + ")", null)
    .then(function () { return true; }).catch(function () { return false; });
}

function loadRecent() {
  if (!ghReady() || !$("recent")) return Promise.resolve();
  return ghGet("photos").then(function (dir) {
    if (!dir || !Array.isArray(dir)) return;
    var files = dir.filter(function (f) { return /\.jpe?g$/i.test(f.name); })
                   .sort(function (a, b) { return a.name < b.name ? 1 : -1; }).slice(0, 12);
    $("recentH").hidden = !files.length;
    $("recent").innerHTML = files.map(function (f) {
      var rid = f.name.replace(/\.jpe?g$/i, "");
      return '<span data-rid="' + rid + '"><img alt="" data-img="' + rid + '"><i>' + esc(rid) + '</i></span>';
    }).join("");
    files.forEach(function (f) {
      var rid = f.name.replace(/\.jpe?g$/i, "");
      var img = $("recent").querySelector('[data-img="' + rid + '"]');
      if (!img) return;
      img.src = photoCache[rid] || (photoCache[rid] = "");
      blobFor(rid).then(function (u) { if (u) img.src = u; });
    });
  }).catch(function () {});
}

function blobFor(rid) {
  if (photoCache[rid]) return Promise.resolve(photoCache[rid]);
  return ghGet("photos/" + rid + ".jpg").then(function (f) {
    if (!f || !f.content) return null;
    var bytes = Uint8Array.from(atob(f.content.replace(/\s/g, "")), function (c) { return c.charCodeAt(0); });
    var url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    photoCache[rid] = url; return url;
  }).catch(function () { return null; });
}

/* ───────────────────────── 相片處理 ───────────────────────── */
function readFile(file) {
  return new Promise(function (res, rej) {
    var fr = new FileReader();
    fr.onload = function () { res(fr.result); };
    fr.onerror = function () { rej(new Error("讀取失敗")); };
    fr.readAsDataURL(file);
  });
}
function shrink(dataUrl, file) {
  return new Promise(function (res) {
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      return res({ dataUrl: dataUrl, mime: file.type || "application/pdf", b64: String(dataUrl).split(",")[1] || "", pdf: true });
    }
    var img = new Image();
    img.onload = function () {
      var MAX = 1600, w = img.naturalWidth, h = img.naturalHeight;
      var sc = Math.min(1, MAX / Math.max(w, h));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      var out = c.toDataURL("image/jpeg", 0.85);
      res({ dataUrl: out, mime: "image/jpeg", b64: out.split(",")[1], w: c.width, h: c.height });
    };
    img.onerror = function () { res({ dataUrl: dataUrl, mime: file.type || "image/jpeg", b64: String(dataUrl).split(",")[1] || "" }); };
    img.src = dataUrl;
  });
}

/* ───────────────────────── 介面 ───────────────────────── */
function fmtShort(iso) {
  if (!iso) return "";
  var p = String(iso).split("-");
  return p.length === 3 ? p[1] + "/" + p[2] : iso;
}
function renderHeader() {
  var total = items.reduce(function (s, r) { return s + (Number(r.hkd) || 0); }, 0);
  $("hdTotal").textContent = money(total);
  var rcpts = {};
  items.forEach(function (r) { if (r.receipt_id) rcpts[r.receipt_id] = 1; });
  $("hdSub").textContent = items.length + " 件已入帳 · " + Object.keys(rcpts).length + " 張收據"
    + (pending.length ? " · ⏳ " + pending.length + " 待確認" : "");
  var b = $("pendBadge");
  b.hidden = !pending.length; b.textContent = pending.length;
  $("pendBar").hidden = !pending.length;
  $("pendEmpty").hidden = pending.length > 0;
}

function itemCard(r, mode) {
  var opts = CATS.map(function (c) {
    return '<option value="' + c + '"' + (c === r.category ? " selected" : "") + ">" + c + "</option>"; }).join("");
  var curOpts = Object.keys(DEFAULT_RATES).concat(["JPY", "CNY"]).filter(function (c, i, a) { return a.indexOf(c) === i; })
    .map(function (c) { return '<option value="' + c + '"' + (c === r.currency ? " selected" : "") + ">" + c + "</option>"; }).join("");
  var alt = r.product_original && r.product_original !== r.product
    ? '<div class="item-alt">原文：' + esc(r.product_original) + "</div>" : "";
  var head = '<div class="item-top"><div class="item-name">' + esc(r.product || "（未命名）") + alt + "</div>"
    + '<div class="item-amt">' + (r.currency === "HKD" ? "HK$" : esc(r.currency) + " ")
    + money(r.amount) + '</div></div>'
    + '<div class="item-sub">' + esc(r.date || "") + " " + esc(r.time || "")
    + (r.store ? " · " + esc(r.store) : "") + ' · <span class="hkd">≈ HK$' + money(r.hkd) + "</span>"
    + ' · <span class="cat-pill">' + esc(r.category) + "</span></div>";

  var fields = '<div class="grid3">'
    + '<label class="f">數量<input type="number" step="any" data-k="qty" value="' + (r.qty || 1) + '"></label>'
    + '<label class="f">金額<input type="number" step="any" data-k="amount" value="' + (r.amount || 0) + '"></label>'
    + '<label class="f">幣別<select data-k="currency">' + curOpts + "</select></label></div>"
    + '<div class="grid3">'
    + '<label class="f">類別<select data-k="category">' + opts + "</select></label>"
    + '<label class="f">日期<input type="date" data-k="date" value="' + esc(r.date || "") + '"></label>'
    + '<label class="f">商店<input type="text" data-k="store" value="' + esc(r.store || "") + '"></label></div>';

  var act = mode === "pend"
    ? '<div class="item-act"><button class="btn btn-sm" data-act="p-del">刪除</button>'
      + '<button class="btn btn-sm btn-primary" data-act="p-ok">入帳</button></div>'
    : '<div class="item-act"><button class="btn btn-sm btn-danger" data-act="l-del">刪除</button></div>';

  return '<div class="item" data-id="' + esc(r.id) + '" data-mode="' + mode + '">' + head + fields + act + "</div>";
}

function renderPending() {
  $("pendList").innerHTML = pending.map(function (r) { return itemCard(r, "pend"); }).join("");
  renderHeader();
}
function renderLedger() {
  var sorted = items.slice().sort(function (a, b) {
    return (a.date + (a.time || "")) < (b.date + (b.time || "")) ? 1 : -1; });
  $("ledList").innerHTML = sorted.map(function (r) { return itemCard(r, "led"); }).join("");
  $("ledEmpty").hidden = sorted.length > 0;

  var total = 0, byCat = {}, byCur = {}, byDay = {};
  items.forEach(function (r) {
    var h = Number(r.hkd) || 0; total += h;
    byCat[r.category || "其他"] = (byCat[r.category || "其他"] || 0) + h;
    var c = r.currency || "HKD";
    byCur[c] = byCur[c] || { amt: 0, hkd: 0 };
    byCur[c].amt += Number(r.amount) || 0; byCur[c].hkd += h;
    byDay[r.date] = (byDay[r.date] || 0) + h;
  });
  var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
  var html = '<div class="st"><div class="st-k">總支出（HKD）</div><div class="st-v">' + money(total) + "</div>"
    + '<div class="st-k" style="margin-top:4px">' + items.length + " 件 · " + Object.keys(byDay).length + " 日</div></div>";
  cats.forEach(function (c) {
    var pct = total ? (byCat[c] / total * 100) : 0;
    html += '<div class="st"><div class="st-k">' + esc(c) + " · " + pct.toFixed(1) + '%</div><div class="st-v">'
      + money(byCat[c]) + '</div><div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>';
  });
  var curK = Object.keys(byCur).filter(function (c) { return c !== "HKD"; });
  curK.forEach(function (c) {
    html += '<div class="st"><div class="st-k">' + esc(c) + " 原幣</div><div class=\"st-v\">"
      + money(byCur[c].amt) + '</div><div class="st-k">≈ HK$' + money(byCur[c].hkd) + "</div></div>";
  });
  $("ledStats").innerHTML = items.length ? html : "";
  renderHeader();
}
function renderAll() { renderPending(); renderLedger(); }

/* ───────────────────────── 上傳流程 ───────────────────────── */
function handleFiles(list) {
  var files = Array.prototype.slice.call(list || []);
  if (!files.length) return;
  if (!S.key) { toast("請先去「設定」填 API Key", true); go("set"); return; }
  var i = 0;
  var step = function () {
    if (i >= files.length) { ov(false); saveLocal(); renderAll(); toast("辨識完成，去「待確認」覆核"); return; }
    var f = files[i++];
    var card = document.createElement("div");
    card.className = "q"; card.id = "q" + i;
    card.innerHTML = '<span class="st">⏳</span><div class="q-b"><div class="q-t">' + esc(f.name)
      + '</div><div class="q-s">辨識中…</div></div>';
    $("upQueue").prepend(card);
    ov(true, "辨識 " + i + "/" + files.length + "：" + f.name);
    readFile(f).then(function (dataUrl) { return shrink(dataUrl, f); }).then(function (photo) {
      photo.rid = uid(10); photo.name = f.name;
      if (photo.pdf) {
        card.querySelector(".st").textContent = "⚠️";
        card.querySelector(".q-s").innerHTML = '<span class="bad">暫不支援 PDF，請用相片或截圖</span>';
        return;
      }
      return extractRows(photo).then(function (rows) {
        if (!rows.length) {
          card.querySelector(".st").textContent = "🤷";
          card.querySelector(".q-s").textContent = "冇辨識到項目";
        } else {
          pending = pending.concat(rows);
          card.querySelector(".st").textContent = "✅";
          card.querySelector(".q-s").textContent = "辨識到 " + rows.length + " 件（待確認）";
          return putPhoto(photo.rid, photo.b64, photo.name);
        }
      });
    }).catch(function (e) {
      card.querySelector(".st").textContent = "❌";
      card.querySelector(".q-s").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
      toast("辨識失敗：" + e.message, true);
    }).then(step);
  };
  step();
}

/* ───────────────────────── 匯出 Excel ───────────────────────── */
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise(function (res, rej) {
    var srcs = ["vendor/xlsx.full.min.js", "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"];
    var k = 0;
    var tryNext = function () {
      if (k >= srcs.length) return rej(new Error("載入 Excel 引擎失敗（檢查 vendor/xlsx.full.min.js）"));
      var s = document.createElement("script");
      s.src = srcs[k++];
      s.onload = function () { window.XLSX ? res(window.XLSX) : tryNext(); };
      s.onerror = tryNext;
      document.head.appendChild(s);
    };
    tryNext();
  });
}

function exportXlsx() {
  if (!items.length) { toast("帳簿係空嘅", true); return; }
  ov(true, "產生 Excel…");
  loadXlsx().then(function (XLSX) {
    var HEADERS = ["日期", "時間", "產品名稱", "數量", "原幣金額", "幣別", "匯率",
                   "金額(HKD)", "類別", "商店／來源", "備註", "原文／譯名前"];
    var WIDTHS = [12, 8, 32, 7, 12, 8, 11, 13, 12, 19, 22, 26];
    var rows = items.slice().sort(function (a, b) {
      return (a.date + (a.time || "")) < (b.date + (b.time || "")) ? -1 : 1; });

    var wb = XLSX.utils.book_new();

    /* 消費明細 */
    var aoa = [["個人消費記帳明細表"], ["所有統計一律以港幣（HKD）計算；外幣按「匯率」欄折算。"], HEADERS];
    var byDay = {}, byCat = {}, byCur = {};
    rows.forEach(function (r) {
      aoa.push([r.date, r.time || "", r.product || "", Number(r.qty) || 1, Number(r.amount) || 0,
                r.currency || "HKD", r.currency === "HKD" ? 1 : Number(r.fx) || fxOf(r.currency),
                Number(r.hkd) || 0, r.category || "其他", r.store || "", r.note || "",
                r.product_original || ""]);
      byDay[r.date] = (byDay[r.date] || 0) + (Number(r.hkd) || 0);
      byCat[r.category || "其他"] = (byCat[r.category || "其他"] || 0) + (Number(r.hkd) || 0);
      var c = r.currency || "HKD";
      byCur[c] = byCur[c] || { amt: 0, hkd: 0 };
      byCur[c].amt += Number(r.amount) || 0; byCur[c].hkd += Number(r.hkd) || 0;
    });
    var grand = rows.reduce(function (s, r) { return s + (Number(r.hkd) || 0); }, 0);
    aoa.push(["", "", "總計", "", "", "", "", r2(grand), "", "", "", ""]);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = WIDTHS.map(function (w) { return { wch: w }; });
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
    XLSX.utils.book_append_sheet(wb, ws, "消費明細");

    /* 每日小計 */
    var d1 = [["日期", "筆數", "金額(HKD)", "佔比"]];
    Object.keys(byDay).sort().forEach(function (d) {
      var n = rows.filter(function (r) { return r.date === d; }).length;
      d1.push([d, n, r2(byDay[d]), grand ? byDay[d] / grand : 0]);
    });
    d1.push(["總計", rows.length, r2(grand), 1]);
    var ws2 = XLSX.utils.aoa_to_sheet(d1);
    ws2["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws2, "每日小計");

    /* 類別分析 */
    var d2 = [["類別", "筆數", "金額(HKD)", "佔比"]];
    Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).forEach(function (c) {
      var n = rows.filter(function (r) { return (r.category || "其他") === c; }).length;
      d2.push([c, n, r2(byCat[c]), grand ? byCat[c] / grand : 0]);
    });
    d2.push(["總計", rows.length, r2(grand), 1]);
    var ws3 = XLSX.utils.aoa_to_sheet(d2);
    ws3["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws3, "類別分析");

    /* 匯率參考 */
    var d3 = [["幣別", "原幣金額", "匯率(1 外幣→HKD)", "金額(HKD)", "筆數"]];
    Object.keys(byCur).sort().forEach(function (c) {
      var n = rows.filter(function (r) { return (r.currency || "HKD") === c; }).length;
      d3.push([c, r2(byCur[c].amt), c === "HKD" ? 1 : fxOf(c), r2(byCur[c].hkd), n]);
    });
    var ws4 = XLSX.utils.aoa_to_sheet(d3);
    ws4["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws4, "匯率參考");

    /* 類別定義 */
    var d4 = [["類別", "說明"]];
    var DESC = { "餐飲": "餐廳、咖啡、外賣、小食", "超市雜貨": "超市、街市、雜貨", "交通": "車費、油費、泊車、機票",
      "日用百貨": "日用品、個護、母嬰", "電子產品": "電子、配件、維修", "服飾美容": "衣履、化妝、美髮",
      "醫療保健": "診金、藥、保健品", "家居": "傢俬、家品、水電煤", "娛樂": "戲院、遊戲、旅遊玩樂",
      "教育": "學費、書、課程", "其他": "未能歸類" };
    CATS.forEach(function (c) { d4.push([c, DESC[c] || ""]); });
    var ws5 = XLSX.utils.aoa_to_sheet(d4);
    ws5["!cols"] = [{ wch: 14 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, ws5, "類別定義");

    var d = new Date(), stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0")
      + String(d.getDate()).padStart(2, "0");
    XLSX.writeFile(wb, "個人記帳_" + stamp + ".xlsx");
    ov(false);
    toast("已匯出 Excel（5 個工作表）");
  }).catch(function (e) { ov(false); toast("匯出失敗：" + e.message, true); });
}

/* ───────────────────────── 分頁 + 事件 ───────────────────────── */
function go(v) {
  ["up", "pend", "led", "set"].forEach(function (k) { $("v-" + k).hidden = (k !== v); });
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.classList.toggle("is-on", t.getAttribute("data-v") === v);
  });
  if (v === "led") { renderLedger(); loadRecent(); }
  if (v === "pend") renderPending();
}
function fillSettings() {
  $("fProvider").value = S.provider;
  $("fBase").value = S.base; $("fKey").value = S.key; $("fModel").value = S.model;
  $("fRepo").value = S.repo; $("fToken").value = S.token; $("fRates").value = S.rates || "";
  $("about").innerHTML = "個人記帳 v1 · 前端：GitHub Pages（公開）· 資料：你嘅私有 repo<br>"
    + "匯率：" + (ratesDate || "預設值") + " · 類別 11 個 · 匯出 Excel 5 工作表";
}
function commitPending() {
  if (!pending.length) return;
  ov(true, "寫入帳簿…");
  items = items.concat(pending);
  pending = [];
  pushLedger().then(function (ok) {
    ov(false); saveLocal(); renderAll();
    toast(ok ? "已入帳並同步到 GitHub" : "已入帳（本機；未連接 GitHub）");
  }).catch(function (e) { ov(false); saveLocal(); renderAll(); toast("已入帳，但同步失敗：" + e.message, true); });
}

function bind() {
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.addEventListener("click", function () { go(t.getAttribute("data-v")); });
  });
  $("btnPick").addEventListener("click", function () { $("file").click(); });
  $("file").addEventListener("change", function (e) { handleFiles(e.target.files); e.target.value = ""; });

  $("pendList").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]"); if (!b) return;
    var card = b.closest(".item"), id = card.getAttribute("data-id");
    var r = pending.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    if (b.getAttribute("data-act") === "p-del") {
      pending = pending.filter(function (x) { return x.id !== id; });
      saveLocal(); renderPending(); toast("已刪除");
    } else {
      pending = pending.filter(function (x) { return x.id !== id; });
      items.push(r); saveLocal(); renderPending(); renderLedger();
      pushLedger().catch(function () {}); toast("已入帳");
    }
  });
  $("pendList").addEventListener("change", function (e) {
    var t = e.target, k = t.getAttribute("data-k"); if (!k) return;
    var id = t.closest(".item").getAttribute("data-id");
    var r = pending.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    applyEdit(r, k, t.value); saveLocal();
    t.closest(".item").querySelector(".hkd") ; renderPending();
  });
  $("btnCommitAll").addEventListener("click", commitPending);

  $("ledList").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]"); if (!b) return;
    var id = b.closest(".item").getAttribute("data-id");
    if (b.getAttribute("data-act") === "l-del") {
      if (!confirm("確定刪除這筆？")) return;
      items = items.filter(function (x) { return x.id !== id; });
      saveLocal(); renderLedger();
      pushLedger().then(function () { toast("已刪除並同步"); })
        .catch(function (e2) { toast("已刪除，但同步失敗：" + e2.message, true); });
    }
  });
  $("ledList").addEventListener("change", function (e) {
    var t = e.target, k = t.getAttribute("data-k"); if (!k) return;
    var id = t.closest(".item").getAttribute("data-id");
    var r = items.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    applyEdit(r, k, t.value); saveLocal(); renderLedger();
    pushLedger().catch(function () {});
  });

  $("btnSync").addEventListener("click", function () {
    ov(true, "同步 GitHub…");
    pullLedger().then(function (ok) { ov(false); loadRecent(); toast(ok ? "已同步" : "GitHub 未設定／冇 ledger.json"); })
      .catch(function (e) { ov(false); toast("同步失敗：" + e.message, true); });
  });
  $("btnXlsx").addEventListener("click", exportXlsx);
  $("btnTr").addEventListener("click", function () {
    var need = items.filter(function (r) { return needsTranslation(r.product_original || r.product); });
    if (!need.length) { toast("冇需要翻譯嘅項目"); return; }
    ov(true, "翻譯 " + need.length + " 項…");
    var chunks = [], i;
    for (i = 0; i < need.length; i += 20) chunks.push(need.slice(i, i + 20));
    var k = 0;
    var run = function () {
      if (k >= chunks.length) {
        ov(false); renderLedger(); saveLocal();
        pushLedger().then(function () { toast("翻譯完成並同步"); }).catch(function () { toast("翻譯完成（未同步）"); });
        return;
      }
      var chunk = chunks[k++];
      translateRows(chunk).then(function (out) {
        chunk.forEach(function (r, j) {
          if (out[j]) { r.product = out[j]; r.product_zh = out[j]; }
        });
        run();
      }).catch(function (e) { ov(false); toast("翻譯失敗：" + e.message, true); });
    };
    run();
  });

  /* 設定 */
  $("fProvider").addEventListener("change", function () {
    var n = this.value;
    if (n !== "custom") {
      var p = PROVIDERS[n];
      $("fBase").value = p.base; $("fModel").value = p.model;
      if (n === "openai") $("testOut").className = "hint";
    }
  });
  $("btnSave").addEventListener("click", function () {
    S.provider = $("fProvider").value;
    S.base = $("fBase").value.trim();
    S.model = $("fModel").value.trim();
    S.key = $("fKey").value.trim();
    S.repo = $("fRepo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
    S.token = $("fToken").value.trim();
    S.rates = $("fRates").value.trim();
    S.style = (S.provider === "gemini" || /generativelanguage\.googleapis\.com/.test(S.base)) ? "gemini" : "openai";
    if (S.rates) {
      try { S.rates.split(",").forEach(function (kv) {
        var p = kv.split("="); if (p.length === 2) rates[p[0].trim().toUpperCase()] = Number(p[1]); }); } catch (e) {}
    }
    saveSettings(); fillSettings(); toast("已儲存設定");
  });
  $("btnWipe").addEventListener("click", function () {
    if (!confirm("清除本機快取（帳簿／待確認／設定）？\nGitHub 上嘅資料唔會受影響。")) return;
    ["ra.settings", "ra.ledger", "ra.pending", "ra.ledgerSha", "ra.rates", "ra.ratesDate"].forEach(function (k) { localStorage.removeItem(k); });
    location.reload();
  });
  /* 強制更新介面：清 Service Worker + 所有快取，再用新網址重載 */
  $("btnHard").addEventListener("click", function () {
    var o = $("about"); if (o) o.textContent = "正在強制更新…";
    var jobs = [];
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }));
      }
    } catch (e) {}
    Promise.all(jobs).catch(function () {}).then(function () {
      location.replace(location.pathname + "?v=" + Date.now());
    });
  });
  function listModels() {
    var o = $("modelOut");
    if (!S.key) { o.className = "hint err"; o.textContent = "請先填 API Key"; return; }
    o.className = "hint"; o.textContent = "查詢中…";
    var gem = (S.style === "gemini" || /generativelanguage\.googleapis\.com/.test(S.base));
    var base = (S.base || PROVIDERS.gemini.base).replace(/\/+$/, "");
    var url = gem ? base + "/models?key=" + encodeURIComponent(S.key) : base + "/models";
    var hdr = gem ? {} : { "Authorization": "Bearer " + S.key };
    fetch(url, { headers: hdr }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error("HTTP " + r.status + "：" + t.slice(0, 200));
        var d = JSON.parse(t), names = [], imgOf = {};
        if (d.models) d.models.forEach(function (m) {
          var n = (m.name || "").replace(/^models\//, "");
          var ok = !m.supportedGenerationMethods || m.supportedGenerationMethods.indexOf("generateContent") >= 0;
          if (ok) { names.push(n); imgOf[n] = true; }   /* Gemini 系列全部支援睇圖 */
        });
        else if (d.data) d.data.forEach(function (m) {
          names.push(m.id);
          var mods = (m.architecture && m.architecture.input_modalities) || [];
          /* 有講明就用佢；冇講（例如自訂 gateway）→ 當「未知」，唔可以當佢唔支援 */
          imgOf[m.id] = mods.length ? mods.indexOf("image") >= 0 : null;
        });
        if (!names.length) throw new Error("冇列出模型");
        var isImg = function (n) { return imgOf[n] !== false; };
        var nice = names.filter(function (n) {
          return isImg(n) && (/:free$/i.test(n) ||
            /flash|gemini|gemma|gpt-|claude|qwen|inkling|nemotron|dots-|vision|omni|llama-4|mistral/i.test(n));
        });
        nice.sort(function (a, b) {
          var fa = /:free$/i.test(a) ? 0 : 1, fb = /:free$/i.test(b) ? 0 : 1;
          if (fa !== fb) return fa - fb;
          return a < b ? -1 : 1;
        });
        var show = (nice.length ? nice : names.filter(isImg)).slice(0, 40);
        var noImg = names.filter(function (n) { return !isImg(n); }).slice(0, 8);
        var dl = $("models");
        if (dl) dl.innerHTML = show.map(function (n) { return '<option value="' + n + '"></option>'; }).join("");
        o.className = "hint ok";
        o.innerHTML = "✅ 支援睇圖（讀到收據）——按一下填入，🆓 = 免費：<br>" +
          show.map(function (n) {
            return '<a href="#" class="mlink" data-m="' + n + '">' + (/:free$/i.test(n) ? "🆓 " : "🖼 ") + n + "</a>";
          }).join("<br>") +
          (names.length > show.length ? "<br>（共 " + names.length + " 個模型）" : "") +
          (noImg.length ? '<br><br>🚫 <b>唔支援睇圖</b>（唔可以用嚟讀收據）：' + noImg.join("、") : "");
        Array.prototype.forEach.call(o.querySelectorAll(".mlink"), function (a) {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            $("fModel").value = a.getAttribute("data-m");
            o.className = "hint"; o.textContent = "已填入：" + a.getAttribute("data-m") + "（記得按儲存設定）";
          });
        });
      });
    }).catch(function (e) { o.className = "hint err"; o.textContent = "查模型失敗：" + e.message; });
  }
  $("btnModels").addEventListener("click", listModels);

  $("btnTest").addEventListener("click", function () {
    S.base = $("fBase").value.trim(); S.model = $("fModel").value.trim(); S.key = $("fKey").value.trim();
    S.provider = $("fProvider").value;
    S.style = (S.provider === "gemini" || /generativelanguage\.googleapis\.com/.test(S.base)) ? "gemini" : "openai";
    saveSettings();
    var o = $("testOut"); o.className = "hint"; o.textContent = "測試中…";
    callModel([{ text: 'Reply with exactly: {"ok":true}' }]).then(function (t) {
      o.className = "hint ok"; o.textContent = "✓ 連線成功：" + (t || "").slice(0, 40);
    }).catch(function (e) { o.className = "hint err"; o.textContent = "✗ " + e.message.slice(0, 160); });
  });
  $("btnGhTest").addEventListener("click", function () {
    S.repo = $("fRepo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
    S.token = $("fToken").value.trim();
    saveSettings();
    var o = $("ghOut"); o.className = "hint"; o.textContent = "測試中…";
    if (!S.repo || !S.token) { o.className = "hint err"; o.textContent = "✗ 請填 repo 同 token"; return; }
    ghGet("ledger.json").then(function (f) {
      if (f) { o.className = "hint ok"; o.textContent = "✓ 可讀寫，已有 ledger.json（" + f.size + " bytes）"; }
      else {
        ghPut("ledger.json", b64enc(JSON.stringify({ version: 1, updated: new Date().toISOString(), items: [] }, null, 1)),
              "init ledger", null)
          .then(function () { o.className = "hint ok"; o.textContent = "✓ 可讀寫，已建立 ledger.json"; })
          .catch(function (e) { o.className = "hint err"; o.textContent = "✗ 寫入失敗：" + e.message.slice(0, 150); });
      }
    }).catch(function (e) { o.className = "hint err"; o.textContent = "✗ " + e.message.slice(0, 150); });
  });
}

function applyEdit(r, k, v) {
  if (k === "qty" || k === "amount") r[k] = Number(v) || 0;
  else r[k] = v;
  if (k === "currency") r.fx = fxOf(v);
  if (k === "category") r.category = mapCat(v);
  if (k !== "currency") r.fx = r.currency === "HKD" ? 1 : fxOf(r.currency);
  r.hkd = r2((Number(r.amount) || 0) * (Number(r.fx) || 0));
  if (k === "product") r.product_zh = v;
}

/* ───────────────────────── 啟動 ───────────────────────── */
loadSettings();
if (!items.length && !pending.length) {
  /* 首次：如 repo 已設定，嘗試拉 ledger */
}
bind();
fillSettings();
renderAll();
if (!S.repo && !S.key) go("set");
loadRates();
if (ghReady()) {
  pullLedger().then(function () { loadRecent(); }).catch(function () {});
}
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
