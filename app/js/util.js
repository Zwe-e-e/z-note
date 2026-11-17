/* Z Note · small helpers shared by every module */
(function () {
  'use strict';
  const ZN = (window.ZN = window.ZN || {});
  const U = (ZN.util = {});

  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* h('div.card#id', {props}, ...children) → element */
  U.h = function (sel, props) {
    let tag = 'div', id = null;
    const cls = [];
    sel.split(/(?=[.#])/).forEach(part => {
      if (part[0] === '.') cls.push(part.slice(1));
      else if (part[0] === '#') id = part.slice(1);
      else if (part) tag = part;
    });
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (cls.length) el.className = cls.join(' ');
    let kids = Array.prototype.slice.call(arguments, 2);
    if (props != null && (typeof props !== 'object' || props.nodeType || Array.isArray(props))) {
      kids.unshift(props);
      props = null;
    }
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') { if (v) el.className += (el.className ? ' ' : '') + v; }
        else if (k === 'style' && typeof v === 'object') {
          for (const sk in v) {
            if (v[sk] == null) continue;
            if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk];
          }
        }
        else if (k === 'dataset') { for (const dk in v) if (v[dk] != null) el.dataset[dk] = v[dk]; }
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (typeof v === 'boolean') { if (k in el) el[k] = v; else el.setAttribute(k, ''); }
        else el.setAttribute(k, v);
      }
    }
    U.append(el, kids);
    return el;
  };

  U.append = function (el, kids) {
    for (const k of kids) {
      if (k == null || k === false || k === true) continue;
      if (Array.isArray(k)) U.append(el, k);
      else if (k.nodeType) el.appendChild(k);
      else el.appendChild(document.createTextNode(String(k)));
    }
    return el;
  };

  U.clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  U.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  U.debounce = function (fn, ms) {
    let t = null, lastArgs = null;
    const d = function () {
      lastArgs = arguments;
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(null, lastArgs); }, ms);
    };
    d.cancel = () => { clearTimeout(t); t = null; };
    d.flush = () => { if (t) { clearTimeout(t); t = null; fn.apply(null, lastArgs); } };
    return d;
  };

  /* collapse many calls into one per animation frame */
  U.frame = function (fn) {
    let queued = false, lastArgs = null;
    return function () {
      lastArgs = arguments;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn.apply(null, lastArgs); });
    };
  };

  /* ---------- text ---------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);

  const decoder = document.createElement('textarea');
  /* html → plain text, without ever parsing it as live DOM */
  U.text = function (html) {
    if (!html) return '';
    const s = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
    if (s.indexOf('&') < 0) return s;
    decoder.innerHTML = s;
    return decoder.value;
  };

  const INLINE_OK = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, DEL: 1, CODE: 1, KBD: 1, MARK: 1, A: 1, SPAN: 1, BR: 1, SUB: 1, SUP: 1 };
  /* keep only harmless inline formatting (used for pasted and imported text) */
  U.cleanHTML = function (html) {
    if (!html) return '';
    if (!/[<&]/.test(html)) return html;
    const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    const out = [];
    (function walk(node) {
      node.childNodes.forEach(n => {
        if (n.nodeType === 3) { out.push(U.esc(n.nodeValue)); return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') return;
        if (!INLINE_OK[tag]) { walk(n); return; }
        if (tag === 'BR') { out.push('<br>'); return; }
        let attrs = '';
        if (tag === 'A') {
          const href = n.getAttribute('href') || '';
          if (/^(https?:|mailto:|#)/i.test(href)) attrs = ' href="' + U.esc(href) + '" target="_blank" rel="noopener"';
        } else if (tag === 'SPAN' || tag === 'MARK') {
          const c = (n.getAttribute('class') || '').split(/\s+/).filter(x => /^(ink|hl)-[a-z]+$/.test(x)).join(' ');
          if (c) attrs = ' class="' + c + '"';
          else if (tag === 'SPAN') { walk(n); return; }
        }
        const t = tag.toLowerCase();
        out.push('<' + t + attrs + '>');
        walk(n);
        out.push('</' + t + '>');
      });
    })(doc.body);
    return out.join('');
  };

  /* ---------- dates ---------- */
  const p2 = n => String(n).padStart(2, '0');
  U.ymd = d => { d = d || new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  U.fromYmd = s => { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
  U.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  U.longDate = d => (d || new Date()).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  U.shortDate = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  U.dueInfo = function (ymd) {
    if (!ymd) return null;
    const today = U.fromYmd(U.ymd());
    const d = U.fromYmd(ymd);
    const diff = Math.round((d - today) / 864e5);
    let label;
    if (diff === 0) label = 'Today';
    else if (diff === 1) label = 'Tomorrow';
    else if (diff === -1) label = 'Yesterday';
    else if (diff > 1 && diff < 7) label = d.toLocaleDateString(undefined, { weekday: 'long' });
    else {
      const o = { day: 'numeric', month: 'short' };
      if (d.getFullYear() !== today.getFullYear()) o.year = 'numeric';
      label = d.toLocaleDateString(undefined, o);
    }
    return { label, diff, cls: diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'later' };
  };

  U.ago = function (ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) { const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago'; }
    return U.shortDate(ts);
  };

  /* "today", "tomorrow", "fri", "+3", "25/12", "2026-12-25" → yyyy-mm-dd (or null) */
  U.parseDue = function (tok) {
    if (!tok) return null;
    const t = tok.toLowerCase().trim();
    const now = new Date();
    if (t === 'today' || t === 'tod') return U.ymd(now);
    if (t === 'tomorrow' || t === 'tmr' || t === 'tom') return U.ymd(U.addDays(now, 1));
    if (t === 'nextweek' || t === 'next-week') return U.ymd(U.addDays(now, 7));
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const di = days.indexOf(t.slice(0, 3));
    if (di >= 0 && /^[a-z]+$/.test(t)) {
      let add = (di - now.getDay() + 7) % 7;
      if (add === 0) add = 7;
      return U.ymd(U.addDays(now, add));
    }
    let m = /^\+(\d{1,3})$/.exec(t);
    if (m) return U.ymd(U.addDays(now, +m[1]));
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m) return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]);
    m = /^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?$/.exec(t);
    if (m) {
      let day = +m[1], mon = +m[2];
      if (mon > 12 && day <= 12) { const x = day; day = mon; mon = x; }
      if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
      let y = m[3] ? +m[3] : now.getFullYear();
      if (y < 100) y += 2000;
      let d = new Date(y, mon - 1, day);
      if (!m[3] && d < U.fromYmd(U.ymd(now))) d = new Date(y + 1, mon - 1, day);
      return U.ymd(d);
    }
    return null;
  };

  /* ---------- caret helpers for contenteditable ---------- */
  U.caret = {
    range() {
      const sel = window.getSelection();
      return sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    },
    inside(el) {
      const r = U.caret.range();
      return !!(r && el.contains(r.startContainer));
    },
    offset(el) {
      const r = U.caret.range();
      if (!r || !el.contains(r.startContainer)) return 0;
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(r.startContainer, r.startOffset);
      return pre.toString().length;
    },
    /* offset: number of characters, or 'end' */
    set(el, offset) {
      const sel = window.getSelection();
      const r = document.createRange();
      let placed = false;
      if (typeof offset === 'number') {
        let rem = Math.max(0, offset), n;
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while ((n = w.nextNode())) {
          if (rem <= n.length) { r.setStart(n, rem); r.collapse(true); placed = true; break; }
          rem -= n.length;
        }
      }
      if (!placed) { r.selectNodeContents(el); r.collapse(offset === 0); }
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      sel.removeAllRanges();
      sel.addRange(r);
    },
    atStart(el) {
      const sel = window.getSelection();
      const r = U.caret.range();
      if (!r || !sel.isCollapsed || !el.contains(r.startContainer)) return false;
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(r.startContainer, r.startOffset);
      if (pre.toString().length) return false;
      return !pre.cloneContents().querySelector('br');
    },
    atEnd(el) {
      const sel = window.getSelection();
      const r = U.caret.range();
      if (!r || !sel.isCollapsed || !el.contains(r.startContainer)) return false;
      const post = document.createRange();
      post.selectNodeContents(el);
      post.setStart(r.endContainer, r.endOffset);
      return post.toString().length === 0;
    },
    /* viewport rect of the caret (falls back to the element's box when empty) */
    rect(el) {
      const r = U.caret.range();
      if (r) {
        const rects = r.getClientRects();
        if (rects.length) return rects[0];
        const b = r.getBoundingClientRect();
        if (b.height) return b;
      }
      const eb = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
      return { left: eb.left, right: eb.left, top: eb.top, bottom: eb.top + lh, height: lh, width: 0 };
    },
    /* put the caret in `el` as close as possible to a viewport x, on its first or last line */
    setAtX(el, x, last) {
      const eb = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
      const y = last ? eb.bottom - lh / 2 : eb.top + lh / 2;
      const cx = U.clamp(x, eb.left + 1, eb.right - 1);
      let r = null;
      if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(cx, y);
      else if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(cx, y);
        if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); }
      }
      if (r && el.contains(r.startContainer)) {
        el.focus({ preventScroll: true });
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } else U.caret.set(el, last ? 'end' : 0);
    }
  };

  /* ---------- images ---------- */
  U.imageSize = function (blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob).then(bm => { const s = { w: bm.width, h: bm.height }; if (bm.close) bm.close(); return s; })
        .catch(() => ({ w: 0, h: 0 }));
    }
    return new Promise(res => {
      const url = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res({ w: im.naturalWidth, h: im.naturalHeight }); };
      im.onerror = () => { URL.revokeObjectURL(url); res({ w: 0, h: 0 }); };
      im.src = url;
    });
  };

  U.download = function (blob, name) {
    const url = URL.createObjectURL(blob);
    const a = U.h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  U.blobToDataURL = blob => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });

  U.dataURLToBlob = function (dataURL) {
    const i = dataURL.indexOf(',');
    const mime = (/^data:([^;,]+)/.exec(dataURL) || [])[1] || 'application/octet-stream';
    const bin = atob(dataURL.slice(i + 1));
    const arr = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
    return new Blob([arr], { type: mime });
  };

  U.isEditable = function (el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
  };

  U.bytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };
})();
