/**
 * kakijyun.js
 * - URL パラメータ id(4桁) / kanji(1文字) を取得してタイトルや画像を更新
 * - 「書き順動画」ボタンで js{id}{kanji}.html を新規タブで開く（存在しない場合フォールバック）
 * - 手書きパッド（Zinnia）: クリア/一筆戻す/罫線/サンプル/判定
 * - 予測候補を #ink-topk に表示（クリックで大きく表示切り替え）
 */



// ---------- ユーティリティ ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const qp = new URLSearchParams(location.search);
const ID   = (qp.get("id") || "").padStart(4, "0");
const KANJI = (qp.get("kanji") || "").trim();
const BACK_URL = qp.get("back") || "";   // ★ 追加


// ルート判定（/kakitori/ 配下で相対パスがズレるのをケア）
const atRoot = location.pathname.split("/").filter(Boolean).length <= 1;
const PATHS = {
  model: atRoot ? "./models/handwriting-ja.model" : "../models/handwriting-ja.model",
  img:   atRoot ? "./img" : "../img",
  movie: atRoot ? "./movie" : "../movie",
  zinnia: atRoot ? "./vendor/zinnia" : "../vendor/zinnia",
};

// 追加：サイズ設定（CSSピクセル）
const INK_MIN = 200;     // 最小サイズ
const INK_MAX = 320;     // 最大サイズ
let   inkCssSize = 260;  // 初期サイズ（お好みで）

function setInkCssSize(px){
  if (!Ink.el) return;
  inkCssSize = Math.max(INK_MIN, Math.min(INK_MAX, Math.round(px)));
  Ink.el.style.width  = inkCssSize + "px";
  Ink.el.style.height = inkCssSize + "px";
}

// 親幅に合わせたいとき（必要なら）
function idealCssSize(){
  const p = Ink.el?.parentElement;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const raw = Math.floor((p?.clientWidth || vw) * 0.9);
  return Math.max(INK_MIN, Math.min(INK_MAX, raw));
}



let DPR = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvasToDPR() {
  const el = Ink.el;
  if (!el) return;

  // CSSサイズを取得（style設定を優先）
  const cssW = Math.round(el.getBoundingClientRect().width  || inkCssSize);
  const cssH = Math.round(el.getBoundingClientRect().height || inkCssSize);

  // バッキングストアをDPR倍に
  el.width  = Math.max(1, Math.round(cssW * DPR));
  el.height = Math.max(1, Math.round(cssH * DPR));

  Ink.w = cssW;     // 描画ロジックはCSS座標で扱う
  Ink.h = cssH;

  const ctx = (Ink.ctx = el.getContext("2d"));
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

// Webフォント "Klee One" の読み込み完了を待つ（古いブラウザは何もしない）
async function waitKleeOnce() {
  if (!('fonts' in document)) return; // 未対応ブラウザはスキップ
  try {
    // 実際に使うウエイト・サイズに近い指定でロード
    await document.fonts.load("400 240px 'Klee One'", "漢");
    await document.fonts.ready; // （任意）すべてのフォント読み込み待ち
  } catch (e) {
    // 失敗しても無視（フォールバックで描画される）
    // console.warn(e);
  }
}


// ---------- タイトル/見出し/画像 初期化 ----------
function initTitleAndImage() {
  if (ID && KANJI) {
    document.title = `書き順${ID}${KANJI}`;
  } else if (KANJI) {
    document.title = `書き順${KANJI}`;
  }

  const dKanji = $("#d-kanji");
  if (dKanji && KANJI) dKanji.textContent = KANJI;

  const strokeArea = $("#stroke-area");
  const img = document.createElement("img");
  img.alt = "書き順";
  img.loading = "lazy";
  img.decoding = "async";
  img.style.maxWidth = "100%";
  img.src = `${PATHS.img}/${ID || "0001"}_1.jpg`;
  img.onerror = () => {
    // 画像が無ければ KanjiVG をフォールバック表示
    strokeArea.innerHTML = "";
    if (KANJI && KANJI.codePointAt(0)) {
      const cp = KANJI.codePointAt(0);
      const code = "u" + cp.toString(16).padStart(4, "0");
      const iframe = document.createElement("iframe");
      iframe.title = "KanjiVG stroke order";
      iframe.style.width = "100%";
      iframe.style.height = "260px";
      iframe.style.border = "0";
      iframe.src = `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/${code}.svg`;
      strokeArea.append(iframe);
    } else {
      strokeArea.textContent = "書き順画像が見つかりません。";
    }
  };
  strokeArea.innerHTML = "";
  strokeArea.append(img);
}

// ---------- 「書き順動画」ボタン ----------
function wireMovieButton() {
  const btn = $("#btn-write");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // 例： ./movie/js0001日.html を優先、無ければ ./movie/js0001.html → 無ければアラート
    const cand = [
      `${PATHS.movie}/js${ID}${KANJI}.html`,
      `${PATHS.movie}/js${ID}.html`,
    ];
    // まずは無条件で一番目を開く。存在確認を厳密にやるなら HEAD リクエストが必要だが、
    // 共有サーバでは CORS/ヘッダ制限のこともあるので、開いてエラーだったら二番目へフォールバック。
    const w = window.open(cand[0], "_blank", "noopener");
    // 2秒後も about:blank のまま（=失敗っぽい）なら2番目を試す
    setTimeout(() => {
      try {
        if (w && w.location && String(w.location) === "about:blank") {
          w.location.href = cand[1];
        }
      } catch (_) {
        /* クロスオリジンで location チェック不可なら何もしない */
      }
    }, 2000);
  });
}

// ---------- Zinnia（手書き） ----------
let recog = null;           // 認識器
let strokes = [];           // [[{x,y,t}, ...], ...]
let current = null;         // いま描いているストローク
let showGrid = true;
let showSample = true;

const Ink = {
  el: null,
  ctx: null,
  w: 320,
  h: 320,
};

async function ensureZinnia() {
  // vendor/zinnia/zinnia-loader.js を <script type="module"> で import 済み想定
  // index.html で定義した window.__initZinnia(url) を使う
  if (!recog) {
    if (typeof window.__initZinnia !== "function") {
      console.warn("Zinnia ローダーが見つかりません。");
      return null;
    }
    recog = await window.__initZinnia(PATHS.model);
  }
  return recog;
}

function toZinniaFormat() {
  // zinnia wasm 側が受け取りやすい 2次元配列 [[x,y], ...] のストローク配列に変換
  return strokes.map(st => st.map(p => [p.x, p.y]));
}

function drawAll() {
  const ctx = Ink.ctx;
  ctx.clearRect(0, 0, Ink.w, Ink.h);

  // ===== 台紙 =====
  ctx.save();
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, Ink.w, Ink.h);
  ctx.restore();

  // ===== 十字ガイド（点線）=====
  if (showGrid) {
    ctx.save();
    ctx.strokeStyle = "#c9ced6";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    const cx = Math.round(Ink.w / 2) + 0.5;
    const cy = Math.round(Ink.h / 2) + 0.5;
    ctx.lineWidth = 1;          // CSS px
    ctx.setLineDash([3, 3]);    // CSS px 単位
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, Ink.h);
    ctx.moveTo(0, cy); ctx.lineTo(Ink.w, cy);
    ctx.stroke();
    ctx.restore();
  }

  // ===== サンプル文字 =====
// drawAll() 内のサンプル文字描画を差し替え
if (showSample && KANJI) {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontPx = Math.round(Ink.w * 0.75); // 例: 幅の75%
  ctx.font = `${fontPx}px 'Klee One','Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif`;
  ctx.fillText(KANJI, Ink.w / 2, Ink.h / 2.2 + Math.round(Ink.h * 0.025));
  ctx.restore();
}

  // ===== 線（描画済み）=====
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 10;
  for (const st of strokes) {
    if (st.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(st[0].x, st[0].y);
    for (let i = 1; i < st.length; i++) ctx.lineTo(st[i].x, st[i].y);
    ctx.stroke();
  }
  ctx.restore();

  // ===== 現在のストローク =====
  if (current && current.length >= 1) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(current[0].x, current[0].y);
    for (let i = 1; i < current.length; i++) ctx.lineTo(current[i].x, current[i].y);
    ctx.stroke();
    ctx.restore();
  }
}


function getPos(ev) {
  const rect = Ink.el.getBoundingClientRect();
  const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
  const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
  const x = ((clientX - rect.left) / rect.width) * Ink.w;
  const y = ((clientY - rect.top) / rect.height) * Ink.h;
  return { x, y };
}

function startStroke(ev) {
  ev.preventDefault();
  const p = getPos(ev);
  current = [{ x: p.x, y: p.y, t: Date.now() }];
  drawAll();
}

function moveStroke(ev) {
  if (!current) return;
  ev.preventDefault();
  const p = getPos(ev);
  current.push({ x: p.x, y: p.y, t: Date.now() });
  drawAll();
}

function endStroke(ev) {
  if (!current) return;
  ev.preventDefault();
  if (current.length) strokes.push(current);
  current = null;
  drawAll();
}

function clearInk() {
  strokes = [];
  current = null;
  drawAll();
  $("#ink-topk").innerHTML = "";
}

function undoInk() {
  if (current && current.length) {
    current = null;
    drawAll();
    return;
  }
  strokes.pop();
  drawAll();
}

function toggleGrid(btn) {
  showGrid = !showGrid;
  btn.setAttribute("aria-pressed", showGrid ? "true" : "false");
  drawAll();
}

function toggleSample(btn) {
  showSample = !showSample;
  btn.setAttribute("aria-pressed", showSample ? "true" : "false");
  drawAll();
}

async function recognize() {
  const out = $("#ink-topk");
  out.innerHTML = "判定中…";
  const r = await ensureZinnia();
  if (!r) {
    out.textContent = "Zinnia を初期化できませんでした。";
    return;
  }

  const s = toZinniaFormat();
  if (!s.length) {
    out.textContent = "まず 1 文字書いてください。";
    return;
  }

  let candidates = [];
  try {
    // ラッパー差異に対応（recognizeTopK or recognize）
    if (typeof r.recognizeTopK === "function") {
      candidates = await r.recognizeTopK(s, 10);
      // 期待値: [{char:'漢', score:0.12}, ...]
    } else if (typeof r.recognize === "function") {
      const res = await r.recognize(s); // 実装に依る
      // res.topk / res.candidates / res[0] … など柔軟に吸収
      if (Array.isArray(res)) candidates = res;
      else if (Array.isArray(res?.topk)) candidates = res.topk;
      else if (Array.isArray(res?.candidates)) candidates = res.candidates;
      else candidates = [];
    }
  } catch (e) {
    console.error(e);
    out.textContent = "判定に失敗しました。";
    return;
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    out.textContent = "候補が見つかりませんでした。";
    return;
  }

  // 正規化（{char, score} に揃える）
  candidates = candidates.map(c => {
    if (typeof c === "string") return { char: c, score: null };
    if (Array.isArray(c) && c.length) return { char: c[0], score: c[1] ?? null };
    return { char: c.char ?? c.text ?? "", score: c.score ?? c.confidence ?? null };
  }).filter(c => c.char);

  // 表示
  out.innerHTML = candidates.map((c, i) => `
    <button type="button" class="ink-cand" data-c="${escapeHtml(c.char)}" aria-label="候補${i+1}">
      <span class="ink-cand-char">${escapeHtml(c.char)}</span>
      ${c.score != null ? `<small class="ink-cand-score">${(c.score*100).toFixed(1)}%</small>` : ""}
    </button>
  `).join("");

  // 候補クリックで左上の大文字を差し替え
  $$(".ink-cand", out).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const ch = btn.dataset.c || "";
      const dKanji = $("#d-kanji");
      if (dKanji) dKanji.textContent = ch;
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

// ---------- 初期化 ----------
function initInk() {
  Ink.el = $("#ink");
  if (!Ink.el) return;

  // 好みの初期サイズを適用（親幅寄せなら setInkCssSize(idealCssSize()) でもOK）
  setInkCssSize(inkCssSize);
  resizeCanvasToDPR();


  // ポインタイベント
  Ink.el.addEventListener("mousedown", startStroke);
  Ink.el.addEventListener("mousemove", moveStroke);
  window.addEventListener("mouseup", endStroke);

  // タッチ
  Ink.el.addEventListener("touchstart", startStroke, { passive: false });
  Ink.el.addEventListener("touchmove", moveStroke, { passive: false });
  Ink.el.addEventListener("touchend", endStroke, { passive: false });
  Ink.el.addEventListener("touchcancel", endStroke, { passive: false });

  // リサイズ時も再設定（向き変更/ズーム対応）
  window.addEventListener("resize", () => {
    DPR = Math.max(1, window.devicePixelRatio || 1);
    resizeCanvasToDPR();
    drawAll();
  });

  // ボタン類
  $("#ink-clear")?.addEventListener("click", clearInk);
  $("#ink-undo")?.addEventListener("click", undoInk);
  $("#ink-grid")?.addEventListener("click", (ev)=> toggleGrid(ev.currentTarget));
  $("#ink-sample")?.addEventListener("click", (ev)=> toggleSample(ev.currentTarget));
  $("#ink-search")?.addEventListener("click", recognize);

  window.addEventListener("resize", () => {
    DPR = Math.max(1, window.devicePixelRatio || 1);
    // 親幅追従したいなら： setInkCssSize(idealCssSize());
    resizeCanvasToDPR();
    drawAll();
  });

  drawAll();
}


// ---------- DOM 準備で起動 ----------
document.addEventListener("DOMContentLoaded", async () => {
  initTitleAndImage();
  wireMovieButton();

  await waitKleeOnce();     // ここはあなたのフォント待ち

  initInk();
  ensureZinnia().catch(()=>{});

  // ★ 戻るボタンの処理を追加
  const btnBack = document.getElementById("btn-back");
  if (btnBack) {
    btnBack.addEventListener("click", () => {
      // 1) back パラメータがあればそこへ戻る
      if (BACK_URL) {
        window.location.href = BACK_URL;
        return;
      }

      // 2) history に前のページがあるなら、普通に戻る
      if (window.history.length > 1) {
        window.history.back();
        return;
      }

      // 3) どこから来たか分からない（直接開かれた等）ときは index.html に戻す
      window.location.href = "/kakitori/index.html"; // パスは環境に合わせて
    });
  }
});




// ===================== 書き順「動画」を左上カードで再生 =====================
// ======== 修正版 Anim（差し替え） ========
const Anim = {
  playing: false,
  stage: null,
  exportRoot: null,
  canvas: null,
  host: document.getElementById("anim-host"),

  async ensureCanvas() {
    if (!this.canvas) {
      this.canvas = document.getElementById("anim-canvas");
    }
    if (!this.canvas) {
      console.error("[Anim] #anim-canvas が見つかりません");
      alert("内部エラー: canvas が見つかりません。");
      return false;
    }
    return true;
  },

  async loadScriptSequential(urls = []) {
    for (const url of urls) {
      try {
        if ([...document.scripts].some(s => s.src && s.src.endsWith(url))) {
          console.debug("[Anim] already loaded:", url);
          return url;
        }
        await new Promise((res, rej) => {
          const el = document.createElement("script");
          el.src = url;
          el.onload = () => res(true);
          el.onerror = () => rej(new Error("load error: " + url));
          document.body.appendChild(el);
        });
        console.debug("[Anim] loaded:", url);
        return url;
      } catch (e) {
        console.warn("[Anim] failed:", url, e?.message);
      }
    }
    return null;
  },

  resolveSymbolName() {
    const lib = window.lib;
    if (!lib) return null;
    const prefer = `js${ID}${KANJI}`;     // 例: js0004年
    if (lib[prefer]) return prefer;
    const key = Object.keys(lib).find(k => k.startsWith(`js${ID}`) && typeof lib[k] === "function");
    return key || null;
  },

  async play() {
    if (this.playing) return;
    if (!(await this.ensureCanvas())) return;

    // ★ kakitori 配下の構成に合わせる（./movie/...）
    const slug1 = `js${ID}${KANJI}`;   // 例: js0004年
    const slug2 = `js${ID}`;           // 例: js0004
    const candidates = [
      `./movie/${slug1}/${slug1}.js`,
      `./movie/${slug2}/${slug2}.js`,
      // 直下置き混在の保険（あるなら残す）
      `./movie/${slug1}.js`,
      `./movie/${slug2}.js`,
    ];
    console.debug("[Anim] try:", candidates);

    const ok = await this.loadScriptSequential(candidates);
    if (!ok) {
      alert("書き順動画ファイルが見つかりません。");
      return;
    }

    const name = this.resolveSymbolName();
    if (!name || !window.lib || !window.lib.Stage) {
      console.error("[Anim] init fail. lib or Stage missing.", { name, lib: !!window.lib });
      alert("動画の初期化に失敗しました。");
      return;
    }

    // 表示切替
    const dKanji = document.getElementById("d-kanji");
    if (dKanji) dKanji.style.display = "none";
    this.host?.removeAttribute("aria-hidden");

    const lib = window.lib;
    this.stage = new lib.Stage(this.canvas);
    this.exportRoot = new lib[name]();
    this.stage.addChild(this.exportRoot);
    createjs.Ticker.framerate = lib.properties?.fps || 24;
    createjs.Ticker.addEventListener("tick", this.stage);

    this.playing = true;
  },

  stop() {
    if (!this.playing) return;
    try { createjs.Ticker.removeEventListener("tick", this.stage); } catch {}
    try { this.stage?.removeAllChildren(); this.stage?.update(); } catch {}
    this.stage = null;
    this.exportRoot = null;

    const dKanji = document.getElementById("d-kanji");
    if (dKanji) dKanji.style.display = "";
    this.host?.setAttribute("aria-hidden", "true");

    this.playing = false;
  },

  toggle() { this.playing ? this.stop() : this.play(); }
};

(function wireStrokeMovieButton(){
  // DOM 構築後に確実に配線
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btn-write");
    if (!btn) return;
    const update = () => { btn.textContent = Anim.playing ? "停止" : "書き順動画"; };
    btn.addEventListener("click", async () => { await Anim.toggle(); update(); });
  });
  window.addEventListener("beforeunload", () => Anim.stop());
})();

// ===================== 書き順アニメを最初から iframe に表示 =====================
(() => {
  const params = new URLSearchParams(location.search);
  const id    = String(params.get("id") || "").padStart(4, "0");  // 例: 0003
  const kanji = params.get("kanji") || "";                        // 例: 大

  const iframe = document.getElementById("anim-frame");
  if (!iframe) return;

  // Animate出力HTMLのURLを構成（例: /movie/js0003大/js0003大.html）
  const slug    = `js${id}${kanji}`;
  const encoded = encodeURIComponent(slug);
  const url     = `../movie/${encoded}/${encoded}.html`;

  // iframeに設定
  iframe.src = url;
  console.log("[iframe load]", url);
})();