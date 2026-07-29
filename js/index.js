// /js/index.js — 親エントリ（完全版）

import {
  loadData, buildRangeOptions, wireFilters,
  applyFilter, setupDetailDialog, renderList, getData
} from "./common.js";
import "./setting.js"; // ← 設定モーダルの openSettings() をどこでも使えるようにする

async function boot(){
  try{
    // どのページでもまず共通データを読む
    await loadData();

    // ページ種別をDOMで判定
    const isSearchPage  = !!document.getElementById("list");              // 検索一覧があるページ
    const isReadingPage = !!document.getElementById("readingTestList");   // 読みテストのページ
    const hasDetailDlg  = !!document.getElementById("detail");            // 詳細モーダルDOM

    // 共通：詳細モーダルの配線（detail ダイアログがある時だけ）
    if (hasDetailDlg) setupDetailDialog();

    if (isSearchPage){
      // 検索ページ 初期化（従来どおり）
      buildRangeOptions();
      wireFilters();
      renderList(getData());
      applyFilter();
      // 手書きUIは必要なページでのみ読み込む
      const { initInk } = await import("./ink.js");
      initInk();
    }

    if (isReadingPage){
      // 読みテスト 初期化（動的に読み込む）
      // ① ESM化している場合
      try {
        const mod = await import("./reading-test.js");
        if (typeof mod.initReadingTest === "function"){
          await mod.initReadingTest();          // ← これだけで起動
        } else if (typeof window.bootReadingTest === "function"){
          window.bootReadingTest();            // ② グローバル公開版のフォールバック
        }
      } catch(e){
        console.error("[index] reading-test.js の import に失敗:", e);
        // 旧IIFEが自動起動する構成なら何もしない
      }
    }

    // 好みで：全ページに“設定”ボタンを付けたい場合（例）
    document.addEventListener("click", (ev)=>{
      const btn = ev.target.closest("[data-open-settings]");
      if (btn) { ev.preventDefault(); window.openSettings?.(); }
    });

  }catch(err){
    alert(`初期化エラー: ${err.message}`);
    console.error(err);
  }
}

boot();