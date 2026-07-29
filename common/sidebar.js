// /common/sidebar.js — 管理者判定を強化した完全版
(() => {
  "use strict";

  const DEBUG = true; // 必要なければ false

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    const mount = document.getElementById("siteSidebar");
    if (!mount) return;

    const src =
      mount.getAttribute("data-sidebar-src") ||
      "/common/sidebar.html";

    try {
      const res = await fetch(src, { credentials: "include", cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mount.innerHTML = await res.text();

      // ★ ここで付録アコーディオンの保存状態をリセット
      try { localStorage.removeItem('acc:furoku'); } catch {}

            // ← ここに追記（HTMLを入れた“直後”に初期化する）
      setupActiveState(mount);
      setupFurokuAccordion(mount);
    } catch (e) {
      console.error("Sidebar load failed:", e);
      mount.innerHTML = `<div style="padding:12px;color:#b91c1c;">サイドバーの読み込みに失敗しました</div>`;
      return;
    }

    // 役割を検出して表示制御
    const role = detectCurrentRole();
    if (DEBUG) console.log("[sidebar] detected role:", role);
    applyRoleVisibility(role);

    // 例：sidebar.js の init() の末尾
    window.__initSidebarMessages && window.__initSidebarMessages();
  }

  /** 役割検出（できるだけ多くの場所を見にいく） */
  function detectCurrentRole() {
    // 0) デバッグ用オーバーライド (?forceRole=admin)
    const q = new URLSearchParams(location.search);
    const force = q.get("forceRole");
    if (force) return normalizeRole(force);

    // 1) JWT (localStorage.authToken)
    const token = localStorage.getItem("authToken");
    if (token && token.split(".").length === 3) {
      try {
        const payload = JSON.parse(base64UrlDecode(token.split(".")[1]));
        // 1-1) role 文字列
        if (typeof payload.role === "string") return normalizeRole(payload.role);
        // 1-2) roles 配列
        if (Array.isArray(payload.roles) && payload.roles.length) {
          const norm = payload.roles.map(normalizeRole);
          if (norm.includes("admin")) return "admin";
          if (norm.includes("user"))  return "user";
          return norm[0];
        }
        // 1-3) isAdmin 真偽
        if (payload.isAdmin === true) return "admin";
      } catch (e) {
        if (DEBUG) console.warn("[sidebar] JWT parse fail:", e);
      }
    }

    // 2) localStorage.userRole（ログイン時に保存している想定）
    const lsRole = localStorage.getItem("userRole");
    if (lsRole) return normalizeRole(lsRole);

    // 3) localStorage.userProfile（{ role: "...", isAdmin: true } など）
    try {
      const profile = JSON.parse(localStorage.getItem("userProfile") || "null");
      if (profile) {
        if (typeof profile.role === "string") return normalizeRole(profile.role);
        if (profile.isAdmin === true) return "admin";
      }
    } catch {}

    // 既定は "user"
    return "user";
  }

  /** data-requires-role の要素を出し分け */
  function applyRoleVisibility(currentRole) {
    const els = document.querySelectorAll("[data-requires-role]");
    els.forEach(el => {
      const required = (el.getAttribute("data-requires-role") || "").trim().toLowerCase();

      // カンマ区切り対応（例: "admin,manager"）
      const list = required.split(",").map(s => s.trim()).filter(Boolean);
      const ok = list.length ? list.some(req => hasRole(currentRole, req)) : true;

      if (!ok) {
        el.style.display = "none";
      } else {
        // 念のため表示を戻す（他CSSで非表示にしていた場合に備える）
        if (el.style.display === "none") el.style.display = "";
      }
    });
  }

  /** 要求ロールに対して現在ロールが満たすか */
  function hasRole(current, required) {
    const c = normalizeRole(current);
    const r = normalizeRole(required);
    if (!r) return true;            // 要求なしは誰でもOK
    if (!c) return false;

    // 役割の意味づけ：
    // owner … adminと同等以上
    // admin … 管理者
    // teacher … 自所属ユーザーを管理できる
    // user … 一般ユーザー
    if (r === "owner")   return c === "owner";
    if (r === "admin")   return c === "admin" || c === "owner";      // owner≒admin
    if (r === "teacher") return c === "teacher" || c === "admin" || c === "owner";
    if (r === "user")    return ["user","teacher","admin","owner"].includes(c);
    return c === r;
  }

  /** 文字列/配列/真偽値/大小混在を正規化 */
  function normalizeRole(val) {
    if (val == null) return "";
    if (typeof val === "boolean") return val ? "admin" : "user";
    if (Array.isArray(val)) {
      const norm = val.map(normalizeRole);
      if (norm.includes("admin")) return "admin";
      if (norm.includes("user"))  return "user";
      return norm[0] || "";
    }
    return String(val).trim().toLowerCase();
  }

  /** base64url デコード（atob互換） */
  function base64UrlDecode(b64url) {
    const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
    // decodeURIComponent(escape(atob(...))) は UTF-8 対応の素朴な手
    return decodeURIComponent(escape(atob(b64)));
  }
    // --- ここから追記: アクティブ表示 & 付録アコーディオン --------------------

  function setupActiveState(root) {
    const path = location.pathname;
    // data-match を持つ項目のみを対象（ボタン等の誤検出を防止）
    root.querySelectorAll('.side-item[data-match]').forEach(a => {
      const key = a.getAttribute('data-match');
      if (key && path.includes(key)) a.classList.add('is-active');
    });
  }

  function setupFurokuAccordion(root) {
    const btn = root.querySelector('#acc-furoku');
    const panel = root.querySelector('#panel-furoku');
    if (!btn || !panel) return;

    const KEY = 'acc:furoku';
    const saved = localStorage.getItem(KEY) === '1';

    // chapter- 系ページでは自動的に開く + 保存値優先
    const shouldOpen = saved || location.pathname.includes('chapter-');
    setOpen(shouldOpen);

    btn.addEventListener('click', () => setOpen(panel.hasAttribute('hidden')));

    function setOpen(open) {
      if (open) {
        panel.hidden = false;                   // removeAttribute('hidden') と同義
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('is-open');
        localStorage.setItem(KEY, '1');
      } else {
        panel.hidden = true;                    // setAttribute('hidden','') と同義
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('is-open');
        localStorage.setItem(KEY, '0');
      }
    }
  }

  // --- 追記ここまで -----------------------------------------------------------
  // ★ 「戻る」で BFCache から復帰したときも付録アコーディオンを閉じる
  window.addEventListener('pageshow', (ev) => {
    if (!ev.persisted) return; // BFCache からの復帰でない通常遷移は無視

    try { localStorage.removeItem('acc:furoku'); } catch {}

    const root  = document.getElementById('siteSidebar');
    if (!root) return;
    const btn   = root.querySelector('#acc-furoku');
    const panel = root.querySelector('#panel-furoku');
    if (!btn || !panel) return;

    // 強制的に閉じる
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('is-open');
  });
})();


/* ========== メッセージ（モーダル）— 固定HTML本文を表示（衝突回避の専用クラス版） ========== */
(() => {
  "use strict";

  /* ---- CSS を一度だけ注入（他UIとクラス名衝突しない `.msg-modal*` 専用） ---- */
  function ensureMessageStyles(){
    if (document.getElementById("messages-style")) return;
    const css = `
      .msg-modal{position:fixed;inset:0;display:none;z-index:20000;background:transparent}
      .msg-modal.is-open{display:block}
      .msg-modal__overlay{position:absolute;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(2px)}
      .msg-modal__dialog{position:relative;margin:6vh auto;width:clamp(320px,92vw,720px);max-height:88vh;background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.2);display:flex;flex-direction:column}
      .msg-modal__header{padding:12px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
      .msg-modal__title{font-size:16px;font-weight:700}
      .msg-modal__close{background:transparent;border:0;font-size:20px;line-height:1;cursor:pointer}
      .msg-modal__body{padding:16px 18px;overflow:auto}
      @media (max-width:768px){.msg-modal__dialog{margin:0;width:100vw;height:100vh;max-height:none;border-radius:0}}
      body.msg-modal-open{overflow:hidden}
      .msg-article h3{margin:0 0 8px;font-size:18px}
      .msg-article p{line-height:1.9}
    `;
    const style = document.createElement("style");
    style.id = "messages-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---- モーダルDOMを用意（本文は #messagesBody に流し込む） ---- */
  function ensureMessagesModal(){
    let m = document.getElementById("messagesModal");
    if (m) return m;
    m = document.createElement("div");
    m.id = "messagesModal";
    m.className = "msg-modal";
    m.innerHTML = `
      <div class="msg-modal__overlay" data-close="1"></div>
      <div class="msg-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="messagesTitle">
        <div class="msg-modal__header">
          <div id="messagesTitle" class="msg-modal__title">メッセージ</div>
          <button class="msg-modal__close" data-close="1" aria-label="閉じる">×</button>
        </div>
        <div class="msg-modal__body">
          <article id="messagesBody" class="msg-article"></article>
        </div>
      </div>
    `;
    document.body.appendChild(m);

    m.addEventListener("click", (e)=>{ if (e.target && e.target.closest("[data-close]")) closeMessages(); });
    document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") closeMessages(); });

    return m;
  }

  function openMessages(){
    ensureMessageStyles();
    ensureMessagesModal().classList.add("is-open");
    document.body.classList.add("msg-modal-open");
  }
  function closeMessages(){
    const m = document.getElementById("messagesModal");
    if (m) m.classList.remove("is-open");
    document.body.classList.remove("msg-modal-open");
  }

  /* ---- 固定本文（このHTMLがそのまま表示されます） ---- */
  const STATIC_MESSAGE_HTML = `
      <h3>徳弘康代（元名古屋大学教授)</h3>
      <p>
漢字は多すぎる。それに漢字の言葉も多すぎる。<br>
どうやって勉強したらいいんだ？と心配する人も多いと思います。<br>
でも、大丈夫。<br>
三省堂『日本語学習のためのよく使う順漢字2200』は漢字が番号付きでよく使う順に並び、漢字ごとに、よく使う言葉も勉強できます。<br>
さらに、この『漢字2200』アプリでは、各漢字の言葉がよく使う順に10段階に分けて示されています。<br>
旧JLPTの級数もついていて、練習問題も充実しています。<br>
また、語数が多く、抽象的な意味のある漢字には、字源と漢字の意味の展開が楽しいイラスト入りで説明されていて、漢字の言葉を効果的に増やせるようになっています。<br>
『漢字2200』の本とアプリで、よく使う漢字のよく使う言葉を心配しないで順番に学んでみてください。<br>
800字ぐらい勉強すると、日本語の文章がはやく読めるようになっている自分に気がつくでしょう。
      </p>
  `;

  function renderStaticMessage(){
    const $body = document.getElementById("messagesBody");
    if (!$body) return;
    $body.innerHTML = STATIC_MESSAGE_HTML.trim();
  }

  /* ---- 右ドロワー等を“だいたい閉じる”汎用処理 ---- */
  function closeRightDrawerIfAny(){
    try{
      const candidates = [
        '#rightMenu', '#offcanvasRight', '#siteRightMenu',
        '.right-drawer', '.offcanvas', '.drawer', '.hamburger-menu', '.menu-panel'
      ];
      document.querySelectorAll(candidates.join(',')).forEach(el => {
        el.classList.remove('is-open','open','active','show');
        el.setAttribute('aria-hidden','true');
      });
      document.querySelectorAll('input[type="checkbox"][id*="menu"],input[type="checkbox"][id*="drawer"]').forEach(cb => { cb.checked = false; });
      document.body.classList.remove('drawer-open','offcanvas-open','menu-open');
      if (window.closeRightMenu) window.closeRightMenu();
    }catch{}
  }

  /* ---- トリガをグローバル委譲（右メニューでも確実に拾う） ---- */
  const MESSAGE_TRIGGER_SELECTOR = [
    '[data-open="messages"]',          // 推奨：右メニュー用
    'a[data-match="messages"]',        // サイドバー/右メニュー共通
    'button[data-match="messages"]',
    'a[href="#messages"]',
    'a.side-item[data-match="messages"]'
  ].join(', ');

  function bindMessagesGlobalDelegation(){
    if (document.documentElement.dataset.boundMessagesGlobal) return;
    document.documentElement.dataset.boundMessagesGlobal = "1";

    document.addEventListener('click', (e) => {
      const trigger = e.target.closest(MESSAGE_TRIGGER_SELECTOR);
      if (!trigger) return;

      e.preventDefault();
      closeRightDrawerIfAny();
      setTimeout(() => {
        openMessages();
        renderStaticMessage();
      }, 30);
    }, true); // captureで先に拾う
  }

  /* ---- init フック：sidebar.js の init() から呼ぶ ---- */
  window.__initSidebarMessages = function initSidebarMessages(){
    ensureMessageStyles();
    ensureMessagesModal();
    bindMessagesGlobalDelegation();
  };
})();