// common.js 冒頭（他のimportの並びに）
import { getViewCount, bumpViewCount, listHistory } from "./history.js";

// === common.js の先頭（importの直後あたり）に追加 ===
console.log("[common] loaded path:", import.meta?.url || "(no meta url)");

// getData/OpenDetail を常に window へ（何度やっても無害）
//window.getData = (...args) => (typeof getData === "function" ? getData(...args) : (window.DATA || []));


/* ===================== 設定/状態 ===================== */
export const SRC = "./data/kanji2200.json";                  // データJSON
export const MODEL_URL = "./models/handwriting-ja.model";    // Zinniaモデル

const $ = (sel) => document.querySelector(sel);

export const els = {
  listEl:   document.querySelector("#list"),
  qEl:      document.querySelector("#q"),
  jlptEl:   document.querySelector("#filter-jlpt"),
  gradeEl:  document.querySelector("#filter-grade"),
  // 100件レンジUI
  rangeSelect: document.querySelector("#rangeSelect"),
  rangePrev:   document.querySelector("#rangePrev"),
  rangeNext:   document.querySelector("#rangeNext"),
  // 検索フォーム
  searchForm:  document.querySelector("#searchForm"),
  searchBtn:   document.querySelector("#searchBtn"),
  searchMic:   document.querySelector("#searchMic"),
  // 詳細モーダル
  dlg:      document.querySelector("#detail"),
  closeBtn: document.querySelector("#detail")?.querySelector(".close"),
  dKanji:   document.querySelector("#d-kanji"),
  dMeta:    document.querySelector("#d-meta"),
  dComp:    document.querySelector("#d-comp"),
  strokeArea: document.querySelector("#stroke-area"),
  //手書き検索
  inkClose:  document.querySelector("#ink-close"),
  // 部首検索
  radicalToggle: document.querySelector("#radical-toggle"),
  radicalPanel:  document.querySelector("#radical-panel"),
  radicalClose:  document.querySelector("#radical-close"),
  radicalGrid:   document.querySelector("#radical-grid"),
  radicalStrokeFilter: document.querySelector("#radicalStrokeFilter"),
  radicalResults: document.querySelector("#radical-results"),
  radicalPicked:  document.querySelector("#radical-picked"),
  radicalLists:   document.querySelector("#radical-lists"),
  listSection:    document.querySelector("#listSection"),
  //画数検索
  strokesToggle:  document.querySelector("#strokes-toggle"),
  strokesPanel:   document.querySelector("#strokes-panel"),
  strokesClose:   document.querySelector("#strokes-close"),
  strokesCount:   document.querySelector("#strokesCount"),
  strokesGrid:    document.querySelector("#strokes-grid"),
  //検索履歴
  historyToggle: document.querySelector("#history-toggle"),
  historyPanel:  document.querySelector("#history-panel"),
  historyClose:  document.querySelector("#history-close"),
  historyGrid:   document.querySelector("#history-grid"),
  historyFilter: document.querySelector("#historyFilter"),
};


let DATA = [];                // 正規化後データ
let CHAR_INDEX = new Map();   // char → row

export const getData = () => DATA;
export const getCharIndex = () => CHAR_INDEX;

// ここで window にぶら下げる（この時点では getData はもう定義済み）
window.getData = getData;

/* ===================== 正規化ユーティリティ ===================== */

// CID → 表示したい漢字 の対応表
const CID_MAP = {
  // 1384
  "&CID8267;": "辻",
  "&CID3056;": "辻󠄀",

  // 1704
  "&CID7962;": "茨",
  "&CID1205;": "茨󠄀",

  // 1721
  "&CID7766;": "謎",
  "&CID3262;": "謎󠄀",

  // 1732
  "&CID7652;": "葛",
  "&CID1481;": "葛󠄀",

  // 1856
  "&CID7767;": "灘",
  "&CID3263;": "灘󠄀",

  // 1912
  "&CID8266;": "逢",
  "&CID13408;": "逢󠄀",

  // 1942
  "&CID7965;": "牙",
  "&CID1383;": "牙󠄀",

  // 1965
  "&CID7780;": "樋",
  "&CID3465;": "樋󠄀",

  // 1970
  "&CID7799;": "餅",
  "&CID3819;": "餅󠄀",

  // 1990
  "&CID7738;": "樽",
  "&CID2924;": "樽󠄀",

  // 2033
  "&CID7642;": "噂",
  "&CID1247;": "噂󠄀",

  // 2068
  "&CID7961;": "芦",
  "&CID1142;": "芦󠄀",

  // 2090
  "&CID13650;": "飴",
  "&CID1252;": "飴󠄀",

  // 2124
  "&CID7756;": "賭",
  "&CID3148;": "賭󠄀",

  // 2183
  "&CID7688;": "薩",
  "&CID2165;": "薩󠄀",

  // 2195
  "&CID7711;": "逗",
  "&CID2598;": "逗󠄀",
};

// 1つの文字列の中の &CIDxxxx; を全部置換
function replaceCIDs(str) {
  if (str == null) return str;
  let s = String(str);
  for (const [cid, ch] of Object.entries(CID_MAP)) {
    if (s.includes(cid)) {
      s = s.split(cid).join(ch);
    }
  }
  return s;
}

// 1レコード丸ごと（オブジェクト／配列）を再帰的に置換
function replaceCidInRow(row) {
  if (!row || typeof row !== "object") return row;

  if (Array.isArray(row)) {
    return row.map(v =>
      typeof v === "string"
        ? replaceCIDs(v)
        : (v && typeof v === "object" ? replaceCidInRow(v) : v)
    );
  }

  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string") {
      out[k] = replaceCIDs(v);
    } else if (v && typeof v === "object") {
      out[k] = replaceCidInRow(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}


/* ===================== 正規化ユーティリティ ===================== */
const firstChar = s => (s ? Array.from(String(s).normalize('NFC'))[0] || '' : '');
const toNum = v => {
  if (v == null) return null;
  const s = String(v).replace(/[^\d.-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const toArr = (row, jaKeys=[]) => {
  if (Array.isArray(row)) return row.filter(Boolean).map(String);
  const out = [];
  for (const k of jaKeys) if (row?.[k]) out.push(String(row[k]));
  return out;
};
function asImg(v){
  if (!v) return "";
  const s = String(v).trim();
  if (/^(https?:|data:|\/|\.{1,2}\/)/.test(s)) return s;
  return `./img/${s}`;
}
function toHalfDigits(s){
  return String(s||"").replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0xFEE0));
}
function normalizeGrade(v){
  const s = toHalfDigits(String(v||"").trim());
  if (!s) return "";
  const m = s.match(/([1-6])/);
  return m ? `小${m[1]}` : "";
}
function normalizeJlptLevels(v){
  const s = String(v || "").toUpperCase();
  const m = s.match(/N[1-5]/g);
  return m ? Array.from(new Set(m)) : [];
}

function normalizeJinmeiFlag(v){
  const s = String(v || "").trim();
  if (!s) return false;

  // 明示的に「なし」「対象外」「-」は false
  if (s === "-" || /なし|対象外/i.test(s)) return false;

  // 人名用漢字・人名用 と書いてあれば true
  if (/人名用漢字|人名用|人名/i.test(s)) return true;

  // 〇 や ○ だけの場合も true 扱いしたいなら
  if (s === "○" || s === "〇") return true;

  // それ以外は一旦 false にしておく（必要ならパターンを増やす）
  return false;
}


/* ===================== 行の正規化 ===================== */


export function normalizeRow(row){
  // ★ JSON 1行分の &CIDxxxx; を全部、対応する漢字にしてしまう
  row = replaceCidInRow(row);

  const ch = firstChar(row.char ?? row["漢字"]);
  const radicalReadings =
    Array.isArray(row.radical_readings) ? row.radical_readings.map(String)
    : Array.isArray(row["部首読み"])    ? row["部首読み"].map(String)
    : [];

  // ★ 熟語1〜8 を 1 つの配列にまとめる
  let compounds;
  if (Array.isArray(row.compounds) && row.compounds.length) {
    compounds = row.compounds;
  } else {
    const a = [];
    for (let i = 1; i <= 8; i++) {
      const w  = row[`熟語${i}`];
      const y  = row[`熟語${i}読み`];
      const r  = row[`熟語${i}ローマ字`];
      const e  = row[`熟語${i}英語`];
      const ex = row[`熟語${i}例文`];

      if (!w) continue;

      a.push({
        word: String(w),
        reading: y ? String(y) : "",
        romaji: r ? String(r) : "",
        en: e ? String(e) : "",
        example_html: ex ? String(ex) : ""
      });
    }
    compounds = a;
  }

  // 例文だけの配列（検索用）
  const examples_html = [];
  for (const c of (compounds || [])) {
    if (c.example_html && String(c.example_html).trim()) {
      examples_html.push(String(c.example_html));
    }
  }

  // ★ ここが消えていたので復活させる
  const gradeRaw = row.grade ?? row["学年配当"] ?? "";
  const jlptRaw  = row.jlpt  ?? row["能力試験"] ?? "";

  // ★ 常用フラグ
  const joyoFlag = !!(
    row.joyo ||
    (row["常用漢字か否か"] && String(row["常用漢字か否か"]).includes("常用"))
  );

  return {
    id: String(row.id ?? row["漢字番号"] ?? ch),
    char: ch,
    radical: row.radical ?? row["部首"] ?? "",
    radical_strokes: toNum(row.radical_strokes ?? row["部首画数"]),
    radical_readings: radicalReadings,

    strokes: toNum(row.strokes ?? row["総画数"]),
    grade: row.grade ?? row["学年配当"] ?? "",
    grade_norm: normalizeGrade(gradeRaw),
    jlpt: jlptRaw,
    jlpt_levels: normalizeJlptLevels(jlptRaw),
    kanken: row.kanken ?? row["漢検級数"] ?? "",
jinmei: normalizeJinmeiFlag(row.jinmei ?? row["人名用漢字か否か"]),
    joyo: joyoFlag,

    on:  toArr(row.on ?? row, ["音読み1","音読み2","音読み3","音読み4","音読み5","音読み6","音読み7","音読み8","音読み9","音読み10"]),
    kun: toArr(row.kun ?? row, ["訓読み1","訓読み2","訓読み3","訓読み4","訓読み5","訓読み6","訓読み7","訓読み8","訓読み9","訓読み10"]),
    meanings_ja: toArr(row.meanings_ja ?? row, ["意味"]),
    meanings_en: toArr(row.meanings_en ?? row, ["英語の意味"]),
    image_stroke: asImg(row.image_stroke ?? row["漢字と筆順の画像"] ?? ""),
    image_font:   asImg(row.image_font   ?? row["明朝体とゴシックの画像"] ?? ""),
    compounds,
    examples_html,
  };
}


// ★ ルビを素早く扱うユーティリティ
function stripRubyTags(html = "") {
  // ruby/rb/rt/rpタグだけ除去（中身は残す）
  return String(html).replace(/<\/?(ruby|rb|rt|rp)>/g, "");
}

// ★ <ruby><rb>漢</rb><rt>かな</rt></ruby> → 「漢」に置換（rbだけ採用）
function rubyToRB(html = "") {
  return String(html)
    .replace(
      /<ruby>\s*<rb>(.*?)<\/rb>\s*(?:<rt>.*?<\/rt>\s*)?(?:<rp>.*?<\/rp>\s*)?<\/ruby>/gs,
      "$1"
    )
    .replace(/<\/?(ruby|rb|rt|rp)>/g, "");
}

// ★ <ruby><rb>漢</rb><rt>かな</rt></ruby> → 「かな」に置換して、全文かなの版を作る
function rubyToKana(html = "") {
  return String(html)
    // rubyブロックをかな（rt）に置換
    .replace(
      /<ruby>\s*<rb>.*?<\/rb>\s*<rt>(.*?)<\/rt>\s*(?:<rp>.*?<\/rp>\s*)?<\/ruby>/gs,
      "$1"
    )    // 念のためタグ類は除去
    .replace(/<\/?(ruby|rb|rt|rp)>/g, "");
}

// ★ 検索用に例文から複数バリアントを生成
function makeExampleVariants(html = "") {
  const raw = String(html).trim();
  if (!raw) return [];

  const rb     = rubyToRB(raw);       // 例: 「切った」   ←★これが欲しい
  const kana   = rubyToKana(raw);     // 例: 「きった」
  const noRuby = stripRubyTags(raw);  // 例: 「切きった」（保険）

  // 既存の正規化関数がある場合は合わせて適用（toSearchKey は既存に合わせて利用）
  const v = new Set();
  v.add(rb);
  v.add(kana);
  v.add(noRuby);
  
  // 既存の toSearchKey があればそちらも追加（全角/半角/大小/記号揺れ吸収）
  if (typeof toSearchKey === "function") {
    v.add(toSearchKey(rb));
    v.add(toSearchKey(kana));
    v.add(toSearchKey(noRuby));

  }
  return Array.from(v).filter(Boolean);
}



/* === 検索用ユーティリティ === */
function toNFC(s){ return String(s||"").normalize("NFC"); }

// 全角英数→半角、カナは片仮名→平仮名へ寄せる（よみ比較を安定化）
function toSearchKey(s){
  s = toNFC(s);
  // 全角→半角（数字・英字）
  s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0xFEE0));
  // カタカナ→ひらがな
  s = s.replace(/[ァ-ン]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0x60));
  // 小書きの扱い・長音の正規化は必要に応じて追加可
  return s.toLowerCase().trim();
}

function tokenizeQuery(q){
  // 空白区切り（全角／半角）
  return toSearchKey(q).split(/[\s\u3000]+/).filter(Boolean);
}

/* 数字レンジの抽出（"123" / "100-199" / "100–199" に対応） */
function extractNumberFilters(terms){
  const rest = [];
  const ranges = [];
  for (const t of terms){
    // 全角数字を吸収
    const raw = t.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0xFEE0));
    const m = raw.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m){
      const s = parseInt(m[1],10), e = parseInt(m[2],10);
      if (Number.isFinite(s) && Number.isFinite(e)) {
        ranges.push([Math.min(s,e), Math.max(s,e)]);
        continue;
      }
    }
    const n = parseInt(raw, 10);
    if (String(n) === raw && Number.isFinite(n)){
      ranges.push([n,n]);  // 単独番号
      continue;
    }
    rest.push(t);
  }
  // 複数レンジ指定されたら union（OR）で残す
  return { ranges, restTerms: rest };
}


// 行データから検索対象フィールドを取り出してキー化
function buildSearchFields(x){
  const char = toSearchKey(x.char);
  const on   = (x.on||[]).map(toSearchKey);
  const kun  = (x.kun||[]).map(toSearchKey);
  const meanJ= (x.meanings_ja||[]).map(toSearchKey);
  const meanE= (x.meanings_en||[]).map(toSearchKey);
  const compW= (x.compounds||[]).map(c => toSearchKey(c.word||""));
  const compR= (x.compounds||[]).map(c => toSearchKey(c.reading||""));
  const radical = toSearchKey(x.radical||"");
  const radYomi = (x.radical_readings||[]).map(toSearchKey);   // ★追加
  const jlpt = toSearchKey(x.jlpt||"");
  const grade= toSearchKey(x.grade_norm || x.grade || "");
  // ★ 例文の取り込み（正規化済み examples_html を使う）
  const examples = [];
  for (const ex of (x.examples_html || [])) {
    examples.push(...makeExampleVariants(ex));
  }
  return { char, on, kun, meanJ, meanE, compW, compR, radical, radYomi,examples, jlpt, grade };
}

// 単語 term に対する x のマッチスコア（大きいほど優先）
// ルール（合計加点式、複数termはANDで全termがどこかにヒット）
//  1000: 文字が完全一致（最優先）
//   800: 熟語の語形が完全一致（word）
//   650: 読み（音/訓）が完全一致
//   520: 熟語の語形に部分一致（前方一致 560、部分一致 520）
//   500: 読みに前方一致、 450: 読みに部分一致
//   300: 日本語/英語の意味に一致
//   220: 部首が一致、180: JLPT/学年が一致
//    60: どこかに部分一致（保険）
//  tie-break: __no 昇順
function scoreOneTerm(fields, term){
  let s = 0;
  // ★ fields 内の配列をフラット化（examples, radYomi など）
  const anyFields = [];
  for (const v of Object.values(fields)) {
    if (Array.isArray(v)) anyFields.push(...v);
    else if (v) anyFields.push(v);
  }
  // 文字
  if (term === fields.char) s += 1000;

  // 熟語
  if (fields.compW.includes(term)) s += 800;
  if (fields.compW.some(w => w.startsWith(term))) s += 560;
  if (fields.compW.some(w => w.includes(term)))   s += 520;

  // 読み（音・訓）
  if (fields.on.includes(term) || fields.kun.includes(term)) s += 650;
  if (fields.on.some(r => r.startsWith(term)) || fields.kun.some(r => r.startsWith(term))) s += 500;
  if (fields.on.some(r => r.includes(term))   || fields.kun.some(r => r.includes(term)))   s += 450;

  // 部首の“読み”
  if ((fields.radYomi||[]).includes(term))                       s += 600;
  if ((fields.radYomi||[]).some(r => r.startsWith(term)))        s += 480;
  if ((fields.radYomi||[]).some(r => r.includes(term)))          s += 420;

  // 意味
  if (fields.meanJ.some(m => m.includes(term))) s += 300;
  if (fields.meanE.some(m => m.includes(term))) s += 280;

  // 部首／JLPT／学年
  if (fields.radical && (fields.radical === term || fields.radical.includes(term))) s += 220;
  if (fields.jlpt    && (fields.jlpt    === term)) s += 180;
  if (fields.grade   && (fields.grade   === term)) s += 180;

   // 例文にも加点（完全一致／前方一致／部分一致）
  if (fields.examples && fields.examples.length) {
    if (fields.examples.includes(term)) s += 420;
    else if (fields.examples.some(v => v.startsWith(term))) s += 320;
    else if (fields.examples.some(v => v.includes(term)))   s += 240;
  }


  // 保険：どこかに部分一致
  const any = [
    fields.char,
    ...fields.compW, ...fields.compR,
    ...fields.on, ...fields.kun,
    ...fields.meanJ, ...fields.meanE,
    fields.radical,
    ...(fields.radYomi||[]),      // ★追加
    fields.jlpt, fields.grade
  ];
  if (anyFields.some(v => v && v.includes(term))) s = Math.max(s, 60);

  return s;
}

// 1行に対してクエリ配列全体のスコア（AND：全termがヒットしたときのみ合格）
function scoreRowForTerms(x, terms){
  const f = buildSearchFields(x);
  let total = 0;
  for (const t of terms){
    const sc = scoreOneTerm(f, t);
    if (sc <= 0) return 0; // このtermがどこにもマッチしない → 不合格
    total += sc;
  }
  return total;
}

/* ===================== データ読込 ===================== */
export async function loadData(){
  const res = await fetch(SRC, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${SRC} -> ${res.status}`);
  const raw = JSON.parse(await res.text());
  DATA = (Array.isArray(raw) ? raw : []).map(normalizeRow).filter(r => r.char);
  // 連番（番号がなければ読み込み順）
  DATA.forEach((row, i) => { row.__no = i + 1; });
  CHAR_INDEX = new Map(DATA.map(r => [r.char, r]));
}
// common.js のどこか（loadData() 定義の後あたりが安全）に追加



/* ===================== 一覧・フィルタ・レンジ100 ===================== */
export function buildRangeOptions(){
  const { rangeSelect } = els;
  if (!rangeSelect) return;
  rangeSelect.innerHTML = `<option value="">すべて（1–${DATA.length}）</option>`;
  const total = DATA.length;
  for (let start = 1; start <= total; start += 100){
    const end = Math.min(start + 99, total);
    const opt = document.createElement("option");
    opt.value = `${start}-${end}`;
    opt.textContent = `${start}–${end}`;
    rangeSelect.appendChild(opt);
  }
}

export function wireFilters(){
  const { qEl, jlptEl, gradeEl, rangeSelect, rangePrev, rangeNext, searchForm, searchBtn } = els;

  // 検索ボタン/Enterで検索
  searchForm?.addEventListener("submit", e=>{ e.preventDefault(); closeAllSearchPanels(); applyFilter(); });
  searchBtn?.addEventListener("click",  e=>{ e.preventDefault(); closeAllSearchPanels(); applyFilter(); });
  // 入力欄が空になったタイミングを検出してリセットする
  els.qEl?.addEventListener("input", () => {
    // 「×」で空になったとき or 手動で全削除したとき
    if (els.qEl.value.trim() === "") {
      switchToListMode();
      closeAllSearchPanels(); 
      renderList(getData(), { showBadge: false });
    }
  });
  // フィルタ
  jlptEl?.addEventListener("change", ()=>{ switchToListMode(); applyFilter(); });
  gradeEl?.addEventListener("change", ()=>{ switchToListMode(); applyFilter(); });
  rangeSelect?.addEventListener("change", ()=>{ switchToListMode(); applyFilter(); });
  rangePrev?.addEventListener("click", ()=> stepRange(-1));
  rangeNext?.addEventListener("click", ()=> stepRange(1));

  // 音声検索（実装済みなら呼ぶ）
  wireVoiceSearch?.();

  // 部首
  els.radicalToggle?.addEventListener("click", ()=>{
    if (isOpen(els.radicalPanel)) openExclusive('none'); else {
      initRadicalPanelOnce(); openExclusive('radical');
      renderRadicalGrid?.(); renderRadicalPicked?.(); renderRadicalResults?.([]);
    }
  });
  els.radicalClose?.addEventListener("click", ()=> openExclusive('none'));

  // 画数
  els.strokesToggle?.addEventListener("click", ()=>{
    if (isOpen(els.strokesPanel)) openExclusive('none'); else openExclusive('strokes');
  });
  els.strokesClose?.addEventListener("click", ()=> openExclusive('none'));

  // 手書き（先に他を閉じる → ink側の処理が開く）
  const inkBtn = document.querySelector('#ink-toggle');
  inkBtn?.addEventListener('click', ()=> openExclusive('ink'), { capture:true });
  els.inkClose?.addEventListener("click", ()=> openExclusive('none'));

  //履歴
  els.historyToggle?.addEventListener("click", ()=>{
    if (isOpen(els.historyPanel)) openExclusive('none');  // もう一度で閉じる
    else openExclusive('history');
  });
  els.historyClose?.addEventListener("click", ()=> openExclusive('none'));
}


function stepRange(dir){
  const { rangeSelect } = els;
  if (!rangeSelect || !rangeSelect.options.length) return;
  const idx = rangeSelect.selectedIndex;
  const next = Math.min(Math.max(idx + dir, 1), rangeSelect.options.length - 1);
  rangeSelect.selectedIndex = next;
  applyFilter();
}



/* ===================== 部首検索 ===================== */
let _radicalIndex = null;    // { byStroke: Map<number, Set<radical>>, meta: Map<radical,{strokes}> }
let _pickedRadical = null;   // 現在選択中の部首（文字）
let _pickedStroke  = null;   // その部首の画数

function buildRadicalIndex(){
  if (_radicalIndex) return _radicalIndex;
  const data = getData();
  const byStroke = new Map();   // strokes -> Set(radical)
  const meta = new Map();       // radical -> { strokes }
  for (const r of data){
    const rad = r.radical || "";
    if (!rad) continue;
    const rs = Number.isFinite(r.radical_strokes) ? r.radical_strokes : null;
    if (rs != null){
      if (!byStroke.has(rs)) byStroke.set(rs, new Set());
      byStroke.get(rs).add(rad);
      if (!meta.has(rad)) meta.set(rad, { strokes: rs });
    }else{
      // 画数不明の部首を拾っておきたい場合は here
      if (!meta.has(rad)) meta.set(rad, { strokes: null });
    }
  }
  _radicalIndex = { byStroke, meta };
  return _radicalIndex;
}

function wireRadicalSearch(){
  const { radicalToggle, radicalClose } = els;
  radicalToggle?.addEventListener("click", openRadicalPanel);
  radicalClose?.addEventListener("click", closeRadicalPanel);
  initRadicalPanelOnce(); // ← ここだけ呼べばOK
}
function initRadicalPanelOnce(){
  const { radicalStrokeFilter } = els;
  if (!radicalStrokeFilter || radicalStrokeFilter.dataset.ready) return;
  radicalStrokeFilter.dataset.ready = "1";

  const idx = buildRadicalIndex();
  const strokes = [...idx.byStroke.keys()].sort((a,b)=>a-b);

  // ✅『すべて』を最初に
  radicalStrokeFilter.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "すべて";
  radicalStrokeFilter.appendChild(optAll);

  for (const s of strokes){
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s}画の部首`;
    radicalStrokeFilter.appendChild(opt);
  }

  radicalStrokeFilter.selectedIndex = 0;
  radicalStrokeFilter.addEventListener("change", renderRadicalGrid);
}



function openRadicalPanel(){
  const { radicalPanel, radicalResults, listSection } = els;
  initRadicalPanelOnce();     // ← 追加

  renderRadicalGrid();
  // 表示状態
  radicalPanel?.classList.remove("hidden");
  radicalPanel?.setAttribute("aria-hidden","false");
  radicalResults?.classList.remove("hidden");
  radicalResults?.setAttribute("aria-hidden","false");
  listSection?.classList.add("hidden");
  // 初期化
  _pickedRadical = null; _pickedStroke = null;
  renderRadicalPicked();
  renderRadicalResults([]);
}

function closeRadicalPanel(){
  const { radicalPanel, radicalResults, listSection } = els;
  radicalPanel?.classList.add("hidden");
  radicalPanel?.setAttribute("aria-hidden","true");
  radicalResults?.classList.add("hidden");
  radicalResults?.setAttribute("aria-hidden","true");
  listSection?.classList.remove("hidden");
}

function renderRadicalGrid(){
  const { radicalGrid, radicalStrokeFilter } = els;
  const idx = buildRadicalIndex();
  const wantVal = radicalStrokeFilter?.value ?? "";
  // ★追加
  _pickedRadical = null;
  _pickedStroke  = null;
  renderRadicalPicked();
  renderRadicalResults([]);

  const makeTiles = (radicals, strokes) => {
    const arr = [...radicals].sort((a,b)=> a.localeCompare(b,'ja')); // 部首は一応五十音風に
    const tiles = arr.map(rad =>
      `<button class="radical-tile" data-r="${escapeAttr(rad)}" data-strokes="${strokes}">${escapeHTML(rad)}</button>`
    ).join("");
    return tiles || `<div class="muted" style="grid-column:1/-1">該当なし</div>`;
  };

  // 『すべて』→ 画数ごとに見出し＋タイル群
  if (wantVal === ""){
    const sKeys = [...idx.byStroke.keys()].sort((a,b)=>a-b);
    radicalGrid.innerHTML = sKeys.map(s => `
      <section class="radical-group" data-strokes="${s}">
        <h3 class="radical-head">${s}画の部首</h3>
        <div class="radical-row">
          ${makeTiles(idx.byStroke.get(s), s)}
        </div>
      </section>
    `).join("");
  } else {
    // 単一の画数だけ
    const s = parseInt(wantVal, 10);
    const set = idx.byStroke.get(s) || new Set();
    radicalGrid.innerHTML = `
      <section class="radical-group" data-strokes="${s}">
        <h3 class="radical-head">${s}画の部首</h3>
        <div class="radical-row">
          ${makeTiles(set, s)}
        </div>
      </section>
    `;
  }

  // クリック配線（共通）
  radicalGrid.querySelectorAll(".radical-tile").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      _pickedRadical = btn.dataset.r || "";
      _pickedStroke  = parseInt(btn.dataset.strokes||"",10);
      // Active表示（同じ画数セクション内）
      const group = btn.closest(".radical-group");
      group?.querySelectorAll(".radical-tile").forEach(b => b.classList.toggle("is-active", b===btn));

      renderRadicalPicked();
      searchRadical(); // 結果を再描画
      scrollToRadicalResults();     // ← ここを追加！
    });
  });
}


function renderRadicalPicked(){
  const { radicalPicked } = els;
  if (!_pickedRadical){
    radicalPicked.innerHTML = `<span>選択された部首：<em>なし</em></span>`;
  }else{
    radicalPicked.innerHTML = `
      <span>選択された部首：</span>
      <span class="badge" style="font-size:1.1rem;">${escapeHTML(_pickedRadical)}</span>
      <span class="muted">（${_pickedStroke ?? "?"}画）</span>
    `;
  }
}

function searchRadical(){
  if (!_pickedRadical) { renderRadicalResults([]); return; }
  const data = getData().filter(x => x.radical === _pickedRadical);
  // +追加画数でグループ化
  const groups = new Map(); // addStrokes -> array
  for (const x of data){
    const ks = Number.isFinite(x.strokes) ? x.strokes : null;
    const add = (Number.isFinite(_pickedStroke) && Number.isFinite(ks)) ? (ks - _pickedStroke) : null;
    const key = (add!=null && add>=0) ? add : "？";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  // キーを昇順（"？"は最後）
  const keys = [...groups.keys()].sort((a,b)=>{
    if (a==="？") return 1;
    if (b==="？") return -1;
    return a-b;
  });
  const result = keys.map(k => ({ add: k, items: groups.get(k).sort((a,b)=>(a.__no||0)-(b.__no||0)) }));
  renderRadicalResults(result);
}

function renderRadicalResults(grouped){
  const { radicalLists } = els;
  if (!grouped || !grouped.length){
    radicalLists.innerHTML = `<div class="muted">部首を選ぶと候補が表示されます。</div>`;
    return;
  }
  radicalLists.innerHTML = grouped.map(g => `
    <div class="radical-group-strokes">
      <h3>+${escapeHTML(String(g.add))}画</h3>
      <div class="radical-row">
        ${g.items.map(cardHTML).join("")}
      </div>
    </div>
  `).join("");

  // クリックで詳細を出す（一覧と同じ）
  radicalLists.querySelectorAll(".card").forEach((el, idx)=>{
    // 要素からアイテムを取り出すため簡易に data-id を使って検索
    const id = el.getAttribute("data-id");
    const hit = getData().find(x => String(x.id) === String(id));
    if (hit) el.addEventListener("click", ()=> openDetail(hit));
  });
}

/* ===================== 画数検索 ===================== */
let _strokeBuckets = null; // Map<number, Array<item>>

function buildStrokeBuckets(){
  if (_strokeBuckets) return _strokeBuckets;
  _strokeBuckets = new Map();
  for (const x of getData()){
    const s = Number.isFinite(x.strokes) ? x.strokes : null;
    if (s==null) continue;
    if (!_strokeBuckets.has(s)) _strokeBuckets.set(s, []);
    _strokeBuckets.get(s).push(x);
  }
  // それぞれ番号昇順にしておく
  for (const arr of _strokeBuckets.values()){
    arr.sort((a,b)=>(a.__no||0)-(b.__no||0));
  }
  return _strokeBuckets;
}

function initStrokesPanelOnce(){
  const { strokesCount } = els;
  if (!strokesCount || strokesCount.dataset.ready) return;
  strokesCount.dataset.ready = "1";

  const buckets = buildStrokeBuckets();
  const counts = [...buckets.keys()].sort((a,b)=>a-b);

  // 『すべて』
  const optAll = document.createElement("option");
  optAll.value = "";            // 空＝すべて
  optAll.textContent = "すべて";
  strokesCount.appendChild(optAll);

  // 1画,2画,…
  for (const c of counts){
    const opt = document.createElement("option");
    opt.value = String(c);
    opt.textContent = `${c}画`;
    strokesCount.appendChild(opt);
  }
  strokesCount.selectedIndex = 0;

  strokesCount.addEventListener("change", renderStrokesGrid);
}


function renderStrokesGrid(){
  const { strokesCount, strokesGrid } = els;
  if (!strokesGrid) return;

  const buckets = buildStrokeBuckets();
  const val = strokesCount?.value ?? "";

  // クリック→詳細
  const wireCards = (root) => {
    root.querySelectorAll(".card").forEach(el=>{
      const id = el.getAttribute("data-id");
      const hit = getData().find(x=> String(x.id) === String(id));
      if (hit) el.addEventListener("click", ()=> openDetail(hit));
    });
  };

  // 『すべて』：画数ごとに見出し＋カード
  if (val === ""){
    const counts = [...buckets.keys()].sort((a,b)=>a-b);
    strokesGrid.innerHTML = counts.map(c => `
      <section class="stroke-group" data-strokes="${c}">
        <h3 class="stroke-head">${c}画</h3>
        <div class="stroke-row">
          ${(buckets.get(c)||[]).map(cardHTML).join("")}
        </div>
      </section>
    `).join("");
    wireCards(strokesGrid);
    return;
  }

  // 単一の画数
  const c = parseInt(val,10);
  const list = buckets.get(c)||[];
  strokesGrid.innerHTML = `
    <section class="stroke-group" data-strokes="${c}">
      <h3 class="stroke-head">${c}画</h3>
      <div class="stroke-row">
        ${list.map(cardHTML).join("")}
      </div>
    </section>
  `;
  wireCards(strokesGrid);
}




/* ===================== 検索パネルの排他制御 ===================== */
// --- 汎用 ---
function isOpen(el){ return el && !el.classList.contains('hidden'); }
function openPanel(el, btn){ if(!el) return; el.classList.remove('hidden'); el.setAttribute('aria-hidden','false'); btn?.setAttribute('aria-expanded','true'); }
function closePanel(el, btn){ if(!el) return; el.classList.add('hidden'); el.setAttribute('aria-hidden','true'); btn?.setAttribute('aria-expanded','false'); }
function closeInkPanelIfOpen(){
  const p=document.querySelector('#ink-panel'), b=document.querySelector('#ink-toggle');
  if (isOpen(p)) closePanel(p,b);
}
/* ←← ここに 2-1 を追加（他のヘルパーと同じ階層・関数の外） */
function setActive(btn, on){
  if (!btn) return;
  btn.classList.toggle('is-active', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function scrollToRadicalResults(){
  const el = els.radicalResults;
  if (!el) return;

  // 必ず表示状態へ
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden','false');

  // 固定ヘッダーぶんを差し引く（IDやクラス名は実環境に合わせて）
  const header = document.querySelector('#siteHeader, header, .site-header');
  const headerH = header?.offsetHeight || 0;

  const y = el.getBoundingClientRect().top + window.pageYOffset - headerH - 84;
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  window.scrollTo({ top: y, behavior });

  // URLハッシュも合わせたい場合（任意）
  // history.replaceState(null, '', '#radical-results');
}

function openExclusive(kind){
  const { radicalPanel, radicalToggle, listSection, radicalResults, radicalLists, radicalPicked } = els;
  const { strokesPanel, strokesToggle, historyPanel, historyToggle } = els;
  const inkToggle = document.querySelector('#ink-toggle');

  // すべて閉じる
  closePanel(radicalPanel, radicalToggle);
  closePanel(strokesPanel, strokesToggle);
  closePanel(historyPanel, historyToggle);
  closeInkPanelIfOpen();

  setActive(radicalToggle, false);
  setActive(strokesToggle, false);
  setActive(historyToggle, false);
  setActive(inkToggle, false);

  // ✅ 一覧の履歴バッジを完全クリア（他モード切替時）
  const listEl = els.listEl;
  if (listEl) {
    listEl.querySelectorAll(".hist-badge").forEach(b => b.remove());
  }

  // 部首の残留クリア
  if (radicalResults){ radicalResults.classList.add('hidden'); radicalResults.setAttribute('aria-hidden','true'); }
  if (radicalLists)  radicalLists.innerHTML = "";
  if (radicalPicked) radicalPicked.innerHTML = "";

  if (kind === 'radical'){
    initRadicalPanelOnce();                 // ★これを追加
    openPanel(radicalPanel, radicalToggle);
    listSection?.classList.add('hidden');
    radicalResults?.classList.remove('hidden');
    radicalResults?.setAttribute('aria-hidden','false');
    renderRadicalGrid();                    // 初回レンダ
    renderRadicalPicked(); 
    renderRadicalResults([]);
    setActive(radicalToggle, true);
  } else if (kind === 'strokes'){
    initStrokesPanelOnce();
    openPanel(strokesPanel, strokesToggle);
    listSection?.classList.add('hidden');
    renderStrokesGrid();
    setActive(strokesToggle, true);
  } else if (kind === 'history'){
    openPanel(historyPanel, historyToggle);
    listSection?.classList.add('hidden');
    initHistoryFilterOnce();   // ← 追加
    renderHistoryGrid();           // ← 履歴を描画（バッジ表示）
    setActive(historyToggle, true);
  } else if (kind === 'ink'){
    listSection?.classList.remove('hidden');
    setActive(inkToggle, true);
  } else {
    listSection?.classList.remove('hidden');
  }
}

// 通常の一覧モードへ強制復帰（部首/画数/手書きをすべて閉じる）
function switchToListMode(){
  const { radicalPanel, radicalToggle, radicalResults, radicalLists, radicalPicked,
          strokesPanel, strokesToggle, listSection } = els;
  const inkToggle = document.querySelector('#ink-toggle');

  closePanel(radicalPanel, radicalToggle);
  closePanel(strokesPanel, strokesToggle);
  closeInkPanelIfOpen();

  if (radicalResults){
    radicalResults.classList.add('hidden');
    radicalResults.setAttribute('aria-hidden','true');
  }
  if (radicalLists)  radicalLists.innerHTML = "";
  if (radicalPicked) radicalPicked.innerHTML = "";

  // ボタンも全て非アクティブ
  setActive(radicalToggle, false);
  setActive(strokesToggle, false);
  setActive(inkToggle, false);

  listSection?.classList.remove('hidden');
  // ★ 検索系パネル閉じたら一覧の履歴バッジ非表示化
  const listEl = els.listEl;
  if (listEl) {
    listEl.querySelectorAll(".hist-badge").forEach(b => b.remove());
  }
}

function closeAllSearchPanels(){
  const {
    radicalPanel, radicalToggle, radicalResults, radicalLists, radicalPicked,
    strokesPanel, strokesToggle,
    historyPanel, historyToggle,
    listSection
  } = els;
  const inkToggle = document.querySelector('#ink-toggle');

  // すべて閉じる
  closePanel(radicalPanel, radicalToggle);
  closePanel(strokesPanel,  strokesToggle);
  closePanel(historyPanel,  historyToggle);
  closeInkPanelIfOpen();

  // ✅ 部首検索の「結果ブロック」も必ず非表示にする
  if (radicalResults){
    radicalResults.classList.add('hidden');
    radicalResults.setAttribute('aria-hidden','true');
  }
  // ついでに中身と選択状態もリセット（任意）
  if (radicalLists)  radicalLists.innerHTML = "";
  if (radicalPicked) radicalPicked.innerHTML = "";
  document.querySelectorAll('.radical-tile.is-active')
    .forEach(b => b.classList.remove('is-active'));

  // トグルの見た目OFF
  setActive(radicalToggle, false);
  setActive(strokesToggle, false);
  setActive(historyToggle, false);
  setActive(inkToggle,     false);

  // 一覧に戻す
  listSection?.classList.remove('hidden');

  // 検索時は履歴バッジを消す（仕様）
  els.listEl?.querySelectorAll('.hist-badge').forEach(b=>b.remove());
}

/* ==== 音声検索 ==== */
function wireVoiceSearch(){
  const { qEl, searchMic } = els;
  if (!searchMic) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){
    // 非対応ブラウザ：ボタンを無効化
    searchMic.disabled = true;
    searchMic.title = "このブラウザは音声入力に対応していません";
    return;
  }

  // ★ index.html に最初から入っている SVG をそのまま保存しておく
  const MIC_HTML = searchMic.innerHTML;

  let recog = null;
  let active = false;

  function start(){
    if (active) return;
    recog = new SR();
    recog.lang = "ja-JP";
    recog.interimResults = false;
    recog.maxAlternatives = 1;

    recog.onstart = ()=> {
      active = true;
      searchMic.setAttribute("aria-pressed","true");
      // ★ アクティブ時は今まで通り ● だけを表示
      searchMic.textContent = "●";
      searchMic.title = "音声入力を停止";
    };
    recog.onerror = ()=> stop();
    recog.onend = ()=> stop();
    recog.onresult = (ev)=>{
      const text = (ev.results?.[0]?.[0]?.transcript || "").trim();
      if (text){
        if (qEl) qEl.value = text;
        applyFilter(); // 音声確定で即検索
      }
    };
    try{ recog.start(); }catch{ /* Safari二重start対策 */ }
  }

  function stop(){
    if (!active) return;
    try{ recog?.stop(); }catch{}
    active = false;
    searchMic.setAttribute("aria-pressed","false");
    // ★ 停止時に SVG を元通り差し戻す
    searchMic.innerHTML = MIC_HTML;
    searchMic.title = "音声入力を開始";
  }

  searchMic.addEventListener("click", ()=> active ? stop() : start());
}



export function applyFilter(){
  closeAllSearchPanels();
  const { listEl, qEl, jlptEl, gradeEl, rangeSelect } = els;

  const termRaw = (qEl?.value || "");
  const terms0  = tokenizeQuery(termRaw);

  // 入力クエリから「番号レンジ」を抽出（例：123, 100-199）
  const { ranges, restTerms } = extractNumberFilters(terms0);

  const jl   = (jlptEl?.value || "").trim();
  const gr   = (gradeEl?.value || "").trim();
  const rsel = (rangeSelect?.value || "").trim();

  // 1) ベース抽出（AND：JLPT/学年/レンジUI）
  let list = getData().filter(item => {
    if (jl && !(item.jlpt_levels || []).includes(jl)) return false;
    const gnorm = item.grade_norm || item.grade || "";
    if (gr && gnorm !== gr) return false;
    if (rsel){
      const [s,e] = rsel.split("-").map(n => parseInt(n,10));
      if (!(item.__no >= s && item.__no <= e)) return false;
    }
    return true;
  });

  // 2) クエリが空 ＆ 番号レンジも空 → 番号昇順
  if (!restTerms.length && !ranges.length){
    list.sort((a,b) => (a.__no||0) - (b.__no||0));
    renderList(list);
    return;
  }

  // 3) 「番号レンジ」指定（クエリ内）をさらに適用（OR結合）
  if (ranges.length){
    list = list.filter(x => ranges.some(([s,e]) => x.__no >= s && x.__no <= e));
  }

  // 4) 用語（残りの語）で優先度付きスコアリング（AND）
  if (restTerms.length){
    const scored = [];
    for (const x of list){
      const sc = scoreRowForTerms(x, restTerms);
      if (sc > 0) {
        // 検索時のみ履歴ブースト（開いているのが履歴パネル以外なら適用）
        let hist = 0, boost = 0;
        if (!isOpen(els.historyPanel)) {
          hist = getViewCount(String(x.id)) || 0;
          boost = Math.min(300, Math.round(Math.log1p(hist) * 120));
        }
        scored.push({ x, sc: sc + boost, hist })
      }
    }
    // 並び替え：総合スコア降順 → 履歴多い順 → 番号昇順
    scored.sort((a,b) => (b.sc - a.sc) || (b.hist - a.hist) || ((a.x.__no||0)-(b.x.__no||0)));
    renderList(scored.map(s => s.x), { showBadge: !isOpen(els.historyPanel) });
  } else {
    // （クエリ空のときは従来どおり番号昇順）
    list.sort((a,b) => (a.__no||0) - (b.__no||0));
    renderList(list, { showBadge: false });
  }
}

// common.js の renderList を丸ごと置換
export function renderList(arr, opts = { showBadge:false }){
  const listEl = document.querySelector("#list"); // ★その場で再取得
  if (!listEl) {
    console.warn("[common] #list が無いページなので一覧描画はスキップします");
    return;
  }
  listEl.innerHTML = (arr||[]).map(x => cardHTML(x, opts)).join("");
  listEl.querySelectorAll(".card").forEach((el, idx)=>{
    const x = arr[idx];
    el.addEventListener("click", ()=> openDetail(x));
  });
}


// 既存 cardHTML を置き換え（第2引数で制御）
export function cardHTML(x, opts = {}) {
  const { showBadge = false } = opts;

  // ★ 漢字番号（__no を優先、なければ id を数値に）
  const noVal = Number.isFinite(x?.__no)
    ? x.__no
    : Number.isFinite(parseInt(x?.id, 10))
      ? parseInt(x.id, 10)
      : null;
  const noText  = Number.isFinite(noVal) ? String(noVal).padStart(4, "0") : "";
  const noBadge = noText
    ? `<span class="badge badge-no">No.${noText}</span>`
    : "";

  // JLPT
  let jl = "";
  if (isApplicableTagValue(x?.jlpt)) {
    jl = `<span class="badge">JLPT ${escapeHTML(x.jlpt)}</span>`;
  }

  // 学年
  let gd = "";
  const gradeSrc =
    isApplicableTagValue(x?.grade_norm) ? x.grade_norm :
    (isApplicableTagValue(x?.grade) ? x.grade : "");
  if (gradeSrc) {
    gd = `<span class="badge">${escapeHTML(gradeSrc)}</span>`;
  }

  // 画数
  const st = (x?.strokes != null)
    ? `<span class="badge">${x.strokes}画</span>`
    : "";

  let hist = "";
  if (showBadge) {
    const cnt = (x.__histCount ?? getViewCount(String(x.id)) ?? 0);
    if (cnt > 0) hist = `<span class="hist-badge" aria-label="閲覧回数">${cnt}</span>`;
  }

  // ★ 1段目のメタに「No.0001」バッジを混ぜる
  const metaRow1 = [noBadge, jl, gd, st].filter(Boolean).join("");

  return `
    <div class="card" data-id="${escapeAttr(x?.id)}">
      ${hist}
      <div class="kanji">${escapeHTML(x?.char||"")}</div>
      <div class="meta">${metaRow1}</div>
      <div class="meta">${escapeHTML((x?.on||[]).join("・"))}</div>
      <div class="meta">${escapeHTML((x?.kun||[]).join("・"))}</div>
    </div>
  `;
}


/* ===================== 履歴用 ===================== */
function renderHistoryGrid(){
  const { historyGrid, historyFilter } = els;
  if (!historyGrid) return;

  const hist = listHistory(); // [{id,count,last}]
  if (!hist.length){
    historyGrid.innerHTML = `<p class="muted">履歴はまだありません。</p>`;
    return;
  }

  const byId = new Map(getData().map(r => [String(r.id), r]));
  // 履歴エントリを元データにマージ
  const rows = hist.map(h => {
    const base = byId.get(String(h.id));
    if (!base) return null;
    return { ...base, __histCount: h.count, __last: h.last };
  }).filter(Boolean);

  // 並べ替え
  const mode = historyFilter?.value || "count_desc";
  if (mode === "count_desc"){
    rows.sort((a,b) => (b.__histCount - a.__histCount) || ((a.__no||0)-(b.__no||0)));
  } else if (mode === "recent_desc"){
    rows.sort((a,b) => (b.__last - a.__last) || ((a.__no||0)-(b.__no||0)));
  } else if (mode === "id_asc"){
    rows.sort((a,b) => ((a.__no||0) - (b.__no||0)));
  }

  // 履歴カードだけ右上バッジを表示
  historyGrid.innerHTML = rows.map(row => cardHTML(row, { showBadge:true })).join("");

  historyGrid.querySelectorAll(".card").forEach(el=>{
    const id = el.getAttribute("data-id");
    const hit = getData().find(x=> String(x.id) === String(id));
    if (hit) el.addEventListener("click", ()=> openDetail(hit));
  });
}
function initHistoryFilterOnce(){
  const sel = els.historyFilter;
  if (!sel || sel.dataset.ready) return;
  sel.dataset.ready = "1";
  sel.innerHTML = `
    <option value="count_desc">回数順（多い→少ない）</option>
    <option value="recent_desc">最近見た順（新→旧）</option>
    <option value="id_asc">漢字番号順（小→大）</option>
  `;
  sel.value = "count_desc";
  sel.addEventListener("change", renderHistoryGrid);
}

document.querySelector("#historySort")?.addEventListener("change", renderHistoryGrid);
document.addEventListener("history:changed", renderHistoryGrid); // 変化に追随

/* ===================== 詳細モーダル ===================== */
// ★ ヘッダーを作る（引数なし／一度だけ）
function buildDetailHeaderOnce() {
  const dlg = els.dlg;
  if (!dlg || dlg.dataset.headReady) return;

  let btn = dlg.querySelector(".close");
  if (!btn) {
    btn = document.createElement("button");
    btn.className = "close";
    btn.textContent = "×";
    btn.setAttribute("aria-label", "閉じる");
  }

  const head = document.createElement("div");
  head.className = "d-head";
  head.appendChild(btn);

  const firstChild = dlg.firstElementChild;
  if (!firstChild || !firstChild.classList.contains("d-head")) {
    dlg.insertBefore(head, firstChild || null);
  }

  dlg.dataset.headReady = "1";
}

export function setupDetailDialog(rec){
  const { dlg, strokeArea } = els;
  if (!dlg) return;

  buildDetailHeaderOnce?.();

  // ✅ 1) クリック委譲：.close が押されたら必ず閉じる
  dlg.addEventListener("click", (ev) => {
    if (ev.target.closest(".close")) {
      ev.preventDefault();
      ev.stopPropagation();
      safeCloseDialog(dlg);
    }
  });

  // ✅ 2) ESCで閉じられない環境への保険
  dlg.addEventListener("cancel", (ev) => {
    ev.preventDefault();
    safeCloseDialog(dlg);
  });

  // 閉じたら筆順領域をクリア
  dlg.addEventListener("close", () => {
    strokeArea && (strokeArea.innerHTML = "");
  });

  // ヘッダー半透明のスクロール状態更新
  const wrap = dlg.querySelector(".d-wrap");
  const onScroll = () => {
    const y = (wrap?.scrollTop || 0);
    dlg.classList.toggle("is-scrolled", y > 4);
  };
  wrap?.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ★ rec が渡された時だけレイアウト構築（互換性のため）
  if (rec) buildDetailLayoutOnce?.(rec);
}

/* === フェールセーフで確実に閉じる === */
function safeCloseDialog(dlg){
  try { if (typeof dlg.close === "function") dlg.close(); } catch (_) {}
  if (dlg.hasAttribute("open")) dlg.removeAttribute("open");
}

/**
 * ダイアログ内部を
 *  左: [漢字カード] → [書き順カード] → [書き取りボタン]
 *  右: [メタ情報]
 *  下: [熟語], [例文]
 * に再配置（初回のみ）
 */
function buildDetailLayoutOnce(rec){
  const dlg = els.dlg;
  const wrap = dlg?.querySelector(".d-wrap");
  if (!wrap || wrap.dataset.ready) return;

  const dKanji   = els.dKanji;
  const dMeta    = els.dMeta;
  const dStroke  = wrap.querySelector(".d-stroke");
  const dComp    = els.dComp;

  // ===== コンテナ生成 =====
  const left    = document.createElement("div"); left.className = "d-left";
  const right   = document.createElement("div"); right.className = "d-right";
  const bottom  = document.createElement("div"); bottom.className = "d-bottom";

  // 左: 漢字カード
  const kanjiCard = document.createElement("div");
  kanjiCard.className = "d-card d-kanji-card";
  kanjiCard.append(dKanji);

  // ★ 漢字番号ラベル + 漢字カードのブロックを作る
  const kanjiBlock = document.createElement("div");
  kanjiBlock.className = "d-kanji-block";

  const noLabel = document.createElement("div");
  noLabel.className = "d-no-label";       // ← ここに「No.0001」を入れる
  kanjiBlock.append(noLabel, kanjiCard);


  // 左: 書き順カード（中にボタンも含める）
  if (dStroke) {
    dStroke.classList.add("d-card", "d-stroke-card");

    // ★ rec から必要情報を取得
    const kanjiNo4  = String(rec?.["漢字番号"] ?? rec?.id ?? "").padStart(4,"0");
    const kanjiChar = String(rec?.["漢字"] ?? rec?.char ?? "");

    // カードにも保持（近傍から参照できるように）
    dStroke.dataset.kanjiNo   = kanjiNo4;
    dStroke.dataset.kanjiChar = kanjiChar;

    const btnWrite = document.createElement("button");
    btnWrite.id = "btn-write";
    btnWrite.className = "btn-primary";
    btnWrite.style.width = "100%";
    btnWrite.style.marginTop = "12px";
    btnWrite.textContent = "漢字書き取り";

btnWrite.addEventListener("click", (ev) => {
  const card  = ev.currentTarget.closest(".d-stroke-card");
  const modal = document.getElementById('detail');
  const id4   = card?.dataset.kanjiNo   ?? modal?.dataset.kanjiNo   ?? "";
  const kanji = card?.dataset.kanjiChar ?? modal?.dataset.kanjiChar ?? "";
  if (!id4 || !kanji) return;

  // 戻り先 URL（?detail=xxxx を付与）
  const backUrl = new URL(window.location.href);
  backUrl.searchParams.set("detail", id4);

  // ドメイン + ルートを起点に絶対URLを作る
  const baseAbs = new URL("/kanji2200v2/kanji2200/", window.location.origin);
  const url     = new URL("kakitori/kakijyun.html", baseAbs); // ← ここで絶対URL

  // クエリ付与
  url.searchParams.set("id", id4);
  url.searchParams.set("kanji", kanji);
  url.searchParams.set("back", backUrl.toString());

  window.location.assign(url.toString());
});




    dStroke.append(btnWrite);
  }

  // 右: メタカード
  const metaCard = document.createElement("div");
  metaCard.className = "d-card d-meta-card";
  metaCard.innerHTML = `<h3>詳細</h3>`;  // 先にタイトルだけ入れる
  metaCard.appendChild(dMeta);          // そのあとに dMeta ノードを移動

  // 下: 熟語／例文
  const compSection = document.createElement("div");
  compSection.className = "d-comp-wrap";
  compSection.style.gridColumn = "1 / -1";
  // ★ 見出しを外側（wrap）に置く
  const compH3 = document.createElement("h3");
  compH3.textContent = "熟語";
  dComp.classList?.add?.("d-comp");
  compSection.append(compH3, dComp);

  const exampleSection = document.createElement("section");
  exampleSection.className = "d-example";
  exampleSection.style.gridColumn = "1 / -1";
  exampleSection.innerHTML = `
    <h3>例文</h3>
    <div id="example-area"></div>
  `;

  // ===== 組み立て =====
  left.append(kanjiBlock);          // ★ ここを kanjiBlock に
  if (dStroke) left.append(dStroke);
  right.append(metaCard);
  // ★ 例文を上、熟語を下
  bottom.append(exampleSection, compSection);


  wrap.innerHTML = "";
  wrap.append(left, right, bottom);
  wrap.dataset.ready = "1";

  // 💡 SP／PC順序切替
  function rearrangeDetailLayout() {
    const isSP = window.innerWidth <= 768;
    wrap.innerHTML = "";
    if (isSP) {
      // スマホ：縦順（例文 → 熟語）
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "16px";
      // ★ ここ
      wrap.append(kanjiBlock, metaCard, dStroke, exampleSection, compSection);
    } else {
      // PC：左右＋下段（下段も例文 → 熟語）
      wrap.style.display = "grid";
      wrap.style.gridTemplateColumns = "340px 1fr";
      wrap.style.gap = "24px";
      const leftCol = document.createElement("div");
      leftCol.className = "d-left";
      // ★ ここも
      leftCol.append(kanjiBlock, dStroke);
      const rightCol = document.createElement("div");
      rightCol.className = "d-right";
      rightCol.append(metaCard);
      const bottomRow = document.createElement("div");
      bottomRow.className = "d-bottom";
      bottomRow.append(exampleSection, compSection);
      wrap.append(leftCol, rightCol, bottomRow);
    }
  }


  rearrangeDetailLayout();
  window.addEventListener("resize", rearrangeDetailLayout);
}

// ★ 最初に見つかった例文（HTMLのまま）を返す
function pickFirstExampleHTML(x){
  if (!x) return "";
  const arr = Array.isArray(x.examples_html) ? x.examples_html : [];
  return arr.find(s => String(s).trim()) || "";
}

// ★ タグ表示してよい値かどうか判定（空・対象外・なし・- などは非表示）
function isApplicableTagValue(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  if (s === "-" || s === "―") return false;
  if (/対象外|なし/i.test(s)) return false;  // 「対象外」「なし」など
  return true;
}



export function openDetail(x){
  const { dlg, dKanji, dMeta, dComp, strokeArea } = els;
  if (!x || !dlg) return;

  // dataset にも保存（ボタンクリック時の保険）
  dlg.dataset.kanjiNo   = String(x?.id ?? x?.["漢字番号"] ?? "").padStart(4, "0");
  dlg.dataset.kanjiChar = String(x?.char ?? x?.["漢字"] ?? "");

  setupDetailDialog(x); // ヘッダー構築＋レイアウト構築（引数で渡す）

  bumpViewCount(String(x.id));

    // ★ 漢字番号ラベルに表示
  const id4 = dlg.dataset.kanjiNo || "";
  const noLabel = dlg.querySelector(".d-no-label");
  if (noLabel) {
    noLabel.textContent = id4 ? `No.${id4}` : "";
  }

  // 左: 漢字
  dKanji.textContent = x.char || "";


  // 左: 漢字
  dKanji.textContent = x.char || "";

  // === タグ群 ===
  const tags = [];

  // 学年：grade_norm 優先、なければ grade。ただし「対象外」「なし」などは除外
  const gradeSrc =
    isApplicableTagValue(x.grade_norm) ? x.grade_norm :
    (isApplicableTagValue(x.grade) ? x.grade : "");
  // 常用漢字フラグ
  if (x.joyo) {
    tags.push(`<span class="badge">常用</span>`);
  }

  if (gradeSrc) {
    tags.push(`<span class="badge">${escapeHTML(gradeSrc)}</span>`);
  }

  // 漢検：級数が「対象外」「なし」などの場合は表示しない
  if (isApplicableTagValue(x.kanken)) {
    tags.push(`<span class="badge">漢検${escapeHTML(x.kanken)}</span>`);
  }
  
  // JLPT：N1〜N5 以外（対象外・なしなど）は表示しない
  if (isApplicableTagValue(x.jlpt)) {
    tags.push(`<span class="badge">${escapeHTML(x.jlpt)}</span>`);
  }


// === メタ情報 ===
const meaningsJaHTML = (x.meanings_ja || []).join("、");
const meaningsEnText = (x.meanings_en || []).join(", ");

dMeta.innerHTML = `
  <div class="tags-row" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
    ${tags.join("") || ""}
  </div>
  <div class="row">
    部首: ${escapeHTML(x.radical || "-")}
    ／画数: ${x.strokes ?? "-"}
    ／人名: ${x.jinmei ? "○" : "-"}
  </div>  <div class="row">音: ${escapeHTML((x.on||[]).join("・"))}</div>
  <div class="row">訓: ${escapeHTML((x.kun||[]).join("・"))}</div>
  <!-- ★ここだけ escapeHTML を使わない -->
  <div class="row">意味: ${meaningsJaHTML || "-"}</div>
  <div class="row">Meanings: ${escapeHTML(meaningsEnText)}</div>
`;

  // === 書き順画像 ===
  strokeArea.innerHTML = "";
  if (x.image_stroke && String(x.image_stroke).trim()) {
    const img = new Image();
    img.alt = "書き順";
    img.loading = "lazy";
    img.decoding = "async";
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

// === 熟語 ===
const allComps   = Array.isArray(x.compounds) ? x.compounds : [];
const noExample  = allComps.filter(c =>
  !c.example_html || !String(c.example_html).trim()
);

dComp.innerHTML =
  noExample.map(c => {
    const w = String(c.word || "");
    const y = String(c.reading || "");

    // 熟語x読みはルビに
    const wordRuby = y
      ? `<ruby><rb>${escapeHTML(w)}</rb><rt>${escapeHTML(y)}</rt></ruby>`
      : escapeHTML(w);

    // 仕様どおり「熟語x」だけ表記
    return `
      <div class="comp">
        ${wordRuby}
      </div>
    `;
  }).join("");

  // === 例文 ===
  const exArea = els.dlg.querySelector("#example-area");
  if (exArea) {
    // 熟語の中から「例文あり」のものだけ取り出す
    const comps = Array.isArray(x.compounds) ? x.compounds : [];
    const withEx = comps.filter(c => c.example_html && String(c.example_html).trim());

    if (withEx.length) {
      exArea.innerHTML = withEx.map(c => {
        const w  = String(c.word || "");
        const y  = String(c.reading || "");
        const r  = String(c.romaji || "");
        const en = String(c.en || "");
        const ex = c.example_html || "";

        // 熟語x + 熟語x読み をルビにする
        const wordRuby = y
          ? `<ruby><rb>${escapeHTML(w)}</rb><rt>${escapeHTML(y)}</rt></ruby>`
          : escapeHTML(w);

        return `
          <div class="d-card d-example-card">
            <div class="example-head">
              <span class="example-word">【 <strong>${wordRuby}</strong></span>
              ${r  ? `<span class="example-romaji">${escapeHTML(r)} 】</span>` : ""}
              ${en ? `<span class="example-en">${escapeHTML(en)}</span>` : ""}
                            ${ex}

            </div>
            <div class="example-card-body">
            </div>
          </div>
        `;
      }).join("");
    } else {
      exArea.innerHTML = `<span class="muted">（例文なし）</span>`;
    }
  }

  dlg.showModal?.();

  if (isOpen(els.historyPanel)) renderHistoryGrid();
}

// 4桁ゼロ埋め
function pad4(n){ return String(n).padStart(4, "0"); }

// ★ 漢字番号から詳細を開く（word は曖昧時の絞り込みに使用）
window.openDetailByNo = function(no, wordOpt){
  const data = getData?.() || [];
  if (!Array.isArray(data) || !data.length) {
    console.warn("[common] データ未読込のため詳細を開けません");
    return;
  }
  const n = parseInt(no, 10);
  const id4 = pad4(n);

  // id / __no のいずれかで一致、必要なら word で絞る
  let hit = data.find(r =>
    String(r.id) === id4 ||
    String(r.id) === String(n) ||
    r.__no === n
  );

  if (!hit && wordOpt) {
    hit = data.find(r =>
      (String(r.id) === id4 || String(r.id) === String(n) || r.__no === n) &&
      Array.isArray(r.compounds) && r.compounds.some(c => c.word === wordOpt)
    );
  }

  // 最終フォールバック：単語一致
  if (!hit && wordOpt) {
    hit = data.find(r =>
      Array.isArray(r.compounds) && r.compounds.some(c => c.word === wordOpt)
    );
  }

  if (hit) return openDetail(hit);
  console.warn("[common] 詳細対象が見つかりませんでした no:", no, "word:", wordOpt);
};


// ====== Back-to-Top button ======
(function setupBackToTop(){
  const btn = document.createElement('button');
  btn.className = 'backtotop';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'ページ上部へ戻る');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 5l7 7-1.4 1.4L13 8.8V20h-2V8.8L6.4 13.4 5 12z"/>
    </svg>
  `;
  document.body.appendChild(btn);

  const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // しきい値：300px超スクロールで表示
  const THRESHOLD = 300;

  function onScroll(){
    const y = window.pageYOffset || document.documentElement.scrollTop || 0;
    btn.classList.toggle('is-visible', y > THRESHOLD);
    // 一覧ブロック追従のための位置調整（PC）
    positionNearList();
  }

  // 一覧ブロックの右肩に沿わせる（PCのみ目安）
  function positionNearList(){
    const listSection = document.querySelector('#listSection') || document.querySelector('#list');
    if (!listSection) { btn.classList.remove('follow-list'); return; }

    const vpW = window.innerWidth;
    const rect = listSection.getBoundingClientRect();
    const pageX = rect.left + window.pageXOffset;
    const pageR = rect.right + window.pageXOffset;

    // コンテンツ幅が十分あれば“右肩外側”に寄せる
    const margin = 12;               // 一覧の右から少し離す
    const bottom = 24;               // 画面下からの距離
    const btnW = 44;

    if (vpW >= 992 && rect.width >= 480) {
      btn.classList.add('follow-list');
      // 右端に合わせる。ただし画面外に出ないようクランプ
      let left = pageR - btnW - margin;
      const minLeft = window.pageXOffset + 16;
      const maxLeft = window.pageXOffset + vpW - btnW - 16;
      left = Math.max(minLeft, Math.min(left, maxLeft));

      // スクロール分を足して座標指定
      btn.style.left = `${left}px`;
      btn.style.right = 'auto';
      btn.style.bottom = `${bottom}px`;
    } else {
      // SPは右下固定
      btn.classList.remove('follow-list');
      btn.style.left = 'auto';
      btn.style.right = '16px';
      btn.style.bottom = '16px';
    }
  }

  // クリックで上部へ
  btn.addEventListener('click', ()=>{
    const behavior = prefersReduce ? 'auto' : 'smooth';
    window.scrollTo({ top: 0, behavior });
  });

  // 初期 & イベント
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', positionNearList);
  // フォントや画像レイアウト後にも位置調整
  window.addEventListener('load', positionNearList);
  setTimeout(()=>{ onScroll(); }, 0);
})();

/* ===================== 小ユーティリティ ===================== */
export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
export function escapeAttr(s){ return String(s ?? "").replace(/"/g, "&quot;"); }




// === common.js の末尾に追加（openDetail定義の“後”） ===
try {
  window.openDetail = openDetail;   // グローバル公開
  console.log("[common] window.openDetail =", typeof window.openDetail);
} catch (e) {
  console.warn("[common] openDetail bind failed:", e);
}

document.addEventListener("kanji:open-detail", (e) => {
  const { no, word } = e.detail || {};
  if (typeof window.openDetailByNo === "function") {
    window.openDetailByNo(no, word);
  }
});