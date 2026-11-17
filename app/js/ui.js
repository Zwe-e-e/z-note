/* Z Note · shared UI pieces: menus, popovers, dialogs, toasts, tooltips, drag-to-reorder */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h;
  const ui = (ZN.ui = {});
  const layer = () => document.getElementById('layer');

  /* ---------- floating placement ---------- */
  /* anchor: an element, or a point {x, y, top?} (top = upper edge to flip above) */
  function place(el, anchor, opts) {
    opts = opts || {};
    const pad = 8, vw = window.innerWidth, vh = window.innerHeight;
    el.style.left = '0px';
    el.style.top = '0px';
    const r = el.getBoundingClientRect();
    let x, y;
    if (anchor && anchor.nodeType) {
      const a = anchor.getBoundingClientRect();
      if (opts.side === 'right') {
        x = a.right + 8; y = a.top + a.height / 2 - r.height / 2;
        if (x + r.width > vw - pad) x = a.left - r.width - 8;
      } else if (opts.side === 'top') {
        x = a.left + a.width / 2 - r.width / 2; y = a.top - r.height - 8;
        if (y < pad) y = a.bottom + 8;
      } else {
        x = opts.align === 'end' ? a.right - r.width : opts.align === 'center' ? a.left + a.width / 2 - r.width / 2 : a.left;
        y = a.bottom + 6;
        if (y + r.height > vh - pad && a.top - r.height - 6 > pad) y = a.top - r.height - 6;
      }
    } else {
      x = anchor.x; y = anchor.y;
      if (y + r.height > vh - pad) y = (anchor.top != null ? anchor.top - 6 : y) - r.height;
    }
    x = U.clamp(x, pad, Math.max(pad, vw - r.width - pad));
    y = U.clamp(y, pad, Math.max(pad, vh - r.height - pad));
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  }
  ui.place = place;

  /* ---------- one floating panel at a time (menus, popovers) ---------- */
  let floater = null, suppress = null;

  function closeFloater() {
    if (!floater) return;
    const f = floater;
    floater = null;
    f.el.remove();
    document.removeEventListener('pointerdown', f.out, true);
    document.removeEventListener('keydown', f.key, true);
    window.removeEventListener('resize', closeFloater);
    window.removeEventListener('blur', closeFloater);
    if (f.onClose) f.onClose();
  }
  ui.closeMenu = closeFloater;
  ui.menuOpen = () => !!floater;

  function openFloater(el, anchor, opts) {
    opts = opts || {};
    closeFloater();
    layer().appendChild(el);
    place(el, anchor, opts);
    const f = { el, onClose: opts.onClose };
    f.out = e => {
      if (el.contains(e.target)) return;
      if (opts.keep && opts.keep.contains(e.target)) return;
      if (anchor && anchor.nodeType && anchor.contains(e.target)) suppress = { anchor, t: Date.now() };
      closeFloater();
    };
    f.key = e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      closeFloater();
      if (opts.returnFocus && opts.returnFocus.focus) opts.returnFocus.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', f.out, true);
    document.addEventListener('keydown', f.key, true);
    window.addEventListener('resize', closeFloater);
    window.addEventListener('blur', closeFloater);
    floater = f;
    return { el, close: () => { if (floater === f) closeFloater(); } };
  }
  /* true when `anchor` was just clicked to dismiss its own menu (so the click shouldn't reopen it) */
  function justClosedBy(anchor) {
    const s = suppress;
    suppress = null;
    return !!(s && anchor && s.anchor === anchor && Date.now() - s.t < 350);
  }

  ui.popover = function (anchor, content, opts) {
    if (justClosedBy(anchor)) return null;
    return openFloater(h('div.pop' + (opts && opts.className ? '.' + opts.className : ''), content), anchor, opts);
  };

  /* items: {label, icon|swatch|glyph, hint, sub, checked, danger, disabled, onClick, items} | {sep:true} | {head:'text'} | {custom: el} */
  ui.menu = function (anchor, items, opts) {
    opts = opts || {};
    if (!opts._nested && justClosedBy(anchor)) return null;
    const m = h('div.menu', { role: 'menu' });
    const fill = (list, parentList) => {
      U.clear(m);
      if (parentList) {
        const back = h('button.menu-item.menu-back', { type: 'button' }, ZN.icon('chevL', 15), h('span.menu-label', 'Back'));
        back.addEventListener('click', e => { e.stopPropagation(); fill(parentList, null); place(m, anchor, opts); focusFirst(); });
        m.appendChild(back);
        m.appendChild(h('div.menu-sep'));
      }
      list.forEach(it => {
        if (!it) return;
        if (it.sep) { m.appendChild(h('div.menu-sep')); return; }
        if (it.head) { m.appendChild(h('div.menu-head', it.head)); return; }
        if (it.custom) { m.appendChild(it.custom); return; }
        const row = h('button.menu-item' + (it.danger ? '.danger' : ''), { type: 'button', role: 'menuitem', disabled: !!it.disabled },
          it.icon ? ZN.icon(it.icon, 16) : it.swatch ? h('span.menu-swatch', { style: { background: it.swatch } }) : it.glyph ? h('span.menu-glyph', it.glyph) : h('span.menu-blank'),
          h('span.menu-label', it.label, it.sub ? h('small', it.sub) : null),
          it.hint ? h('span.menu-hint', it.hint) : null,
          it.checked ? h('span.menu-check', ZN.icon('check', 14)) : null,
          it.items ? h('span.menu-arrow', ZN.icon('chevR', 13)) : null);
        row.addEventListener('click', e => {
          e.stopPropagation();
          if (it.items) {
            fill(typeof it.items === 'function' ? it.items() : it.items, list);
            place(m, anchor, opts);
            focusFirst();
            return;
          }
          closeFloater();
          if (it.onClick) it.onClick(e);
        });
        m.appendChild(row);
      });
    };
    const focusFirst = () => {
      if (opts.noFocus) return;
      const first = m.querySelector('.menu-item:not(:disabled):not(.menu-back)') || m.querySelector('.menu-item:not(:disabled)');
      if (first) first.focus({ preventScroll: true });
    };
    fill(items, null);
    m.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const rows = Array.from(m.querySelectorAll('.menu-item:not(:disabled)'));
      if (!rows.length) return;
      let i = rows.indexOf(document.activeElement);
      i = e.key === 'ArrowDown' ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
      rows[i].focus({ preventScroll: true });
    });
    m.addEventListener('contextmenu', e => e.preventDefault());
    const f = openFloater(m, anchor, opts);
    focusFirst();
    return f;
  };

  /* ---------- dialogs ---------- */
  ui.modal = function (o) {
    o = o || {};
    const prevFocus = document.activeElement;
    const back = h('div.modal-back');
    const box = h('div.modal.sheet' + (o.className ? '.' + o.className : ''), { role: 'dialog', 'aria-modal': 'true' });
    if (o.width) box.style.width = o.width + 'px';
    let closed = false;
    function close(val) {
      if (closed) return;
      closed = true;
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) { try { prevFocus.focus({ preventScroll: true }); } catch (e) {} }
      if (o.onClose) o.onClose(val);
    }
    function onKey(e) {
      if (e.key === 'Escape' && !floater && o.dismissable !== false) { e.stopPropagation(); e.preventDefault(); close(); }
    }
    if (o.title) {
      box.appendChild(h('div.modal-head', h('h2.modal-title', o.title),
        o.dismissable === false ? null : h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, ZN.icon('x', 16))));
    }
    const body = h('div.modal-body');
    if (o.body) U.append(body, [o.body]);
    box.appendChild(body);
    if (o.buttons && o.buttons.length) {
      box.appendChild(h('div.modal-foot', o.buttons.map(b =>
        h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : '') + (b.quiet ? '.quiet' : ''), {
          type: 'button', onclick: () => { const r = b.onClick ? b.onClick() : undefined; if (r !== false) close(b.value); }
        }, b.label))));
    }
    back.appendChild(box);
    back.addEventListener('pointerdown', e => { if (e.target === back && o.dismissable !== false) close(); });
    document.addEventListener('keydown', onKey, true);
    layer().appendChild(back);
    const auto = box.querySelector('[autofocus]') || box.querySelector('.modal-foot .btn.primary') || box.querySelector('input, textarea, button');
    if (auto) auto.focus({ preventScroll: true });
    return { el: box, body, close };
  };

  ui.confirm = function (message, o) {
    o = o || {};
    return new Promise(resolve => {
      ui.modal({
        title: o.title || 'Are you sure?', width: 400,
        body: h('p.modal-text', message),
        buttons: [
          { label: o.cancel || 'Cancel', quiet: true, value: false },
          { label: o.ok || 'OK', primary: !o.danger, danger: !!o.danger, value: true }
        ],
        onClose: v => resolve(v === true)
      });
    });
  };

  ui.prompt = function (title, value, o) {
    o = o || {};
    return new Promise(resolve => {
      const input = h('input.input', { type: 'text', value: value || '', placeholder: o.placeholder || '', autofocus: true, maxlength: 200 });
      let m = null;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); m.close(input.value); } });
      m = ui.modal({
        title, width: 420, body: [o.message ? h('p.modal-text', o.message) : null, input],
        buttons: [{ label: 'Cancel', quiet: true, value: null }, { label: o.ok || 'Save', primary: true, onClick: () => { m.close(input.value); return false; } }],
        onClose: v => resolve(typeof v === 'string' ? v.trim() : null)
      });
      input.focus();
      input.select();
    });
  };

  /* ---------- toasts ---------- */
  ui.toast = function (msg, o) {
    o = o || {};
    let host = document.querySelector('.toasts');
    if (!host) { host = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); layer().appendChild(host); }
    const t = h('div.toast' + (o.error ? '.error' : ''), h('span', msg));
    let dead = false;
    const kill = () => { if (dead) return; dead = true; t.classList.add('out'); setTimeout(() => t.remove(), 220); };
    if (o.action) t.appendChild(h('button.toast-act', { type: 'button', onclick: () => { kill(); o.action.fn(); } }, o.action.label));
    host.appendChild(t);
    setTimeout(kill, o.ms || (o.action ? 6500 : 3200));
    return kill;
  };

  /* ---------- tooltips: any element with data-tip="Label|Shortcut" ---------- */
  let tipEl = null, tipTimer = null, tipFor = null;
  function hideTip() {
    clearTimeout(tipTimer);
    tipFor = null;
    if (tipEl) { tipEl.remove(); tipEl = null; }
  }
  function showTip(t) {
    if (!t.isConnected) return;
    const parts = (t.getAttribute('data-tip') || '').split('|');
    if (!parts[0]) return;
    tipEl = h('div.tip', h('span', parts[0]), parts[1] ? h('kbd', parts[1]) : null);
    layer().appendChild(tipEl);
    place(tipEl, t, { side: t.getAttribute('data-tip-side') || 'bottom', align: 'center' });
  }
  document.addEventListener('mouseover', e => {
    const t = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t === tipFor) return;
    hideTip();
    tipFor = t;
    if (t) tipTimer = setTimeout(() => showTip(t), 500);
  });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('keydown', hideTip, true);
  document.addEventListener('wheel', hideTip, { capture: true, passive: true });

  /* ---------- vertical drag-to-reorder ----------
     o: { container, item: selector, handle: selector, scroller?, onDrop(itemEl, beforeEl|null), onClick?(itemEl, handleEl, event), group?(itemEl) → [els moved together] } */
  ui.dragSort = function (o) {
    const c = o.container;
    function down(e) {
      if (e.button !== 0) return;
      const handle = e.target.closest(o.handle);
      if (!handle || !c.contains(handle)) return;
      const item = handle.closest(o.item);
      if (!item) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      let active = false, line = null, before, moved = [item], scrollTimer = null, lastY = sy;

      function update(y) {
        const items = Array.from(c.querySelectorAll(o.item)).filter(el => moved.indexOf(el) < 0 && el.offsetParent !== null);
        let target = null, ly = null;
        for (const el of items) {
          const r = el.getBoundingClientRect();
          if (y < r.top + r.height / 2) { target = el; ly = r.top; break; }
        }
        const cr = c.getBoundingClientRect();
        if (!target) { const last = items[items.length - 1]; ly = last ? last.getBoundingClientRect().bottom : cr.top; }
        before = target;
        line.style.left = cr.left + 'px';
        line.style.width = cr.width + 'px';
        line.style.top = (ly - 1) + 'px';
      }
      function move(ev) {
        if (!active) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
          active = true;
          if (o.group) moved = o.group(item) || [item];
          moved.forEach(el => el.classList.add('dragging'));
          document.body.classList.add('is-dragging');
          line = h('div.drop-line');
          layer().appendChild(line);
          if (o.scroller) scrollTimer = setInterval(() => {
            const sr = o.scroller.getBoundingClientRect();
            if (lastY < sr.top + 56) { o.scroller.scrollTop -= 14; update(lastY); }
            else if (lastY > sr.bottom - 56) { o.scroller.scrollTop += 14; update(lastY); }
          }, 30);
        }
        ev.preventDefault();
        lastY = ev.clientY;
        update(lastY);
      }
      function up(ev) {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        clearInterval(scrollTimer);
        if (!active) { if (o.onClick && ev.type === 'pointerup') o.onClick(item, handle, ev); return; }
        moved.forEach(el => el.classList.remove('dragging'));
        document.body.classList.remove('is-dragging');
        line.remove();
        if (ev.type === 'pointerup' && before !== undefined) o.onDrop(item, before || null, moved);
      }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    }
    c.addEventListener('pointerdown', down);
    return () => c.removeEventListener('pointerdown', down);
  };

  /* ---------- image viewer ---------- */
  ui.lightbox = async function (blobId) {
    const url = await ZN.store.blobURL(blobId);
    if (!url) { ui.toast('That image is no longer in your notebook.'); return; }
    const rec = await ZN.store.getBlob(blobId);
    const back = h('div.lightbox');
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    back.append(
      h('img', { src: url, alt: (rec && rec.name) || 'Image' }),
      h('div.lightbox-bar',
        h('button.btn.sm', { type: 'button', onclick: e => { e.stopPropagation(); ui.copyImage(rec.blob); } }, ZN.icon('copy', 15), 'Copy'),
        h('button.btn.sm', { type: 'button', onclick: e => { e.stopPropagation(); U.download(rec.blob, (rec.name || 'snip') + '.png'); } }, ZN.icon('download', 15), 'Download'),
        h('button.btn.sm', { type: 'button', onclick: close }, ZN.icon('x', 15), 'Close')));
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey, true);
    layer().appendChild(back);
  };

  ui.copyImage = async function (blob) {
    try {
      let png = blob;
      if (blob.type !== 'image/png') {
        const bm = await createImageBitmap(blob);
        const cv = document.createElement('canvas');
        cv.width = bm.width; cv.height = bm.height;
        cv.getContext('2d').drawImage(bm, 0, 0);
        png = await new Promise(r => cv.toBlob(r, 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      ui.toast('Copied to the clipboard');
    } catch (e) {
      ui.toast('Could not copy — the browser blocked clipboard access.', { error: true });
    }
  };

  /* ---------- pickers ---------- */
  const PAGE_ICONS = ['note', 'todo', 'board', 'book', 'bulb', 'star', 'heart', 'flag', 'pin', 'target', 'rocket', 'briefcase',
    'cap', 'person', 'calendar', 'clock', 'inbox', 'folder', 'tag', 'camera', 'image', 'pen', 'code', 'home', 'layout', 'data', 'snip', 'sun', 'moon', 'check'];
  const EMOJI = ['💡', '📌', '📝', '📚', '🏗️', '🧱', '📐', '🛠️', '📅', '✅', '🎯', '🚀', '🧠', '💬', '📷', '🗂️', '💰', '❤️', '🌱', '☕', '🏠', '✈️', '🎓', '⭐'];

  ui.iconPicker = function (anchor, current, onPick) {
    const grid = h('div.icon-grid', PAGE_ICONS.map(n =>
      h('button.ibtn' + (current === 'i:' + n ? '.on' : ''), { type: 'button', 'aria-label': n, onclick: () => { p.close(); onPick('i:' + n); } }, ZN.icon(n, 18))));
    const emo = h('div.icon-grid', EMOJI.map(e =>
      h('button.ibtn' + (current === e ? '.on' : ''), { type: 'button', onclick: () => { p.close(); onPick(e); } }, h('span.emoji', { style: { fontSize: '17px' } }, e))));
    const p = ui.popover(anchor, [
      h('div.menu-head', 'Ink icons'), grid,
      h('div.menu-head', 'Stickers'), emo,
      h('div.pop-foot', h('button.btn.sm.quiet', { type: 'button', onclick: () => { p.close(); onPick(''); } }, 'Use the default icon'))
    ], { className: 'icon-pop' });
    return p;
  };

  /* quick due-date choices + a calendar field */
  ui.datePicker = function (anchor, current, onPick) {
    const now = new Date();
    const opt = (label, d) => ({ label, hint: d ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '', onClick: () => onPick(d ? U.ymd(d) : null) });
    const toMon = ((8 - now.getDay()) % 7) || 7;
    const input = h('input.input', { type: 'date', value: current || '' });
    input.addEventListener('change', () => { if (input.value) { ui.closeMenu(); onPick(input.value); } });
    input.addEventListener('click', e => e.stopPropagation());
    return ui.menu(anchor, [
      Object.assign(opt('Today', now), { icon: 'sun' }),
      Object.assign(opt('Tomorrow', U.addDays(now, 1)), { icon: 'arrowUp' }),
      Object.assign(opt('Next Monday', U.addDays(now, toMon)), { icon: 'calendar' }),
      Object.assign(opt('In a week', U.addDays(now, 7)), { icon: 'clock' }),
      { sep: true },
      { custom: h('div.menu-custom', h('label.menu-head', 'Pick a date'), input) },
      current ? { sep: true } : null,
      current ? { label: 'No due date', icon: 'x', onClick: () => onPick(null) } : null
    ], { align: 'end' });
  };

  /* colour swatch row used by menus and toolbars: colors = [{id, css, label}] */
  ui.swatches = function (colors, current, onPick) {
    return h('div.swatches', colors.map(c =>
      h('button.swatch' + (c.id === current ? '.on' : ''), {
        type: 'button', 'aria-label': c.label || c.id, 'data-tip': c.label || null,
        style: { '--sw': c.css }, onclick: e => { e.stopPropagation(); onPick(c.id, e); }
      })));
  };
})();
