import { MODEL_URL, getCharIndex, cardHTML, openDetail, escapeHTML, els } from "./common.js";

/* ===================== 設定/状態 ===================== */
const INK_MAX_CSS = 320;                  // 最大CSSサイズ（端末に合わせて縮む）
let INK_SHOW_RULE = true;                 // 罫線の表示/非表示
let INK_WIRED = false;                    // イベント配線は一度だけ
const IS_WINDOWS = /Windows/i.test(navigator.userAgent);
let USE_SAFE_DRAW = IS_WINDOWS;           // Windowsは安全描画を既定ON
let DPR = 1;

/* DOM参照（index.htmlの検索ブロック内） */
const INK       = document.getElementById("ink");
const INK_TOPK  = document.getElementById("ink-topk");
const INK_CLEAR = document.getElementById("ink-clear");
const INK_UNDO  = document.getElementById("ink-undo");
const INK_SEARCH= document.getElementById("ink-search");
const INK_GRID  = document.getElementById("ink-grid");
const BTN_TOGGLE= document.getElementById("ink-toggle");
const PANEL     = document.getElementById("ink-panel");

let inkCtx, isDrawing = false;
let inkStrokes = []; // [[{x,y},...], ...]  CSSピクセル座標
let lastCssW = 0, lastCssH = 0;

/* ===================== 公開：初期化 ===================== */
export function initInk(){
  wireHandToggle();     // 開閉＋初回レイアウト
  setupInkCanvas();     // 一度だけ配線（表示中ならレイアウト調整）
  wireGridToggle();     // 罫線ON/OFF
  wireClearUndoSearch();// クリア・一筆戻す・検索
  window.addEventListener("resize", () => refreshInkCanvas());
}

/* ===================== 手書きUI：開閉 ===================== */
function wireHandToggle(){
  if (!BTN_TOGGLE || !PANEL) return;
  BTN_TOGGLE.addEventListener("click", () => {
    const isHidden = PANEL.classList.toggle('hidden');
    const open = !isHidden;
    PANEL.setAttribute('aria-hidden', String(!open));
    BTN_TOGGLE.setAttribute('aria-expanded', String(open));
      // ボタンの見た目をここで同期（common.js では付けない方針）
   BTN_TOGGLE.classList.toggle('is-active', open);
   BTN_TOGGLE.setAttribute('aria-pressed', String(open));
    if (open){
      setupInkCanvas();     // 初回なら配線
      refreshInkCanvas();   // サイズ確定→背景（罫線）→既存線再描画
      //requestAnimationFrame(()=>PANEL.scrollIntoView({behavior:'smooth', block:'start'}));
    }
  });
}

/* ===================== キャンバスレイアウト ===================== */
function idealCanvasCssSize(){
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const pw = INK?.parentElement ? INK.parentElement.clientWidth : vw;
  const raw = Math.floor(pw * 0.90);
  return Math.min(INK_MAX_CSS, Math.max(180, raw));
}
function fitCssSize(){
  if (!INK) return;
  const size = idealCanvasCssSize();
  INK.style.width  = `${size}px`;
  INK.style.height = `${size}px`;
}
function setupHiDPI(){
  if (!INK) return;
  const rect = INK.getBoundingClientRect();

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

  inkCtx = INK.getContext('2d');

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

  clearCanvasBg(inkCtx, cssW, cssH, INK);

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
}
export function refreshInkCanvas(){
  if (!INK) return;
  requestAnimationFrame(()=>{
    fitCssSize();
    setupHiDPI();
    if (inkCtx) clearCanvasBg(inkCtx, lastCssW, lastCssH, INK);
    redrawFromStrokes();
  });
}

/* ===================== 初期配線（Pointer/Buttons） ===================== */
function setupInkCanvas(){
  if (!INK) return;
  if (INK_WIRED){
    refreshInkCanvas();
    return;
  }
  INK_WIRED = true;

  INK.style.touchAction = 'none';
  INK.style.msTouchAction = 'none';
  INK.addEventListener('contextmenu', e => e.preventDefault());
  INK.style.userSelect = 'none';
  INK.style.webkitTapHighlightColor = 'transparent';

  fitCssSize();
  setupHiDPI();

  INK.addEventListener("pointerdown", start, {passive:false});
  INK.addEventListener("pointermove", move,   {passive:false});
  INK.addEventListener("pointerup", end);
  INK.addEventListener("pointerleave", end);
  INK.addEventListener("pointercancel", end);
  INK.addEventListener("lostpointercapture", end);
}

function wireGridToggle(){
  INK_GRID?.addEventListener("click", () => {
    INK_SHOW_RULE = !INK_SHOW_RULE;
    INK_GRID.setAttribute("aria-pressed", String(INK_SHOW_RULE));
    if (!inkCtx) return;
    clearCanvasBg(inkCtx, lastCssW, lastCssH, INK);
    redrawFromStrokes();
  });
}
function wireClearUndoSearch(){
  INK_CLEAR?.addEventListener("click", () => {
    if (!inkCtx) return;
    inkStrokes = [];
    clearCanvasBg(inkCtx, lastCssW, lastCssH, INK);
    if (INK_TOPK) INK_TOPK.innerHTML = "";   // ← 検索候補をリセット
  });
  INK_UNDO?.addEventListener("click", () => {
    if (!inkCtx || !inkStrokes.length) return;
    inkStrokes.pop();
    clearCanvasBg(inkCtx, lastCssW, lastCssH, INK);
    redrawFromStrokes();
  });
  INK_SEARCH?.addEventListener("click", searchByInk);
}

/* ===================== 描画系 ===================== */
function sx(x){ return USE_SAFE_DRAW ? x * DPR : x; }
function sy(y){ return USE_SAFE_DRAW ? y * DPR : y; }

function start(e){
  e.preventDefault();
  INK.setPointerCapture?.(e.pointerId);
  isDrawing = true;

  const p = getXY(e);
  inkStrokes.push([p]);

  // 最初の点を確実に可視化
  const t = inkCtx.getTransform?.();
  const needScale = IS_WINDOWS && t && t.a===1 && t.d===1 && !t.b && !t.c && !t.e && !t.f;
  const X = needScale ? p.x * DPR : p.x;
  const Y = needScale ? p.y * DPR : p.y;

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
  return { x, y };
}

function redrawFromStrokes(){
  if (!inkCtx) return;
  const t = inkCtx.getTransform?.();
  const needScale = IS_WINDOWS && t && t.a===1 && t.d===1;
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

function clearCanvasBg(ctx, cssW, cssH, canvas){
  if (USE_SAFE_DRAW){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#eeeeeeff";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    if (INK_SHOW_RULE) drawGuides(ctx, canvas.width, canvas.height, true);
  }else{
    ctx.clearRect(0,0,cssW,cssH);
    ctx.fillStyle = "#eeeeeeff";
    ctx.fillRect(0,0,cssW,cssH);
    if (INK_SHOW_RULE) drawGuides(ctx, cssW, cssH, false);
  }
}
function drawGuides(ctx, w, h){
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,.25)";
  const base = (typeof DPR === "number" && DPR > 0 ? DPR : 1);
  const dash = 2 * base;
  if (ctx.setLineDash) ctx.setLineDash([dash, dash]);
  ctx.lineWidth = Math.max(1, base * 0.5);
  const cx = Math.floor(w/2), cy = Math.floor(h/2);
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
  ctx.moveTo(0, cy); ctx.lineTo(w, cy);
  ctx.stroke();
  ctx.restore();
}

/* ===================== Zinnia連携 ===================== */
let ZINNIA = null;
async function ensureZinnia(){
  if (ZINNIA) return ZINNIA;
  try {
    const loader = await import("./vendor/zinnia/zinnia-loader.js?ModPagespeed=off");
    if (!loader?.initZinnia) throw new Error("initZinnia not found");
    ZINNIA = await loader.initZinnia(MODEL_URL);
    return ZINNIA;
  } catch (e) {
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
  const raw = z.classifyStrokes(inkStrokes, W, H, 50); // 候補多め
  const res = raw.map(r => ({ char: (r.char || "").normalize("NFC")[0] || "", score: r.score }));
  showInkTopK(res);
}

function showInkTopK(arr){
  if (!INK_TOPK) return;
  const index = getCharIndex();
  const seen = new Set();
  const items = [];
  for (const {char, score} of (arr || [])){
    const rec = index.get(char);
    if (!rec) continue;
    if (seen.has(rec.id)) continue;
    items.push({ ...rec, _score: score });
    seen.add(rec.id);
  }
  items.sort((a,b)=> (b._score ?? 0) - (a._score ?? 0));
  INK_TOPK.innerHTML = items.length
    ? items.slice(0,10).map(cardHTML).join("")
    : `<div class="empty">候補が見つかりませんでした</div>`;
  INK_TOPK.querySelectorAll(".card").forEach((el, idx)=>{
    const item = items[idx];
    el.addEventListener("click", ()=> openDetail(item));
  });
}