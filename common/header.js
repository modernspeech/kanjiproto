// /common/header.js — 共通ヘッダー読込 + LogIn/Out 切替 + モバイルドロワー（委譲対応・完全版）
(() => {
  "use strict";

  const FOCUSABLE =
    'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  let lastFocus = null;
  let logoutDelegationBound = false;

  document.addEventListener("DOMContentLoaded", init);

  // =========================
  // init: ヘッダー読込 → 初期化
  // =========================
  async function init() {
    const host = document.getElementById("siteHeader");
    if (!host) return;

    const src = host.getAttribute("data-header-src") || "/common/header.html";
    try {
      const res = await fetch(src, { credentials: "include", cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      host.innerHTML = await res.text();
    } catch (e) {
      console.error("Header load failed:", e);
      host.innerHTML = `<div style="padding:8px;color:#b91c1c;">ヘッダーの読み込みに失敗しました</div>`;
      return;
    }

    // 先に LogIn/Out リンクを“属性で”整える（イベントは後述の委譲で拾う）
    initAuthLinks();

    // ドロワー初期化（旧 initHamburger 互換も提供）
    window.initHamburger = initHamburgerDrawer;
    initHamburgerDrawer();

    // （重要）ログアウトは委譲で1回だけバインド → クローンにも効く
    bindGlobalLogoutDelegation();
        // 未ログイン時は最小レイアウトに置き換え（PCヘッダー/モバイルドロワー）
    applyGuestMinimalLayout();

  }

  // =========================
  // ログイン状態（JWT exp 優先）
  // =========================
  function isLoggedIn() {
    const t = localStorage.getItem("authToken");
    if (!t) return false;
    const parts = t.split(".");
    if (parts.length !== 3) return true;
    try {
      const payload = JSON.parse(base64UrlDecode(parts[1]));
      if (typeof payload.exp === "number") {
        const now = Math.floor(Date.now() / 1000);
        return payload.exp > now;
      }
      return true;
    } catch {
      return true;
    }
  }

  // =========================
  // LogIn/Out リンク更新（全インスタンス対象）
  // =========================
  function initAuthLinks() {
    // ヘッダー本体にもドロワーのクローンにも対応するため、まとめて取得
    const links = document.querySelectorAll('#authLink, #headerLoginLink, a[data-auth="link"]');
    if (!links.length) return;

    const loggedIn = isLoggedIn();
    links.forEach(link => {
      // 表示テキスト用の候補
      const textNode =
        link.querySelector("[data-auth-text]") ||
        link.querySelector("#authText") ||
        link.querySelector("span");

      // アイコン（任意）
      const useEl = link.querySelector("svg use");

      if (loggedIn) {
        if (textNode) textNode.textContent = "Log Out";
        if (useEl) safeSetUseHref(useEl, "#bi-box-arrow-right");
        link.href = "#";
        link.setAttribute("data-action", "logout");  // ← 委譲ターゲット
      } else {
        if (textNode) textNode.textContent = "Log In";
        if (useEl) safeSetUseHref(useEl, "#bi-box-arrow-in-right");
        link.removeAttribute("data-action");
        link.href = "/login.html";                  // ルート相対で確実に
      }
    });
  }

  // クリック委譲（ログアウト）：クローンでも確実に動作
  function bindGlobalLogoutDelegation(){
    if (logoutDelegationBound) return;
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-action="logout"]');
      if (!a) return;
      e.preventDefault();
      doLogout();
    });
    logoutDelegationBound = true;
  }

  // =========================
  // ドロワー（モバイル用）
  // =========================
  function initHamburgerDrawer() {
    const btn       = document.getElementById("menuToggle");
    let   drawer    = document.getElementById("mobileDrawer");
    const closeBtn  = document.getElementById("drawerClose");
    let   backdrop  = document.getElementById("drawerBackdrop");
    const body      = document.getElementById("drawerBody");
    if (!btn || !drawer || !body) return;

    // ドロワー/Backdrop を body 直下へ（inert の影響を避ける）
    if (drawer.parentElement !== document.body) document.body.appendChild(drawer);
    if (backdrop && backdrop.parentElement !== document.body) document.body.appendChild(backdrop);

    // 中身（ヘッダーナビ + サイドバー）を一度だけ複製
// 中身（ヘッダーナビ + サイドバー）
if (!body.dataset.filled) {
  if (!isLoggedIn()) {
    // ★未ログイン：header.html のサイドバーから data-guest="include" を抽出
    body.innerHTML = ""; // 一旦クリア
    const frag = document.createDocumentFragment();

    // 先頭に Home / Log In を追加（固定）
    const home = document.createElement('a');
    home.className = 'side-item';
    home.href = '/kanji2200v2/kanji2200/index.html';
    home.setAttribute('data-match', 'home');
    home.innerHTML = `<svg class="bi"><use href="#bi-house"/></svg> Home`;
    frag.appendChild(home);

    const login = document.createElement('a');
    login.className = 'side-item';
    login.href = '/login.html';
    login.id = 'drawerLoginLink';
    login.setAttribute('data-auth', 'link');
    login.innerHTML = `<svg class="bi"><use href="#bi-box-arrow-in-right"/></svg> Log In`;
    frag.appendChild(login);

    // サイドバー本体（header.html内）から “印のついた要素” を順番にコピー
    const sidebar = document.getElementById('appSidebar') || document.querySelector('.sidebar,.app-sidebar,.sidebar-sp');
    if (sidebar) {
      sidebar.querySelectorAll('[data-guest="include"]').forEach(node => {
        frag.appendChild(node.cloneNode(true));
      });
    }

    body.appendChild(frag);
   // 付録アコーディオンを有効化（モバイルドロワー内を対象）
   window.__initFurokuAccordion('#mobileDrawer');
   if (window.__initSidebarMessages) window.__initSidebarMessages();
    body.dataset.filled = '1';

    // ログインリンクの表記整合
    initAuthLinks();
  } else {
    // ★ログイン済み：従来どおりクローン
    const frag = document.createDocumentFragment();

    const siteNav = document.getElementById("siteNav");
    if (siteNav) {
      const navClone = siteNav.cloneNode(true);
      navClone.id = "siteNavClone";
      frag.appendChild(navClone);
    }

    const side = document.getElementById("appSidebar")
      || document.querySelector(".sidebar,.app-sidebar,.sidebar-sp");
    if (side) {
      const sideClone = side.cloneNode(true);
      sideClone.id = "appSidebarClone";
      frag.appendChild(sideClone);
    }

    body.appendChild(frag);
    window.__initFurokuAccordion('#appSidebarClone');

    body.dataset.filled = "1";
    initAuthLinks();
  }
}



    const isDesktop = () => window.matchMedia("(min-width:1025px)").matches;

    const onKeydown = (e) => {
      if (e.key === "Escape") close();
      else trapFocus(e, drawer);
    };

    const open = () => {
      if (isDesktop()) return; // PCでは開かない
      lastFocus = document.activeElement;

      drawer.hidden = false;
      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
      btn.setAttribute("aria-expanded", "true");
      if (backdrop) backdrop.hidden = false;

      setBackgroundInertExcept([drawer, backdrop], true);

      const f = firstFocusable(drawer) || closeBtn || btn;
      setTimeout(() => f && f.focus(), 0);

      document.addEventListener("keydown", onKeydown);
    };

    const close = () => {
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
      drawer.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (backdrop) backdrop.hidden = true;

      setBackgroundInertExcept([drawer, backdrop], false);

      document.removeEventListener("keydown", onKeydown);
      (lastFocus && typeof lastFocus.focus === "function" ? lastFocus : btn).focus();
    };

    // 起動時は必ず閉じる（PCで見える事故防止）
    close();

    btn.addEventListener("click", () => {
      drawer.classList.contains("is-open") ? close() : open();
    });
    closeBtn && closeBtn.addEventListener("click", close);
    backdrop && backdrop.addEventListener("click", close);
    window.addEventListener("resize", () => { if (isDesktop()) close(); });
  }

  // =========================
  // ユーティリティ
  // =========================
  function firstFocusable(container) {
    return container.querySelector(FOCUSABLE);
  }

  function trapFocus(e, container) {
    if (e.key !== "Tab") return;
    const items = [...container.querySelectorAll(FOCUSABLE)]
      .filter(el => !el.hasAttribute("disabled") && (el.offsetParent !== null || el.getClientRects().length));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus(); e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus(); e.preventDefault();
    }
  }

  // body 直下の要素を対象に、許可（ドロワー/Backdrop）以外を inert
  function setBackgroundInertExcept(allowedEls, on) {
    const allowedTop = new Set();
    allowedEls.filter(Boolean).forEach(el => {
      let top = el;
      while (top && top.parentElement !== document.body) top = top.parentElement;
      if (top) allowedTop.add(top);
    });
    [...document.body.children].forEach(el => {
      if (allowedTop.has(el)) return;
      if (on) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
  }

  /** <use> の href/xlink:href を安全に更新 */
  function safeSetUseHref(useEl, val) {
    try {
      useEl.setAttribute("href", val);
      useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", val);
    } catch {}
  }

  /** ログアウト */
  function doLogout() {
    try {
      localStorage.removeItem("authToken");
      localStorage.removeItem("userRole");
      localStorage.removeItem("userProfile");
      localStorage.removeItem("selectedPrompt");
    } catch {}
    location.href = "/login.html";
  }

  /** base64url デコード（Unicode安全） */
  function base64UrlDecode(b64url) {
    const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const dec = new TextDecoder("utf-8");
    return dec.decode(bytes);
  }

  // =========================
  // 未ログイン時：PCヘッダーを Home / Log In のみに
  // =========================
  function applyGuestMinimalLayout() {
    if (isLoggedIn()) return;
    const siteNav = document.getElementById('siteNav');
    if (!siteNav) return;

    siteNav.innerHTML = `
      <a class="nav-item" href="/kanji2200v2/kanji2200/index.html">
        <svg class="bi"><use href="#bi-house"/></svg><span>Home</span>
      </a>
<a href="javascript:void(0)" class="nav-item btn-setting" data-open-settings>
  <svg class="bi"><use href="#bi-gear"/></svg><span>Setting</span>
</a>

      <a class="nav-item" id="headerLoginLink" href="/login.html" data-auth="link">
        <svg class="bi"><use href="#bi-box-arrow-in-right"/></svg>
        <span data-auth-text>Log In</span>
      </a>
    `;
    initAuthLinks();
  }


})();

// ======== 付録アコーディオンの初期化（クローン後対応） ========
window.__initFurokuAccordion = function(rootSelector) {
  const root = document.querySelector(rootSelector);
  if (!root) return;
  const btn = root.querySelector('.side-acc-toggle');
  const panel = root.querySelector('.side-acc-panel');
  if (!btn || !panel) return;

  const saved = localStorage.getItem('acc:furoku:m') === '1';
  const isChapter = location.pathname.includes('/furoku/');
  setOpen(saved || isChapter);

  btn.addEventListener('click', () => setOpen(panel.hasAttribute('hidden')));

  function setOpen(open){
    if (open){
      panel.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('is-open');
      localStorage.setItem('acc:furoku:m','1');
    } else {
      panel.setAttribute('hidden','');
      btn.setAttribute('aria-expanded','false');
      btn.classList.remove('is-open');
      localStorage.setItem('acc:furoku:m','0');
    }
  }
};