// ===== 簡易検索 + 詳細表示 + 書き順画像（同梱 or KanjiVG） + 手書き検索 =====
const SRC = "./data/kanji2200.json"; // 実際の配置に合わせて変更OK

// ---------- DOM ----------
const $ = sel => document.querySelector(sel);
const listEl   = $("#list");
const qEl      = $("#q");
const jlptEl   = $("#filter-jlpt");
const gradeEl  = $("#filter-grade");
const dlg      = $("#detail");
const closeBtn = dlg?.querySelector(".close");
const dKanji   = $("#d-kanji");
const dMeta    = $("#d-meta");
const dComp    = $("#d-comp");
const strokeArea = $("#stroke-area");

// 手書きUI（無いページもある想定なのでオプショナル）
const INK       = $("#ink");
const INK_TOPK  = $("#ink-topk");
const INK_CLEAR = $("#ink-clear");
const INK_UNDO  = $("#ink-undo");
const INK_SEARCH= $("#ink-search");

// ---------- 状態 ----------
let RAW = [];   // 読み込んだ元JSON
let DATA = [];  // 正規化済み（共通キー: id, char, strokes など）

// ========== 起動 ==========
init();

async function init(){
  try {
    const res = await fetch(SRC, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch ${SRC} -> ${res.status} ${res.statusText}`);

    const text = await res.text();
    try {
      RAW = JSON.parse(text);
      if (!Array.isArray(RAW)) throw new Error("JSONは配列である必要があります");
    } catch (e) {
      console.error("JSON parse failed. First 200 chars:\n", text.slice(0,200));
      throw e;
    }

    // 日本語/英語どちらのキーでも使えるよう正規化
    DATA = RAW.map(normalizeKanji);

    // UIイベント
    qEl?.addEventListener("input", applyFilter);
    jlptEl?.addEventListener("change", applyFilter);
    gradeEl?.addEventListener("change", applyFilter);
    closeBtn?.addEventListener("click", ()=> dlg?.close());
    dlg?.addEventListener("close", ()=> { if (strokeArea) strokeArea.innerHTML = ""; });

    // 手書きUIがあるページのみセットアップ
    if (INK && INK_CLEAR && INK_UNDO && INK_SEARCH) setupInkCanvas();

    // 初回描画
    renderList(DATA);

  } catch (err) {
    alert(`データ読込エラー：${err.message}\n（ブラウザのコンソールに詳細）`);
    console.error(err);
    if (typeof location !== "undefined") {
      console.log("resolved URL:", new URL(SRC, location.href).href);
    }
  }
}

// ========== 正規化（日本語/英語キー両対応） ==========
// === 追加: 学年・数値・真偽ヘルパー ===
function toStr(v){ return (v ?? "") + ""; }
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function toBool(v){
  if (typeof v === "boolean") return v;
  const s = toStr(v).trim();
  return ["1","true","TRUE","○","◯","はい","Yes","yes"].includes(s);
}
function zenkakuToHankakuDigits(s){
  return toStr(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0)-0xFEE0));
}
function kanjiDigitToArabic(s){
  const map = { "一":"1","二":"2","三":"3","四":"4","五":"5","六":"6" };
  return s.replace(/[一二三四五六]/g, m=>map[m]||m);
}
function normalizeGrade(v){
  let s = zenkakuToHankakuDigits(kanjiDigitToArabic(toStr(v))).trim();
  if (!s || /なし|—|-|無|対象外/i.test(s)) return null;
  // 例: "2年", "小2", "小学校2年", "２年", "小二"
  const m = s.match(/(小|小学|小学校)?\s*([1-6])\s*年?/);
  if (m) return `小${m[2]}`;
  return s; // それ以外は原文を返す（中学など）
}
function arrFrom(x, fallback, jpKeys=[]){
  if (Array.isArray(fallback) && fallback.length) return fallback.filter(Boolean).map(String);
  const out=[];
  for (const k of jpKeys){
    if (k in x && toStr(x[k]).trim()) out.push(toStr(x[k]).trim());
  }
  return out;
}

// === 差し替え: 日本語/英語キー両対応の正規化 ===
function normalizeKanji(x){
  const char = x.char ?? x["漢字"] ?? "";
  const id   = x.id   ?? x["漢字番号"] ?? char;
  const gradeRaw = x.grade ?? x["学年配当"] ?? null;
  const gradeNorm = normalizeGrade(gradeRaw);

  return {
    id,
    char,
    radical : x.radical ?? x["部首"] ?? null,
    strokes : toNum(x.strokes ?? x["総画数"]),
    joyo    : (x.joyo ?? x["常用漢字か否か"]) !== undefined ? toBool(x.joyo ?? x["常用漢字か否か"]) : null,
    grade   : gradeRaw,
    grade_norm: gradeNorm,              // ← 追加：フィルタはこれで行う
    jlpt    : x.jlpt  ?? x["能力試験"] ?? null,
    kanken  : x.kanken?? x["漢検級数"] ?? null,
    jinmei  : (x.jinmei ?? x["人名用漢字か否か"]) !== undefined ? toBool(x.jinmei ?? x["人名用漢字か否か"]) : null,
    on      : arrFrom(x, x.on,  ["音読み1","音読み2","音読み3"]),
    kun     : arrFrom(x, x.kun, ["訓読み1","訓読み2","訓読み3"]),
    meanings_ja: arrFrom(x, x.meanings_ja, ["日本語の意味1","日本語の意味2","日本語の意味3"]),
    meanings_en: arrFrom(x, x.meanings_en, ["英語の意味1","英語の意味2","英語の意味3"]),
    image_stroke: x.image_stroke ?? x["漢字と筆順の画像"] ?? "",
    image_font  : x.image_font   ?? x["明朝体とゴシックの画像"] ?? "",
    // 熟語（配列が無ければ 熟語1..8 を吸収）
    compounds: Array.isArray(x.compounds) ? x.compounds : (()=>{
      const out=[];
      for(let i=1;i<=8;i++){
        const w=x[`熟語${i}`], y=x[`熟語${i}読み`], e=x[`熟語${i}英語`];
        if (w && toStr(w).trim()){
          const o={word:toStr(w).trim()};
          if (y && toStr(y).trim()) o.reading=toStr(y).trim();
          if (e && toStr(e).trim()) o.en=toStr(e).trim();
          out.push(o);
        }
      }
      return out;
    })()
  };
}


// ========== 検索・一覧 ==========
function applyFilter(){
  const q = (qEl?.value || "").trim().toLowerCase();
  const fJLPT  = jlptEl?.value || "";
  const fGrade = gradeEl?.value || "";   // 例: "小1"〜"小6"

  const res = DATA.filter(x=>{
    if (fJLPT  && String(x.jlpt||"") !== fJLPT) return false;
    if (fGrade && String(x.grade_norm||"") !== fGrade) return false;  // ← ここを修正
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
  if (!listEl) return;
  listEl.innerHTML = arr.map(cardHTML).join("");
  // クリック: 要素順と配列順を対応させ、dataset/id検索に依存しない
  listEl.querySelectorAll(".card").forEach((el, idx)=>{
    const item = arr[idx];
    el.addEventListener("click", ()=> openDetail(item));
  });
}

function cardHTML(x){
  const jl = x.jlpt ? `<span class="badge">JLPT ${escapeHTML(x.jlpt)}</span>` : "";
  const gd = x.grade ? `<span class="badge">${escapeHTML(x.grade)}</span>` : "";
  const st = (x.strokes!=null) ? `<span class="badge">${x.strokes}画</span>` : "";
  return `
    <div class="card">
      <div class="kanji">${escapeHTML(x.char||"")}</div>
      <div class="meta">${[jl,gd,st].filter(Boolean).join("")}</div>
      <div class="meta">${escapeHTML((x.on||[]).join("・"))}</div>
      <div class="meta">${escapeHTML((x.kun||[]).join("・"))}</div>
    </div>
  `;
}

// ========== 詳細モーダル ==========
function openDetail(x){
  if (!x || !dlg) return;

  if (dKanji) dKanji.textContent = x.char || "？";
  if (dMeta) {
    dMeta.innerHTML = `
      <div class="row">部首: ${escapeHTML(x.radical||"-")}／画数: ${x.strokes??"-"}／常用: ${x.joyo? "○":"-"}</div>
      <div class="row">学年: ${escapeHTML(x.grade_norm || x.grade || "-")}／JLPT: ${escapeHTML(x.jlpt||"-")}／漢検: ${escapeHTML(x.kanken||"-")}／人名用: ${x.jinmei? "○":"-"}</div>
      <div class="row">音: ${escapeHTML((x.on||[]).join("・"))}</div>
      <div class="row">訓: ${escapeHTML((x.kun||[]).join("・"))}</div>
      <div class="row">意味: ${escapeHTML((x.meanings_ja||[]).join("、"))}</div>
      <div class="row">Meanings: ${escapeHTML((x.meanings_en||[]).join(", "))}</div>
    `;
  }

  // 書き順：画像優先→KanjiVG
  if (strokeArea) {
    strokeArea.innerHTML = "";
    const imgSrc = (x.image_stroke && String(x.image_stroke).trim()) ? String(x.image_stroke).trim() : "";
    if (imgSrc) {
      const img = new Image();
      img.alt = "書き順";
      img.loading = "lazy";
      img.decoding = "async";
      img.style.maxWidth = "100%";
      img.src = imgSrc;
      strokeArea.append(img);
    } else {
      // KanjiVG埋め込み（charが不正でも落ちないようチェック）
      if (x.char && typeof x.char.codePointAt === "function") {
        const cp = x.char.codePointAt(0);
        if (Number.isFinite(cp)) {
          const code = "u" + cp.toString(16).padStart(4,"0");
          const url = `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/${code}.svg`;
          const iframe = document.createElement("iframe");
          iframe.title = "KanjiVG stroke order";
          iframe.style.width = "100%";
          iframe.style.height = "260px";
          iframe.style.border = "0";
          iframe.src = url;
          strokeArea.append(iframe);
        } else {
          strokeArea.textContent = "（文字コードを特定できませんでした）";
        }
      } else {
        strokeArea.textContent = "（文字データがありません）";
      }
    }
  }

  if (dComp) {
    dComp.innerHTML = `<h3>熟語</h3>` + (x.compounds||[]).map(c =>
      `<div class="comp"><strong>${escapeHTML(c.word||"")}</strong> <small>${escapeHTML(c.reading||"")}</small><br><small>${escapeHTML(c.en||"")}</small></div>`
    ).join("");
  }

  dlg.showModal?.();
}

// ========== HTMLエスケープ ==========
function escapeHTML(s){ return String(s ?? "").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }

/* ========= 手書き検索（正規化＋Hu(7)+HOG(8)の複合） ========= */

// --- 手書きUIセットアップ（既存と同様） ---
let inkStrokes = []; // [[{x,y},...], ...]
let isDrawing = false;

function setupInkCanvas(){
  const ctx = INK.getContext("2d");
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 12; ctx.strokeStyle = "#e9eef4";
  clearInk();

  const getXY = ev => {
    const r = INK.getBoundingClientRect();
    const s = ev.touches ? ev.touches[0] : ev;
    return { x: s.clientX - r.left, y: s.clientY - r.top };
  };

  const start = ev => { ev.preventDefault(); isDrawing = true; inkStrokes.push([getXY(ev)]); };
  const move  = ev => {
    if (!isDrawing) return;
    const p = getXY(ev), cur = inkStrokes[inkStrokes.length-1], a = cur[cur.length-1];
    cur.push(p);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(p.x,p.y); ctx.stroke();
  };
  const end   = () => { isDrawing = false; };

  INK.addEventListener("pointerdown", start);
  INK.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  INK.addEventListener("touchstart", start, {passive:false});
  INK.addEventListener("touchmove",  move,  {passive:false});
  window.addEventListener("touchend", end);

  INK_CLEAR.addEventListener("click", clearInk);
  INK_UNDO .addEventListener("click", undoInk);
  INK_SEARCH.addEventListener("click", searchByInk);
}

function clearInk(){
  const ctx = INK.getContext("2d");
  ctx.clearRect(0,0,INK.width,INK.height);
  ctx.fillStyle = "#0f1319"; ctx.fillRect(0,0,INK.width,INK.height);
  inkStrokes = [];
  INK_TOPK && (INK_TOPK.innerHTML = "");
}
function undoInk(){
  if (!inkStrokes.length) return;
  const ctx = INK.getContext("2d");
  inkStrokes.pop();
  ctx.clearRect(0,0,INK.width,INK.height);
  ctx.fillStyle = "#0f1319"; ctx.fillRect(0,0,INK.width,INK.height);
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 12; ctx.strokeStyle = "#e9eef4";
  for (const s of inkStrokes){
    for (let i=1;i<s.length;i++){ ctx.beginPath(); ctx.moveTo(s[i-1].x,s[i-1].y); ctx.lineTo(s[i].x,s[i].y); ctx.stroke(); }
  }
}

// --- 画像前処理：Otsuで2値化 → ink領域を切り出して正方リサイズ（余白10%） ---
function otsuThreshold(gray){
  const hist = new Array(256).fill(0);
  for (let i=0;i<gray.length;i++) hist[gray[i]]++;
  const total = gray.length;
  let sum1 = 0; for (let t=0;t<256;t++) sum1 += t*hist[t];
  let wB=0, sumB=0, maxVar=-1, thr=0;
  for (let t=0;t<256;t++){
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t*hist[t];
    const mB = sumB / wB, mF = (sum1 - sumB) / wF;
    const between = wB*wF*(mB - mF)*(mB - mF);
    if (between > maxVar){ maxVar = between; thr = t; }
  }
  return thr;
}

// 3x3 多数決（1回）
function majorityFilter(bin, S){
  const out = new Float32Array(S*S);
  const idx = (x,y)=>y*S+x;
  for (let y=1;y<S-1;y++){
    for (let x=1;x<S-1;x++){
      let s=0;
      for(let j=-1;j<=1;j++) for(let i=-1;i<=1;i++) s += bin[idx(x+i,y+j)];
      out[idx(x,y)] = (s >= 5) ? 1 : 0; // 5/9以上を線と判定
    }
  }
  // 枠はそのまま
  for (let x=0;x<S;x++){ out[idx(x,0)]=bin[idx(x,0)]; out[idx(x,S-1)]=bin[idx(x,S-1)]; }
  for (let y=0;y<S;y++){ out[idx(0,y)]=bin[idx(0,y)]; out[idx(S-1,y)]=bin[idx(S-1,y)]; }
  return out;
}

// 背景成分に触れない“穴”の数を数える（背景の連結成分のうち非境界接触をカウント）
function countHoles(bin, S){
  const N = S*S, seen = new Uint8Array(N);
  const idx = (x,y)=>y*S+x;
  const inb = (x,y)=> x>=0 && x<S && y>=0 && y<S;

  // まず“外部背景”を塗る（境界から0の領域をBFS）
  const q = [];
  for (let x=0;x<S;x++){
    if (bin[idx(x,0)]===0){ seen[idx(x,0)]=1; q.push([x,0]); }
    if (bin[idx(x,S-1)]===0){ seen[idx(x,S-1)]=1; q.push([x,S-1]); }
  }
  for (let y=0;y<S;y++){
    if (bin[idx(0,y)]===0){ seen[idx(0,y)]=1; q.push([0,y]); }
    if (bin[idx(S-1,y)]===0){ seen[idx(S-1,y)]=1; q.push([S-1,y]); }
  }
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  while(q.length){
    const [x,y]=q.pop();
    for(const [dx,dy] of dirs){
      const nx=x+dx, ny=y+dy;
      if(!inb(nx,ny)) continue;
      const id=idx(nx,ny);
      if(seen[id] || bin[id]!==0) continue;
      seen[id]=1; q.push([nx,ny]);
    }
  }

  // 残った0成分が“穴”
  let holes=0;
  for (let y=1;y<S-1;y++){
    for (let x=1;x<S-1;x++){
      const id=idx(x,y);
      if (bin[id]===0 && !seen[id]){
        holes++;
        // 塗りつぶし
        const q2=[[x,y]];
        seen[id]=1;
        while(q2.length){
          const [cx,cy]=q2.pop();
          for(const [dx,dy] of dirs){
            const nx=cx+dx, ny=cy+dy, id2=idx(nx,ny);
            if(!inb(nx,ny)) continue;
            if(bin[id2]===0 && !seen[id2]){ seen[id2]=1; q2.push([nx,ny]); }
          }
        }
      }
    }
  }
  return holes;
}

// 極性自動判定＋切り出し＋スケール正規化
function prepareNormalized(srcCanvas, S=128){
  const W = srcCanvas.width, H = srcCanvas.height;
  const ctx0 = srcCanvas.getContext("2d");
  const rgba0 = ctx0.getImageData(0,0,W,H).data;
  const gray0 = new Uint8ClampedArray(W*H);
  for (let i=0,j=0;i<rgba0.length;i+=4,j++){
    gray0[j] = Math.round(rgba0[i]*0.299 + rgba0[i+1]*0.587 + rgba0[i+2]*0.114);
  }
  const thr0 = otsuThreshold(gray0);

  // 2つの極性候補を作って少ない方を“インク=1”に採用
  const binDark = new Float32Array(W*H); // 低い = インク
  const binLite = new Float32Array(W*H); // 高い = インク（白抜き線）
  let sumDark=0, sumLite=0;
  for (let i=0;i<gray0.length;i++){
    const v = gray0[i];
    const bd = (v < thr0) ? 1 : 0;
    const bl = (v > thr0) ? 1 : 0;
    binDark[i]=bd; sumDark+=bd;
    binLite[i]=bl; sumLite+=bl;
  }
  const bin0 = (sumDark <= sumLite) ? binDark : binLite;

  // 外接矩形で切り出し
  let minX=W, minY=H, maxX=-1, maxY=-1;
  for (let y=0;y<H;y++){
    for (let x=0;x<W;x++){
      if (bin0[y*W+x]){ if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; }
    }
  }
  if (maxX<0) return { gray:new Uint8ClampedArray(S*S), bin:new Float32Array(S*S), aspect:1, holes:0, S };

  const cutW=maxX-minX+1, cutH=maxY-minY+1, aspect = cutW / cutH;
  const pad = Math.floor(S*0.10);
  const scale = Math.min((S-2*pad)/cutW, (S-2*pad)/cutH);

  const tmp = document.createElement("canvas"); tmp.width=S; tmp.height=S;
  const tctx = tmp.getContext("2d");
  tctx.fillStyle="#fff"; tctx.fillRect(0,0,S,S);
  const dx = Math.floor((S - cutW*scale)/2);
  const dy = Math.floor((S - cutH*scale)/2);
  tctx.drawImage(srcCanvas, minX, minY, cutW, cutH, dx, dy, Math.round(cutW*scale), Math.round(cutH*scale));

  // 最終の2値化も再度Otsu→極性自動→ノイズ除去
  const id = tctx.getImageData(0,0,S,S);
  const rgba = id.data;
  const gray = new Uint8ClampedArray(S*S);
  for (let i=0,j=0;i<rgba.length;i+=4,j++){
    gray[j] = Math.round(rgba[i]*0.299 + rgba[i+1]*0.587 + rgba[i+2]*0.114);
  }
  const thr = otsuThreshold(gray);
  let bin = new Float32Array(S*S);
  let sumLow=0, sumHigh=0;
  for (let i=0;i<gray.length;i++){
    const bd = (gray[i] < thr) ? 1 : 0;
    const bl = (gray[i] > thr) ? 1 : 0;
    sumLow += bd; sumHigh += bl;
    bin[i] = bd; // 一旦bd
  }
  if (sumHigh < sumLow){
    for (let i=0;i<bin.length;i++) bin[i] = (gray[i] > thr) ? 1 : 0;
  }
  bin = majorityFilter(bin, S); // 1回だけ

  const holes = countHoles(bin, S);
  return { gray, bin, aspect, holes, S };
}

// Hu(7)
function huFromBinary(bin, S){
  let m00=0, m10=0, m01=0;
  for (let y=0;y<S;y++) for (let x=0;x<S;x++){ const v=bin[y*S+x]; m00+=v; m10+=x*v; m01+=y*v; }
  if (m00===0) return Array(7).fill(0);
  const xbar=m10/m00, ybar=m01/m00;
  const mu=(p,q)=>{ let s=0; for(let y=0;y<S;y++)for(let x=0;x<S;x++){ const v=bin[y*S+x]; if(!v)continue; s+=Math.pow(x-xbar,p)*Math.pow(y-ybar,q);} return s; };
  const mu20=mu(2,0), mu02=mu(0,2), mu11=mu(1,1), mu30=mu(3,0), mu12=mu(1,2), mu21=mu(2,1), mu03=mu(0,3);
  const t0=mu20+mu02, t1=Math.pow(mu20-mu02,2)+4*Math.pow(mu11,2);
  const t2=Math.pow(mu30-3*mu12,2)+Math.pow(3*mu21-mu03,2);
  const t3=Math.pow(mu30+mu12,2)+Math.pow(mu21+mu03,2);
  const t4=(mu30-3*mu12)*(mu30+mu12)*(Math.pow(mu30+mu12,2)-3*Math.pow(mu21+mu03,2))
          +(3*mu21-mu03)*(mu21+mu03)*(3*Math.pow(mu30+mu12,2)-Math.pow(mu21+mu03,2));
  const t5=(mu20-mu02)*(Math.pow(mu30+mu12,2)-Math.pow(mu21+mu03,2))
          +4*mu11*(mu30+mu12)*(mu21+mu03);
  const t6=(3*mu21-mu03)*(mu30+mu12)*(Math.pow(mu30+mu12,2)-3*Math.pow(mu21+mu03,2))
          -(mu30-3*mu12)*(mu21+mu03)*(3*Math.pow(mu30+mu12,2)-Math.pow(mu21+mu03,2));
  return [t0,t1,t2,t3,t4,t5,t6].map(v=>Math.sign(v)*Math.log10(Math.abs(v)+1e-12));
}

// HOG(8)（Sobel）
function hog8FromGray(gray, S){
  const bins = new Float32Array(8);
  const at = (x,y)=> gray[y*S+x]||0;
  for (let y=1;y<S-1;y++){
    for (let x=1;x<S-1;x++){
      const gx = -at(x-1,y-1)-2*at(x-1,y)-at(x-1,y+1)+at(x+1,y-1)+2*at(x+1,y)+at(x+1,y+1);
      const gy = -at(x-1,y-1)-2*at(x,y-1)-at(x+1,y-1)+at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1);
      const mag = Math.hypot(gx,gy); if (!mag) continue;
      let ang = Math.atan2(gy,gx); if (ang<0) ang += 2*Math.PI;
      const k = Math.floor(ang/(2*Math.PI/8)) % 8;
      bins[k] += mag;
    }
  }
  let n=1e-8; for (let i=0;i<8;i++) n += bins[i]*bins[i];
  n = Math.sqrt(n);
  for (let i=0;i<8;i++) bins[i] /= n;
  return Array.from(bins);
}

function featuresFromCanvas(cnv){
  const prep = prepareNormalized(cnv, 128);
  return {
    hu:  huFromBinary(prep.bin, prep.S),
    hog: hog8FromGray(prep.gray, prep.S),
    aspect: prep.aspect,
    holes: prep.holes
  };
}

// --- グリフ（文字）用の特徴（フォント描画→同じ前処理）。キャッシュする ---
const glyphFeatCache = new Map();
function featuresForGlyph(ch){
  if (!ch) return {hu:Array(7).fill(0), hog:Array(8).fill(0), aspect:1, holes:0};
  if (glyphFeatCache.has(ch)) return glyphFeatCache.get(ch);

  const S = 200;
  const c = document.createElement("canvas"); c.width=S; c.height=S;
  const g = c.getContext("2d");
  g.fillStyle="#fff"; g.fillRect(0,0,S,S);
  g.fillStyle="#000";
  g.font = "900 150px 'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif";
  g.textAlign="center"; g.textBaseline="middle";
  g.fillText(ch, S/2, S/2+4);

  const f = featuresFromCanvas(c);
  glyphFeatCache.set(ch, f);
  return f;
}


// --- 距離（小さいほど近い）：HuのL2 + HOGのコサイン + 形比 + 画数差 ---
function l2(a,b){ let s=0; for(let i=0;i<a.length;i++){ const d=a[i]-b[i]; s+=d*d; } return Math.sqrt(s); }
function cosineDist(a,b){
  let dot=0, na=1e-8, nb=1e-8;
  for (let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return 1 - dot / (Math.sqrt(na)*Math.sqrt(nb));
}

async function searchByInk(){
  if (!inkStrokes.length){ alert("パッドに1文字書いてください"); return; }

  // 1) Google Input Tools を試す
  try {
    const ink = toGoogleInk(inkStrokes);
    const chars = await recognizeWithGoogleInputTools(ink, "ja", INK.width, INK.height, 20); // 上位20
    const items = [];
    for (const ch of chars){
      const it = DATA.find(d => d.char === ch);
      if (it) items.push(it);
    }
    if (items.length){
      // 右側の候補表示
      INK_TOPK.innerHTML = items.slice(0,10).map(it => `
        <div class="ink-cand"><span class="big">${escapeHTML(it.char)}</span>
          <small>${it.strokes ?? "-"}画</small></div>`).join("");
      INK_TOPK.querySelectorAll(".ink-cand").forEach((el, i)=> el.addEventListener("click", ()=> openDetail(items[i])));
      // 下のカードを差し替え
      renderList(items);
      return; // 成功
    }
  } catch (e){
    console.warn("Cloud handwriting fallback to local:", e);
  }

  // 2) 失敗/0件なら、いまのローカル特徴検索にフォールバック
  // （あなたの現在のローカル版 searchByInk 本体をここに残す or 呼び出す）
  // 例: fallbackLocalSearch();
}


function showInkTopK(arr){
  if (!INK_TOPK) return;
  INK_TOPK.innerHTML = arr.map(({item, dist})=>`
    <div class="ink-cand">
      <span class="big">${escapeHTML(item.char||"")}</span>
      <small>dist: ${dist.toFixed(3)}</small>
      <small>${item.strokes ?? "-"}画</small>
    </div>
  `).join("");
  INK_TOPK.querySelectorAll(".ink-cand").forEach((el, idx)=>{
    const item = arr[idx]?.item;
    el.addEventListener("click", ()=> item && openDetail(item));
  });
}

function toGoogleInk(inkStrokes){
  return inkStrokes.map(st => [
    st.map(p => Math.round(p.x)),
    st.map(p => Math.round(p.y)),
    [] // 時刻は空でもOK
  ]);
}

async function recognizeWithGoogleInputTools(ink, lang="ja", width=INK?.width||320, height=INK?.height||320, topk=20){
  const body = {
    options: "enable_pre_space",
    requests: [{
      writing_guide: { writing_area_width: width, writing_area_height: height },
      ink,
      language: lang
    }]
  };
  const url = "https://inputtools.google.com/request?ime=handwriting&app=webapp&cs=1&oe=UTF-8"; // .twでも可
  const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Google Input Tools ${res.status} ${res.statusText}`);
  const j = await res.json();
  const results = j?.[1]?.[0]?.[1] || [];
  return results.slice(0, topk); // 文字列の配列（例: ["日","田","目", ...]）
}
