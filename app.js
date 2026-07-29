/* ===================== 基本設定 ===================== */
const SRC = "./data/kanji2200.json";                 // データJSON
const MODEL_URL = "./models/handwriting-ja.model";   // Zinniaモデル

const $ = sel => document.querySelector(sel);
const listEl = $("#list"), qEl = $("#q"), jlptEl = $("#filter-jlpt"), gradeEl = $("#filter-grade");
const dlg = $("#detail"), closeBtn = dlg?.querySelector(".close");
const dKanji = $("#d-kanji"), dMeta = $("#d-meta"), dComp = $("#d-comp"), strokeArea = $("#stroke-area");

/* 手書きUI */
const INK = $("#ink"), INK_TOPK = $("#ink-topk");
const INK_CLEAR = $("#ink-clear"), INK_UNDO = $("#ink-undo"), INK_SEARCH = $("#ink-search"), INK_GRID = $("#ink-grid");
// 手書きキャンバスの最大CSSサイズ（お好みで調整）
const INK_MAX_CSS = 320;   // 例: 320px（必要なら 260 など）


let DATA = [];     // 正規化済み
let ZINNIA = null; // { classifyStrokes(strokes, w, h, topk) }
let INK_WIRED = false; // 手書きキャンバスのイベント配線を一度だけにする
let INK_SHOW_RULE = true;  // 罫線の表示/非表示


const rangeSelect = document.getElementById("rangeSelect");
const rangePrev   = document.getElementById("rangePrev");
const rangeNext   = document.getElementById("rangeNext");


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
// 画像パス正規化: ファイル名のみなら ./img/ を付与
function asImg(v){
  if (!v) return "";
  const s = String(v).trim();
  // 既に URL や相対パスが付いているならそのまま
  if (/^(https?:|data:|\/|\.{1,2}\/)/.test(s)) return s;
  return `./img/${s}`;
}
function toHalfDigits(s){
  return String(s||"").replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0xFEE0));
}
function normalizeGrade(v){
  const s = toHalfDigits(String(v||"").trim());
  if (!s) return "";
  // 「小1」「小学1年」「1年」「1」「小１」などを「小1」にそろえる
  const m = s.match(/([1-6])/);
  return m ? `小${m[1]}` : "";
}
function normalizeJlptLevels(v){
  const s = String(v || "").toUpperCase();
  const m = s.match(/N[1-5]/g);         // 例: "N2N3", "N2/N3", "[N2 N3]"
  return m ? Array.from(new Set(m)) : []; // 重複除去して配列で返す
}


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
  const gradeRaw = row.grade ?? row["学年配当"] ?? "";
    const jlptRaw = row.jlpt ?? row["能力試験"] ?? "";

  
  return {
    id: String(row.id ?? row["漢字番号"] ?? ch),
    char: ch,
    radical: row.radical ?? row["部首"] ?? "",
    strokes: toNum(row.strokes ?? row["総画数"]),
    grade_norm: normalizeGrade(gradeRaw),   // ★ 追加    
    jlpt: jlptRaw,
    jlpt_levels: normalizeJlptLevels(jlptRaw),  // ★ 追加
    kanken: row.kanken ?? row["漢検級数"] ?? "",
    jinmei: !!(row.jinmei ?? row["人名用漢字か否か"]),
    on:  toArr(row.on ?? row, ["音読み1","音読み2","音読み3"]),
    kun: toArr(row.kun ?? row, ["訓読み1","訓読み2","訓読み3"]),
    meanings_ja: toArr(row.meanings_ja ?? row, ["日本語の意味1","日本語の意味2","日本語の意味3"]),
    meanings_en: toArr(row.meanings_en ?? row, ["英語の意味1","英語の意味2","英語の意味3"]),
    image_stroke: asImg(row.image_stroke ?? row["漢字と筆順の画像"] ?? ""),
    image_font:   asImg(row.image_font   ?? row["明朝体とゴシックの画像"] ?? ""),
    compounds
  };
}

/* ===== 手書き検索トグル（隠し→表示） ===== */
function wireHandToggle(){
  const btn = document.getElementById('ink-toggle');
  const panel = document.getElementById('ink-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    const isHidden = panel.classList.toggle('hidden');
    const open = !isHidden;
    panel.setAttribute('aria-hidden', String(!open));
    btn.setAttribute('aria-expanded', String(open));
if (open) {
  // 初回ならイベント配線、以降はレイアウト更新
  setupInkCanvas();
  if (typeof window.__refreshInkCanvas === "function") window.__refreshInkCanvas();
}

  });
}
// 罫線トグル
INK_GRID?.addEventListener("click", () => {
  INK_SHOW_RULE = !INK_SHOW_RULE;                          // ← 罫線の状態はこのボタンだけで変更
  INK_GRID.setAttribute("aria-pressed", String(INK_SHOW_RULE));
  if (!inkCtx) return;
  clearCanvasBg(inkCtx, lastCssW, lastCssH, INK);          // 背景＆罫線を反映
  redrawFromStrokes();
});



/* ===================== 起動 ===================== */
init();

async function init(){
  try{
    await loadData();
    wireFilters();
    wireHandToggle();   // ← これを追加
    setupDetailDialog();
    setupInkCanvas();            // 手書きUI（要素が無いページなら何もしない）
  }catch(err){
    alert(`初期化エラー: ${err.message}`);
    console.error(err);
  }
}
function buildRangeOptions(){
  if (!rangeSelect) return;
  rangeSelect.innerHTML = `<option value="">すべて（1–${DATA.length}）</option>`;
  const total = DATA.length;
  for (let start = 1; start <= total; start += 100){
    const end = Math.min(start + 99, total);
    const val = `${start}-${end}`;
    const label = `${start}–${end}`;
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    rangeSelect.appendChild(opt);
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
  DATA.forEach((row, i) => { row.__no = i + 1; }); // 1..N を付与（番号が無い前提でもOK）
await loadData();
buildRangeOptions();
wireFilters();
wireHandToggle();
setupDetailDialog();
setupInkCanvas();

}


/* ===================== フィルター/検索 ===================== */
function wireFilters(){
  qEl?.addEventListener("input", applyFilter);
  jlptEl?.addEventListener("change", applyFilter);
  gradeEl?.addEventListener("change", applyFilter);
  rangeSelect?.addEventListener("change", applyFilter);

  // 100件送り／戻し（補助）
  rangePrev?.addEventListener("click", () => stepRange(-1));
  rangeNext?.addEventListener("click", () => stepRange(1));
}
function stepRange(dir){
  if (!rangeSelect || !rangeSelect.options.length) return;
  // 現在インデックス（0: すべて, 1..）
  const idx = rangeSelect.selectedIndex;
  const next = Math.min(Math.max(idx + dir, 1), rangeSelect.options.length - 1);
  rangeSelect.selectedIndex = next;
  applyFilter();
}


function applyFilter(){
  const term = (qEl?.value || "").trim();
  const jl   = jlptEl?.value || "";
  const gr   = gradeEl?.value || "";
  const rsel = rangeSelect?.value || ""; // "1-100" など

  let list = DATA.filter(item => {
    if (jl && item.jlpt !== jl) return false;
    if (gr && item.grade !== gr) return false;
    if (term){
      const hay = [item.char, item.on, item.kun, ...(item.meanings || [])].join(" ");
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  // 番号レンジを絞り込み
  if (rsel){
    const [s,e] = rsel.split("-").map(n => parseInt(n,10));
    list = list.filter(x => x.__no >= s && x.__no <= e);
  }

  // 表示は番号昇順で安定化
  list.sort((a,b) => (a.__no||0) - (b.__no||0));

  renderList(list);
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

dComp.innerHTML = `<h3>熟語</h3>` + (x.compounds || []).map(c =>
  `<div class="comp">
     <strong>${escapeHTML(c.word || "")}</strong>
     <small>${escapeHTML(c.reading || "")}</small><br>
     <small>${escapeHTML(c.en || "")}</small>
   </div>`
).join("");
  dlg.showModal?.();
}

/* ===================== 手書きキャンバス（レスポンシブ/HiDPI対応） ===================== */

/** 推奨CSSサイズ（px）。PCはやや大きめ、タブレット/スマホは画面幅に追従 */
function idealCanvasCssSize(){
  // 親コンテナ幅（なければ画面幅）をベースに
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const pw = (INK && INK.parentElement) ? INK.parentElement.clientWidth : vw;
  // 端末に合わせて 90% を目安に。180〜INK_MAX_CSS にクランプ
  const raw = Math.floor(pw * 0.90);
  return Math.min(INK_MAX_CSS, Math.max(180, raw));
}


let inkCtx, isDrawing = false;
let inkStrokes = []; // [[{x,y},...], ...]  座標はCSSピクセルで統一
let lastCssW = 0, lastCssH = 0;

function setupInkCanvas(){
  if (!INK) return;

  // すでに配線済みならレイアウトだけ更新して終了
  if (INK_WIRED) {
    if (typeof window.__refreshInkCanvas === "function") {
      window.__refreshInkCanvas();
    }
    return;
  }
  INK_WIRED = true;
  INK.style.touchAction = 'none';
  INK.style.msTouchAction = 'none'; // 古い Edge 対策
  // 長押しのコンテキストメニュー無効化（描画中に出ると見えないことがある）
  INK.addEventListener('contextmenu', e => e.preventDefault());
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

  // ★ ここで DPR を更新（Windows安全描画で使います）
  DPR = Math.max(1, window.devicePixelRatio || 1);

  const cssW = Math.round(rect.width);
  const cssH = Math.round(rect.height);
  const pxW  = Math.max(1, Math.round(cssW * DPR));
  const pxH  = Math.max(1, Math.round(cssH * DPR));

  const needRescale = (lastCssW && lastCssH && (cssW !== lastCssW || cssH !== lastCssH));
  const scaleX = needRescale ? cssW/lastCssW : 1;
  const scaleY = needRescale ? cssH/lastCssH : 1;

  INK.width  = pxW;
  INK.height = pxH;

  // 互換優先（Windows描画抜け対策のためオプション無し）
  inkCtx = INK.getContext('2d');

  // ★ Windows は setTransform を使わず、座標側で DPR を掛ける
  if (USE_SAFE_DRAW){
    inkCtx.setTransform(1,0,0,1,0,0);
    inkCtx.lineWidth = Math.max(8, Math.round(cssW / 40)) * DPR;
  } else {
    inkCtx.setTransform(DPR,0,0,DPR,0,0);
    inkCtx.lineWidth = Math.max(8, Math.round(cssW / 40));
  }

  inkCtx.lineCap = "round";
  inkCtx.lineJoin = "round";
  inkCtx.strokeStyle = "#1a1a1aff";
  inkCtx.globalCompositeOperation = 'source-over';
  inkCtx.imageSmoothingEnabled = true;

  // 背景を塗る（DPR差を吸収）
  clearCanvasBg(inkCtx, cssW, cssH, INK);

  // キャンバスの見た目サイズが変わったら既存ストロークをリスケール
  if (needRescale){
    for (const s of inkStrokes){
      for (const p of s){
        p.x *= scaleX;
        p.y *= scaleY;
      }
    }
  }
  redrawFromStrokes();

  lastCssW = cssW;
  lastCssH = cssH;
  };


  fitCssSize();
  setupHiDPI();

  // リサイズ対応
window.addEventListener("resize", () => {
  if (typeof window.__refreshInkCanvas === "function") window.__refreshInkCanvas();
});


  // Pointerイベント（coalesced対応）
  INK.addEventListener("pointerdown", start, {passive:false});
  INK.addEventListener("pointermove", move,   {passive:false});
  INK.addEventListener("pointerup", end);
  INK.addEventListener("pointerleave", end);
  INK.addEventListener("pointercancel", end);
  INK.addEventListener("lostpointercapture", end);

// クリア
INK_CLEAR?.addEventListener("click", () => {
  if (!inkCtx) return;

  // 1) 手書きストロークをリセット
  inkStrokes = [];

  // 2) キャンバス背景の再描画（罫線は INK_SHOW_RULE に従って維持）
  clearCanvasBg(inkCtx, lastCssW, lastCssH, INK);

  // 3) 手書き検索の候補（検索結果）をリセット
  if (INK_TOPK) INK_TOPK.innerHTML = "";

  // ※ 一覧の検索キーワードやフィルタは触らない（現状維持）
});


// 一筆戻す
INK_UNDO?.addEventListener("click", () => {
  if (!inkCtx || !inkStrokes.length) return;
  inkStrokes.pop();                                   // 最後のストロークだけ削除
  clearCanvasBg(inkCtx, lastCssW, lastCssH, INK);     // 背景＆罫線を再描画
  redrawFromStrokes();                                // 残りの線を再描画
});

  INK_SEARCH?.addEventListener("click", searchByInk);

  function start(e){
  e.preventDefault();
  INK.setPointerCapture?.(e.pointerId);
  isDrawing = true;

  const p = getXY(e);
  inkStrokes.push([p]);

  // --- 最初の点が見えない環境対策（Windows + transform未設定のときはDPRを手で掛ける）
  const t = inkCtx.getTransform?.();
  const needScale = IS_WINDOWS && t && t.a===1 && t.d===1 && !t.b && !t.c && !t.e && !t.f;
  const X = needScale ? p.x * DPR : p.x;
  const Y = needScale ? p.y * DPR : p.y;

  // 小さな点（円）で確実に可視化
  const r = Math.max(1, inkCtx.lineWidth / 2);
  inkCtx.beginPath();
  inkCtx.arc(X, Y, r, 0, Math.PI*2);
  const prev = inkCtx.fillStyle;
  inkCtx.fillStyle = inkCtx.strokeStyle;
  inkCtx.fill();
  inkCtx.fillStyle = prev;
  }
  function move(e){
  if (!isDrawing) return;
  e.preventDefault();

  const t = inkCtx.getTransform?.();
  const needScale = IS_WINDOWS && t && t.a===1 && t.d===1 && !t.b && !t.c && !t.e && !t.f;
  const Sx = needScale ? (x)=>x*DPR : (x)=>x;
  const Sy = needScale ? (y)=>y*DPR : (y)=>y;

  const batch = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  const cur = inkStrokes[inkStrokes.length-1];

  for (const ev of batch){
    const p = getXY(ev);
    const a = cur[cur.length-1];
    cur.push(p);

    inkCtx.beginPath();
    inkCtx.moveTo(Sx(a.x), Sy(a.y));
    inkCtx.lineTo(Sx(p.x), Sy(p.y));
    inkCtx.stroke();
  }
  }

  function end(){ isDrawing = false; }

  function getXY(ev){
    const r = INK.getBoundingClientRect();
    const x = (ev.clientX ?? ev.touches?.[0]?.clientX) - r.left;
    const y = (ev.clientY ?? ev.touches?.[0]?.clientY) - r.top;
    return { x, y }; // CSSピクセル
  }
  window.__refreshInkCanvas = () => {
    try {
      // 非表示だった直後だと rect が 0 のことがあるので 1フレーム遅延
      requestAnimationFrame(() => {
        // あなたの関数名に合わせて呼び出し（元コードにある名前）
        if (typeof fitCssSize === "function") fitCssSize();
        if (typeof setupHiDPI === "function") setupHiDPI();
        if (inkCtx) clearCanvasBg(inkCtx, lastCssW, lastCssH, INK);

        if (typeof redrawFromStrokes === "function") redrawFromStrokes();
      });
    } catch(_) {}
  };
}

function clearInk(){
  inkStrokes = [];
  INK_TOPK && (INK_TOPK.innerHTML = "");
  if (inkCtx){
    const rect = INK.getBoundingClientRect();
    // transform の有無に関わらず全域を確実に塗りつぶす
    inkCtx.save();
    // いったんアイデンティティで塗ると安全
    if (inkCtx.setTransform) inkCtx.setTransform(1,0,0,1,0,0);
    inkCtx.clearRect(0,0,INK.width, INK.height);
    inkCtx.fillStyle = "#dededeff";
    inkCtx.fillRect(0,0,INK.width, INK.height);
    inkCtx.restore();
  }
}


function undoInk(){
  if (!inkStrokes.length || !inkCtx) return;
  inkStrokes.pop();

  // 変換状態に依存せず、キャンバスの実サイズ全域をクリア＆背景色で塗る
  inkCtx.save();
  if (inkCtx.setTransform) inkCtx.setTransform(1, 0, 0, 1, 0, 0); // アイデンティティに
  inkCtx.clearRect(0, 0, INK.width, INK.height);
  inkCtx.fillStyle = "#dededeff";
  inkCtx.fillRect(0, 0, INK.width, INK.height);
  inkCtx.restore();

  // 残ったストロークを再描画（drawSegment を使う実装のままでOK）
  redrawFromStrokes();
}


function redrawFromStrokes(){
  if (!inkCtx) return;

  const t = inkCtx.getTransform?.();
  const needScale = IS_WINDOWS && t && t.a===1 && t.d===1 && !t.b && !t.c && !t.e && !t.f;
  const Sx = needScale ? (x)=>x*DPR : (x)=>x;
  const Sy = needScale ? (y)=>y*DPR : (y)=>y;

  for (const s of inkStrokes){
    for (let i=1;i<s.length;i++){
      const a = s[i-1], p = s[i];
      inkCtx.beginPath();
      inkCtx.moveTo(Sx(a.x), Sy(a.y));
      inkCtx.lineTo(Sx(p.x), Sy(p.y));
      inkCtx.stroke();
    }
  }
}


// --- Windows セーフ描画トグル ---
const IS_WINDOWS = /Windows/i.test(navigator.userAgent);
let USE_SAFE_DRAW = IS_WINDOWS;   // Windows ではデフォで有効（他は従来のまま）
let DPR = 1;

// CSS座標→描画用座標（セーフ描画時は DPR を掛ける）
function sx(x){ return USE_SAFE_DRAW ? x * DPR : x; }
function sy(y){ return USE_SAFE_DRAW ? y * DPR : y; }

function drawSegment(ctx, a, p){
  ctx.beginPath();
  ctx.moveTo(sx(a.x), sy(a.y));
  ctx.lineTo(sx(p.x), sy(p.y));
  ctx.stroke();
}
function drawDot(ctx, p){
  // 最初の点が見えない対策（1ピクセル線 or 小円）
  const r = Math.max(1, ctx.lineWidth / 2);
  ctx.beginPath();
  ctx.arc(sx(p.x), sy(p.y), r, 0, Math.PI*2);
  const prev = ctx.fillStyle;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  ctx.fillStyle = prev;
}

function clearCanvasBg(ctx, cssW, cssH, canvas){
  if (USE_SAFE_DRAW){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#dededeff";
    ctx.fillRect(0,0,canvas.width,canvas.height);
   if (INK_SHOW_RULE) drawGuides(ctx, canvas.width, canvas.height, true);

  }else{
    ctx.clearRect(0,0,cssW,cssH);
    ctx.fillStyle = "#dededeff";
    ctx.fillRect(0,0,cssW,cssH);
   if (INK_SHOW_RULE) drawGuides(ctx, cssW, cssH, false);

  }
}

function drawGuides(ctx, w, h, isHiDPI){
  ctx.save();
  // ドット線・半透明
  ctx.strokeStyle = "rgba(0,0,0,.25)";
  const base = (typeof DPR === "number" && DPR > 0 ? DPR : 1);
  const dash = 6 * base;
  if (ctx.setLineDash) ctx.setLineDash([dash, dash]);
  ctx.lineWidth = Math.max(1, base * 1);

  // 中心の十字
  const cx = Math.floor(w/2), cy = Math.floor(h/2);
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
  ctx.moveTo(0, cy); ctx.lineTo(w, cy);
  ctx.stroke();

  ctx.restore();
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
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}
function escapeAttr(s){ return String(s ?? "").replace(/"/g, "&quot;"); }