// history.js  ← ES Modules 前提（HTML側からは直接読み込まない）
const LS_KEY = "kanji2200_history_v1"; // id -> {count, last}

function readMap(){
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(LS_KEY) || "{}"))); }
  catch { return new Map(); }
}
function writeMap(map){
  const obj = Object.fromEntries(map);
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

export function bumpViewCount(id){
  if (!id) return;
  const key = String(id);
  const m = readMap();
  const cur = m.get(key) || { count: 0, last: 0 };
  cur.count += 1;
  cur.last = Date.now();
  m.set(key, cur);
  writeMap(m);

  // 任意：画面側が自動更新できるようにイベント発火
  document.dispatchEvent(new CustomEvent("history:changed", { detail: { id: key, ...cur }}));
}

export function getViewCount(id){
  if (!id) return 0;
  const rec = readMap().get(String(id));
  return rec?.count || 0;
}

export function listHistory(){
  const m = readMap();
  // [{id, count, last}] を返す
  return [...m.entries()].map(([id, v]) => ({ id, count: v.count|0, last: v.last|0 }));
}

// もしグローバルからも使いたい場合だけ、上書きなしでアタッチ
if (typeof window !== "undefined") {
  window.HISTORY_API ||= {
    bumpViewCount,
    getViewCount,
    listHistory,
  };
}
