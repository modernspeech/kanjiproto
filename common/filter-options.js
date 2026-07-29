// /common/filter-options.js（差し替え版）
(() => {
  // 既定（管理者や有料コース用）
  const DEFAULT_LEVELS = ["初級", "中級", "上級", "超級", "面接対応"];
  const DEFAULT_TYPES  = ["二択", "単体"];        // 既存を踏襲
  // free 制限
  const FREE_LEVELS = ["初級", "中級", "上級", "超級"];
  const FREE_TYPES  = ["二択"];

  // 他JSがフィルターを上書きしないよう固定（themes.js / home-themes.js が参照）
  window.USE_STATIC_FILTERS = true;

  // 既存の authFetch / API_BASE があれば流用
  async function af(url, opts = {}) {
    opts.headers = opts.headers || {};
    const t = localStorage.getItem('authToken') || '';
    if (t) opts.headers.Authorization = `Bearer ${t}`;
    const base = window.API_BASE || "https://my-api-436216861937.asia-northeast1.run.app";
    if (url.startsWith('/')) url = base + url;
    return fetch(url, opts);
  }

  // /api/theme-options があればそれを使う（サーバが最終判断）
  async function getAllowed(){
    try{
      const r = await af('/api/theme-options', { cache:'no-cache' });
      if (r.ok){
        const { role, course, levels, types } = await r.json();
        // サーバが返す配列をそのまま使う（admin/owner は完全解放のはず）
        return { role, course, levels, types };
      }
    }catch(_){}
    // フォールバック：JWT内の role / course_id を見る
    const p = parseJwt();
    const role   = p.role || 'user';
    const course = (p.course_id || 'free').toLowerCase();
    if (role === 'admin' || role === 'owner' || course !== 'free') {
      return { role, course, levels: DEFAULT_LEVELS, types: DEFAULT_TYPES };
    }
    return { role, course, levels: FREE_LEVELS, types: FREE_TYPES };
  }

  function fillAll(selector, items, allLabel) {
    document.querySelectorAll(selector).forEach(sel => {
      if (!(sel instanceof HTMLSelectElement)) return;
      const prev = sel.value || "";
      sel.innerHTML = `<option value="">${allLabel}</option>` +
        items.map(v => `<option value="${v}">${v}</option>`).join("");
      if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    });
  }

  function parseJwt(){
    const t = localStorage.getItem('authToken'); if(!t) return {};
    try{
      const b = t.split('.')[1] || '';
      const pad = '='.repeat((4 - (b.length % 4)) % 4);
      const json = atob((b + pad).replace(/-/g,'+').replace(/_/g,'/'));
      return JSON.parse(decodeURIComponent(escape(json)));
    }catch{ return {}; }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const { levels, types } = await getAllowed();
    // data-filter="level"/"type" と既存IDの両方を埋める
    fillAll('select[data-filter="level"], #filterLevel, #fLevel', levels, "全てのLV");
    fillAll('select[data-filter="type"],  #filterType,  #fType',  types,  "全てのタイプ");
  });
})();
