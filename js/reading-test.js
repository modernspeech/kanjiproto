// js/reading-test.js
(() => {
  "use strict";

  const DATA_URL = "./data/kanji2200_yomitest.json";
  const GROUP_SIZE = 80; // 漢字番号 80ごとにグループ（1–80, 81–160, ...）

  // ==== ユーザー設定（設定モーダルと連携） ====
  // 既定：10問 / 順番 / ひらがな以外は不正解
  const DEFAULT_SETTINGS = {
    questionsPerGroup: 10,       // 1グループあたりの出題数（0/未設定なら既定の10を適用）
    order: "sequential",         // "sequential" | "random"
    enforceHiragana: true,       // ひらがな以外は不正解として扱う（長音「ー」は許可）
  };
  const SETTINGS_KEY = "kanji2200ReadingSettings";

  // 要素キャッシュ
  const els = {};

  // 状態
  const state = {
    allItems: [],            // 全アイテム（no, word, yomi, meaning）
    groups: [],              // [{ id, startNo, endNo, items }]
    currentGroupIndex: null, // 実行中のグループ index
    currentQuestions: [],    // 出題中の問題配列
    currentIndex: 0,         // 現在の出題インデックス
    answers: [],             // 解答ログ [{ no, word, correctYomi, userAnswer, isCorrect }]
  };

  document.addEventListener("DOMContentLoaded", init);

  // 設定変更の通知を受けたら即反映（次回テスト開始時に効く）
  document.addEventListener("reading:settings-updated", (ev) => {
    try {
      const next = ev.detail || {};
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...next }));
      // 一覧の表示自体は同じだが、questionsPerGroup や order が変わった時に備えて
      // 必要ならここで UI メッセージ等を出すことも可能
    } catch {}
  });

  function $(id) {
    return document.getElementById(id);
  }

  // =========================
  // 初期化
  // =========================
  async function init() {
    Object.assign(els, {
      // ビュー
      viewList: $("view-test-list"),
      viewQuiz: $("view-quiz"),
      viewResult: $("view-result"),

      // テスト一覧
      readingTestList: $("readingTestList"),

      // クイズ
      quizRangeLabel: $("quizRangeLabel"),
      quizQuestionNumberLabel: $("quizQuestionNumberLabel"),
      quizKanjiNoLabel: $("quizKanjiNoLabel"),
      quizWord: $("quizWord"),
      quizAnswerInput: $("quizAnswerInput"),
      quizFeedback: $("quizFeedback"),
      quizProgressBar: $("quizProgressBar"),

      // 結果
      resultRangeLabel: $("resultRangeLabel"),
      // resultScore は旧UIの名残。新UI（ゲージ）では未使用だが後方互換のため残す
      resultScore: $("resultScore") || null,
      resultCount: $("resultCount"),
      resultTableBody: $("resultTableBody"),

      // ボタン
      btnBackToList: $("btnBackToList"),
      btnSubmitAnswer: $("btnSubmitAnswer"),
      btnResultBackList: $("btnResultBackList"),
      btnRetryGroup: $("btnRetryGroup"),
      btnNextGroup: $("btnNextGroup"),
    });

    attachEvents();

    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error("JSON 読み込みエラー");
      const data = await res.json();
      setupData(data);
      renderTestList();                // 一覧描画
      if (window.refreshTestAccordions) window.refreshTestAccordions(); // 高さ/結線同期（保険）
      switchView("list");
    } catch (err) {
      console.error(err);
      if (els.readingTestList) {
        els.readingTestList.textContent = "問題データを読み込めませんでした。";
      }
    }
  }

  // =========================
  // イベント
  // =========================
  function attachEvents() {
    if (els.btnBackToList)
      els.btnBackToList.addEventListener("click", () => switchView("list"));

    if (els.btnResultBackList)
      els.btnResultBackList.addEventListener("click", () => switchView("list"));

    // 決定ボタン
    if (els.btnSubmitAnswer)
      els.btnSubmitAnswer.addEventListener("click", onSubmitAnswer);

    // Enter キー：IME変換確定中は無視、確定後のみ送信（空欄時は無効）
    if (els.quizAnswerInput) {
      let isComposing = false;
      els.quizAnswerInput.addEventListener("compositionstart", () => {
        isComposing = true;
      });
      els.quizAnswerInput.addEventListener("compositionend", () => {
        isComposing = false;
      });
      els.quizAnswerInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !isComposing) {
          ev.preventDefault();
          const val = els.quizAnswerInput.value.trim();
          if (val) onSubmitAnswer();
        }
      });
    }

    if (els.btnRetryGroup)
      els.btnRetryGroup.addEventListener("click", () => {
        if (state.currentGroupIndex != null) startTest(state.currentGroupIndex);
      });

    if (els.btnNextGroup)
      els.btnNextGroup.addEventListener("click", () => {
        if (state.currentGroupIndex == null) return;
        const next = state.currentGroupIndex + 1;
        if (next < state.groups.length) {
          startTest(next);
        } else {
          switchView("list");
        }
      });

    // 結果テーブルの「詳細」ボタン（イベント委任）
    if (els.resultTableBody) {
      document.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-open-detail]");
        if (!btn) return;
        const no = parseInt(btn.getAttribute("data-no"), 10);
        const word = decodeURIComponent(btn.getAttribute("data-word") || "");
        document.dispatchEvent(new CustomEvent("kanji:open-detail", { detail: { no, word } }));
      });
    }
  }

  // =========================
  // データ準備
  // =========================
  function setupData(itemsRaw) {
    const items = itemsRaw
      .map((it) => {
        const noNum = parseInt(it.no, 10);
        if (Number.isNaN(noNum)) return null;
        return {
          no: String(noNum),
          noNum,
          word: it.word || "",
          yomi: it.yomi || "",
          meaning: it.meaning || "",
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.noNum - b.noNum || a.word.localeCompare(b.word, "ja"));

    state.allItems = items;

    // 80件ごとにグループ化
    const map = new Map();
    for (const it of items) {
      const idx = Math.floor((it.noNum - 1) / GROUP_SIZE);
      if (!map.has(idx)) map.set(idx, []);
      map.get(idx).push(it);
    }

    const groupIndexes = [...map.keys()].sort((a, b) => a - b);
    state.groups = groupIndexes.map((idx) => {
      const itemsInGroup = map
        .get(idx)
        .sort((a, b) => a.noNum - b.noNum || a.word.localeCompare(b.word, "ja"));
      const startNo = idx * GROUP_SIZE + 1;
      const endNo = (idx + 1) * GROUP_SIZE;
      return { id: idx, startNo, endNo, items: itemsInGroup };
    });
  }

  // =========================
  // テスト一覧描画
  // =========================
  function renderTestList() {
    const listEl = document.getElementById("readingTestList"); // 毎回取り直す（動的DOMにも対応）
    if (!listEl) {
      console.warn("[reading-test] #readingTestList が見つからないため後で再試行します");
      // 400ms後に1回だけ再試行（必要なら回数を増やしてOK）
      setTimeout(renderTestList, 400);
      return;
    }

    listEl.innerHTML = "";
    state.groups.forEach((g, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "test-item";
      btn.innerHTML = `
        <span class="test-item-no">${i + 1}</span>
        <span class="test-item-label">漢字番号：${g.startNo}〜${g.endNo}</span>
      `;
      btn.addEventListener("click", () => startTest(i));
      listEl.appendChild(btn);
    });

    // アコーディオン（高さ）再同期
    if (window.refreshTestAccordions) window.refreshTestAccordions();
  }

  // =========================
  // 設定ロード（安全化）
  // =========================
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) || {};
      const q = Number(parsed.questionsPerGroup);
      return {
        questionsPerGroup: Number.isFinite(q) && q > 0 ? q : DEFAULT_SETTINGS.questionsPerGroup,
        order: parsed.order === "random" ? "random" : "sequential",
        enforceHiragana:
          typeof parsed.enforceHiragana === "boolean" ? parsed.enforceHiragana : DEFAULT_SETTINGS.enforceHiragana,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  // =========================
  // テスト開始
  // =========================
  function startTest(groupIndex) {
    const group = state.groups[groupIndex];
    if (!group) return;

    state.currentGroupIndex = groupIndex;
    state.currentIndex = 0;
    state.answers = [];

    const settings = loadSettings();

    // ベース問題を取得
    let qs = group.items.slice();

    // 出題順
    if (settings.order === "random") qs = shuffleArray(qs);

    // 出題数制限（0/未設定なら既定10を適用済み）
    if (settings.questionsPerGroup && settings.questionsPerGroup > 0) {
      qs = qs.slice(0, settings.questionsPerGroup);
    }

    state.currentQuestions = qs;

    if (els.quizRangeLabel) {
      els.quizRangeLabel.textContent = `漢字番号：${group.startNo}〜${group.endNo}`;
    }

    showCurrentQuestion();
    switchView("quiz");
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // =========================
  // ビュー切替
  // =========================
  function switchView(mode) {
    const viewList  = document.getElementById("view-test-list");
    const viewQuiz  = document.getElementById("view-quiz");
    const viewResult= document.getElementById("view-result");

    if (viewList)  viewList.classList.toggle("hidden", mode !== "list");
    if (viewQuiz)  viewQuiz.classList.toggle("hidden", mode !== "quiz");
    if (viewResult)viewResult.classList.toggle("hidden", mode !== "result");
  }

  // =========================
  // 出題表示
  // =========================
  function showCurrentQuestion() {
    const idx = state.currentIndex;
    const q = state.currentQuestions[idx];
    if (!q) return;

    els.quizQuestionNumberLabel.textContent = `Q${idx + 1}`;
    els.quizKanjiNoLabel.textContent = `漢字番号 ${q.no}`;
    els.quizWord.textContent = q.word;
    els.quizAnswerInput.value = "";
    els.quizFeedback.textContent = "";

    // 進捗バー
    const total = state.currentQuestions.length || 1;
    const ratio = (idx / total) * 100;
    els.quizProgressBar.style.width = `${ratio}%`;

    els.quizAnswerInput.focus();
  }

  // =========================
  // 文字正規化・チェック
  // =========================
  function normalizeAnswer(s) {
    return forceHiragana((s || "").trim().replace(/\s+/g, ""));
  }

  // ひらがな＋長音記号のみ OK
  function isHiraganaOnly(str) {
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (ch === "ー") continue;
      if (code < 0x3041 || code > 0x3096) return false;
    }
    return str.length > 0;
  }

  // カタカナ/半角カナ → ひらがな（簡易）
  function forceHiragana(str) {
    if (!str) return "";
    let result = "";
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      // 全角カタカナ → ひらがな
      if (code >= 0x30a1 && code <= 0x30f6) {
        result += String.fromCharCode(code - 0x60);
      }
      // 半角カタカナ（簡易） → 全角カタカナ → ひらがな
      else if (code >= 0xff66 && code <= 0xff9d) {
        const zenkaku = String.fromCharCode(code - 0xff66 + 0x30a6);
        const zCode = zenkaku.charCodeAt(0);
        result +=
          zCode >= 0x30a1 && zCode <= 0x30f6
            ? String.fromCharCode(zCode - 0x60)
            : zenkaku;
      }
      // ひらがな
      else if (code >= 0x3041 && code <= 0x3096) {
        result += ch;
      }
      // 長音は維持
      else if (ch === "ー") {
        result += ch;
      }
      // それ以外はそのまま（採点時に弾く）
      else {
        result += ch;
      }
    }
    return result;
  }

  // =========================
  // 解答送信
  // =========================
  function onSubmitAnswer() {
    const idx = state.currentIndex;
    const q = state.currentQuestions[idx];
    if (!q) return;

    const settings = loadSettings();

    const raw = els.quizAnswerInput.value;
    const userNorm = normalizeAnswer(raw);
    const correctNorm = normalizeAnswer(q.yomi);

    if (!userNorm) {
      els.quizFeedback.textContent = "解答を入力してください。";
      els.quizAnswerInput.focus();
      return;
    }

    // 「ひらがな以外は不正解」設定が ON のときのみ厳格チェック
    if (settings.enforceHiragana && !isHiraganaOnly(userNorm)) {
      els.quizFeedback.textContent = "ひらがなで入力してください。";
      els.quizAnswerInput.focus();
      return;
    }

    const isCorrect = userNorm === correctNorm;

    state.answers.push({
      no: q.no,
      word: q.word,
      correctYomi: q.yomi,
      userAnswer: userNorm,
      isCorrect,
    });

    els.quizFeedback.textContent = isCorrect
      ? "正解です！"
      : `不正解です。正解：${q.yomi}`;

    const nextIndex = idx + 1;
    if (nextIndex < state.currentQuestions.length) {
      state.currentIndex = nextIndex;
      setTimeout(showCurrentQuestion, 600);
    } else {
      setTimeout(showResult, 600);
    }
  }

  // =========================
  // ドーナツゲージ（共通で使い回し可能）
  // =========================
  // el: data-gauge を持つ要素、percent: 0-100
  function updateGauge(el, percent) {
    if (!el) return;
    const circle = el.querySelector(".g-progress");
    const textEl = el.querySelector("[data-score]");
    if (!circle) return;

    const r = parseFloat(circle.getAttribute("r") || "54");
    const C = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, percent));

    circle.style.strokeDasharray = `${C} ${C}`;
    circle.style.strokeDashoffset = `${C * (1 - p / 100)}`;

    if (textEl) textEl.textContent = String(Math.round(p));
  }

  // =========================
  // 結果表示
  // =========================
  function showResult() {
    const group = state.groups[state.currentGroupIndex];
    if (!group) return;

    const total = state.answers.length;
    const correctCount = state.answers.filter((a) => a.isCorrect).length;
    const score = Math.round((correctCount / (total || 1)) * 100);

    // 範囲・件数
    if (els.resultRangeLabel) {
      els.resultRangeLabel.textContent = `漢字番号：${group.startNo}〜${group.endNo}`;
    }
    if (els.resultScore) {
      // 旧UI（数字だけの円）互換
      els.resultScore.textContent = String(score);
    }
    if (els.resultCount) {
      els.resultCount.textContent = `${correctCount}問/${total}問中`;
    }

    // 結果テーブル
    const tbody = document.getElementById("resultTableBody"); // 直前に再取得
    if (tbody) {
      tbody.innerHTML = "";
      state.answers.forEach((a, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>Q${i + 1}</td>
          <td>${a.word}</td>
          <td>${a.userAnswer}</td>
          <td>${a.correctYomi}</td>
          <td>${a.isCorrect ? "✓" : "✗"}</td>
          <td>
            <button type="button"
              class="btn-secondary btn-detail"
              data-open-detail
              data-no="${a.no}"
              data-word="${encodeURIComponent(a.word)}">
              詳細
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      console.warn("[reading-test] #resultTableBody が見つかりません（描画をスキップ）");
    }

    // score.html 用に保存
    saveGroupResultToStorage({
      groupId: group.id,
      rangeLabel: `漢字番号：${group.startNo}〜${group.endNo}`,
      total,
      correct: correctCount,
      score,
      takenAt: new Date().toISOString(),
    });

    // SVGゲージ更新（test.html の結果ビューに配置している前提）
    updateGauge(document.querySelector("[data-gauge]"), score);

    switchView("result");
  }

  function saveGroupResultToStorage(record) {
    const KEY = "kanji2200ReadingResults";
    let arr = [];
    try {
      arr = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    const idx = arr.findIndex((r) => r.groupId === record.groupId);
    if (idx >= 0) arr[idx] = record;
    else arr.push(record);
    localStorage.setItem(KEY, JSON.stringify(arr));
  }

  // 他スクリプトから初期化したい場合のフック（任意で使用可）
  if (typeof window !== "undefined") window.__readingTestInit = init;

})();

/* === Accordion for test list (読み/書き) === */
(() => {
  "use strict";

  const KEY = "kanji2200AccordionState"; // { reading: true/false, writing: true/false }

  // 外部から再結線したい時のために公開（例：リスト描画直後に呼ぶ）
  window.refreshTestAccordions = bindAll;

  // ★ ここを書き換え
  document.addEventListener("DOMContentLoaded", () => {
    clearAccordionState();  // ← まず全部閉じて状態クリア
    bindAll();              // ← そのあと通常の結線
  });
    // ★ 戻る（BFCache 復元）でも必ず閉じる
  window.addEventListener("pageshow", (ev) => {
    if (ev.persisted) {
      clearAccordionState();
    }
  });

  function bindAll(){
    const state = loadState();

    document.querySelectorAll(".acc[data-acc]").forEach(acc => {
      const btn = acc.querySelector(".acc-summary");
      const panel = acc.querySelector("[data-acc-panel]");
      if (!btn || !panel) return;

      // すでに結線済みならスキップ（多重バインド防止）
      if (btn.dataset.accWired === "1") return;
      btn.dataset.accWired = "1";

      // 初期状態：localStorage > aria-expanded
      const id = btn.id || panel.id; // acc-reading / acc-writing を想定
      const key = id && id.includes("writing") ? "writing" : "reading";
      const expanded = (key in state) ? !!state[key] : (btn.getAttribute("aria-expanded") === "true");
      setExpanded(btn, panel, expanded, false);

      // クリックで開閉
      btn.addEventListener("click", () => {
        const next = !(btn.getAttribute("aria-expanded") === "true");
        setExpanded(btn, panel, next, true);

        // 保存
        const cur = loadState();
        cur[key] = next;
        try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch {}
      });

      // 初回レイアウト（開いているものは高さ合わせ）
      requestAnimationFrame(() => syncHeight(panel));

      // リサイズで高さ再計算
      window.addEventListener("resize", () => syncHeight(panel));
    });
  }

  function loadState(){
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
  }

  function setExpanded(btn, panel, expanded, animate){
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (expanded){
      panel.hidden = false;
      if (animate) animateOpen(panel); else syncHeight(panel);
    } else {
      if (animate) animateClose(panel);
      else {
        panel.style.height = "0px";
        panel.hidden = true;
      }
    }
  }
  function setExpanded(btn, panel, expanded, animate){
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (expanded){
      panel.hidden = false;
      if (animate) animateOpen(panel); else syncHeight(panel);
    } else {
      if (animate) animateClose(panel);
      else {
        panel.style.height = "0px";
        panel.hidden = true;
      }
    }
  }

  // ★ 追加：状態クリア＋全アコーディオンを閉じる
  function clearAccordionState(){
    // 保存されている開閉状態を捨てる
    try { localStorage.removeItem(KEY); } catch {}

    // DOM 上の .acc をすべて閉じる
    document.querySelectorAll(".acc[data-acc]").forEach(acc => {
      const btn   = acc.querySelector(".acc-summary");
      const panel = acc.querySelector("[data-acc-panel]");
      if (!btn || !panel) return;
      setExpanded(btn, panel, false, false);  // アニメなしで「閉」
    });
  }

  function syncHeight(panel){
    if (panel.hidden) return;
    const inner = panel.querySelector(".acc-panel-inner");
    const h = inner ? inner.offsetHeight : panel.scrollHeight;
    panel.style.height = h + "px";
  }

  function animateOpen(panel){
    panel.hidden = false; // まず見える状態に
    const inner = panel.querySelector(".acc-panel-inner");
    const target = inner ? inner.offsetHeight : panel.scrollHeight;
    panel.style.height = "0px";
    panel.style.visibility = "visible";
    requestAnimationFrame(() => {
      panel.style.height = target + "px";
    });
  }

  function animateClose(panel){
    const current = panel.offsetHeight;
    panel.style.height = current + "px";
    requestAnimationFrame(() => {
      panel.style.height = "0px";
      panel.addEventListener("transitionend", onEnd, { once: true });
      function onEnd(){ panel.hidden = true; }
    });
  }
})();