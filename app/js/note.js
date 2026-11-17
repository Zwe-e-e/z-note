/* Z Note · note pages — a block editor (one editable line per block) */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store, ui = ZN.ui, C = U.caret;

  const TEXT = { p: 1, h1: 1, h2: 1, h3: 1, todo: 1, ul: 1, ol: 1, quote: 1, callout: 1, code: 1, toggle: 1 };
  const KEEP = { todo: 1, ul: 1, ol: 1 };            // Enter carries these on to the next line
  const MAX_INDENT = 6;
  const PH = {
    p: 'Write something, or type / for blocks', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', todo: 'To-do',
    ul: 'List item', ol: 'List item', quote: 'Quote', callout: 'Something worth noticing', code: 'Code', toggle: 'Toggle heading'
  };
  const MENU = [
    { t: 'p', label: 'Text', icon: 'para', sub: 'Plain writing', keys: 'text paragraph plain' },
    { t: 'h1', label: 'Heading 1', icon: 'h1', sub: 'Big section title', keys: 'h1 heading title' },
    { t: 'h2', label: 'Heading 2', icon: 'h2', sub: 'Section title', keys: 'h2 heading subtitle' },
    { t: 'h3', label: 'Heading 3', icon: 'h3', sub: 'Small title', keys: 'h3 heading' },
    { t: 'todo', label: 'To-do', icon: 'tasks', sub: 'A box you can tick', keys: 'todo task check checkbox' },
    { t: 'ul', label: 'Bulleted list', icon: 'list', sub: 'Simple dots', keys: 'bullet list unordered' },
    { t: 'ol', label: 'Numbered list', icon: 'olist', sub: '1, 2, 3…', keys: 'numbered list ordered' },
    { t: 'toggle', label: 'Toggle', icon: 'toggle', sub: 'Tuck lines away under a heading', keys: 'toggle collapse fold hide' },
    { t: 'quote', label: 'Quote', icon: 'quote', sub: 'Someone else’s words', keys: 'quote blockquote' },
    { t: 'callout', label: 'Callout', icon: 'callout', sub: 'A box that stands out', keys: 'callout note info tip box' },
    { t: 'code', label: 'Code', icon: 'code', sub: 'Typewriter text, kept as typed', keys: 'code snippet mono' },
    { t: 'divider', label: 'Divider', icon: 'divider', sub: 'A line across the page', keys: 'divider line rule hr' },
    { t: 'image', label: 'Picture', icon: 'image', sub: 'Upload from this PC', keys: 'image picture photo upload' },
    { t: 'snip', label: 'Screen snip', icon: 'snip', sub: 'Capture part of your screen', keys: 'snip screenshot capture screen' },
    { t: 'page', label: 'Sub-page', icon: 'page', sub: 'A new note inside this one', keys: 'page subpage link' },
    { t: 'date', label: 'Today’s date', icon: 'calendar', sub: 'Stamp the date here', keys: 'date today now' }
  ];
  const HL = ['yellow', 'pink', 'green', 'blue'];
  const INK = ['red', 'blue', 'green'];

  function newBlock(t, html) {
    const b = { id: U.uid(), t, html: html || '' };
    if (t === 'todo') b.checked = false;
    if (t === 'toggle') b.open = true;
    return b;
  }

  /* all the words on a note, for search */
  function textOf(page) {
    const out = [];
    ((page.content && page.content.blocks) || []).forEach(b => {
      if (b.html) out.push(U.text(b.html));
      if (b.cap) out.push(b.cap);
    });
    return out.join('\n');
  }
  ZN.note = { textOf, newBlock, TEXT };

  /* ---------- shared page header: icon, title, tags (notes and to-do lists) ---------- */
  ZN.pageHead = function (page, o) {
    o = o || {};
    if (!Array.isArray(page.tags)) page.tags = [];
    const titleEl = h('h1.page-title', { contenteditable: 'plaintext-only', spellcheck: 'false', 'data-ph': 'Untitled', role: 'textbox', 'aria-label': 'Page title' }, page.title || '');
    const iconBtn = h('button.page-icon', { type: 'button', 'data-tip': 'Change the icon', 'aria-label': 'Change the icon' });
    const metaEl = h('div.page-meta');
    const setIcon = () => U.clear(iconBtn).append(ZN.pageIcon(page, 30));
    setIcon();
    iconBtn.addEventListener('click', () => ui.iconPicker(iconBtn, page.icon, v => { S.update(page.id, { icon: v }, { keepTime: true }); setIcon(); }));

    titleEl.addEventListener('input', () => {
      if (titleEl.textContent.trim() === '') titleEl.textContent = '';
      S.update(page.id, { title: titleEl.textContent.replace(/\s+/g, ' ').trim() });
    });
    titleEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (o.onLeave) o.onLeave(); }
    });
    titleEl.addEventListener('paste', e => {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' '));
    });

    function renderMeta(refocus) {
      U.clear(metaEl);
      page.tags.forEach(t => metaEl.append(h('span.chip.tag-chip',
        h('span', { style: { cursor: 'pointer' }, onclick: () => ZN.search && ZN.search.open('#' + t) }, '#' + t),
        h('button', { type: 'button', 'aria-label': 'Remove tag ' + t, onclick: () => { S.update(page.id, { tags: page.tags.filter(x => x !== t) }, { keepTime: true }); renderMeta(); } }, ZN.icon('x', 11)))));
      const inp = h('input.tag-input', { type: 'text', placeholder: page.tags.length ? '+ tag' : '+ add a tag', maxlength: 30, 'aria-label': 'Add a tag' });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const v = inp.value.replace(/[#,]/g, '').trim().toLowerCase();
          inp.value = '';
          if (v && page.tags.indexOf(v) < 0) { S.update(page.id, { tags: page.tags.concat([v]) }, { keepTime: true }); renderMeta(true); }
        } else if (e.key === 'Backspace' && !inp.value && page.tags.length) {
          S.update(page.id, { tags: page.tags.slice(0, -1) }, { keepTime: true });
          renderMeta(true);
        } else if (e.key === 'Escape') inp.blur();
      });
      metaEl.append(inp);
      if (refocus) inp.focus();
    }
    renderMeta();

    const el = h('header.page-head',
      h('span.page-date', U.shortDate(page.created)), iconBtn, titleEl,
      h('div.title-rule', { html: '<svg viewBox="0 0 600 9" preserveAspectRatio="none" aria-hidden="true"><path d="M2 5.5C80 2 160 8 240 4.500S420 7 598 3.500" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>' }),
      metaEl);
    return { el, titleEl, focusTitle: () => C.set(titleEl, 'end') };
  };

  /* ---------- range helpers ---------- */
  function textRange(te, a, z) {
    const r = document.createRange();
    let pos = 0, n, startSet = false, endSet = false;
    const w = document.createTreeWalker(te, NodeFilter.SHOW_TEXT);
    while ((n = w.nextNode())) {
      const len = n.length;
      if (!startSet && a <= pos + len) { r.setStart(n, a - pos); startSet = true; }
      if (startSet && z <= pos + len) { r.setEnd(n, z - pos); endSet = true; break; }
      pos += len;
    }
    if (!startSet) { r.selectNodeContents(te); r.collapse(false); }
    else if (!endSet) r.setEnd(te, te.childNodes.length);
    return r;
  }
  function textBefore(te, node) {
    const r = document.createRange();
    r.selectNodeContents(te);
    r.setEndBefore(node);
    return r.toString().length;
  }
  function selectedTextNodes(te, r) {
    const out = [];
    const w = document.createTreeWalker(te, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!r.intersectsNode(n)) continue;
      const a = n === r.startContainer ? r.startOffset : 0;
      const z = n === r.endContainer ? r.endOffset : n.length;
      if (z > a) out.push({ n, a, z });
    }
    return out;
  }
  /* split `anc` in two around `node` and remove `anc` from around node itself */
  function liftOut(node, anc) {
    const p = anc.parentNode;
    const r1 = document.createRange();
    r1.setStartBefore(anc); r1.setEndBefore(node);
    const left = r1.extractContents();
    const r2 = document.createRange();
    r2.setStartAfter(node); r2.setEndAfter(anc);
    const right = r2.extractContents();
    if (left.textContent !== '') p.insertBefore(left, anc);
    if (right.textContent !== '') p.insertBefore(right, anc.nextSibling);
    while (anc.firstChild) p.insertBefore(anc.firstChild, anc);
    p.removeChild(anc);
  }
  /* wrap the selection in <tag class=cls>, or unwrap when it is already wrapped that way. cls === null only removes. */
  function toggleWrap(te, tag, cls, family) {
    const s = window.getSelection();
    if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (r.collapsed || !te.contains(r.commonAncestorContainer)) return;
    const parts = selectedTextNodes(te, r);
    if (!parts.length) return;
    const same = tag + (cls ? '.' + cls : '');
    const allOn = cls !== null && parts.every(p => { const a = p.n.parentElement.closest(same); return a && a !== te && te.contains(a); });
    const nodes = parts.map(p => {
      let n = p.n;
      if (p.z < n.length) n.splitText(p.z);
      if (p.a > 0) n = n.splitText(p.a);
      return n;
    });
    nodes.forEach(n => {
      let a;
      while ((a = n.parentElement.closest(family)) && a !== te && te.contains(a)) liftOut(n, a);
      if (!allOn && cls !== null) {
        const wEl = document.createElement(tag);
        if (cls) wEl.className = cls;
        n.parentNode.insertBefore(wEl, n);
        wEl.appendChild(n);
      }
    });
    const start = textBefore(te, nodes[0]);
    const len = nodes.reduce((sum, n) => sum + n.length, 0);
    te.querySelectorAll(family).forEach(x => {
      if (!x.isConnected) return;
      if (x.textContent === '') { x.remove(); return; }
      let nx;
      while ((nx = x.nextSibling) && nx.nodeType === 1 && nx.tagName === x.tagName && nx.className === x.className) {
        while (nx.firstChild) x.appendChild(nx.firstChild);
        nx.remove();
      }
    });
    te.normalize();
    s.removeAllRanges();
    s.addRange(textRange(te, start, start + len));
  }

  function linesToBlocks(lines) {
    const out = [];
    lines.forEach(raw => {
      if (!raw.trim()) return;
      const lead = /^[\t ]*/.exec(raw)[0];
      const indent = Math.min(MAX_INDENT, (lead.match(/\t/g) || []).length + Math.floor(lead.replace(/\t/g, '').length / 2));
      let s = raw.trim(), t = 'p', checked = false, m;
      if ((m = /^(#{1,3})\s+(.*)$/.exec(s))) { t = 'h' + m[1].length; s = m[2]; }
      else if ((m = /^(?:[-*•]\s+)?\[( |x|X)?\]\s+(.*)$/.exec(s))) { t = 'todo'; checked = /x/i.test(m[1] || ''); s = m[2]; }
      else if ((m = /^[-*•]\s+(.*)$/.exec(s))) { t = 'ul'; s = m[1]; }
      else if ((m = /^\d{1,3}[.)]\s+(.*)$/.exec(s))) { t = 'ol'; s = m[1]; }
      else if ((m = /^>\s+(.*)$/.exec(s))) { t = 'quote'; s = m[1]; }
      else if (/^(-{3,}|_{3,}|\*{3,})$/.test(s)) { out.push(newBlock('divider')); return; }
      const b = newBlock(t, U.esc(s));
      if (t === 'todo') b.checked = checked;
      if (indent && KEEP[t]) b.indent = indent;
      out.push(b);
    });
    return out;
  }

  /* ====================================================================== */
  ZN.views.note = function (el, page) {
    if (!page.content || !Array.isArray(page.content.blocks)) page.content = { blocks: [] };
    const blocks = page.content.blocks;
    if (!blocks.length) blocks.push(newBlock('p'));

    const layer = document.getElementById('layer');
    const els = new Map();
    const sel = new Set();
    let selAnchor = null, selFocus = null, lastId = null, mouseDown = false, dragFrom = null, alive = true;

    const blocksEl = h('div.blocks', { tabindex: '-1' });
    const tailEl = h('div.blocks-tail');
    const head = ZN.pageHead(page, { onLeave: () => { const f = blocks.find(b => TEXT[b.t]); if (f) focusBlock(f.id, 0); } });
    const sheet = h('div.sheet.page.note', head.el, blocksEl, tailEl);
    el.append(h('div.page-wrap', sheet));

    /* ----- model helpers ----- */
    const byId = id => blocks.find(b => b.id === id);
    const textOfBlock = b => { const e = b && els.get(b.id); return e ? e.querySelector('.blk-text') : null; };
    const blockOfText = te => byId(te.closest('.blk').dataset.id);
    const readHTML = (b, te) => (b.t === 'code' ? U.esc(te.textContent) : (te.innerHTML === '<br>' ? '' : te.innerHTML));
    const isHidden = b => { const e = els.get(b.id); return !e || e.hidden; };
    function prevVisible(b) { let i = blocks.indexOf(b) - 1; while (i >= 0 && isHidden(blocks[i])) i--; return i >= 0 ? blocks[i] : null; }
    function nextVisible(b) { let i = blocks.indexOf(b) + 1; while (i < blocks.length && isHidden(blocks[i])) i++; return i < blocks.length ? blocks[i] : null; }
    function subtreeEnd(i) { const ind = blocks[i].indent || 0; let j = i; while (j + 1 < blocks.length && (blocks[j + 1].indent || 0) > ind) j++; return j; }
    const lhPx = () => parseFloat(getComputedStyle(blocksEl).lineHeight) || 28;
    const changed = () => S.touch(page.id);

    /* ----- rendering ----- */
    function markFor(b) {
      if (b.t === 'todo') return h('button.chk' + (b.checked ? '.on' : ''), { type: 'button', tabindex: '-1', 'data-act': 'check', 'aria-label': 'Done', 'aria-pressed': String(!!b.checked), html: ZN.tickHTML });
      if (b.t === 'toggle') return h('button.twisty' + (b.open === false ? '' : '.open'), { type: 'button', tabindex: '-1', 'data-act': 'fold', 'aria-label': 'Show or hide' }, ZN.icon('chevR', 14));
      if (b.t === 'callout') return ZN.icon('bulb', 17);
      if (b.t === 'ul') return h('span.bullet');
      if (b.t === 'ol') return h('span.num');
      return null;
    }

    function imageEl(b) {
      const img = S.setImg(h('img', { alt: b.cap || 'Picture', draggable: false }), b.src);
      const cap = h('figcaption.blk-cap', { contenteditable: 'plaintext-only', 'data-ph': 'Add a caption' }, b.cap || '');
      cap.addEventListener('input', () => { if (cap.textContent.trim() === '') cap.textContent = ''; b.cap = cap.textContent; changed(); typingCommit(); });
      cap.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const n = nextVisible(b);
        if (n && TEXT[n.t]) focusBlock(n.id, 0);
        else { before(); const nb = insertAfter(b, newBlock('p')); focusBlock(nb.id, 0); done(); }
      });
      cap.addEventListener('paste', e => { e.preventDefault(); e.stopPropagation(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ')); });
      return h('figure.blk-img', { style: { width: b.w ? b.w + 'px' : null } },
        h('div.img-frame', img,
          h('div.img-tools',
            h('button.ibtn.sm', { type: 'button', tabindex: '-1', 'data-act': 'img-open', 'data-tip': 'Open', 'aria-label': 'Open picture' }, ZN.icon('open', 14)),
            h('button.ibtn.sm', { type: 'button', tabindex: '-1', 'data-act': 'img-copy', 'data-tip': 'Copy', 'aria-label': 'Copy picture' }, ZN.icon('copy', 14)),
            h('button.ibtn.sm', { type: 'button', tabindex: '-1', 'data-act': 'img-del', 'data-tip': 'Remove', 'aria-label': 'Remove picture' }, ZN.icon('trash', 14))),
          h('span.img-resize', { 'data-tip': 'Drag to resize' })),
        cap);
    }

    function pageLinkEl(b) {
      const p = S.get(b.pageId);
      const ok = p && S.isLive(p);
      return h('button.blk-page' + (ok ? '' : '.gone'), { type: 'button', 'data-act': 'open-page', disabled: !ok },
        ok ? ZN.pageIcon(p, 17) : ZN.icon('page', 17), h('span', ok ? ZN.pageTitle(p) : 'This page was deleted'));
    }

    function renderBlock(b) {
      const e = h('div.blk' + (b.t === 'todo' && b.checked ? '.done' : ''), { dataset: { id: b.id, t: b.t }, style: { '--indent': b.indent || 0 } });
      e.append(h('div.blk-gutter',
        h('button.blk-add', { type: 'button', tabindex: '-1', 'data-act': 'add', 'data-tip': 'Add a block below', 'aria-label': 'Add a block below' }, ZN.icon('plus', 15)),
        h('button.blk-grip', { type: 'button', tabindex: '-1', 'data-tip': 'Drag to move · click for options', 'aria-label': 'Move this block or open its options' }, ZN.icon('grip', 15))));
      if (TEXT[b.t]) {
        const m = markFor(b);
        if (m) e.append(h('div.blk-mark', m));
        const te = h('div.blk-text', { contenteditable: b.t === 'code' ? 'plaintext-only' : 'true', spellcheck: b.t === 'code' ? 'false' : 'true', 'data-ph': PH[b.t] || '' });
        if (b.t === 'code') te.textContent = U.text(b.html); else te.innerHTML = b.html || '';
        e.append(te);
      } else if (b.t === 'divider') e.append(h('div.blk-rule'));
      else if (b.t === 'image') e.append(imageEl(b));
      else if (b.t === 'page') e.append(pageLinkEl(b));
      return e;
    }

    function renderAll() {
      els.clear();
      U.clear(blocksEl);
      blocks.forEach(b => { const e = renderBlock(b); els.set(b.id, e); blocksEl.append(e); });
      sync();
    }

    /* numbering, folded toggles, and the paper pattern lined up with the first line */
    function sync() {
      const counters = [];
      let hideBelow = null;
      blocks.forEach(b => {
        const e = els.get(b.id);
        if (!e) return;
        const ind = b.indent || 0;
        if (hideBelow !== null && ind > hideBelow) { e.hidden = true; return; }
        e.hidden = false;
        hideBelow = b.t === 'toggle' && b.open === false ? ind : null;
        counters.length = ind + 1;
        if (b.t === 'ol') {
          counters[ind] = (counters[ind] || 0) + 1;
          const n = e.querySelector('.num');
          if (n) n.textContent = counters[ind] + '.';
        } else counters[ind] = 0;
      });
      sheet.style.setProperty('--pat-y', (blocksEl.offsetTop % lhPx()) + 'px');
    }

    function insertAt(i, nb) {
      blocks.splice(i, 0, nb);
      const e = renderBlock(nb);
      els.set(nb.id, e);
      const ref = blocks[i + 1] ? els.get(blocks[i + 1].id) : null;
      blocksEl.insertBefore(e, ref || null);
      return nb;
    }
    const insertAfter = (ref, nb) => insertAt(blocks.indexOf(ref) + 1, nb);
    const insertBefore = (ref, nb) => insertAt(blocks.indexOf(ref), nb);
    function replaceEl(b) {
      const old = els.get(b.id), e = renderBlock(b);
      els.set(b.id, e);
      if (old) old.replaceWith(e); else blocksEl.append(e);
      if (sel.has(b.id)) e.classList.add('sel');
      return e;
    }
    function removeBlock(b) {
      const i = blocks.indexOf(b);
      if (i < 0) return;
      blocks.splice(i, 1);
      const e = els.get(b.id);
      if (e) e.remove();
      els.delete(b.id);
      sel.delete(b.id);
    }
    function setIndent(b, n) {
      n = U.clamp(n, 0, MAX_INDENT);
      if (n) b.indent = n; else delete b.indent;
      const e = els.get(b.id);
      if (e) e.style.setProperty('--indent', n);
    }

    function focusBlock(id, where) {
      const e = els.get(id);
      if (!e) return;
      const te = e.querySelector('.blk-text');
      if (te) { C.set(te, where === undefined ? 'end' : where); lastId = id; }
      else selectBlocks([id]);
    }

    /* ----- undo history (snapshots) ----- */
    const hist = [];
    let hi = -1, typing = false;
    function caretState() {
      const a = document.activeElement;
      const te = a && a.closest ? a.closest('.blk-text') : null;
      if (te && blocksEl.contains(te)) return { id: te.closest('.blk').dataset.id, off: C.offset(te) };
      if (sel.size) return { id: selIds()[0], off: null };
      return null;
    }
    function commit() {
      typing = false;
      const snap = JSON.stringify(blocks);
      if (hi >= 0 && hist[hi].snap === snap) return;
      hist.length = hi + 1;
      hist.push({ snap, caret: caretState() });
      if (hist.length > 150) hist.shift();
      hi = hist.length - 1;
    }
    const typingCommit = U.debounce(commit, 650);
    /* call before any structural change */
    function before() {
      typingCommit.flush();
      if (hi >= 0) hist[hi].caret = caretState();
    }
    function done() { sync(); commit(); changed(); }
    function restore(state) {
      const data = JSON.parse(state.snap);
      blocks.length = 0;
      data.forEach(b => blocks.push(b));
      sel.clear();
      closeSlash();
      renderAll();
      const c = state.caret;
      if (c && els.has(c.id)) { if (c.off == null) selectBlocks([c.id]); else focusBlock(c.id, c.off); }
      changed();
    }
    function undo() { typingCommit.flush(); if (hi > 0) { hi--; restore(hist[hi]); } }
    function redo() { typingCommit.flush(); if (hi < hist.length - 1) { hi++; restore(hist[hi]); } }

    /* ----- block selection ----- */
    const selIds = () => blocks.filter(b => sel.has(b.id)).map(b => b.id);
    function clearSel() {
      sel.forEach(id => { const e = els.get(id); if (e) e.classList.remove('sel'); });
      sel.clear();
    }
    function selectBlocks(ids, keepAnchor) {
      clearSel();
      ids.forEach(id => { const e = els.get(id); if (e) { sel.add(id); e.classList.add('sel'); } });
      if (!keepAnchor) { selAnchor = ids[0] || null; selFocus = ids[ids.length - 1] || null; }
      const s = window.getSelection();
      if (s) s.removeAllRanges();
      blocksEl.focus({ preventScroll: true });
      hideBar();
      closeSlash();
    }
    function selectRange(aId, zId) {
      let a = blocks.findIndex(b => b.id === aId), z = blocks.findIndex(b => b.id === zId);
      if (a < 0 || z < 0) return;
      if (a > z) { const t = a; a = z; z = t; }
      selectBlocks(blocks.slice(a, z + 1).map(b => b.id), true);
    }

    /* ----- structural edits ----- */
    function retype(b, t) {
      const te = textOfBlock(b);
      const had = te && document.activeElement === te;
      const off = had ? C.offset(te) : 0;
      if (te) b.html = readHTML(b, te);
      if (t === 'code' && b.t !== 'code') b.html = U.esc(U.text(b.html));
      b.t = t;
      if (t === 'todo') b.checked = !!b.checked; else delete b.checked;
      if (t === 'toggle') b.open = true; else delete b.open;
      replaceEl(b);
      if (had) focusBlock(b.id, off);
    }

    function enter(b, te) {
      before();
      const r = C.range();
      if (!r) return;
      if (!r.collapsed) r.deleteContents();
      if (te.textContent === '' && b.t !== 'p') {
        // an empty list line, heading or quote steps back to plain text
        if (KEEP[b.t] && b.indent) setIndent(b, b.indent - 1); else retype(b, 'p');
        done();
        return;
      }
      const tail = document.createRange();
      tail.selectNodeContents(te);
      tail.setStart(r.startContainer, r.startOffset);
      const box = document.createElement('div');
      box.appendChild(tail.extractContents());
      const tailHTML = box.textContent === '' ? '' : box.innerHTML;
      if (te.textContent === '' && tailHTML) {
        // Enter at the very start of a line pushes the whole line down and keeps its type
        te.innerHTML = tailHTML;
        b.html = tailHTML;
        const above = newBlock(KEEP[b.t] ? b.t : 'p');
        if (b.indent) above.indent = b.indent;
        insertBefore(b, above);
        C.set(te, 0);
        done();
        return;
      }
      if (te.innerHTML === '<br>' || te.textContent === '') te.innerHTML = '';
      b.html = te.innerHTML;
      let nb;
      if (b.t === 'toggle') {
        nb = newBlock('p', tailHTML);
        if (b.open === false) { if (b.indent) nb.indent = b.indent; insertAt(subtreeEnd(blocks.indexOf(b)) + 1, nb); }
        else { nb.indent = Math.min(MAX_INDENT, (b.indent || 0) + 1); insertAfter(b, nb); }
      } else {
        nb = newBlock(KEEP[b.t] ? b.t : 'p', tailHTML);
        if (b.indent) nb.indent = b.indent;
        insertAfter(b, nb);
      }
      focusBlock(nb.id, 0);
      els.get(nb.id).scrollIntoView({ block: 'nearest' });
      done();
    }

    function backspaceAtStart(b, te) {
      before();
      if (b.t !== 'p') { retype(b, 'p'); done(); return; }
      if (b.indent) { setIndent(b, b.indent - 1); done(); return; }
      const prev = prevVisible(b);
      if (!prev) return;
      if (!TEXT[prev.t]) {
        if (te.textContent === '' && blocks.length > 1) { removeBlock(b); selectBlocks([prev.id]); done(); }
        else selectBlocks([prev.id]);
        return;
      }
      const pte = textOfBlock(prev);
      const off = pte.textContent.length;
      const add = readHTML(b, te);
      if (prev.t === 'code') { pte.textContent += U.text(add); prev.html = U.esc(pte.textContent); }
      else {
        if (pte.innerHTML === '<br>') pte.innerHTML = '';
        pte.insertAdjacentHTML('beforeend', add);
        prev.html = pte.innerHTML;
      }
      removeBlock(b);
      focusBlock(prev.id, off);
      done();
    }

    function deleteAtEnd(b, te) {
      const next = nextVisible(b);
      if (!next) return;
      before();
      if (!TEXT[next.t]) { selectBlocks([next.id]); return; }
      if (next.t === 'toggle' && next.open === false) { next.open = true; sync(); }
      const off = te.textContent.length;
      const add = readHTML(next, textOfBlock(next));
      if (b.t === 'code') { te.textContent += U.text(add); b.html = U.esc(te.textContent); }
      else {
        if (te.innerHTML === '<br>') te.innerHTML = '';
        te.insertAdjacentHTML('beforeend', add);
        b.html = te.innerHTML;
      }
      removeBlock(next);
      focusBlock(b.id, off);
      done();
    }

    function indentBlocks(ids, d) {
      before();
      ids.forEach(id => {
        const b = byId(id);
        if (!b) return;
        const i = blocks.indexOf(b);
        const max = i > 0 ? (blocks[i - 1].indent || 0) + 1 : 0;
        setIndent(b, Math.min(max, (b.indent || 0) + d));
      });
      done();
    }

    function deleteBlocks(ids) {
      before();
      const set = new Set(ids);
      ids.forEach(id => {
        const b = byId(id);
        if (b && b.t === 'toggle' && b.open === false) {   // a folded toggle takes what is tucked under it along
          const i = blocks.indexOf(b);
          for (let j = i + 1; j <= subtreeEnd(i); j++) set.add(blocks[j].id);
        }
      });
      const first = blocks.findIndex(b => set.has(b.id));
      blocks.filter(b => set.has(b.id)).forEach(removeBlock);
      clearSel();
      if (!blocks.length) insertAt(0, newBlock('p'));
      sync();
      let t = blocks[Math.max(0, Math.min(first, blocks.length) - 1)];
      if (isHidden(t)) t = prevVisible(t) || blocks[0];
      if (TEXT[t.t]) focusBlock(t.id, 'end'); else selectBlocks([t.id]);
      done();
    }

    function duplicate(ids) {
      before();
      const src = ids.map(byId).filter(Boolean);
      if (!src.length) return;
      let ref = src[src.length - 1];
      const te = textOfBlock(ref);
      src.forEach(b => { const t = textOfBlock(b); if (t) b.html = readHTML(b, t); });
      const made = src.map(b => Object.assign(JSON.parse(JSON.stringify(b)), { id: U.uid() }));
      made.forEach(nb => { ref = insertAfter(ref, nb); });
      if (made.length === 1 && TEXT[made[0].t] && te && !sel.size) focusBlock(made[0].id, 'end');
      else selectBlocks(made.map(b => b.id));
      done();
    }

    function moveBlocks(ids, dir) {
      if (!ids.length) return;
      before();
      const wasSel = sel.size > 0;
      const caret = caretState();
      const first = blocks.findIndex(b => b.id === ids[0]);
      let last = blocks.findIndex(b => b.id === ids[ids.length - 1]);
      if (first < 0 || last < 0) return;
      if (blocks[last].t === 'toggle' && blocks[last].open === false) last = subtreeEnd(last);
      const n = last - first + 1;
      if (dir < 0) {
        let t = first - 1;
        while (t >= 0 && isHidden(blocks[t])) t--;
        if (t < 0) return;
        const group = blocks.splice(first, n);
        blocks.splice.apply(blocks, [t, 0].concat(group));
      } else {
        const t = last + 1;
        if (t >= blocks.length) return;
        const end = blocks[t].t === 'toggle' && blocks[t].open === false ? subtreeEnd(t) : t;
        const group = blocks.splice(first, n);
        blocks.splice.apply(blocks, [end - n + 1, 0].concat(group));
      }
      renderAll();
      if (wasSel) selectBlocks(ids);
      else if (caret && caret.off != null) focusBlock(caret.id, caret.off);
      const e = els.get(ids[0]);
      if (e) e.scrollIntoView({ block: 'nearest' });
      done();
    }

    async function addImages(files, afterId, replaceEmpty) {
      files = Array.from(files || []).filter(f => /^image\//.test(f.type));
      if (!files.length) return;
      before();
      let ref = byId(afterId) || blocks[blocks.length - 1];
      let lastImg = null;
      for (const f of files) {
        const rec = await S.addImage(f, { kind: 'image', name: (f.name || '').replace(/\.[^.]+$/, '') });
        if (!alive) return;
        const nb = Object.assign(newBlock('image'), { src: rec.id, w: null, cap: '' });
        if (replaceEmpty && ref && ref.t === 'p' && !ref.html && blocks.indexOf(ref) >= 0) {
          const i = blocks.indexOf(ref);
          removeBlock(ref);
          insertAt(i, nb);
          replaceEmpty = false;
        } else insertAfter(blocks.indexOf(ref) >= 0 ? ref : blocks[blocks.length - 1], nb);
        ref = nb;
        lastImg = nb;
      }
      const i = blocks.indexOf(lastImg);
      if (i === blocks.length - 1) insertAt(blocks.length, newBlock('p'));
      const next = blocks[i + 1];
      if (next && TEXT[next.t]) focusBlock(next.id, 0);
      done();
    }

    function insertImage(rec) {
      before();
      const ref = byId(lastId) || blocks[blocks.length - 1];
      const nb = Object.assign(newBlock('image'), { src: rec.id, w: null, cap: '' });
      if (ref.t === 'p' && !ref.html && !ref.indent) { const i = blocks.indexOf(ref); removeBlock(ref); insertAt(i, nb); }
      else insertAfter(ref, nb);
      const i = blocks.indexOf(nb);
      if (i === blocks.length - 1) insertAt(blocks.length, newBlock('p'));
      const next = blocks[i + 1];
      if (next && TEXT[next.t]) focusBlock(next.id, 0);
      done();
      requestAnimationFrame(() => { const e = els.get(nb.id); if (e) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
    }

    function pickFiles() {
      return new Promise(res => {
        const inp = h('input', { type: 'file', accept: 'image/*', multiple: true });
        inp.addEventListener('change', () => res(Array.from(inp.files || [])));
        inp.click();
      });
    }

    /* ----- the slash menu ----- */
    const slash = { open: false, el: null, id: null, start: 0, items: [], idx: 0 };
    function closeSlash() {
      if (!slash.open) return;
      slash.open = false;
      if (slash.el) slash.el.remove();
      slash.el = null;
    }
    function drawSlash(te) {
      const m = slash.el;
      U.clear(m);
      if (!slash.items.length) m.append(h('div.menu-head', 'No block matches that'));
      slash.items.forEach((it, i) => m.append(h('div.menu-item' + (i === slash.idx ? '.hot' : ''), { dataset: { i: String(i) } },
        ZN.icon(it.icon, 17), h('span.menu-label', it.label, h('small', it.sub)))));
      const r = C.rect(te);
      ui.place(m, { x: r.left, y: r.bottom + 6, top: r.top });
      const hot = m.querySelector('.hot');
      if (hot) hot.scrollIntoView({ block: 'nearest' });
    }
    function updateSlash(te) {
      const off = C.offset(te), text = te.textContent;
      if (off <= slash.start || text.charAt(slash.start) !== '/') { closeSlash(); return; }
      const q = text.slice(slash.start + 1, off).replace(/ /g, ' ').toLowerCase();
      if (q.length > 22 || /\s$/.test(q) && !MENU.some(it => it.label.toLowerCase().indexOf(q.trim()) === 0 && q.trim())) { closeSlash(); return; }
      const items = MENU.filter(it => !q || it.label.toLowerCase().indexOf(q) >= 0 || it.keys.indexOf(q) >= 0);
      if (!items.length && q.length > 6) { closeSlash(); return; }
      if (items.length !== slash.items.length) slash.idx = 0;
      slash.items = items;
      slash.idx = Math.min(slash.idx, Math.max(0, items.length - 1));
      drawSlash(te);
    }
    function openSlash(b, te) {
      const off = C.offset(te);
      const prevCh = te.textContent.charAt(off - 2);
      if (off >= 2 && !/\s/.test(prevCh)) return;       // only at the start of a line or after a space
      closeSlash();
      slash.open = true;
      slash.id = b.id;
      slash.start = off - 1;
      slash.idx = 0;
      slash.items = [];
      slash.el = h('div.menu.slash-menu');
      slash.el.addEventListener('mousedown', e => {
        e.preventDefault();
        const it = e.target.closest('[data-i]');
        if (it) pickSlash(+it.dataset.i);
      });
      layer.appendChild(slash.el);
      updateSlash(te);
    }
    function slashKey(e) {
      const n = slash.items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!n) return false;
        e.preventDefault();
        slash.idx = (slash.idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        const te = textOfBlock(byId(slash.id));
        if (te) drawSlash(te);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!n) { closeSlash(); return false; }
        e.preventDefault();
        pickSlash(slash.idx);
        return true;
      }
      if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return true; }
      return false;
    }
    function pickSlash(i) {
      const it = slash.items[i], b = byId(slash.id);
      const te = textOfBlock(b);
      if (!it || !b || !te) { closeSlash(); return; }
      before();
      const off = Math.max(C.offset(te), slash.start + 1);
      const r = textRange(te, slash.start, off);
      r.deleteContents();
      const s = window.getSelection();
      s.removeAllRanges();
      r.collapse(true);
      s.addRange(r);
      closeSlash();
      if (te.innerHTML === '<br>' || te.textContent === '') te.innerHTML = '';
      b.html = readHTML(b, te);
      const empty = te.textContent === '';

      if (it.t === 'date') {
        document.execCommand('insertText', false, new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ' ');
        return;
      }
      if (it.t === 'divider') {
        let d;
        if (empty && b.t === 'p') { b.t = 'divider'; b.html = ''; replaceEl(b); d = b; }
        else d = insertAfter(b, newBlock('divider'));
        const nb = insertAfter(d, newBlock('p'));
        focusBlock(nb.id, 0);
        done();
        return;
      }
      if (it.t === 'image') {
        done();
        pickFiles().then(files => { if (alive) addImages(files, b.id, true); });
        return;
      }
      if (it.t === 'snip') {
        done();
        lastId = b.id;
        if (ZN.snip) ZN.snip.start(); else ui.toast('The snipping tool is not available.');
        return;
      }
      if (it.t === 'page') {
        const sub = S.create({ type: 'note', parentId: page.id });
        const pb = { id: U.uid(), t: 'page', pageId: sub.id };
        if (empty && b.t === 'p') { const k = blocks.indexOf(b); removeBlock(b); insertAt(k, pb); } else insertAfter(b, pb);
        if (blocks[blocks.length - 1] === pb) insertAt(blocks.length, newBlock('p'));
        done();
        S.settings.expanded[page.id] = true;
        S.saveSettings();
        S.flush();
        ZN.openPage(sub.id);
        setTimeout(() => { const v = ZN.shell.view(); if (v && v.focusTitle) v.focusTitle(); }, 40);
        return;
      }
      if (b.t === 'p' || empty) retype(b, it.t);
      else { const nb = insertAfter(b, newBlock(it.t)); if (b.indent) setIndent(nb, b.indent); focusBlock(nb.id, 0); }
      done();
    }

    /* ----- markdown-style shortcuts typed at the start of a plain line ----- */
    function shortcut(b, te) {
      const off = C.offset(te);
      if (off > 5) return;
      const head = te.textContent.slice(0, off).replace(/ /g, ' ');
      let t = null, checked = false;
      if (head === '# ') t = 'h1';
      else if (head === '## ') t = 'h2';
      else if (head === '### ') t = 'h3';
      else if (head === '- ' || head === '* ') t = 'ul';
      else if (/^\d{1,2}[.)] $/.test(head)) t = 'ol';
      else if (head === '[] ' || head === '[ ] ') t = 'todo';
      else if (head === '[x] ' || head === '[X] ') { t = 'todo'; checked = true; }
      else if (head === '> ') t = 'quote';
      else if (head === '>> ') t = 'toggle';
      else if (head === '```') t = 'code';
      else if (head === '---') t = 'divider';
      if (!t) return;
      before();
      textRange(te, 0, off).deleteContents();
      if (te.innerHTML === '<br>' || te.textContent === '') te.innerHTML = '';
      b.html = readHTML(b, te);
      if (t === 'divider') {
        const rest = b.html;
        b.t = 'divider'; b.html = '';
        replaceEl(b);
        const nb = insertAfter(b, newBlock('p', rest));
        focusBlock(nb.id, 0);
      } else {
        C.set(te, 0);
        retype(b, t);
        if (checked) { b.checked = true; replaceEl(b); focusBlock(b.id, 0); }
      }
      done();
    }

    /* ----- inline formatting ----- */
    function fmt(kind, arg) {
      const s = window.getSelection();
      if (!s.rangeCount) return;
      const node = s.anchorNode;
      const te = node && (node.nodeType === 1 ? node : node.parentElement).closest('.blk-text');
      if (!te || !blocksEl.contains(te)) return;
      const b = blockOfText(te);
      if (!b || b.t === 'code') return;
      if (kind === 'link') { makeLink(te, b); return; }
      before();
      if (kind === 'bold' || kind === 'italic' || kind === 'underline' || kind === 'strikeThrough') document.execCommand(kind);
      else if (kind === 'code') toggleWrap(te, 'code', '', 'code');
      else if (kind === 'hl') toggleWrap(te, 'mark', 'hl-' + arg, 'mark');
      else if (kind === 'ink') toggleWrap(te, 'span', 'ink-' + arg, 'span[class^="ink-"]');
      else if (kind === 'clear') {
        document.execCommand('removeFormat');
        document.execCommand('unlink');
        toggleWrap(te, 'mark', null, 'mark');
        toggleWrap(te, 'span', null, 'span[class^="ink-"]');
        toggleWrap(te, 'code', null, 'code');
      }
      b.html = readHTML(b, te);
      commit();
      changed();
      updateBar();
    }

    async function makeLink(te, b) {
      const s = window.getSelection();
      const saved = s.getRangeAt(0).cloneRange();
      const inA = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('a');
      hideBar();
      const url = await ui.prompt('Link', inA ? inA.getAttribute('href') : '', { placeholder: 'https://…', ok: 'Save link', message: 'Paste or type a web address. Leave it empty to remove the link.' });
      if (url === null || !alive) return;
      before();
      te.focus({ preventScroll: true });
      s.removeAllRanges();
      s.addRange(saved);
      if (!url) document.execCommand('unlink');
      else {
        document.execCommand('createLink', false, /^(https?:|mailto:)/i.test(url) ? url : 'https://' + url);
        te.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
      }
      b.html = readHTML(b, te);
      commit();
      changed();
    }

    const bar = h('div.fmt-bar', { hidden: true });
    const fb = (label, kind, arg, tip) => h('button.fmt-btn', {
      type: 'button', tabindex: '-1', 'data-tip': tip, 'data-tip-side': 'top', 'aria-label': tip.split('|')[0],
      onmousedown: e => { e.preventDefault(); fmt(kind, arg); }
    }, label);
    U.append(bar, [
      fb(h('b', 'B'), 'bold', null, 'Bold|Ctrl B'), fb(h('i', 'I'), 'italic', null, 'Italic|Ctrl I'),
      fb(h('u', 'U'), 'underline', null, 'Underline|Ctrl U'), fb(h('s', 'S'), 'strikeThrough', null, 'Strikethrough|Ctrl Shift X'),
      fb(ZN.icon('code', 15), 'code', null, 'Code|Ctrl E'), fb(ZN.icon('link', 15), 'link', null, 'Link|Ctrl K'),
      h('span.fmt-sep'),
      HL.map(c => fb(h('span.fmt-hl', { style: { background: 'var(--hl' + (c === 'yellow' ? '' : '-' + c) + ')' } }), 'hl', c,
        c[0].toUpperCase() + c.slice(1) + ' highlighter' + (c === 'yellow' ? '|Ctrl Shift H' : ''))),
      h('span.fmt-sep'),
      INK.map(c => fb(h('span.fmt-ink', { style: { color: 'var(--' + c + ')' } }, 'A'), 'ink', c, c[0].toUpperCase() + c.slice(1) + ' ink')),
      h('span.fmt-sep'),
      fb(ZN.icon('eraser', 15), 'clear', null, 'Clear formatting')]);
    layer.appendChild(bar);
    function hideBar() { bar.hidden = true; }
    function updateBar() {
      if (!alive) return;
      const s = window.getSelection();
      if (mouseDown || !s.rangeCount || s.isCollapsed || sel.size) { hideBar(); return; }
      const r = s.getRangeAt(0);
      const c = r.commonAncestorContainer;
      const te = (c.nodeType === 1 ? c : c.parentElement).closest('.blk-text');
      if (!te || !blocksEl.contains(te) || te.closest('.blk').dataset.t === 'code' || !r.toString().trim()) { hideBar(); return; }
      const rect = r.getBoundingClientRect();
      if (!rect.width && !rect.height) { hideBar(); return; }
      bar.hidden = false;
      const bw = bar.offsetWidth, bh = bar.offsetHeight;
      let y = rect.top - bh - 9;
      if (y < 54) y = rect.bottom + 9;
      bar.style.left = Math.round(U.clamp(rect.left + rect.width / 2 - bw / 2, 8, window.innerWidth - bw - 8)) + 'px';
      bar.style.top = Math.round(y) + 'px';
    }
    const queueBar = U.frame(updateBar);

    /* ----- keyboard ----- */
    function blockSelKey(e, mod) {
      const ids = selIds();
      const k = e.key, lk = k.toLowerCase();
      if (mod && lk === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && lk === 'y') { e.preventDefault(); redo(); return; }
      if (mod && lk === 'a') { e.preventDefault(); selectBlocks(blocks.map(b => b.id)); return; }
      if (mod && lk === 'd') { e.preventDefault(); duplicate(ids); return; }
      if (mod) return;                                    // Ctrl+C / Ctrl+X arrive as copy / cut events
      if (k === 'Escape') {
        e.preventDefault();
        const b = byId(ids[0]);
        clearSel();
        if (b && TEXT[b.t]) focusBlock(b.id, 'end');
        return;
      }
      if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); deleteBlocks(ids); return; }
      if (k === 'Enter') {
        e.preventDefault();
        const b = byId(ids[ids.length - 1]);
        clearSel();
        if (TEXT[b.t]) focusBlock(b.id, 'end');
        else { before(); const nb = insertAfter(b, newBlock('p')); focusBlock(nb.id, 0); done(); }
        return;
      }
      if (k === 'Tab') { e.preventDefault(); indentBlocks(ids, e.shiftKey ? -1 : 1); return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        const up = k === 'ArrowUp';
        if (e.altKey) { moveBlocks(ids, up ? -1 : 1); return; }
        if (e.shiftKey) {
          const from = byId(selFocus && sel.has(selFocus) ? selFocus : (up ? ids[0] : ids[ids.length - 1]));
          const t = from ? (up ? prevVisible(from) : nextVisible(from)) : null;
          if (!t) return;
          selFocus = t.id;
          selectRange(selAnchor || ids[0], t.id);
          els.get(t.id).scrollIntoView({ block: 'nearest' });
          return;
        }
        const cur = byId(up ? ids[0] : ids[ids.length - 1]);
        const t = cur ? (up ? prevVisible(cur) : nextVisible(cur)) : null;
        if (!t) return;
        if (ids.length === 1 && !TEXT[cur.t] && TEXT[t.t]) { clearSel(); focusBlock(t.id, up ? 'end' : 0); }
        else { selectBlocks([t.id]); els.get(t.id).scrollIntoView({ block: 'nearest' }); }
      }
    }

    function isAllSelected(te) {
      const s = window.getSelection();
      if (!s.rangeCount) return false;
      return s.toString().length >= te.textContent.length;
    }

    function onKeyDown(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (sel.size) { blockSelKey(e, mod); return; }
      const te = e.target.closest ? e.target.closest('.blk-text') : null;
      if (!te) return;
      const b = blockOfText(te);
      if (!b) return;
      if (slash.open && slashKey(e)) return;
      const k = e.key, lk = k.toLowerCase();
      const collapsed = window.getSelection().isCollapsed;

      if (mod && !e.altKey) {
        if (lk === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (lk === 'y') { e.preventDefault(); redo(); return; }
        if (lk === 'a') { if (isAllSelected(te)) { e.preventDefault(); selectBlocks(blocks.map(x => x.id)); } return; }
        if (lk === 'd' && !e.shiftKey) { e.preventDefault(); duplicate([b.id]); return; }
        if (k === 'Enter' && b.t === 'todo') { e.preventDefault(); toggleCheck(b); return; }
        if (b.t !== 'code') {
          if (lk === 'e' && !e.shiftKey) { e.preventDefault(); fmt('code'); return; }
          if (lk === 'h' && e.shiftKey) { e.preventDefault(); fmt('hl', 'yellow'); return; }
          if (lk === 'x' && e.shiftKey) { e.preventDefault(); fmt('strikeThrough'); return; }
          if (lk === 'k' && !e.shiftKey && !collapsed) { e.preventDefault(); fmt('link'); return; }
        }
      }
      if (e.altKey && !mod && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); moveBlocks([b.id], k === 'ArrowUp' ? -1 : 1); return; }

      if (k === 'Enter' && !e.isComposing) {
        if (b.t === 'code') {
          if (mod || e.shiftKey) { e.preventDefault(); before(); b.html = readHTML(b, te); const nb = insertAfter(b, newBlock('p')); focusBlock(nb.id, 0); done(); }
          return;                                           // plain Enter is a new line inside the code
        }
        e.preventDefault();
        if (e.shiftKey) { document.execCommand('insertLineBreak'); return; }
        enter(b, te);
        return;
      }
      if (k === 'Backspace') {
        if (collapsed && C.atStart(te)) { e.preventDefault(); backspaceAtStart(b, te); }
        return;
      }
      if (k === 'Delete') {
        if (collapsed && C.atEnd(te)) { e.preventDefault(); deleteAtEnd(b, te); }
        return;
      }
      if (k === 'Tab') {
        e.preventDefault();
        if (b.t === 'code' && !e.shiftKey) { document.execCommand('insertText', false, '  '); return; }
        indentBlocks([b.id], e.shiftKey ? -1 : 1);
        return;
      }
      if ((k === 'ArrowUp' || k === 'ArrowDown') && !e.shiftKey && !mod && !e.altKey) {
        const up = k === 'ArrowUp';
        const r = C.rect(te), tb = te.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(te).lineHeight) || 28;
        const edge = up ? r.top - tb.top < lh * 0.7 : tb.bottom - r.bottom < lh * 0.7;
        if (!edge) return;
        const t = up ? prevVisible(b) : nextVisible(b);
        if (!t) { if (up) { e.preventDefault(); head.focusTitle(); } return; }
        e.preventDefault();
        if (TEXT[t.t]) { C.setAtX(textOfBlock(t), r.left, up); lastId = t.id; }
        else selectBlocks([t.id]);
        return;
      }
      if (k === 'ArrowLeft' && collapsed && !e.shiftKey && C.atStart(te)) {
        const p = prevVisible(b);
        if (p) { e.preventDefault(); if (TEXT[p.t]) focusBlock(p.id, 'end'); else selectBlocks([p.id]); }
        return;
      }
      if (k === 'ArrowRight' && collapsed && !e.shiftKey && C.atEnd(te)) {
        const n = nextVisible(b);
        if (n) { e.preventDefault(); if (TEXT[n.t]) focusBlock(n.id, 0); else selectBlocks([n.id]); }
        return;
      }
      if (k === 'Escape') { e.preventDefault(); selectBlocks([b.id]); }
    }

    function toggleCheck(b) {
      before();
      b.checked = !b.checked;
      const e = els.get(b.id);
      e.classList.toggle('done', b.checked);
      const c = e.querySelector('.chk');
      if (c) { c.classList.toggle('on', b.checked); c.setAttribute('aria-pressed', String(b.checked)); }
      commit();
      changed();
    }

    /* ----- typing ----- */
    function onBeforeInput(e) {
      if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); return; }
      if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); return; }
      if (!typing) { typing = true; if (hi >= 0) hist[hi].caret = caretState(); }
    }
    function onInput(e) {
      const te = e.target.closest ? e.target.closest('.blk-text') : null;
      if (!te) return;
      const b = blockOfText(te);
      if (!b) return;
      if (e.isComposing) { b.html = readHTML(b, te); changed(); return; }
      if (te.innerHTML === '<br>') te.innerHTML = '';
      b.html = readHTML(b, te);
      changed();
      typingCommit();
      if (b.t === 'code') return;
      if (slash.open) { if (slash.id === b.id) updateSlash(te); else closeSlash(); return; }
      if (e.inputType !== 'insertText' && e.inputType !== 'insertCompositionText') return;
      const last = (e.data || '').slice(-1);
      if (last === '/') openSlash(b, te);
      else if (b.t === 'p' && (last === ' ' || last === ' ' || last === '-' || last === '`')) shortcut(b, te);
    }

    /* ----- clipboard ----- */
    function plainLine(b) {
      const ind = '  '.repeat(b.indent || 0), t = U.text(b.html || '');
      switch (b.t) {
        case 'h1': return '# ' + t;
        case 'h2': return '## ' + t;
        case 'h3': return '### ' + t;
        case 'ul': return ind + '- ' + t;
        case 'ol': return ind + '1. ' + t;
        case 'todo': return ind + (b.checked ? '[x] ' : '[ ] ') + t;
        case 'quote': return '> ' + t;
        case 'divider': return '---';
        case 'image': return '[picture' + (b.cap ? ': ' + b.cap : '') + ']';
        case 'page': { const p = S.get(b.pageId); return '[page: ' + (p ? ZN.pageTitle(p) : 'deleted') + ']'; }
        default: return ind + t;
      }
    }
    function onCopy(e) {
      if (!sel.size) return;
      const ids = selIds();
      const data = ids.map(byId);
      e.clipboardData.setData('application/x-znote-blocks', JSON.stringify(data));
      e.clipboardData.setData('text/plain', data.map(plainLine).join('\n'));
      e.preventDefault();
      if (e.type === 'cut') deleteBlocks(ids);
    }
    function pasteBlocks(list, after) {
      const made = [];
      (Array.isArray(list) ? list : []).forEach(x => {
        if (!x || typeof x.t !== 'string') return;
        const b = { id: U.uid(), t: x.t };
        if (TEXT[x.t]) b.html = x.t === 'code' ? U.esc(U.text(String(x.html || ''))) : U.cleanHTML(String(x.html || ''));
        else if (x.t === 'image') { b.src = String(x.src || ''); b.w = +x.w || null; b.cap = String(x.cap || ''); }
        else if (x.t === 'page') b.pageId = String(x.pageId || '');
        else if (x.t !== 'divider') return;
        if (x.t === 'todo') b.checked = !!x.checked;
        if (x.t === 'toggle') b.open = x.open !== false;
        if (+x.indent > 0) b.indent = Math.min(MAX_INDENT, +x.indent);
        made.push(b);
      });
      if (!made.length) return;
      before();
      let ref = after || blocks[blocks.length - 1];
      made.forEach(nb => { ref = insertAfter(ref, nb); });
      selectBlocks(made.map(b => b.id));
      done();
    }
    function onPaste(e) {
      const cd = e.clipboardData;
      if (!cd) return;
      const te = e.target.closest ? e.target.closest('.blk-text') : null;
      const cur = te ? blockOfText(te) : (sel.size ? byId(selIds().pop()) : byId(lastId));
      const files = Array.from(cd.files || []).filter(f => /^image\//.test(f.type));
      if (files.length) { e.preventDefault(); addImages(files, cur ? cur.id : null, true); return; }
      const own = cd.getData('application/x-znote-blocks');
      if (own) {
        e.preventDefault();
        try { pasteBlocks(JSON.parse(own), cur); } catch (err) { console.warn('[Z Note] could not paste blocks', err); }
        return;
      }
      if (!te) return;
      e.preventDefault();
      const text = (cd.getData('text/plain') || '').replace(/\r\n?/g, '\n');
      if (!text) return;
      const b = cur;
      const lines = text.split('\n');
      if (b.t === 'code') { document.execCommand('insertText', false, text); return; }
      if (lines.filter(l => l.trim()).length <= 1) {
        const one = text.trim();
        if (/^https?:\/\/\S+$/i.test(one)) {
          if (!window.getSelection().isCollapsed) { before(); document.execCommand('createLink', false, one); te.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; }); b.html = readHTML(b, te); commit(); changed(); }
          else document.execCommand('insertHTML', false, '<a href="' + U.esc(one) + '" target="_blank" rel="noopener">' + U.esc(one) + '</a>&nbsp;');
        } else document.execCommand('insertText', false, text.replace(/\n/g, ' '));
        return;
      }
      const made = linesToBlocks(lines);
      if (!made.length) return;
      before();
      const r = C.range();
      if (!r.collapsed) r.deleteContents();
      const tail = document.createRange();
      tail.selectNodeContents(te);
      tail.setStart(r.startContainer, r.startOffset);
      const box = document.createElement('div');
      box.appendChild(tail.extractContents());
      const tailHTML = box.textContent === '' ? '' : box.innerHTML;
      if (te.innerHTML === '<br>' || te.textContent === '') te.innerHTML = '';
      b.html = readHTML(b, te);
      const first = made[0];
      let rest = made.slice(1);
      if (te.textContent === '' && b.t === 'p' && TEXT[first.t]) {
        b.t = first.t; b.html = first.html;
        if (first.t === 'todo') b.checked = first.checked;
        if (first.indent) b.indent = first.indent;
        replaceEl(b);
      } else if (TEXT[first.t]) {
        te.insertAdjacentHTML('beforeend', first.html);
        b.html = readHTML(b, te);
      } else rest = made;
      let ref = b;
      rest.forEach(nb => { ref = insertAfter(ref, nb); });
      if (!TEXT[ref.t]) ref = insertAfter(ref, newBlock('p'));
      const lte = textOfBlock(ref);
      const off = lte.textContent.length;
      if (tailHTML) { lte.insertAdjacentHTML('beforeend', tailHTML); ref.html = readHTML(ref, lte); }
      focusBlock(ref.id, off);
      els.get(ref.id).scrollIntoView({ block: 'nearest' });
      done();
    }

    /* ----- mouse ----- */
    function blockMenu(anchor, b) {
      selectBlocks([b.id]);
      const ids = [b.id];
      ui.menu(anchor, [
        TEXT[b.t] ? {
          label: 'Turn into', icon: 'para',
          items: MENU.filter(m => TEXT[m.t]).map(m => ({
            label: m.label, icon: m.icon, checked: m.t === b.t,
            onClick: () => { before(); retype(b, m.t); clearSel(); focusBlock(b.id, 'end'); done(); }
          }))
        } : null,
        b.t === 'image' ? { label: 'Open picture', icon: 'open', onClick: () => ui.lightbox(b.src) } : null,
        b.t === 'image' && b.w ? { label: 'Back to full size', icon: 'fit', onClick: () => { before(); b.w = null; replaceEl(b); done(); } } : null,
        { label: 'Duplicate', icon: 'copy', hint: 'Ctrl D', onClick: () => duplicate(ids) },
        { label: 'Move up', icon: 'arrowUp', hint: 'Alt ↑', onClick: () => moveBlocks(ids, -1) },
        { label: 'Move down', icon: 'arrowDown', hint: 'Alt ↓', onClick: () => moveBlocks(ids, 1) },
        { sep: true },
        { label: 'Delete', icon: 'trash', hint: 'Del', danger: true, onClick: () => deleteBlocks(ids) }
      ], { returnFocus: blocksEl });
    }

    function onClick(e) {
      const e2 = e.target.closest('.blk');
      if (!e2) return;
      const b = byId(e2.dataset.id);
      if (!b) return;
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'check') { toggleCheck(b); return; }
        if (a === 'fold') { before(); b.open = b.open === false; act.classList.toggle('open', b.open); done(); return; }
        if (a === 'add') {
          before();
          const i = blocks.indexOf(b);
          const nb = newBlock('p');
          if (b.indent) nb.indent = b.indent;
          insertAt((b.t === 'toggle' && b.open === false ? subtreeEnd(i) : i) + 1, nb);
          focusBlock(nb.id, 0);
          done();
          document.execCommand('insertText', false, '/');
          return;
        }
        if (a === 'open-page') { ZN.openPage(b.pageId); return; }
        if (a === 'img-open') { ui.lightbox(b.src); return; }
        if (a === 'img-copy') { S.getBlob(b.src).then(r => { if (r) ui.copyImage(r.blob); }); return; }
        if (a === 'img-del') { deleteBlocks([b.id]); return; }
      }
      const link = e.target.closest('a[href]');
      if (link && (e.ctrlKey || e.metaKey)) { e.preventDefault(); window.open(link.href, '_blank', 'noopener'); return; }
      if (b.t === 'image' && e.target.closest('.img-frame')) { selectBlocks([b.id]); return; }
      if (b.t === 'divider') selectBlocks([b.id]);
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      mouseDown = true;
      const e2 = e.target.closest('.blk');
      dragFrom = e2 && e.target.closest('.blk-text') ? e2.dataset.id : null;
      if (sel.size && !e.target.closest('.blk-gutter')) clearSel();
    }
    function onMouseMove(e) {
      if (!mouseDown || !dragFrom || !(e.buttons & 1)) return;
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const e2 = under && under.closest ? under.closest('.blk') : null;
      if (!e2 || !blocksEl.contains(e2)) return;
      if (e2.dataset.id === dragFrom && !sel.size) return;
      blocksEl.classList.add('selecting');
      selectRange(dragFrom, e2.dataset.id);
    }
    function onMouseUp() {
      if (!mouseDown) return;
      mouseDown = false;
      dragFrom = null;
      blocksEl.classList.remove('selecting');
      queueBar();
    }

    function onImgResize(e) {
      const hnd = e.target.closest('.img-resize');
      if (!hnd || e.button !== 0) return;
      e.preventDefault();
      const fig = hnd.closest('.blk-img'), b = byId(hnd.closest('.blk').dataset.id);
      const sx = e.clientX, sw = fig.getBoundingClientRect().width;
      const max = blocksEl.clientWidth - (b.indent || 0) * 26;
      const mv = ev => { fig.style.width = Math.round(U.clamp(sw + (ev.clientX - sx), 90, max)) + 'px'; };
      const up = () => {
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
        before();
        b.w = Math.round(fig.getBoundingClientRect().width);
        commit();
        changed();
      };
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
    }

    /* ----- wire up ----- */
    blocksEl.addEventListener('keydown', onKeyDown);
    blocksEl.addEventListener('beforeinput', onBeforeInput);
    blocksEl.addEventListener('input', onInput);
    blocksEl.addEventListener('paste', onPaste);
    blocksEl.addEventListener('copy', onCopy);
    blocksEl.addEventListener('cut', onCopy);
    blocksEl.addEventListener('click', onClick);
    blocksEl.addEventListener('mousedown', onMouseDown);
    blocksEl.addEventListener('pointerdown', onImgResize);
    blocksEl.addEventListener('dblclick', e => {
      const e2 = e.target.tagName === 'IMG' ? e.target.closest('.blk[data-t="image"]') : null;
      if (e2) ui.lightbox(byId(e2.dataset.id).src);
    });
    blocksEl.addEventListener('focusin', e => {
      const te = e.target.closest ? e.target.closest('.blk-text') : null;
      if (!te) return;
      lastId = te.closest('.blk').dataset.id;
      if (sel.size && !blocksEl.classList.contains('selecting')) clearSel();
    });
    blocksEl.addEventListener('focusout', e => {
      if (slash.open && !(e.relatedTarget && slash.el && slash.el.contains(e.relatedTarget))) closeSlash();
    });
    tailEl.addEventListener('mousedown', e => {
      e.preventDefault();
      const last = blocks[blocks.length - 1];
      if (last && last.t === 'p' && !last.html) { focusBlock(last.id, 0); return; }
      before();
      const nb = insertAt(blocks.length, newBlock('p'));
      focusBlock(nb.id, 0);
      done();
    });
    sheet.addEventListener('dragover', e => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    sheet.addEventListener('drop', e => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      const under = e.target.closest ? e.target.closest('.blk') : null;
      addImages(files, under ? under.dataset.id : null, false);
    });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', queueBar);
    el.addEventListener('scroll', queueBar, { passive: true });
    window.addEventListener('resize', queueBar);

    const offSort = ui.dragSort({
      container: blocksEl, item: '.blk', handle: '.blk-grip', scroller: el,
      group: item => {
        const id = item.dataset.id;
        const ids = sel.has(id) && sel.size > 1 ? selIds() : [id];
        const set = new Set(ids);
        ids.forEach(i => {
          const b = byId(i);
          if (b && b.t === 'toggle') { const k = blocks.indexOf(b); for (let j = k + 1; j <= subtreeEnd(k); j++) set.add(blocks[j].id); }
        });
        return blocks.filter(b => set.has(b.id)).map(b => els.get(b.id));
      },
      onClick: (item, handle) => blockMenu(handle, byId(item.dataset.id)),
      onDrop: (item, beforeEl, moved) => {
        before();
        const ids = new Set(moved.map(m => m.dataset.id));
        const group = blocks.filter(b => ids.has(b.id));
        const rest = blocks.filter(b => !ids.has(b.id));
        let at = beforeEl ? rest.findIndex(b => b.id === beforeEl.dataset.id) : rest.length;
        if (at < 0) at = rest.length;
        const next = rest.slice(0, at).concat(group, rest.slice(at));
        blocks.length = 0;
        next.forEach(b => blocks.push(b));
        renderAll();
        selectBlocks(group.map(b => b.id));
        done();
      }
    });

    /* sub-page links follow renames and deletions; the pattern follows style changes */
    const offTree = S.on('tree', U.frame(() => {
      if (!alive) return;
      blocks.forEach(b => { if (b.t === 'page') { const e = els.get(b.id); if (e) { const o = e.querySelector('.blk-page'); if (o) o.replaceWith(pageLinkEl(b)); } } });
    }));
    const offStyle = S.on('style', () => requestAnimationFrame(() => { if (alive) sync(); }));

    renderAll();
    commit();

    return {
      insertImage,
      focusTitle: head.focusTitle,
      unmount() {
        alive = false;
        typingCommit.flush();
        closeSlash();
        bar.remove();
        offSort();
        offTree();
        offStyle();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('selectionchange', queueBar);
        el.removeEventListener('scroll', queueBar);
        window.removeEventListener('resize', queueBar);
      }
    };
  };
})();
