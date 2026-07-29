
// image-viewer.js — 画像クリックでモーダル拡大表示
(function(){
  "use strict";

  const SCOPE_SELECTORS = ['main.content','.content','body'];

  function buildModal(){
    const frag = document.createDocumentFragment();

    const backdrop = document.createElement('div');
    backdrop.className = 'iv-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const modal = document.createElement('div');
    modal.className = 'iv-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const inner = document.createElement('div');
    inner.className = 'iv-modal-inner';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'iv-close';
    closeBtn.setAttribute('aria-label', '閉じる（Esc）');
    closeBtn.textContent = '×';

    const img = document.createElement('img');
    img.className = 'iv-img';
    img.alt = '';

    const cap = document.createElement('div');
    cap.className = 'iv-caption';

    inner.appendChild(closeBtn);
    inner.appendChild(img);
    inner.appendChild(cap);
    modal.appendChild(inner);

    frag.appendChild(backdrop);
    frag.appendChild(modal);
    document.body.appendChild(frag);

    return { backdrop, modal, inner, closeBtn, img, cap };
  }

  const els = buildModal();

  function open(src, caption){
    els.img.src = src;
    els.cap.textContent = caption || '';
    els.backdrop.classList.add('is-open');
    els.modal.classList.add('is-open');
    document.addEventListener('keydown', onKeyDown);
  }

  function close(){
    els.backdrop.classList.remove('is-open');
    els.modal.classList.remove('is-open');
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e){
    if (e.key === 'Escape') close();
  }

  els.backdrop.addEventListener('click', close);
  els.closeBtn.addEventListener('click', close);

  const scope = document.querySelector(SCOPE_SELECTORS.join(',')) || document.body;

  scope.addEventListener('click', function(ev){
    let target = ev.target;
    if (!(target instanceof Element)) return;
    const imgEl = target.closest('img.img-zoomable, figure img, .img-zoomable img');
    if (!imgEl) return;

    const src = imgEl.getAttribute('data-full') || imgEl.getAttribute('src');
    let caption = '';
    const fig = imgEl.closest('figure');
    const figcap = fig ? fig.querySelector('figcaption') : null;
    if (figcap && figcap.textContent.trim()){
      caption = figcap.textContent.trim();
    } else {
      caption = imgEl.getAttribute('alt') || '';
    }
    open(src, caption);
  });

  function markZoomables(){
    const nodes = scope.querySelectorAll('figure img, img.img-zoomable, .img-zoomable img');
    nodes.forEach(n => n.classList.add('img-zoomable'));
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', markZoomables);
  } else {
    markZoomables();
  }
})();
