(() => {
  "use strict";

  const SETTINGS_KEY = "kanji2200ReadingSettings";
  const DEFAULTS = {
    questionsPerGroup: 10,
    order: "sequential",
    enforceHiragana: true,
  };
  // 試す候補パス（順番重要）
  const CANDIDATES = [
    "/kanji2200v2/kanji2200/common/setting.html",
    "/kanji2200v2/kanji2200/setting.html",
    "./common/setting.html",
    "../common/setting.html",
    "../../common/setting.html",
    "./setting.html",
    "../setting.html",
    "../../setting.html",
  ];

  // === 公開API ===
  window.openSettings = async function openSettings() {
    let dlg = document.getElementById("settingsDialog");

    // 1) 無ければ取得して挿入（<style>含め template 丸ごと）
    if (!dlg) {
      const { ok, html, url, status } = await fetchFirst(CANDIDATES);
      if (!ok) {
        console.error("[settings] setting.html を取得できませんでした", { status, tried: CANDIDATES });
        alert("設定モーダルを読み込めませんでした。");
        return;
      }
      const tpl = document.createElement("template");
      tpl.innerHTML = html.trim();
      document.body.appendChild(tpl.content.cloneNode(true));
      dlg = document.getElementById("settingsDialog");
      if (!dlg) {
        console.error("[settings] #settingsDialog が setting.html 内に見つかりません", { url });
        alert("設定モーダルの初期化に失敗しました。");
        return;
      }
    }

    // 2) UI反映
    const elQ = dlg.querySelector("#setQuestionsPerGroup");
    const elOrderSeq = dlg.querySelector("input[name='setOrder'][value='sequential']");
    const elOrderRnd = dlg.querySelector("input[name='setOrder'][value='random']");
    const elHira = dlg.querySelector("#setEnforceHiragana");
    const btnSave = dlg.querySelector("#btnSettingsSave");
    const btnCancel = dlg.querySelector("#btnSettingsCancel");
    const btnReset = dlg.querySelector("#btnSettingsReset");
    
    const cur = loadSettings();
    elQ.value = String(cur.questionsPerGroup ?? DEFAULTS.questionsPerGroup);
    (cur.order === "random" ? elOrderRnd : elOrderSeq).checked = true;
    elHira.checked = !!cur.enforceHiragana;

    // イベント
    btnSave?.addEventListener("click", onSave, { once: true });
    btnCancel?.addEventListener("click", onCancel, { once: true });
    btnReset?.addEventListener("click", onReset, { once: true });

    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");

    function onSave() {
      const q = parseInt(elQ.value, 10);
      const next = {
        questionsPerGroup: Number.isFinite(q) && q > 0 ? q : DEFAULTS.questionsPerGroup,
        order: elOrderRnd.checked ? "random" : "sequential",
        enforceHiragana: !!elHira.checked,
      };
      saveSettings(next);
      dlg.close();
      document.dispatchEvent(new CustomEvent("reading:settings-updated", { detail: next }));
    }

    function onCancel() {
      dlg.close();
    }

    function onReset() {
      // ✅ 既定値で保存＋UI更新
      saveSettings({ ...DEFAULTS });
      elQ.value = String(DEFAULTS.questionsPerGroup);
      elOrderSeq.checked = true;
      elOrderRnd.checked = false;
      elHira.checked = true;
      dlg.close();
      document.dispatchEvent(new CustomEvent("reading:settings-updated", { detail: { ...DEFAULTS } }));
    }
  };


  // data-open-settings クリックで開く
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest?.("[data-open-settings]");
    if (!btn) return;
    ev.preventDefault();
    window.openSettings();
  });

  // --- util: 先に取れる setting.html を返す ---
  async function fetchFirst(urls){
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
        if (res.ok) return { ok:true, html: await res.text(), url, status: res.status };
      } catch (e) {
        // 次へ
      }
    }
    return { ok:false, html:"", url:null, status:"not-found" };
  }

  // --- storage ---
  // 保存・読込（安全化）
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw) || {};
      const q = Number(parsed.questionsPerGroup);
      return {
        questionsPerGroup: Number.isFinite(q) && q > 0 ? q : DEFAULTS.questionsPerGroup,
        order: parsed.order === "random" ? "random" : "sequential",
        enforceHiragana:
          typeof parsed.enforceHiragana === "boolean" ? parsed.enforceHiragana : DEFAULTS.enforceHiragana,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings(obj) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULTS, ...obj }));
    } catch (e) {
      console.warn("[settings] 保存に失敗:", e);
    }
  }

  window.readingSettings = { load: loadSettings, save: saveSettings, defaults: DEFAULTS };
})();