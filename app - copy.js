/* ===================== 基本設定 ===================== */
const SRC = "./data/kanji2200.json";                 // データJSON
const MODEL_URL = "./models/handwriting-ja.model";   // Zinniaモデル

const $ = sel => document.querySelector(sel);
const listEl = $("#list"), qEl = $("#q"), jlptEl = $("#filter-jlpt"), gradeEl = $("#filter-grade");
const dlg = $("#detail"), closeBtn = dlg?.querySelector(".close");
const dKanji = $("#d-kanji"), dMeta = $("#d-meta"), dComp = $("#d-comp"), strokeArea = $("#stroke-area");

/* 手書きUI */
const INK = $("#ink"), INK_TOPK = $("#ink-topk");
const INK_CLEAR = $("#ink-clear"), INK_UNDO = $("#ink-undo"), INK_SEARCH = $("#ink-search");

let DATA = [];     // 正規化済み
let ZINNIA = null; // { classifyStrokes(strokes, w, h, topk) }

// --- helpers ---
const firstChar = s => (s ? Array.from(String(s).normalize('NFC'))[0] || '' : '');
const toNum = v => {
  if (v == null) return null;
  const s = String(v).replace(/[^\d.-]/g, ''); // 「７画」なども拾う
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const toArr = (row, jaKeys=[]) => {
  if (Array.isArray(row)) return row.filter(Boolean).map(String);
  const out = [];
  for (const k of jaKeys) if (row?.[k]) out.push(String(row[k]));
  return out;
};

// --- 1行をアプリ内部形式に正規化 ---
function normalizeRow(row){
  const ch = firstChar(row.char ?? row["漢字"]);
  const compounds = Array.isArray(row.compounds) && row.compounds.length
    ? row.compounds
    : (() => {
        const a=[]; for(let i=1;i<=8;i++){
          const w=row[`熟語${i}`], y=row[`熟語${i}読み`], e=row[`熟語${i}英語`];
          if (w){ const o={word:String(w)}; if(y) o.reading=String(y); if(e) o.en=String(e); a.push(o); }
        } return a;
      })();
  return {
    id: String(row.id ?? row["漢字番号"] ?? ch),
    char: ch,
    radical: row.radical ?? row["部首"] ?? "",
    strokes: toNum(row.strokes ?? row["総画数"]),
    grade: row.grade ?? row["学年配当"] ?? "",
    jlpt: row.jlpt ?? row["能力試験"] ?? "",
    kanken: row.kanken ?? row["漢検級数"] ?? "",
    jinmei: !!(row.jinmei ?? row["人名用漢字か否か"]),
    on:  toArr(row.on ?? row, ["音読み1","音読み2","音読み3"]),
    kun: toArr(row.kun ?? row, ["訓読み1","訓読み2","訓読み3"]),
    meanings_ja: toArr(row.meanings_ja ?? row, ["日本語の意味1","日本語の意味2","日本語の意味3"]),
    meanings_en: toArr(row.meanings_en ?? row, ["英語の意味1","英語の意味2","英語の意味3"]),
    image_stroke: row.image_stroke ?? row["漢字と筆順の画像"] ?? "",
    image_font:   row.image_font   ?? row["明朝体とゴシックの画像"] ?? "",
    compounds
  };
}


/* ===================== 起動 ===================== */
init();

async function init(){
  try{
    await loadData();
    wireFilters();
    setupDetailDialog();
    setupInkCanvas();            // 手書きUI（要素が無いページなら何もしない）
  }catch(err){
    alert(`初期化エラー: ${err.message}`);
    console.error(err);
  }
}

/* ===================== データ読込（正規化込み） ===================== */
let CHAR_INDEX = new Map();

async function loadData(){
  const res = await fetch(SRC, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${SRC} -> ${res.status}`);
  const raw = JSON.parse(await res.text());

  DATA = (Array.isArray(raw) ? raw : []).map(normalizeRow)
           .filter(r => r.char);                 // 文字なしは除外
  CHAR_INDEX = new Map(DATA.map(r => [r.char, r])); // char→正規化行

  renderList(DATA);                               // ← 下の一覧が復活
}


/* ===================== フィルター/検索 ===================== */
function wireFilters(){
  qEl?.addEventListener("input", applyFilter);
  jlptEl?.addEventListener("change", applyFilter);
  gradeEl?.addEventListener("change", applyFilter);
}

function applyFilter(){
  const q = (qEl?.value || "").trim().toLowerCase();
  const fJLPT  = jlptEl?.value || "";
  const fGrade = gradeEl?.value || "";   // 例: "小1"〜"小6"

  const res = DATA.filter(x=>{
    if (!x) return false;
    if (fJLPT  && String(x.jlpt||"") !== fJLPT) return false;
    if (fGrade && String(x.grade_norm||"") !== fGrade) return false;
    if (!q) return true;

    const hay = [
      x.char || "",
      ...(x.on||[]),
      ...(x.kun||[]),
      ...(x.meanings_ja||[]),
      ...(x.meanings_en||[]),
      ...(x.compounds||[]).map(c=>[c.word,c.reading,c.en].filter(Boolean).join(" "))
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });

  renderList(res);
}

function renderList(arr){
  listEl.innerHTML = (arr||[]).map(item => cardHTML(item)).join("");
  listEl.querySelectorAll(".card").forEach((el, idx)=>{
    const x = arr[idx];
    el.addEventListener("click", ()=> openDetail(x));
  });
}

function cardHTML(x){
  const jl = x?.jlpt ? `<span class="badge">JLPT ${escapeHTML(x.jlpt)}</span>` : "";
  const gd = x?.grade ? `<span class="badge">${escapeHTML(x.grade)}</span>` : "";
  const st = (x?.strokes!=null) ? `<span class="badge">${x.strokes}画</span>` : "";
  return `
    <div class="card" data-id="${escapeAttr(x?.id)}">
      <div class="kanji">${escapeHTML(x?.char||"")}</div>
      <div class="meta">${[jl,gd,st].filter(Boolean).join("")}</div>
      <div class="meta">${escapeHTML((x?.on||[]).join("・"))}</div>
      <div class="meta">${escapeHTML((x?.kun||[]).join("・"))}</div>
    </div>
  `;
}

/* ===================== 詳細ダイアログ ===================== */
function setupDetailDialog(){
  closeBtn?.addEventListener("click", ()=> dlg.close());
  dlg?.addEventListener("close", ()=> strokeArea && (strokeArea.innerHTML = ""));
}

function openDetail(x){
  if (!x || !dlg) return;

  dKanji.textContent = x.char || "";
  dMeta.innerHTML = `
    <div class="row">部首: ${escapeHTML(x.radical||"-")}／画数: ${x.strokes??"-"}／常用: ${x.joyo? "○":"-"}</div>
    <div class="row">学年: ${escapeHTML(x.grade_norm || x.grade || "-")}／JLPT: ${escapeHTML(x.jlpt||"-")}／漢検: ${escapeHTML(x.kanken||"-")}／人名用: ${x.jinmei? "○":"-"}</div>
    <div class="row">音: ${escapeHTML((x.on||[]).join("・"))}</div>
    <div class="row">訓: ${escapeHTML((x.kun||[]).join("・"))}</div>
    <div class="row">意味: ${escapeHTML((x.meanings_ja||[]).join("、"))}</div>
    <div class="row">Meanings: ${escapeHTML((x.meanings_en||[]).join(", "))}</div>
  `;

  // 書き順：画像優先→KanjiVG
  strokeArea.innerHTML = "";
  if (x.image_stroke && String(x.image_stroke).trim()) {
    const img = new Image();
    img.alt = "書き順";
    img.loading = "lazy"; img.decoding = "async";
    img.style.maxWidth = "100%";
    img.src = x.image_stroke;
    strokeArea.append(img);
  } else if (x.char){
    const cp = x.char.codePointAt(0);
    if (cp){
      const code = "u" + cp.toString(16).padStart(4,"0");
      const url = `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/${code}.svg`;
      const iframe = document.createElement("iframe");
      iframe.title = "KanjiVG stroke order";
      iframe.style.width = "100%";
      iframe.style.height = "260px";
      iframe.style.border = "0";
      iframe.src = url;
      strokeArea.append(iframe);
    }
  }

  dComp.innerHTML = `<h3>熟語</h3>` + (x.compounds||[]).map(c =>
    `<div class="comp"><strong>${escapeHTML(c.word||"")}</strong> <small>${escapeHTML(c.reading||"")}</small><br><small>${escapeHTML(c.en||"")}</small></div>`
  ).join("");

  dlg.showModal?.();
}

/* ===================== 手書きキャンバス（レスポンシブ/HiDPI対応） ===================== */

/** 推奨CSSサイズ（px）。PCはやや大きめ、タブレット/スマホは画面幅に追従 */
function idealCanvasCssSize(){
  const vw = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
  if (vw >= 1200) return 400;   // デスクトップ
  if (vw >= 992)  return 360;   // ラップトップ
  if (vw >= 768)  return 320;   // タブレット
  return Math.max(260, Math.min(340, Math.round(vw * 0.9))); // スマホ
}

let inkCtx, isDrawing = false;
let inkStrokes = []; // [[{x,y},...], ...]  座標はCSSピクセルで統一
let lastCssW = 0, lastCssH = 0;

function setupInkCanvas(){
  if (!INK) return;

    // Android での描画可視化のため：既定のタッチ挙動を完全停止
    INK.style.touchAction = 'none';
    INK.style.userSelect = 'none';
    INK.style.webkitTapHighlightColor = 'transparent';

  // 見た目サイズ（CSS）を調整
  const fitCssSize = ()=>{
    const size = idealCanvasCssSize();
    INK.style.width  = `${size}px`;
    INK.style.height = `${size}px`;
  };

  // キャンバスの実サイズ(DPR反映)を設定
  const setupHiDPI = ()=>{
    const rect = INK.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const cssW = Math.round(rect.width);
    const cssH = Math.round(rect.height);
    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(cssH * dpr));

    const needRescale = (lastCssW && lastCssH && (cssW !== lastCssW || cssH !== lastCssH));
    const scaleX = needRescale ? cssW/lastCssW : 1;
    const scaleY = needRescale ? cssH/lastCssH : 1;

    INK.width = pxW;
    INK.height = pxH;

    // ★ Android では desynchronized を外す（描画が見えなくなることがある）
    const isAndroid = /Android/i.test(navigator.userAgent);
    const ctxOpts = isAndroid
      ? { willReadFrequently: true }
      : { desynchronized: true, willReadFrequently: true };
    inkCtx = INK.getContext('2d', ctxOpts);
    inkCtx.setTransform(dpr,0,0,dpr,0,0);      // 以降はCSS座標で描画OK
    inkCtx.globalCompositeOperation = 'source-over';
    inkCtx.lineCap = "round";
    inkCtx.lineJoin = "round";
    inkCtx.lineWidth = Math.max(8, Math.round(cssW / 40)); // 画面サイズに比例
    inkCtx.strokeStyle = "#e9eef4";

    // 背景
    inkCtx.save();
    inkCtx.fillStyle = "#0f1319";
    inkCtx.fillRect(0,0,cssW,cssH);
    inkCtx.restore();

    if (needRescale){
      for (const s of inkStrokes){
        for (const p of s){ p.x *= scaleX; p.y *= scaleY; }
      }
    }
    redrawFromStrokes();

    lastCssW = cssW; lastCssH = cssH;
  };

  fitCssSize();
  setupHiDPI();

  // リサイズ対応
  window.addEventListener("resize", ()=>{
    fitCssSize();
    setupHiDPI();
  });

  // Pointerイベント（coalesced対応）
  INK.addEventListener("pointerdown", start, {passive:false});
  INK.addEventListener("pointermove", move,   {passive:false});
  INK.addEventListener("pointerup", end);
  INK.addEventListener("pointerleave", end);
  INK.addEventListener("pointercancel", end);

  INK_CLEAR?.addEventListener("click", clearInk);
  INK_UNDO?.addEventListener("click", undoInk);
  INK_SEARCH?.addEventListener("click", searchByInk);

  function start(e){
    e.preventDefault();
    INK.setPointerCapture?.(e.pointerId);
    isDrawing = true;
    const p = getXY(e);
    inkStrokes.push([p]);
  }
  function move(e){
    if (!isDrawing) return;
    e.preventDefault();
    const batch = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const cur = inkStrokes[inkStrokes.length-1];
    for (const ev of batch){
      const p = getXY(ev);
      const a = cur[cur.length-1];
      cur.push(p);
      inkCtx.beginPath(); inkCtx.moveTo(a.x, a.y); inkCtx.lineTo(p.x, p.y); inkCtx.stroke();
    }
  }
  function end(){ isDrawing = false; }

  function getXY(ev){
    const r = INK.getBoundingClientRect();
    const x = (ev.clientX ?? ev.touches?.[0]?.clientX) - r.left;
    const y = (ev.clientY ?? ev.touches?.[0]?.clientY) - r.top;
    return { x, y }; // CSSピクセル
  }
}

function clearInk(){
  inkStrokes = [];
  INK_TOPK && (INK_TOPK.innerHTML = "");
  if (inkCtx){
    inkCtx.save();
    inkCtx.clearRect(0,0,lastCssW,lastCssH);
    inkCtx.fillStyle = "#0f1319";
    inkCtx.fillRect(0,0,lastCssW,lastCssH);
    inkCtx.restore();
  }
}

function undoInk(){
  if (!inkStrokes.length || !inkCtx) return;
  inkStrokes.pop();
  inkCtx.save();
  inkCtx.clearRect(0,0,lastCssW,lastCssH);
  inkCtx.fillStyle = "#0f1319";
  inkCtx.fillRect(0,0,lastCssW,lastCssH);
  inkCtx.restore();
  redrawFromStrokes();
}

function redrawFromStrokes(){
  if (!inkCtx) return;
  for (const s of inkStrokes){
    for (let i=1;i<s.length;i++){
      const a = s[i-1], p = s[i];
      inkCtx.beginPath(); inkCtx.moveTo(a.x, a.y); inkCtx.lineTo(p.x, p.y); inkCtx.stroke();
    }
  }
}

/* ===================== Zinnia 認識 ===================== */
async function ensureZinnia(){
  if (ZINNIA) return ZINNIA;

  // 1) 動的import（PageSpeed対策）
  try {
    const loader = await import("./vendor/zinnia/zinnia-loader.js?ModPagespeed=off");
    if (!loader?.initZinnia) throw new Error("initZinnia not found");
    ZINNIA = await loader.initZinnia(MODEL_URL);
    return ZINNIA;
  } catch (e) {
    // 2) index.html で window.__initZinnia を注入している場合のフォールバック
    if (typeof window.__initZinnia === "function"){
      ZINNIA = await window.__initZinnia(MODEL_URL);
      return ZINNIA;
    }
    throw e;
  }
}

async function searchByInk(){
  if (!inkStrokes.length){ alert("パッドに1文字書いてください"); return; }
  const z = await ensureZinnia();
  const rect = INK.getBoundingClientRect();
  const W = Math.round(rect.width), H = Math.round(rect.height);

  // Zinnia候補を多めに取得 → JSON収録のみへ絞り込みは showInkTopK 側で実施
  const raw = z.classifyStrokes(inkStrokes, W, H, 50); // [{char, score}]
  const res = raw.map(r => ({ char: firstChar(r.char), score: r.score })); // NFC正規化
  showInkTopK(res);   // ← 右側のみ更新、下の一覧は触らない
}


// 右側の候補を「JSONレコードのカード」で表示する版（上位10件）
function showInkTopK(arr){
  // arr: [{char, score}, ...]  ← Zinniaの結果をそのまま受け取る
  if (!INK_TOPK) return;

  // Zinnia候補 → JSON照合 → 重複除去（id基準）→ score降順
  const seen = new Set();
  const items = [];
  for (const {char, score} of (arr || [])){
    const rec = CHAR_INDEX.get(char);      // ← 既存のインデックスを利用
    if (!rec) continue;                    // JSONに無いものは除外（UIを統一）
    if (seen.has(rec.id)) continue;        // 同一文字の重複を除外
    items.push({ ...rec, _score: score });
    seen.add(rec.id);
  }
  items.sort((a,b)=> (b._score ?? 0) - (a._score ?? 0));

  // JSONのカードUI（cardHTML）で右側に描画
  INK_TOPK.innerHTML = items.length
    ? items.slice(0,10).map(cardHTML).join("")
    : `<div class="empty">候補が見つかりませんでした</div>`;

  // 右側のカードをタップで詳細モーダル
  INK_TOPK.querySelectorAll(".card").forEach((el, idx)=>{
    const item = items[idx];
    el.addEventListener("click", ()=> openDetail(item));
  });
}


/* ===================== ユーティリティ ===================== */
function escapeHTML(s){ return String(s ?? "").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function escapeAttr(s){ return String(s ?? "").replace(/"/g, "&quot;"); }