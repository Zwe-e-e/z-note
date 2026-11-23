/* Z Note · board — an endless sheet for sticky notes, shapes, arrows, ink and pictures.
   page.content = { items: [...], view: {x, y, k} | null }
   World units are CSS px at 100% zoom; an item's x,y is its top-left corner; array order is z-order. */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store, ui = ZN.ui;
  const clamp = U.clamp;

  /* ---------- vocabulary ---------- */
  const KINDS = { sticky: 1, text: 1, shape: 1, frame: 1, image: 1, ink: 1, line: 1 };
  const STICKY = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'paper', 'grey'];
  const STICKY_NAME = { yellow: 'Yellow', pink: 'Pink', blue: 'Blue', green: 'Green', orange: 'Orange', purple: 'Purple', paper: 'Paper', grey: 'Grey' };
  const INKS = ['ink', 'blue', 'red', 'green', 'amber', 'violet', 'teal'];
  const INK_NAME = { ink: 'Ink', blue: 'Blue', red: 'Red', green: 'Green', amber: 'Amber', violet: 'Violet', teal: 'Teal' };
  const HLS = ['amber', 'red', 'green', 'blue'];
  const HL_NAME = { amber: 'Yellow', red: 'Pink', green: 'Green', blue: 'Blue' };
  const HL_VAR = { amber: 'var(--hl)', red: 'var(--hl-pink)', green: 'var(--hl-green)', blue: 'var(--hl-blue)' };
  const SHAPES = ['rect', 'round', 'ellipse', 'diamond'];
  const SHAPE_ICON = { rect: 'square', round: 'square', ellipse: 'circle', diamond: 'diamond' };
  const SHAPE_NAME = { rect: 'Box', round: 'Rounded box', ellipse: 'Circle', diamond: 'Diamond' };
  const SHAPE_KEY = { rect: 'R', ellipse: 'O', diamond: 'D' };
  const TEXT_PX = { s: 16, m: 22, l: 32, xl: 48 };
  const MIN = { sticky: [56, 56], shape: [28, 28], frame: [90, 70], image: [24, 24], text: [40, 10], ink: [6, 6] };
  const ATTACH = { sticky: 1, text: 1, shape: 1, image: 1 };
  const EDITS = { sticky: 1, text: 1, shape: 1 };
  const TOOL_KEYS = { v: 'select', h: 'hand', n: 'sticky', t: 'text', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', p: 'pen', m: 'hl', e: 'eraser', f: 'frame' };
  const PEN_SIZES = [2, 3.5, 6.5], HL_SIZES = [12, 18, 28], SIZE_NAME = ['Thin', 'Medium', 'Thick'];
  const GAP = 7;      // breathing room between a connector and the thing it points at

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const f1 = n => Math.round(n * 10) / 10;
  const okInk = c => (INKS.indexOf(c) >= 0 ? c : 'ink');
  const inkVar = c => { c = okInk(c); return c === 'ink' ? 'var(--ink)' : 'var(--' + c + ')'; };
  const stVar = c => 'var(--st-' + (STICKY.indexOf(c) >= 0 ? c : 'yellow') + ')';
  const hlVar = c => HL_VAR[c] || inkVar(c);

  /* ---------- a small hand: seeded wobble so strokes look drawn, and stay the same each time ---------- */
  function hashSeed(str) {
    let x = 2166136261;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    return x >>> 0;
  }
  function prng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* one slightly bowed stroke from A to B */
  function rSeg(x1, y1, x2, y2, rnd, amp) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const a = Math.min(amp, len / 10 + 0.3);
    const j = () => (rnd() * 2 - 1) * a;
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    const bow = (rnd() * 2 - 1) * Math.min(len * 0.016, 4.5);
    const c1x = x1 + (x2 - x1) * 0.3 + nx * bow + j(), c1y = y1 + (y2 - y1) * 0.3 + ny * bow + j();
    const c2x = x1 + (x2 - x1) * 0.7 + nx * bow + j(), c2y = y1 + (y2 - y1) * 0.7 + ny * bow + j();
    return 'M' + f1(x1 + j()) + ' ' + f1(y1 + j()) + 'C' + f1(c1x) + ' ' + f1(c1y) + ' ' + f1(c2x) + ' ' + f1(c2y) + ' ' + f1(x2 + j()) + ' ' + f1(y2 + j());
  }
  /* the pencil goes over every line twice */
  const rLine = (x1, y1, x2, y2, rnd, amp) => rSeg(x1, y1, x2, y2, rnd, amp) + rSeg(x1, y1, x2, y2, rnd, amp);
  function rPoly(pts, rnd, amp) {
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      d += rLine(p[0], p[1], q[0], q[1], rnd, amp);
    }
    return d;
  }
  /* closed smooth curve through points (Catmull-Rom → Bézier) */
  function smoothClosed(p) {
    const n = p.length;
    let d = 'M' + f1(p[0][0]) + ' ' + f1(p[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
      d += 'C' + f1(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + f1(p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
        f1(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + f1(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + f1(p2[0]) + ' ' + f1(p2[1]);
    }
    return d;
  }
  function roughEllipse(w, hh, rnd, amp) {
    const cx = w / 2, cy = hh / 2, rx = w / 2, ry = hh / 2;
    const n = clamp(Math.round((rx + ry) / 9), 10, 30);
    let d = '';
    for (let pass = 0; pass < 2; pass++) {
      const off = rnd() * Math.PI * 2, grow = 1 + (rnd() - 0.5) * 0.02, pts = [];
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * rx * grow + (rnd() * 2 - 1) * amp, cy + Math.sin(a) * ry * grow + (rnd() * 2 - 1) * amp]);
      }
      d += smoothClosed(pts);
    }
    return d;
  }
  function roundPts(w, hh, r) {
    const pts = [];
    const edge = (x1, y1, x2, y2) => {
      const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 80));
      for (let i = 0; i <= n; i++) pts.push([x1 + (x2 - x1) * (i / n), y1 + (y2 - y1) * (i / n)]);
    };
    const k = r * 0.2929;
    edge(r, 0, w - r, 0); pts.push([w - k, k]);
    edge(w, r, w, hh - r); pts.push([w - k, hh - k]);
    edge(w - r, hh, r, hh); pts.push([k, hh - k]);
    edge(0, hh - r, 0, r); pts.push([k, k]);
    return pts;
  }
  function roughRound(w, hh, r, rnd, amp) {
    const base = roundPts(w, hh, r);
    let d = '';
    for (let pass = 0; pass < 2; pass++) d += smoothClosed(base.map(p => [p[0] + (rnd() * 2 - 1) * amp, p[1] + (rnd() * 2 - 1) * amp]));
    return d;
  }
  function roundPath(w, hh, r) {
    const a = 'A' + f1(r) + ' ' + f1(r) + ' 0 0 1 ';
    return 'M' + f1(r) + ' 0H' + f1(w - r) + a + f1(w) + ' ' + f1(r) + 'V' + f1(hh - r) + a + f1(w - r) + ' ' + f1(hh) +
      'H' + f1(r) + a + '0 ' + f1(hh - r) + 'V' + f1(r) + a + f1(r) + ' 0Z';
  }
  /* a hand-drawn arrow head at (tx, ty), for a stroke travelling along the unit vector (ux, uy) */
  function arrowHead(tx, ty, ux, uy, rnd, len) {
    const c = Math.cos(0.45), s = Math.sin(0.45), bx = -ux, by = -uy;
    const lx = bx * c - by * s, ly = bx * s + by * c, rx = bx * c + by * s, ry = -bx * s + by * c;
    return rSeg(tx + lx * len, ty + ly * len, tx, ty, rnd, 0.7) + rSeg(tx, ty, tx + rx * len, ty + ry * len, rnd, 0.7);
  }
  /* freehand points → a smooth path (quadratic curves through the midpoints) */
  function inkPath(p) {
    const n = p.length;
    if (!n) return '';
    let d = 'M' + f1(p[0][0]) + ' ' + f1(p[0][1]);
    if (n === 1) return d + 'l0.01 0';
    if (n === 2) return d + 'L' + f1(p[1][0]) + ' ' + f1(p[1][1]);
    for (let i = 1; i < n - 1; i++) {
      d += 'Q' + f1(p[i][0]) + ' ' + f1(p[i][1]) + ' ' + f1((p[i][0] + p[i + 1][0]) / 2) + ' ' + f1((p[i][1] + p[i + 1][1]) / 2);
    }
    return d + 'L' + f1(p[n - 1][0]) + ' ' + f1(p[n - 1][1]);
  }

  /* ---------- geometry ---------- */
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  function segHitsRect(a, b, x1, y1, x2, y2) {
    const inside = p => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
    if (inside(a) || inside(b)) return true;
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, a.x - x1) && clip(dx, x2 - a.x) && clip(-dy, a.y - y1) && clip(dy, y2 - a.y) && t0 <= t1;
  }
  /* Ramer–Douglas–Peucker */
  function simplify(pts, eps) {
    const n = pts.length;
    if (n < 3) return pts.slice();
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const seg = stack.pop(), a = seg[0], b = seg[1];
      let max = 0, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const d = distToSeg(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
        if (d > max) { max = d; idx = i; }
      }
      if (idx >= 0 && max > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }
  /* where a ray from the middle of `it` towards (tx, ty) leaves its outline, plus a small gap */
  function clipPoint(it, tx, ty) {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, dx = tx - cx, dy = ty - cy;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return { x: cx, y: cy };
    const hw = it.w / 2 + GAP, hh = it.h / 2 + GAP;
    let s;
    if (it.kind === 'shape' && it.shape === 'ellipse') s = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
    else if (it.kind === 'shape' && it.shape === 'diamond') s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    else s = Math.min(hw / (Math.abs(dx) || 1e-9), hh / (Math.abs(dy) || 1e-9));
    s = Math.min(s, 1);
    return { x: cx + dx * s, y: cy + dy * s };
  }
  /* the two drawn ends of a connector; attached ends are clipped at the item they point to */
  function lineEnds(it, get) {
    const a = it.a || {}, b = it.b || {};
    const A = a.id ? get(a.id) : null, B = b.id ? get(b.id) : null;
    const fa = A ? { x: A.x + A.w / 2, y: A.y + A.h / 2 } : a.id ? { x: it.x, y: it.y } : { x: num(a.x, it.x), y: num(a.y, it.y) };
    const fb = B ? { x: B.x + B.w / 2, y: B.y + B.h / 2 } : b.id ? { x: it.x + it.w, y: it.y + it.h } : { x: num(b.x, it.x + it.w), y: num(b.y, it.y + it.h) };
    return { a: A ? clipPoint(A, fb.x, fb.y) : fa, b: B ? clipPoint(B, fa.x, fa.y) : fb };
  }

  /* make loaded / pasted items safe to draw (drops what it cannot understand) */
  function sanitize(list) {
    const ids = {};
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (!it || typeof it !== 'object' || !KINDS[it.kind]) { list.splice(i, 1); continue; }
      it.id = it.id != null && !ids[String(it.id)] ? String(it.id) : U.uid() + i;
      it.x = num(it.x, 0); it.y = num(it.y, 0);
      it.w = Math.max(0, num(it.w, 120)); it.h = Math.max(0, num(it.h, 80));
      if (it.kind === 'ink') {
        it.pts = (Array.isArray(it.pts) ? it.pts : []).filter(q => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]));
        if (!it.pts.length) { list.splice(i, 1); continue; }
      }
      if (typeof it.text !== 'string' && (it.kind === 'sticky' || it.kind === 'text' || it.kind === 'shape')) it.text = it.text == null ? '' : String(it.text);
      ids[it.id] = it.kind;
    }
    list.forEach(it => {
      if (it.kind !== 'line') return;
      ['a', 'b'].forEach((k, n) => {
        const e = it[k], fallback = { x: it.x + (n ? it.w : 0), y: it.y + (n ? it.h : 0) };
        if (!e || typeof e !== 'object') it[k] = fallback;
        else if (e.id != null) { if (!ATTACH[ids[String(e.id)]]) it[k] = fallback; else it[k] = { id: String(e.id) }; }
        else it[k] = { x: num(e.x, fallback.x), y: num(e.y, fallback.y) };
      });
    });
    return list;
  }

  function textOf(page) {
    const out = [];
    const list = page && page.content && Array.isArray(page.content.items) ? page.content.items : [];
    list.forEach(it => {
      if (!it) return;
      if (it.kind === 'frame') { if (it.title) out.push(String(it.title)); }
      else if (typeof it.text === 'string' && it.text) { const t = U.text(it.text).trim(); if (t) out.push(t); }
    });
    return out.join('\n');
  }
  ZN.board = { textOf };

  /* ============================================================ the view ============================================================ */
  ZN.views.board = function (el, page) {
    if (!page.content || typeof page.content !== 'object') page.content = { items: [], view: null };
    const content = page.content;
    if (!Array.isArray(content.items)) content.items = [];
    let items = sanitize(content.items);

    const prefs = Object.assign({ sticky: 'yellow', pen: 'ink', penSize: 3.5, hl: 'amber', hlSize: 18, shape: 'rect', arrow: 'end' }, S.settings.boardPrefs || {});
    const savePrefs = () => S.setSetting('boardPrefs', Object.assign({}, prefs));

    const els = new Map(), map = new Map(), toolBtns = {}, fitQ = new Set();
    const get = id => map.get(id);
    const view = { x: 0, y: 0, k: 1 };
    const pointer = { sx: 0, sy: 0, inside: false };
    const hist = { stack: [], idx: -1 };
    let tool = 'select', sel = new Set(), editing = null, gesture = null;
    let spaceDown = false, alive = true, selRect = null, fitRaf = 0;
    let lastClick = { t: 0, x: 0, y: 0, id: null };

    /* ---------- furniture ---------- */
    el.classList.add('fill');
    const world = h('div.b-world');
    const selLayer = h('div.b-sel');
    const attachEl = h('div.b-attach', { hidden: true });
    const marqueeEl = h('div.b-marquee', { hidden: true });
    const eraserEl = h('div.b-eraser', { hidden: true });
    const overlay = h('div.b-overlay', selLayer, attachEl, marqueeEl, eraserEl);
    const hint = h('div.b-hint', { hidden: true },
      h('b', 'Double-click anywhere to drop a sticky note'),
      h('span', 'Pick a tool on the left, or paste a screenshot with Ctrl + V'));
    const titleEl = h('div.b-title-text', {
      contenteditable: 'plaintext-only', spellcheck: 'false', role: 'textbox', 'aria-label': 'Board title', 'data-ph': 'Untitled board'
    }, page.title || '');
    const titleChip = h('div.b-title.b-ui', h('span.b-title-icon', ZN.pageIcon(page, 17)), titleEl);
    const toolsEl = h('div.b-tools.b-ui', { role: 'toolbar', 'aria-label': 'Board tools', 'aria-orientation': 'vertical' });
    const zoomEl = h('div.b-zoom.b-ui', { role: 'toolbar', 'aria-label': 'Undo and zoom' });
    const optsEl = h('div.b-opts.b-ui', { hidden: true });
    const propsEl = h('div.b-props.b-ui', { hidden: true, role: 'toolbar', 'aria-label': 'Selection' });
    const board = h('div.board', { tabindex: '-1', 'data-tool': 'select' }, world, overlay, hint, titleChip, toolsEl, zoomEl, optsEl, propsEl);
    el.appendChild(board);

    function barBtn(icon, label, key, side, fn) {
      const b = h('button.ibtn', { type: 'button', 'aria-label': label, 'data-tip': key ? label + '|' + key : label, 'data-tip-side': side }, ZN.icon(icon, 19));
      b.addEventListener('click', e => { fn(b, e); if (e.detail) b.blur(); });
      return b;
    }
    const toolBtn = (id, icon, label, key, fn) => (toolBtns[id] = barBtn(icon, label, key, 'right', fn || (() => setTool(id))));
    U.append(toolsEl, [
      toolBtn('select', 'cursor', 'Select', 'V'),
      toolBtn('hand', 'hand', 'Move around', 'H'),
      h('span.b-sep'),
      toolBtn('sticky', 'sticky', 'Sticky note', 'N'),
      toolBtn('text', 'text', 'Text', 'T'),
      toolBtn('shape', 'shapes', 'Shapes', 'R O D', b => shapeMenu(b)),
      toolBtn('line', 'arrow', 'Arrow or line', 'L'),
      toolBtn('pen', 'pen', 'Pen', 'P'),
      toolBtn('hl', 'marker', 'Highlighter', 'M'),
      toolBtn('eraser', 'eraser', 'Eraser (ink only)', 'E'),
      toolBtn('frame', 'frame', 'Frame', 'F'),
      h('span.b-sep'),
      toolBtn('image', 'image', 'Add a picture', '', pickImage),
      toolBtn('snip', 'snip', 'Snip the screen', 'Alt S', () => {
        if (ZN.snip && ZN.snip.start) ZN.snip.start(); else ui.toast('The snipping tool is not available.');
      })
    ]);
    const undoBtn = barBtn('undo', 'Undo', 'Ctrl Z', 'top', () => undo());
    const redoBtn = barBtn('redo', 'Redo', 'Ctrl Y', 'top', () => redo());
    const pctBtn = h('button.b-pct', { type: 'button', 'aria-label': 'Zoom level — back to 100%', 'data-tip': 'Back to 100%|Ctrl 0', 'data-tip-side': 'top' }, '100%');
    pctBtn.addEventListener('click', e => { zoomTo(1); if (e.detail) pctBtn.blur(); });
    U.append(zoomEl, [undoBtn, redoBtn, h('span.b-sep.v'),
      barBtn('minus', 'Zoom out', 'Ctrl −', 'top', () => zoomStep(-1)), pctBtn,
      barBtn('plus', 'Zoom in', 'Ctrl +', 'top', () => zoomStep(1)),
      barBtn('fit', 'Fit everything', 'Shift 1', 'top', () => fitView())]);

    function shapeMenu(anchor) {
      ui.menu(anchor, SHAPES.map(s => ({
        label: SHAPE_NAME[s], icon: SHAPE_ICON[s], hint: SHAPE_KEY[s] || '', checked: tool === s,
        onClick: () => { prefs.shape = s; savePrefs(); setTool(s); }
      })), { side: 'right' });
    }

    /* ---------- the view (pan and zoom) ---------- */
    const saveView = U.debounce(() => {
      content.view = { x: view.x, y: view.y, k: Math.round(view.k * 1000) / 1000 };
      S.update(page.id, { content }, { keepTime: true, quiet: true });
    }, 600);

    function applyView(save) {
      view.x = Math.round(view.x);
      view.y = Math.round(view.y);
      world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
      let step = 28;
      while (step * view.k < 14) step *= 2;       // keep the dots from crowding when zoomed out
      const bs = board.style;
      bs.setProperty('--bg-s', f1(step * view.k) + 'px');
      bs.setProperty('--bg-x', view.x + 'px');
      bs.setProperty('--bg-y', view.y + 'px');
      pctBtn.textContent = Math.round(view.k * 100) + '%';
      layoutOverlay();
      if (save !== false) saveView();
    }
    const size = () => ({ w: board.clientWidth || 1000, h: board.clientHeight || 700 });
    function zoomAt(k2, sx, sy) {
      k2 = clamp(k2, 0.1, 4);
      if (Math.abs(k2 - 1) < 0.03) k2 = 1;
      const wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k;
      view.k = k2;
      view.x = sx - wx * k2;
      view.y = sy - wy * k2;
      applyView();
    }
    function zoomStep(dir) { const s = size(); zoomAt(view.k * (dir > 0 ? 1.25 : 0.8), s.w / 2, s.h / 2); }
    function zoomTo(k) { const s = size(); zoomAt(k, s.w / 2, s.h / 2); }
    function viewCentre() { const s = size(); return { x: (s.w / 2 - view.x) / view.k, y: (s.h / 2 - view.y) / view.k }; }
    function pointerWorld() {
      return pointer.inside ? { x: (pointer.sx - view.x) / view.k, y: (pointer.sy - view.y) / view.k } : viewCentre();
    }
    function fitView(save) {
      const s = size();
      if (!items.length) { view.k = 1; view.x = s.w / 2; view.y = s.h / 2; applyView(save); return; }
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      items.forEach(it => {
        x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y - (it.kind === 'frame' ? 32 : 0));
        x2 = Math.max(x2, it.x + it.w); y2 = Math.max(y2, it.y + it.h);
      });
      const padL = 90, padR = 44, padT = 70, padB = 76;
      const aw = Math.max(80, s.w - padL - padR), ah = Math.max(80, s.h - padT - padB);
      const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
      view.k = clamp(Math.min(aw / bw, ah / bh), 0.1, 1);
      view.x = padL + (aw - bw * view.k) / 2 - x1 * view.k;
      view.y = padT + (ah - bh * view.k) / 2 - y1 * view.k;
      applyView(save);
    }
    function local(e) {
      const r = board.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
    }

    /* ---------- drawing the items ---------- */
    function makeEl(it) {
      const e2 = h('div.bi.' + (it.kind === 'text' ? 'btext' : it.kind), { dataset: { id: it.id, kind: it.kind } });
      if (it.kind === 'sticky') e2.append(h('div.st-paper'), h('div.st-fold'), h('div.bi-text'));
      else if (it.kind === 'text') e2.append(h('div.bi-text'));
      else if (it.kind === 'shape') e2.append(h('div.bi-art'), h('div.bi-text'));
      else if (it.kind === 'frame') e2.append(h('div.bi-art'), h('div.frame-title'));
      else if (it.kind === 'image') e2.append(h('img', { alt: '', draggable: 'false' }));
      else e2.append(h('div.bi-art'));
      return e2;
    }
    function svgBox(w, hh, pad, inner) {
      return '<svg class="bi-svg" style="left:' + (-pad) + 'px;top:' + (-pad) + 'px" width="' + f1(w + pad * 2) + '" height="' + f1(hh + pad * 2) +
        '" viewBox="' + (-pad) + ' ' + (-pad) + ' ' + f1(w + pad * 2) + ' ' + f1(hh + pad * 2) + '">' + inner + '</svg>';
    }
    function setText(e2, it) {
      const t = e2.querySelector('.bi-text');
      if (t && !(editing && editing.it === it)) t.innerHTML = U.cleanHTML(String(it.text || ''));
    }
    function shapePad(it) {
      if (it.shape === 'ellipse') return [it.w * 0.15, it.h * 0.15];
      if (it.shape === 'diamond') return [it.w * 0.25, it.h * 0.25];
      return [Math.min(12, it.w * 0.1), Math.min(8, it.h * 0.1)];
    }
    function paintShape(it, e2, full) {
      const w = Math.max(1, it.w), hh = Math.max(1, it.h);
      const kind = SHAPES.indexOf(it.shape) >= 0 ? it.shape : 'rect';
      const filled = !!it.fill && it.fill !== 'none';
      const rnd = prng(hashSeed(it.id));
      e2.dataset.shape = kind;
      e2.classList.toggle('filled', filled);
      e2.style.setProperty('--fillc', filled ? stVar(it.fill) : 'none');
      e2.style.setProperty('--sk', filled && okInk(it.stroke) === 'ink' ? 'var(--st-ink)' : inkVar(it.stroke));
      const pad = shapePad(it);
      e2.style.padding = f1(pad[1]) + 'px ' + f1(pad[0]) + 'px';
      let stroke, fill;
      if (kind === 'ellipse') {
        stroke = roughEllipse(w, hh, rnd, 1.2);
        const arc = 'A' + f1(w / 2) + ' ' + f1(hh / 2) + ' 0 1 0 ';
        fill = 'M0 ' + f1(hh / 2) + arc + f1(w) + ' ' + f1(hh / 2) + arc + '0 ' + f1(hh / 2) + 'Z';
      } else if (kind === 'diamond') {
        stroke = rPoly([[w / 2, 0], [w, hh / 2], [w / 2, hh], [0, hh / 2]], rnd, 1.3);
        fill = 'M' + f1(w / 2) + ' 0L' + f1(w) + ' ' + f1(hh / 2) + 'L' + f1(w / 2) + ' ' + f1(hh) + 'L0 ' + f1(hh / 2) + 'Z';
      } else if (kind === 'round') {
        const r = Math.min(18, w / 2, hh / 2);
        stroke = roughRound(w, hh, r, rnd, 1.1);
        fill = roundPath(w, hh, r);
      } else {
        stroke = rPoly([[0, 0], [w, 0], [w, hh], [0, hh]], rnd, 1.4);
        fill = 'M0 0H' + f1(w) + 'V' + f1(hh) + 'H0Z';
      }
      e2.firstChild.innerHTML = svgBox(w, hh, 6, '<path class="fill" d="' + fill + '"/><path class="stroke" d="' + stroke + '"/>');
      if (full) setText(e2, it);
      queueFit(it);
    }
    function paintFrame(it, e2, full) {
      const w = Math.max(1, it.w), hh = Math.max(1, it.h);
      const d = rPoly([[0, 0], [w, 0], [w, hh], [0, hh]], prng(hashSeed(it.id)), 1.2);
      e2.firstChild.innerHTML = svgBox(w, hh, 12,
        '<path class="hit" stroke-width="14" d="M0 0H' + f1(w) + 'V' + f1(hh) + 'H0Z"/><path class="stroke" d="' + d + '"/>');
      if (full && !(editing && editing.it === it)) e2.lastChild.textContent = it.title || '';
    }
    function paintInk(it, e2) {
      const d = inkPath(it.pts || []);
      const sz = clamp(num(it.size, 3), 0.5, 80);
      e2.classList.toggle('hl', !!it.hl);
      e2.style.setProperty('--c', it.hl ? hlVar(it.color) : inkVar(it.color));
      e2.style.setProperty('--o', it.hl ? (HL_VAR[it.color] ? '.85' : '.35') : '1');
      const pad = Math.ceil(sz / 2) + 12;
      e2.firstChild.innerHTML = svgBox(it.w, it.h, pad,
        '<path class="hit" stroke-width="' + Math.max(14, sz + 8) + '" d="' + d + '"/><path class="stroke" stroke-width="' + sz + '" d="' + d + '"/>');
    }
    function paintLine(it, e2) {
      if (!e2) return;
      const g = lineEnds(it, get);
      const x = Math.min(g.a.x, g.b.x), y = Math.min(g.a.y, g.b.y);
      it.x = f1(x); it.y = f1(y);
      it.w = f1(Math.abs(g.b.x - g.a.x)); it.h = f1(Math.abs(g.b.y - g.a.y));
      const s = e2.style;
      s.left = it.x + 'px'; s.top = it.y + 'px'; s.width = it.w + 'px'; s.height = it.h + 'px';
      s.setProperty('--c', inkVar(it.color));
      e2.classList.toggle('dash', !!it.dash);
      const ax = g.a.x - it.x, ay = g.a.y - it.y, bx = g.b.x - it.x, by = g.b.y - it.y;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) { e2.firstChild.innerHTML = ''; return; }
      const rnd = prng(hashSeed(it.id)), ux = (bx - ax) / len, uy = (by - ay) / len;
      const main = it.dash ? rSeg(ax, ay, bx, by, rnd, 1.1) : rLine(ax, ay, bx, by, rnd, 1.1);
      const hl = clamp(len * 0.3, 6, 15);
      let heads = '';
      if (len > 5 && (it.arrow === 'end' || it.arrow === 'both')) heads += arrowHead(bx, by, ux, uy, rnd, hl);
      if (len > 5 && it.arrow === 'both') heads += arrowHead(ax, ay, -ux, -uy, rnd, hl);
      e2.firstChild.innerHTML = svgBox(it.w, it.h, 26,
        '<path class="hit" stroke-width="16" d="M' + f1(ax) + ' ' + f1(ay) + 'L' + f1(bx) + ' ' + f1(by) + '"/>' +
        '<path class="stroke main" d="' + main + '"/>' + (heads ? '<path class="stroke" d="' + heads + '"/>' : ''));
    }
    function paintLines(only) {
      items.forEach(l => { if (l.kind === 'line' && (!only || only.has(l.id))) paintLine(l, els.get(l.id)); });
    }
    /* full: also rewrite the text / picture, not just the geometry and colours */
    function paint(it, full) {
      const e2 = els.get(it.id);
      if (!e2) return;
      const s = e2.style;
      if (it.kind === 'line') { paintLine(it, e2); return; }
      s.left = it.x + 'px'; s.top = it.y + 'px'; s.width = it.w + 'px';
      if (it.kind !== 'text') s.height = it.h + 'px';
      if (it.kind === 'sticky') { s.setProperty('--st', stVar(it.color)); if (full) setText(e2, it); queueFit(it); }
      else if (it.kind === 'text') {
        e2.dataset.size = TEXT_PX[it.size] ? it.size : 'm';
        s.setProperty('--c', inkVar(it.color));
        if (full) setText(e2, it);
      }
      else if (it.kind === 'shape') paintShape(it, e2, full);
      else if (it.kind === 'frame') paintFrame(it, e2, full);
      else if (it.kind === 'image') { if (full) S.setImg(e2.firstChild, it.src); }
      else if (it.kind === 'ink') paintInk(it, e2);
    }
    function nudgeEl(it) {
      const e2 = els.get(it.id);
      if (e2) { e2.style.left = it.x + 'px'; e2.style.top = it.y + 'px'; }
    }
    function measureText(it) {
      const e2 = els.get(it.id);
      if (e2 && e2.offsetHeight) it.h = e2.offsetHeight;
    }

    /* shrink handwriting until it fits its sticky / shape */
    function queueFit(it) {
      fitQ.add(it.id);
      if (!fitRaf) fitRaf = requestAnimationFrame(runFit);
    }
    function runFit() {
      fitRaf = 0;
      let n = 0;
      for (const id of fitQ) {
        fitQ.delete(id);
        const it = get(id);
        if (it) fitNow(it);
        if (++n >= 60) break;
      }
      if (fitQ.size && alive) fitRaf = requestAnimationFrame(runFit);
    }
    function fitNow(it) {
      const e2 = els.get(it.id);
      const t = e2 ? e2.querySelector('.bi-text') : null;
      if (!t) return;
      let aw, ah, max;
      if (it.kind === 'sticky') { aw = it.w - 24; ah = it.h - 24; max = clamp(Math.min(it.w, it.h) * 0.155, 11, 72); }
      else if (it.kind === 'shape') { const p = shapePad(it); aw = it.w - p[0] * 2; ah = it.h - p[1] * 2; max = clamp(Math.min(it.w, it.h) * 0.2, 13, 24); }
      else return;
      aw = Math.max(8, aw); ah = Math.max(8, ah);
      const ok = () => t.offsetHeight <= ah + 1 && t.scrollWidth <= aw + 1;
      t.style.fontSize = f1(max) + 'px';
      if (ok()) return;
      let lo = 6, hi = max;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        t.style.fontSize = mid + 'px';
        if (ok()) lo = mid; else hi = mid;
      }
      t.style.fontSize = f1(lo) + 'px';
    }

    function renderAll() {
      U.clear(world);
      els.clear(); map.clear(); fitQ.clear();
      items.forEach(it => {
        map.set(it.id, it);
        const e2 = makeEl(it);
        els.set(it.id, e2);
        world.appendChild(e2);
      });
      items.forEach(it => { if (it.kind !== 'line') paint(it, true); });
      items.forEach(it => { if (it.kind === 'text') measureText(it); });
      paintLines();
      updateHint();
    }
    function addMany(list, toBack) {
      list.forEach(it => {
        if (toBack) items.unshift(it); else items.push(it);
        map.set(it.id, it);
        const e2 = makeEl(it);
        els.set(it.id, e2);
        if (toBack) world.insertBefore(e2, world.firstChild); else world.appendChild(e2);
      });
      list.forEach(it => { if (it.kind !== 'line') paint(it, true); });
      list.forEach(it => { if (it.kind === 'text') measureText(it); });
      list.forEach(it => { if (it.kind === 'line') paint(it, true); });
      updateHint();
      return list;
    }
    const addItem = (it, toBack) => addMany([it], toBack)[0];

    function removeItems(ids) {
      const gone = new Set(ids);
      if (!gone.size) return;
      items.forEach(l => {            // connectors that pointed at a removed thing keep their end where it was
        if (l.kind !== 'line' || gone.has(l.id)) return;
        let g = null;
        ['a', 'b'].forEach(k => {
          if (l[k].id && gone.has(l[k].id)) { g = g || lineEnds(l, get); l[k] = { x: f1(g[k].x), y: f1(g[k].y) }; }
        });
      });
      items = items.filter(i => !gone.has(i.id));
      content.items = items;
      gone.forEach(id => {
        const e2 = els.get(id);
        if (e2) e2.remove();
        els.delete(id); map.delete(id); sel.delete(id); fitQ.delete(id);
      });
      paintLines();
      updateHint();
      afterSel();
    }
    function updateHint() { hint.hidden = items.length > 0; }

    /* ---------- selection ---------- */
    const selItems = () => (sel.size ? items.filter(i => sel.has(i.id)) : []);
    function select(ids) { sel = new Set(ids); afterSel(); }
    function afterSel() { buildProps(); layoutOverlay(); }
    const scr = it => ({ l: it.x * view.k + view.x, t: it.y * view.k + view.y, w: it.w * view.k, h: it.h * view.k });
    const px = (l, t, w, hh) => ({ left: f1(l) + 'px', top: f1(t) + 'px', width: w == null ? null : f1(w) + 'px', height: hh == null ? null : f1(hh) + 'px' });

    function layoutOverlay() {
      U.clear(selLayer);
      const list = selItems();
      if (!list.length) { selRect = null; return; }
      const many = list.length > 1, boxes = list.length <= 60;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      list.forEach(it => {
        const b = scr(it);
        x1 = Math.min(x1, b.l); y1 = Math.min(y1, b.t); x2 = Math.max(x2, b.l + b.w); y2 = Math.max(y2, b.t + b.h);
        if (it.kind === 'line' && !many) {
          const g = lineEnds(it, get);
          ['a', 'b'].forEach(k => selLayer.appendChild(h('div.b-h.round' + (it[k].id ? '.tied' : ''), {
            dataset: { end: k, id: it.id }, style: px(g[k].x * view.k + view.x, g[k].y * view.k + view.y)
          })));
          return;
        }
        if (boxes) selLayer.appendChild(h('div.b-box' + (many ? '.thin' : ''), { style: px(b.l - 3, b.t - 3, b.w + 6, b.h + 6) }));
        if (!many && !editing) {
          let hs = it.kind === 'text' ? ['w', 'e'] : it.kind === 'image' || it.kind === 'ink' ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
          if (it.kind !== 'text' && (b.w < 40 || b.h < 40)) hs = hs.filter(k => k.length === 2);
          hs.forEach(k => {
            const hx = k.indexOf('w') >= 0 ? b.l - 3 : k.indexOf('e') >= 0 ? b.l + b.w + 3 : b.l + b.w / 2;
            const hy = k.indexOf('n') >= 0 ? b.t - 3 : k.indexOf('s') >= 0 ? b.t + b.h + 3 : b.t + b.h / 2;
            selLayer.appendChild(h('div.b-h', { dataset: { h: k, id: it.id }, style: px(hx, hy) }));
          });
        }
      });
      if (many) selLayer.appendChild(h('div.b-box.union', { style: px(x1 - 8, y1 - 8, x2 - x1 + 16, y2 - y1 + 16) }));
      selRect = { l: x1, t: y1, r: x2, b: y2 };
      placeProps();
    }
    function placeProps() {
      if (propsEl.hidden || !selRect) return;
      const s = size(), pw = propsEl.offsetWidth, ph = propsEl.offsetHeight;
      let top = selRect.t - ph - 18;
      if (top < 56) top = selRect.b + 18;
      if (top > s.h - ph - 10) top = 56;
      const left = clamp((selRect.l + selRect.r) / 2 - pw / 2, 66, Math.max(66, s.w - pw - 12));
      propsEl.style.left = Math.round(left) + 'px';
      propsEl.style.top = Math.round(top) + 'px';
    }
    function showAttach(it) {
      if (!it) { attachEl.hidden = true; return; }
      const b = scr(it);
      Object.assign(attachEl.style, px(b.l - 5, b.t - 5, b.w + 10, b.h + 10));
      attachEl.hidden = false;
    }

    /* ---------- the bar above the selection ---------- */
    function buildProps() {
      U.clear(propsEl);
      const list = selItems();
      if (!list.length || editing) { propsEl.hidden = true; return; }
      const kinds = {};
      list.forEach(i => { kinds[i.kind] = 1; });
      const names = Object.keys(kinds), only = names.length === 1 ? names[0] : null, first = list[0];
      const parts = [];
      const btn = (inner, tip, fn, on) => {
        const b = h('button.ibtn' + (on ? '.on' : ''), { type: 'button', 'aria-label': tip.split('|')[0], 'data-tip': tip, 'data-tip-side': 'top' }, inner);
        b.addEventListener('click', () => fn(b));
        return b;
      };
      const apply = fn => {
        list.forEach(fn);
        list.forEach(i => paint(i, false));
        list.forEach(i => { if (i.kind === 'text') measureText(i); });
        paintLines();
        commit();
        afterSel();
      };
      const colour = (label, curId, curCss, colours, pick, ring) => {
        const b = h('button.b-color' + (ring ? '.ring' : ''), { type: 'button', 'aria-label': label, 'data-tip': label, 'data-tip-side': 'top', style: { '--sw': curCss } });
        b.addEventListener('click', () => {
          const p = ui.popover(b, ui.swatches(colours, curId, id => { if (p) p.close(); pick(id); }), { side: 'top' });
        });
        return b;
      };
      const stickyCols = STICKY.map(c => ({ id: c, css: stVar(c), label: STICKY_NAME[c] }));
      const inkCols = INKS.map(c => ({ id: c, css: inkVar(c), label: INK_NAME[c] }));
      const noFill = 'linear-gradient(135deg, transparent 44%, var(--red) 44%, var(--red) 56%, transparent 56%)';

      if (only === 'sticky') {
        parts.push(colour('Paper colour', first.color, stVar(first.color), stickyCols, id => { prefs.sticky = id; savePrefs(); apply(i => { i.color = id; }); }));
      } else if (only === 'shape') {
        const filled = first.fill && first.fill !== 'none';
        parts.push(btn(ZN.icon(SHAPE_ICON[first.shape] || 'square', 17), 'Change shape', b => ui.menu(b, SHAPES.map(s => ({
          label: SHAPE_NAME[s], icon: SHAPE_ICON[s], checked: first.shape === s, onClick: () => apply(i => { i.shape = s; })
        })), { side: 'top' })));
        parts.push(colour('Fill', filled ? first.fill : 'none', filled ? stVar(first.fill) : noFill,
          [{ id: 'none', css: noFill, label: 'No fill' }].concat(stickyCols), id => apply(i => { i.fill = id; })));
        parts.push(colour('Outline colour', okInk(first.stroke), inkVar(first.stroke), inkCols, id => apply(i => { i.stroke = id; }), true));
      } else if (only === 'text') {
        ['s', 'm', 'l', 'xl'].forEach(sz => parts.push(btn(h('span.b-txt', sz.toUpperCase()), 'Text size ' + sz.toUpperCase(),
          () => apply(i => { i.size = sz; }), (TEXT_PX[first.size] ? first.size : 'm') === sz)));
        parts.push(colour('Ink colour', okInk(first.color), inkVar(first.color), inkCols, id => apply(i => { i.color = id; }), true));
      } else if (only === 'line') {
        const glyph = { none: '—', end: '→', both: '↔' }, next = { none: 'end', end: 'both', both: 'none' };
        const cur = glyph[first.arrow] ? first.arrow : 'none', dashed = !first.dash;
        parts.push(btn(h('span.b-glyph', glyph[cur]), 'Arrow heads', () => { prefs.arrow = next[cur]; savePrefs(); apply(i => { i.arrow = next[cur]; }); }));
        parts.push(btn(h('span.b-glyph', '┄'), 'Dashed', () => apply(i => { i.dash = dashed; }), !!first.dash));
        parts.push(colour('Ink colour', okInk(first.color), inkVar(first.color), inkCols, id => apply(i => { i.color = id; }), true));
      } else if (only === 'ink') {
        const isHl = !!first.hl;
        const cols = isHl ? HLS.map(c => ({ id: c, css: hlVar(c), label: HL_NAME[c] })) : inkCols;
        parts.push(colour('Ink colour', first.color, isHl ? hlVar(first.color) : inkVar(first.color), cols, id => apply(i => { i.color = id; }), true));
        (isHl ? HL_SIZES : PEN_SIZES).forEach((sz, n) => parts.push(btn(h('span.b-dot', { style: { width: (5 + n * 4) + 'px', height: (5 + n * 4) + 'px' } }),
          SIZE_NAME[n], () => apply(i => { i.size = sz; }), first.size === sz)));
      } else if (only === 'image' && list.length === 1) {
        parts.push(btn(ZN.icon('open', 17), 'View picture', () => ui.lightbox(first.src)));
      }
      if (parts.length) parts.push(h('span.b-sep.v'));
      parts.push(
        btn(ZN.icon('front', 17), 'Bring to front|]', () => reorder(true)),
        btn(ZN.icon('back', 17), 'Send to back|[', () => reorder(false)),
        btn(ZN.icon('copy', 17), 'Duplicate|Ctrl D', () => duplicate()),
        btn(ZN.icon('trash', 17), 'Delete|Del', () => { removeItems(Array.from(sel)); commit(); }));
      U.append(propsEl, parts);
      propsEl.hidden = false;
    }

    /* ---------- options for the tool in hand (pen colour, sticky colour …) ---------- */
    function buildOpts() {
      U.clear(optsEl);
      const dot = n => h('span.b-dot', { style: { width: (5 + n * 4) + 'px', height: (5 + n * 4) + 'px' } });
      if (tool === 'pen' || tool === 'hl') {
        const isHl = tool === 'hl';
        const cols = (isHl ? HLS : INKS).map(c => ({ id: c, css: isHl ? hlVar(c) : inkVar(c), label: (isHl ? HL_NAME : INK_NAME)[c] }));
        const cur = isHl ? prefs.hlSize : prefs.penSize;
        U.append(optsEl, [
          h('span.b-opts-label', isHl ? 'highlighter' : 'pen'),
          ui.swatches(cols, isHl ? prefs.hl : prefs.pen, id => { if (isHl) prefs.hl = id; else prefs.pen = id; savePrefs(); buildOpts(); }),
          h('span.b-sep.v'),
          (isHl ? HL_SIZES : PEN_SIZES).map((sz, n) => {
            const b = h('button.ibtn' + (cur === sz ? '.on' : ''), { type: 'button', 'aria-label': SIZE_NAME[n], 'data-tip': SIZE_NAME[n] }, dot(n));
            b.addEventListener('click', () => { if (isHl) prefs.hlSize = sz; else prefs.penSize = sz; savePrefs(); buildOpts(); });
            return b;
          })
        ]);
      } else if (tool === 'sticky') {
        U.append(optsEl, [
          h('span.b-opts-label', 'sticky'),
          ui.swatches(STICKY.map(c => ({ id: c, css: stVar(c), label: STICKY_NAME[c] })), prefs.sticky, id => { prefs.sticky = id; savePrefs(); buildOpts(); })
        ]);
      } else if (tool === 'line') {
        const glyph = { none: '—', end: '→', both: '↔' }, name = { none: 'Plain line', end: 'Arrow', both: 'Arrow both ways' };
        U.append(optsEl, [h('span.b-opts-label', 'line'), ['none', 'end', 'both'].map(a => {
          const b = h('button.ibtn' + (prefs.arrow === a ? '.on' : ''), { type: 'button', 'aria-label': name[a], 'data-tip': name[a] }, h('span.b-glyph', glyph[a]));
          b.addEventListener('click', () => { prefs.arrow = a; savePrefs(); buildOpts(); });
          return b;
        })]);
      } else { optsEl.hidden = true; return; }
      optsEl.hidden = false;
    }

    function setTool(t) {
      if (editing) commitEdit();
      tool = t;
      board.dataset.tool = t;
      const isShape = SHAPES.indexOf(t) >= 0;
      Object.keys(toolBtns).forEach(id => {
        const on = id === t || (id === 'shape' && isShape);
        toolBtns[id].classList.toggle('on', on);
        toolBtns[id].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (t !== 'select' && t !== 'hand' && sel.size) select([]);
      if (t !== 'eraser') eraserEl.hidden = true;
      buildOpts();
    }

    /* ---------- history ---------- */
    const nudgeCommit = U.debounce(() => { commit(); }, 600);
    function histButtons() {
      undoBtn.disabled = hist.idx <= 0;
      redoBtn.disabled = hist.idx >= hist.stack.length - 1;
    }
    /* call once a gesture is finished: records an undo step and saves the page (only if something changed) */
    function commit() {
      nudgeCommit.cancel();
      const snap = JSON.stringify(items);
      if (snap === hist.stack[hist.idx]) return false;
      hist.stack.length = hist.idx + 1;
      hist.stack.push(snap);
      if (hist.stack.length > 101) hist.stack.shift();
      hist.idx = hist.stack.length - 1;
      S.touch(page.id);
      histButtons();
      return true;
    }
    function restore(i) {
      hist.idx = i;
      items = JSON.parse(hist.stack[i]);
      content.items = items;
      renderAll();
      const keep = new Set();
      sel.forEach(id => { if (map.has(id)) keep.add(id); });
      sel = keep;
      S.touch(page.id);
      histButtons();
      afterSel();
    }
    function undo() {
      if (gesture) return;
      if (editing) commitEdit();
      nudgeCommit.flush();
      if (hist.idx > 0) restore(hist.idx - 1);
    }
    function redo() {
      if (gesture) return;
      if (editing) commitEdit();
      if (hist.idx < hist.stack.length - 1) restore(hist.idx + 1);
    }

    /* ---------- writing on things ---------- */
    function startEdit(it, o) {
      o = o || {};
      if (editing) commitEdit();
      const e2 = els.get(it.id);
      const isTitle = it.kind === 'frame';
      if (!e2 || (!isTitle && !EDITS[it.kind])) return;
      const target = e2.querySelector(isTitle ? '.frame-title' : '.bi-text');
      sel = new Set([it.id]);
      editing = { it, el: e2, target, title: isTitle, fresh: !!o.fresh };
      e2.classList.add('editing');
      if (o.fresh && it.kind === 'text') e2.classList.add('fresh');
      target.setAttribute('contenteditable', isTitle ? 'plaintext-only' : 'true');
      target.setAttribute('spellcheck', 'false');
      target.addEventListener('keydown', onEditKey);
      target.addEventListener('input', onEditInput);
      target.addEventListener('paste', onEditPaste);
      target.addEventListener('blur', onEditBlur);
      target.focus({ preventScroll: true });
      const r = document.createRange();
      r.selectNodeContents(target);
      if (!o.selectAll) r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      afterSel();
    }
    function onEditKey(e) {
      if (!editing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commitEdit(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (editing.title || e.ctrlKey || e.metaKey) commitEdit();
        else document.execCommand('insertLineBreak');
      } else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); }
    }
    function onEditInput() {
      if (!editing) return;
      const it = editing.it;
      if (it.kind === 'text') {
        if (editing.fresh && editing.el.offsetWidth) it.w = editing.el.offsetWidth;
        measureText(it);
        layoutOverlay();
      } else if (!editing.title) fitNow(it);
    }
    function onEditPaste(e) {
      e.preventDefault();
      e.stopPropagation();
      let t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      if (editing && editing.title) t = t.replace(/\s+/g, ' ');
      if (t) document.execCommand('insertText', false, t);
    }
    function onEditBlur() {
      setTimeout(() => { if (editing && document.activeElement !== editing.target) commitEdit(); }, 0);
    }
    function commitEdit() {
      if (!editing) return;
      const ed = editing, it = ed.it, t = ed.target;
      editing = null;
      t.removeEventListener('keydown', onEditKey);
      t.removeEventListener('input', onEditInput);
      t.removeEventListener('paste', onEditPaste);
      t.removeEventListener('blur', onEditBlur);
      const hadFocus = document.activeElement === t;
      t.removeAttribute('contenteditable');
      const s = window.getSelection();
      if (s) s.removeAllRanges();
      let gone = false;
      if (ed.title) {
        it.title = t.textContent.replace(/\s+/g, ' ').trim();
        t.textContent = it.title;
      } else {
        const html = U.cleanHTML(t.innerHTML).replace(/(?:<br>|\s)+$/i, '');
        it.text = html;
        t.innerHTML = html;
        if (it.kind === 'text') {
          if (!U.text(html).trim()) gone = true;
          else {
            if (ed.fresh && ed.el.offsetWidth) it.w = clamp(Math.ceil(ed.el.offsetWidth) + 2, 40, 520);
            ed.el.classList.remove('fresh');
            ed.el.style.width = it.w + 'px';
            measureText(it);
          }
        } else fitNow(it);
      }
      ed.el.classList.remove('editing', 'fresh');
      if (hadFocus && alive) board.focus({ preventScroll: true });
      if (gone) removeItems([it.id]);
      paintLines();
      commit();
      afterSel();
    }

    /* ---------- making things ---------- */
    function newSticky(p, text) {
      return { id: U.uid(), kind: 'sticky', x: f1(p.x - 85), y: f1(p.y - 85), w: 170, h: 170, text: text || '', color: prefs.sticky };
    }
    function stickyAt(p) {
      const it = addItem(newSticky(p));
      if (tool !== 'select') setTool('select');
      startEdit(it, { fresh: true });
    }
    function textAt(p) {
      const it = addItem({ id: U.uid(), kind: 'text', x: f1(p.x - 5), y: f1(p.y - 16), w: 240, h: 32, text: '', size: 'm', color: 'ink' });
      if (tool !== 'select') setTool('select');
      startEdit(it, { fresh: true });
    }
    function imageItem(rec, cx, cy) {
      let w = num(rec.w, 0) || 480, hh = num(rec.h, 0) || 360;
      const sc = Math.min(1, 480 / w);
      w = Math.max(24, Math.round(w * sc)); hh = Math.max(24, Math.round(hh * sc));
      return { id: U.uid(), kind: 'image', x: f1(cx - w / 2), y: f1(cy - hh / 2), w, h: hh, src: rec.id };
    }
    async function addImages(files, at) {
      const c = at || viewCentre(), made = [];
      for (let i = 0; i < files.length; i++) {
        let rec = null;
        try { rec = await S.addImage(files[i], { kind: 'image', name: String(files[i].name || '').replace(/\.[^.]+$/, '') }); } catch (e) { rec = null; }
        if (!alive) return;
        if (!rec) { ui.toast('That picture could not be added.', { error: true }); continue; }
        made.push(imageItem(rec, c.x + i * 28, c.y + i * 28));
      }
      if (!made.length) return;
      if (editing) commitEdit();
      if (tool !== 'select') setTool('select');
      addMany(made);
      select(made.map(i => i.id));
      commit();
    }
    function pickImage() {
      const inp = h('input', { type: 'file', accept: 'image/*', multiple: true });
      inp.addEventListener('change', () => {
        const files = Array.from(inp.files || []).filter(f => /^image\//.test(f.type));
        if (files.length) addImages(files, null);
      });
      inp.click();
    }

    /* ---------- copies ---------- */
    function payload() {
      const list = selItems();
      if (!list.length) return null;
      const ids = new Set(list.map(i => i.id));
      const out = list.map(i => {
        const c = JSON.parse(JSON.stringify(i));
        if (c.kind === 'line') {
          const g = lineEnds(i, get);
          ['a', 'b'].forEach(k => { if (c[k].id && !ids.has(c[k].id)) c[k] = { x: f1(g[k].x), y: f1(g[k].y) }; });
        }
        return c;
      });
      const text = list.map(i => (i.kind === 'frame' ? i.title || '' : typeof i.text === 'string' ? U.text(i.text) : '')).filter(Boolean).join('\n');
      return { znoteBoard: 1, items: out, text: text || 'Z Note board items' };
    }
    /* add fresh copies of `list` (new ids, connectors re-linked), shifted by dx, dy */
    function insertCopies(list, dx, dy) {
      list = sanitize(JSON.parse(JSON.stringify(list)));
      const idMap = {};
      list.forEach((i, n) => { const nid = U.uid() + n.toString(36); idMap[i.id] = nid; i.id = nid; });
      list.forEach(i => {
        if (i.kind === 'line') {
          ['a', 'b'].forEach(k => { if (i[k].id) i[k] = { id: idMap[i[k].id] }; else { i[k].x = f1(i[k].x + dx); i[k].y = f1(i[k].y + dy); } });
        }
        i.x = f1(i.x + dx); i.y = f1(i.y + dy);
      });
      return addMany(list);
    }
    function pasteItems(list, atPointer) {
      if (!list || !list.length) return;
      let dx = 24, dy = 24;
      if (atPointer) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        list.forEach(i => {
          x1 = Math.min(x1, num(i.x, 0)); y1 = Math.min(y1, num(i.y, 0));
          x2 = Math.max(x2, num(i.x, 0) + num(i.w, 0)); y2 = Math.max(y2, num(i.y, 0) + num(i.h, 0));
        });
        const p = pointerWorld();
        dx = p.x - (x1 + x2) / 2; dy = p.y - (y1 + y2) / 2;
      }
      if (editing) commitEdit();
      if (tool !== 'select') setTool('select');
      const added = insertCopies(list, dx, dy);
      select(added.map(i => i.id));
      commit();
    }
    function duplicate() {
      const p = payload();
      if (p) pasteItems(p.items, false);
    }
    function reorder(front) {
      const s = selItems();
      if (!s.length) return;
      const rest = items.filter(i => !sel.has(i.id));
      items = front ? rest.concat(s) : s.concat(rest);
      content.items = items;
      items.forEach(i => { const e2 = els.get(i.id); if (e2) world.appendChild(e2); });
      commit();
    }
    const centreIn = (f, o) => { const cx = o.x + o.w / 2, cy = o.y + o.h / 2; return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h; };
    /* the selection plus whatever sits on a selected frame */
    function carried() {
      const ids = new Set(sel);
      selItems().forEach(f => {
        if (f.kind !== 'frame') return;
        items.forEach(o => { if (o.kind !== 'frame' && !ids.has(o.id) && centreIn(f, o)) ids.add(o.id); });
      });
      return ids;
    }
    function shift(ids, orig, dx, dy) {
      ids.forEach(id => {
        const it = get(id), o = orig ? orig.get(id) : null;
        if (!it) return;
        if (it.kind === 'line') {
          ['a', 'b'].forEach(k => { if (!it[k].id) { it[k].x = f1((o ? o[k].x : it[k].x) + dx); it[k].y = f1((o ? o[k].y : it[k].y) + dy); } });
        } else { it.x = f1((o ? o.x : it.x) + dx); it.y = f1((o ? o.y : it.y) + dy); nudgeEl(it); }
      });
    }
    function nudge(dx, dy) {
      shift(carried(), null, dx, dy);
      paintLines();
      layoutOverlay();
      nudgeCommit();
    }

    /* ---------- gestures ---------- */
    function begin(e, g) {
      gesture = g;
      try { board.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capture */ }
      if (g.busy !== false) board.classList.add('busy');
    }
    /* true on the second click of a double-click on the same thing */
    function clicked(p, id) {
      const now = performance.now();
      const dbl = now - lastClick.t < 430 && Math.hypot(p.sx - lastClick.x, p.sy - lastClick.y) < 7 && lastClick.id === id;
      lastClick = dbl ? { t: 0, x: 0, y: 0, id: null } : { t: now, x: p.sx, y: p.sy, id };
      return dbl;
    }
    const itemUnder = target => { const b = target && target.closest ? target.closest('.bi') : null; return b ? get(b.dataset.id) : null; };
    function attachAt(cx, cy, skipId) {
      const stack = document.elementsFromPoint(cx, cy);
      for (let i = 0; i < stack.length; i++) {
        const n = stack[i];
        if (n === board || n === world) break;
        const it = world.contains(n) ? itemUnder(n) : null;
        if (it && ATTACH[it.kind] && it.id !== skipId) return it;
      }
      return null;
    }

    function panGesture(e) {
      const x0 = e.clientX, y0 = e.clientY, vx = view.x, vy = view.y;
      return {
        busy: false,
        move(ev) { view.x = vx + ev.clientX - x0; view.y = vy + ev.clientY - y0; applyView(); },
        end() {}
      };
    }

    function moveGesture(e, p0, hit, wasSelected) {
      let moved = false, ids = null, orig = null, lines = null;
      return {
        move(ev, p) {
          if (!moved) {
            if (Math.hypot(p.sx - p0.sx, p.sy - p0.sy) < 4) return;
            moved = true;
            if (ev.altKey) {                      // Alt-drag leaves the originals and drags copies
              const pl = payload();
              if (pl) sel = new Set(insertCopies(pl.items, 0, 0).map(i => i.id));
            }
            ids = carried();
            orig = new Map();
            ids.forEach(id => {
              const it = get(id);
              if (it) orig.set(id, it.kind === 'line' ? { a: Object.assign({}, it.a), b: Object.assign({}, it.b) } : { x: it.x, y: it.y });
            });
            lines = new Set();
            items.forEach(l => { if (l.kind === 'line' && (ids.has(l.id) || (l.a.id && ids.has(l.a.id)) || (l.b.id && ids.has(l.b.id)))) lines.add(l.id); });
          }
          let dx = (p.sx - p0.sx) / view.k, dy = (p.sy - p0.sy) / view.k;
          if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
          shift(ids, orig, dx, dy);
          paintLines(lines);
          layoutOverlay();
        },
        end(ev, p) {
          if (moved) { commit(); afterSel(); return; }
          if (wasSelected && sel.size > 1) select([hit.id]);
          if (clicked(p, hit.id)) onDouble(hit);
        }
      };
    }

    function inMarquee(it, x1, y1, x2, y2) {
      if (it.kind === 'frame') return it.x >= x1 && it.y >= y1 && it.x + it.w <= x2 && it.y + it.h <= y2;
      if (it.x > x2 || it.x + it.w < x1 || it.y > y2 || it.y + it.h < y1) return false;
      if (it.kind === 'line') { const g = lineEnds(it, get); return segHitsRect(g.a, g.b, x1, y1, x2, y2); }
      return true;
    }
    function marqueeGesture(e, p0) {
      const base = e.shiftKey ? new Set(sel) : new Set();
      if (!e.shiftKey && sel.size) select([]);
      let moved = false;
      return {
        move(ev, p) {
          if (!moved && Math.hypot(p.sx - p0.sx, p.sy - p0.sy) < 4) return;
          moved = true;
          Object.assign(marqueeEl.style, px(Math.min(p0.sx, p.sx), Math.min(p0.sy, p.sy), Math.abs(p.sx - p0.sx), Math.abs(p.sy - p0.sy)));
          marqueeEl.hidden = false;
          const x1 = Math.min(p0.x, p.x), y1 = Math.min(p0.y, p.y), x2 = Math.max(p0.x, p.x), y2 = Math.max(p0.y, p.y);
          const next = new Set(base);
          items.forEach(it => { if (inMarquee(it, x1, y1, x2, y2)) next.add(it.id); });
          sel = next;
          layoutOverlay();
        },
        end(ev, p, cancelled) {
          marqueeEl.hidden = true;
          if (!moved && !cancelled && clicked(p, null)) { stickyAt(p0); return; }
          afterSel();
        }
      };
    }

    function resizeGesture(e, p0, it, handle) {
      const o = { x: it.x, y: it.y, w: it.w, h: it.h, pts: it.pts ? it.pts.map(q => q.slice()) : null };
      const mn = MIN[it.kind] || [10, 10];
      const W = handle.indexOf('w') >= 0, E = handle.indexOf('e') >= 0, N = handle.indexOf('n') >= 0, Sd = handle.indexOf('s') >= 0;
      // the handle sits a few pixels outside the edge it moves; keep that offset so nothing jumps on grab
      const offX = p0.x - (W ? o.x : o.x + o.w), offY = p0.y - (N ? o.y : o.y + o.h);
      const lines = new Set();
      items.forEach(l => { if (l.kind === 'line' && (l.a.id === it.id || l.b.id === it.id)) lines.add(l.id); });
      return {
        move(ev, p) {
          const qx = p.x - offX, qy = p.y - offY;
          let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
          if (W) x1 = Math.min(qx, x2 - mn[0]);
          if (E) x2 = Math.max(qx, x1 + mn[0]);
          if (N) y1 = Math.min(qy, y2 - mn[1]);
          if (Sd) y2 = Math.max(qy, y1 + mn[1]);
          let w = x2 - x1, hh = y2 - y1;
          const keep = (it.kind === 'image') !== ev.shiftKey;       // pictures keep their shape; Shift flips the rule
          if (keep && handle.length === 2 && o.w > 0 && o.h > 0) {
            const sc = Math.max(w / o.w, hh / o.h);
            w = o.w * sc; hh = o.h * sc;
            if (W) x1 = x2 - w;
            if (N) y1 = y2 - hh;
          }
          it.x = f1(x1); it.y = f1(y1); it.w = f1(w);
          if (it.kind !== 'text') it.h = f1(hh);
          if (it.kind === 'ink' && o.pts) {
            const sx = w / (o.w || 1), sy = hh / (o.h || 1);
            it.pts = o.pts.map(q => [f1(q[0] * sx), f1(q[1] * sy)]);
          }
          paint(it, false);
          if (it.kind === 'text') measureText(it);
          paintLines(lines);
          layoutOverlay();
        },
        end() { if (it.kind === 'text') measureText(it); commit(); afterSel(); }
      };
    }

    /* dragging one end of a connector; dropping it on something ties it there */
    function endGesture(e, p0, line, which) {
      const other = line[which === 'a' ? 'b' : 'a'];
      let cand = null;
      return {
        move(ev, p) {
          cand = attachAt(ev.clientX, ev.clientY, other.id || null);
          showAttach(cand);
          line[which] = { x: f1(p.x), y: f1(p.y) };
          paintLine(line, els.get(line.id));
          layoutOverlay();
        },
        end(ev, p, cancelled) {
          showAttach(null);
          if (cand && !cancelled) line[which] = { id: cand.id };
          paintLine(line, els.get(line.id));
          commit();
          afterSel();
        }
      };
    }

    /* sticky / text: a click drops one and starts typing */
    function placeGesture(e, p0) {
      return {
        busy: false,
        move() {},
        end(ev, p, cancelled) { if (cancelled) return; if (tool === 'sticky') stickyAt(p0); else textAt(p0); }
      };
    }

    /* shapes and frames: drag out a size (a plain click drops a standard one) */
    function drawGesture(e, p0) {
      const isFrame = tool === 'frame';
      const it = isFrame
        ? { id: U.uid(), kind: 'frame', x: p0.x, y: p0.y, w: 1, h: 1, title: 'Frame' }
        : { id: U.uid(), kind: 'shape', shape: tool, x: p0.x, y: p0.y, w: 1, h: 1, text: '', fill: 'none', stroke: 'ink' };
      let made = false;
      return {
        move(ev, p) {
          if (!made) {
            if (Math.hypot(p.sx - p0.sx, p.sy - p0.sy) < 4) return;
            made = true;
            addItem(it, isFrame);
          }
          let w = p.x - p0.x, hh = p.y - p0.y;
          if (ev.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = (w < 0 ? -1 : 1) * m; hh = (hh < 0 ? -1 : 1) * m; }
          it.x = f1(Math.min(p0.x, p0.x + w)); it.y = f1(Math.min(p0.y, p0.y + hh));
          it.w = f1(Math.max(1, Math.abs(w))); it.h = f1(Math.max(1, Math.abs(hh)));
          paint(it, false);
        },
        end(ev, p, cancelled) {
          if (cancelled) { if (made) removeItems([it.id]); return; }
          const mn = MIN[it.kind];
          if (!made || it.w < mn[0] / 2 || it.h < mn[1] / 2) {
            const dw = isFrame ? 480 : 170, dh = isFrame ? 320 : it.shape === 'ellipse' || it.shape === 'diamond' ? 130 : 110;
            it.w = dw; it.h = dh; it.x = f1(p0.x - dw / 2); it.y = f1(p0.y - dh / 2);
            if (!made) addItem(it, isFrame);
          } else { it.w = Math.max(it.w, mn[0]); it.h = Math.max(it.h, mn[1]); }
          paint(it, true);
          setTool('select');
          select([it.id]);
          commit();
        }
      };
    }

    function lineGesture(e, p0) {
      const from = itemUnder(e.target);
      const startIt = from && ATTACH[from.kind] ? from : null;
      const ln = {
        id: U.uid(), kind: 'line', a: startIt ? { id: startIt.id } : { x: f1(p0.x), y: f1(p0.y) }, b: { x: f1(p0.x), y: f1(p0.y) },
        arrow: prefs.arrow, x: f1(p0.x), y: f1(p0.y), w: 0, h: 0
      };
      let made = false, cand = null;
      return {
        move(ev, p) {
          if (!made) {
            if (Math.hypot(p.sx - p0.sx, p.sy - p0.sy) < 4) return;
            made = true;
            addItem(ln);
          }
          cand = attachAt(ev.clientX, ev.clientY, startIt ? startIt.id : null);
          showAttach(cand);
          ln.b = { x: f1(p.x), y: f1(p.y) };
          paintLine(ln, els.get(ln.id));
        },
        end(ev, p, cancelled) {
          showAttach(null);
          if (!made) return;
          if (cancelled) { removeItems([ln.id]); return; }
          if (cand) ln.b = { id: cand.id };
          paintLine(ln, els.get(ln.id));
          if (Math.hypot(ln.w, ln.h) < 6) { removeItems([ln.id]); return; }
          setTool('select');
          select([ln.id]);
          commit();
        }
      };
    }

    function inkGesture(e, p0) {
      const isHl = tool === 'hl';
      const color = isHl ? prefs.hl : prefs.pen, sz = isHl ? prefs.hlSize : prefs.penSize;
      const pts = [[p0.x, p0.y]];
      const live = h('div.bi.ink.b-live' + (isHl ? '.hl' : ''));
      live.style.setProperty('--c', isHl ? hlVar(color) : inkVar(color));
      live.style.setProperty('--o', isHl ? (HL_VAR[color] ? '.85' : '.35') : '1');
      live.innerHTML = '<svg class="bi-svg" width="1" height="1"><path class="stroke" stroke-width="' + sz + '" d="' + inkPath(pts) + '"/></svg>';
      world.appendChild(live);
      const path = live.querySelector('path');
      return {
        busy: false,
        move(ev) {
          const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
          let changed = false;
          (evs && evs.length ? evs : [ev]).forEach(c => {
            const q = local(c), l = pts[pts.length - 1];
            if (Math.hypot(q.x - l[0], q.y - l[1]) * view.k >= 1.4) { pts.push([q.x, q.y]); changed = true; }
          });
          if (changed) path.setAttribute('d', inkPath(pts));
        },
        end(ev, p, cancelled) {
          live.remove();
          if (cancelled) return;
          const out = simplify(pts, 0.55 / view.k);
          let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
          out.forEach(q => { x1 = Math.min(x1, q[0]); y1 = Math.min(y1, q[1]); x2 = Math.max(x2, q[0]); y2 = Math.max(y2, q[1]); });
          addItem({
            id: U.uid(), kind: 'ink', x: f1(x1), y: f1(y1), w: Math.max(1, f1(x2 - x1)), h: Math.max(1, f1(y2 - y1)),
            pts: out.map(q => [f1(q[0] - x1), f1(q[1] - y1)]), color, size: sz, hl: isHl
          });
          commit();
        }
      };
    }

    function eraseAt(p) {
      const r = 10 / view.k, hitIds = [];
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind !== 'ink') continue;
        const pad = r + num(it.size, 3) / 2;
        if (p.x < it.x - pad || p.x > it.x + it.w + pad || p.y < it.y - pad || p.y > it.y + it.h + pad) continue;
        const pts = it.pts, lx = p.x - it.x, ly = p.y - it.y;
        let near = pts.length === 1 && Math.hypot(lx - pts[0][0], ly - pts[0][1]) <= pad;
        for (let k = 1; k < pts.length && !near; k++) near = distToSeg(lx, ly, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]) <= pad;
        if (near) hitIds.push(it.id);
      }
      if (hitIds.length) removeItems(hitIds);
      return hitIds.length;
    }
    function eraseGesture(e, p0) {
      let n = eraseAt(p0);
      return {
        busy: false,
        move(ev, p) { n += eraseAt(p); },
        end() { if (n) commit(); }
      };
    }

    function onDouble(it) {
      if (EDITS[it.kind] || it.kind === 'frame') startEdit(it, {});
      else if (it.kind === 'image') ui.lightbox(it.src);
    }

    function onDown(e) {
      if (gesture || e.target.closest('.b-ui')) return;
      const p = local(e);
      if (editing) {
        if (editing.target.contains(e.target)) return;      // placing the caret inside the text being edited
        commitEdit();
      }
      if (document.activeElement !== board) board.focus({ preventScroll: true });
      if (e.button === 1 || (e.button === 0 && (spaceDown || tool === 'hand'))) {
        e.preventDefault();
        board.classList.add('panning');
        begin(e, panGesture(e));
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();
      if (tool === 'select') {
        const hEl = e.target.closest('.b-h');
        if (hEl) {
          const it = get(hEl.dataset.id);
          if (!it) return;
          begin(e, hEl.dataset.end ? endGesture(e, p, it, hEl.dataset.end) : resizeGesture(e, p, it, hEl.dataset.h));
          return;
        }
        const it = itemUnder(e.target);
        if (!it) { begin(e, marqueeGesture(e, p)); return; }
        if (e.shiftKey) { if (sel.has(it.id)) sel.delete(it.id); else sel.add(it.id); afterSel(); return; }
        const was = sel.has(it.id);
        if (!was) select([it.id]);
        begin(e, moveGesture(e, p, it, was));
      }
      else if (tool === 'sticky' || tool === 'text') begin(e, placeGesture(e, p));
      else if (tool === 'frame' || SHAPES.indexOf(tool) >= 0) begin(e, drawGesture(e, p));
      else if (tool === 'line') begin(e, lineGesture(e, p));
      else if (tool === 'pen' || tool === 'hl') begin(e, inkGesture(e, p));
      else if (tool === 'eraser') begin(e, eraseGesture(e, p));
    }
    function onMove(e) {
      const p = local(e);
      pointer.sx = p.sx; pointer.sy = p.sy; pointer.inside = true;
      if (tool === 'eraser') { eraserEl.style.left = p.sx + 'px'; eraserEl.style.top = p.sy + 'px'; eraserEl.hidden = false; }
      if (gesture) gesture.move(e, p);
    }
    function onUp(e) {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      try { board.releasePointerCapture(e.pointerId); } catch (err) { /* nothing was captured */ }
      board.classList.remove('busy', 'panning');
      g.end(e, local(e), e.type === 'pointercancel');
    }
    function onLeave() { pointer.inside = false; eraserEl.hidden = true; }

    function onWheel(e) {
      if (e.target.closest('.b-tools') && toolsEl.scrollHeight > toolsEl.clientHeight) return;
      e.preventDefault();
      const p = local(e);
      let dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 32; dy *= 32; } else if (e.deltaMode === 2) { dx *= 400; dy *= 400; }
      // a mouse wheel moves in whole notches; a trackpad sends small, often diagonal, deltas
      const mouse = dx === 0 && (e.wheelDeltaY ? Math.abs(e.wheelDeltaY) % 120 === 0 : Math.abs(dy) >= 50);
      if (e.ctrlKey || e.metaKey) {
        zoomAt(view.k * (mouse ? (dy < 0 ? 1.18 : 1 / 1.18) : Math.exp(-dy * 0.01)), p.sx, p.sy);
      } else if (mouse && (S.settings.wheel || 'zoom') === 'zoom') {
        zoomAt(view.k * Math.pow(1.12, -dy / 100), p.sx, p.sy);
      } else {
        if (mouse && e.shiftKey) { dx = dy; dy = 0; }
        view.x -= dx; view.y -= dy;
        applyView();
      }
    }

    function onContext(e) {
      if (e.target.closest('.b-ui') || (editing && editing.target.contains(e.target))) return;
      e.preventDefault();
      if (gesture) return;
      if (editing) commitEdit();
      const it = tool === 'select' ? itemUnder(e.target) : null;
      if (it && !sel.has(it.id)) select([it.id]);
      const p = local(e);
      pointer.sx = p.sx; pointer.sy = p.sy; pointer.inside = true;
      const has = sel.size > 0, clip = ZN._boardClip;
      ui.menu({ x: e.clientX, y: e.clientY }, [
        has ? { label: 'Duplicate', icon: 'copy', hint: 'Ctrl D', onClick: () => duplicate() } : null,
        has ? { label: 'Bring to front', icon: 'front', hint: ']', onClick: () => reorder(true) } : null,
        has ? { label: 'Send to back', icon: 'back', hint: '[', onClick: () => reorder(false) } : null,
        has ? { label: 'Delete', icon: 'trash', hint: 'Del', danger: true, onClick: () => { removeItems(Array.from(sel)); commit(); } } : null,
        has ? { sep: true } : null,
        { label: 'Paste here', icon: 'clipboard', hint: 'Ctrl V', disabled: !clip, onClick: () => { if (clip) pasteItems(clip.items, true); } },
        { label: 'New sticky note here', icon: 'sticky', onClick: () => stickyAt(p) },
        { label: 'Select everything', icon: 'cursor', hint: 'Ctrl A', disabled: !items.length, onClick: () => { setTool('select'); select(items.map(i => i.id)); } },
        { label: 'Fit everything on screen', icon: 'fit', hint: 'Shift 1', onClick: () => fitView() }
      ]);
    }

    /* ---------- keyboard ---------- */
    /* true while a dialog, menu or other layer is in front of the board */
    function blocked() {
      const layer = document.getElementById('layer');
      if (!layer) return false;
      for (let i = 0; i < layer.children.length; i++) {
        const cl = layer.children[i].classList;
        if (!cl.contains('toasts') && !cl.contains('tip') && !cl.contains('drop-line')) return true;
      }
      return false;
    }
    /* keys and clipboard belong to the board only when focus is on it (or nowhere in particular) */
    function mine() {
      if (!board.isConnected || editing || blocked()) return false;
      const ae = document.activeElement;
      if (ae && ae !== document.body && !board.contains(ae)) return false;
      return !(ae && U.isEditable(ae));
    }
    function onKey(e) {
      if (!mine() || e.altKey) return;
      const ae = document.activeElement, k = e.key, lk = k.length === 1 ? k.toLowerCase() : k;
      const onButton = ae && ae.tagName === 'BUTTON';
      const mod = e.ctrlKey || e.metaKey;
      if (k === ' ') {
        if (onButton) return;
        e.preventDefault();
        if (!spaceDown) { spaceDown = true; board.classList.add('space'); }
        return;
      }
      if (mod) {
        if (lk === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (lk === 'y') { e.preventDefault(); redo(); }
        else if (lk === 'a') { e.preventDefault(); if (tool !== 'select') setTool('select'); select(items.map(i => i.id)); }
        else if (lk === 'd') { e.preventDefault(); duplicate(); }
        else if (k === '=' || k === '+') { e.preventDefault(); zoomStep(1); }
        else if (k === '-' || k === '_') { e.preventDefault(); zoomStep(-1); }
        else if (k === '0') { e.preventDefault(); zoomTo(1); }
        return;                                   // Ctrl+C / X / V arrive as copy, cut and paste events
      }
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fitView(); return; }
      if (k === 'Escape') {
        if (gesture) return;
        if (tool !== 'select') setTool('select'); else if (sel.size) select([]);
        return;
      }
      if (gesture) return;
      if (k === 'Delete' || k === 'Backspace') {
        if (sel.size) { e.preventDefault(); removeItems(Array.from(sel)); commit(); }
        return;
      }
      if (k.indexOf('Arrow') === 0) {
        if (!sel.size) return;
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        nudge(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
        return;
      }
      if (k === ']' || k === '[') { if (sel.size) { e.preventDefault(); reorder(k === ']'); } return; }
      const one = sel.size === 1 ? get(sel.values().next().value) : null;
      if (k === 'Enter' || k === 'F2') {
        if (onButton && k === 'Enter') return;
        if (one && (EDITS[one.kind] || one.kind === 'frame')) { e.preventDefault(); startEdit(one, { selectAll: true }); }
        return;
      }
      if (k.length !== 1) return;
      if (one && EDITS[one.kind]) { startEdit(one, {}); return; }      // just start typing on the selected note
      const t = TOOL_KEYS[lk];
      if (t) { e.preventDefault(); setTool(t); }
    }
    function onKeyUp(e) {
      if (e.key === ' ' && spaceDown) { spaceDown = false; board.classList.remove('space'); }
    }
    function onBlur() {
      if (spaceDown) { spaceDown = false; board.classList.remove('space'); }
    }

    function onCopy(e) {
      if (!mine() || !sel.size) return;
      const data = payload();
      if (!data) return;
      e.preventDefault();
      try {
        e.clipboardData.setData('application/x-znote-board', JSON.stringify(data));
        e.clipboardData.setData('text/plain', data.text);
      } catch (err) { /* the in-window copy below still works */ }
      ZN._boardClip = data;
      if (e.type === 'cut') { removeItems(Array.from(sel)); commit(); }
    }
    function onPaste(e) {
      if (!mine()) return;
      const cd = e.clipboardData;
      if (!cd) return;
      const files = [];
      Array.prototype.forEach.call(cd.items || [], it => {
        if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) files.push(f); }
      });
      if (files.length) { e.preventDefault(); addImages(files, pointerWorld()); return; }
      let data = null;
      try { const raw = cd.getData('application/x-znote-board'); if (raw) data = JSON.parse(raw); } catch (err) { data = null; }
      const text = cd.getData('text/plain') || '';
      if (!data && ZN._boardClip && ZN._boardClip.text === text) data = ZN._boardClip;
      if (data && Array.isArray(data.items) && data.items.length) { e.preventDefault(); pasteItems(data.items, true); return; }
      const t = text.trim();
      if (!t) return;
      e.preventDefault();
      const p = pointerWorld(), html = U.esc(t).replace(/\r?\n/g, '<br>');
      const it = t.length > 160
        ? { id: U.uid(), kind: 'text', x: f1(p.x - 180), y: f1(p.y - 20), w: 360, h: 40, text: html, size: 's', color: 'ink' }
        : newSticky(p, html);
      if (tool !== 'select') setTool('select');
      addItem(it);
      select([it.id]);
      commit();
    }
    function onDragOver(e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    }
    function onDrop(e) {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const p = local(e);
      addImages(files, { x: p.x, y: p.y });
    }

    /* ---------- title ---------- */
    titleEl.addEventListener('input', () => S.update(page.id, { title: titleEl.textContent.replace(/\s+/g, ' ').trim() }));
    titleEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); titleEl.blur(); board.focus({ preventScroll: true }); }
    });
    titleEl.addEventListener('blur', () => { titleEl.scrollLeft = 0; });

    /* ---------- wiring ---------- */
    board.addEventListener('pointerdown', onDown);
    board.addEventListener('pointermove', onMove);
    board.addEventListener('pointerup', onUp);
    board.addEventListener('pointercancel', onUp);
    board.addEventListener('pointerleave', onLeave);
    board.addEventListener('mousedown', e => { if (e.button === 1 && !e.target.closest('.b-ui')) e.preventDefault(); });
    board.addEventListener('wheel', onWheel, { passive: false });
    board.addEventListener('contextmenu', onContext);
    board.addEventListener('dragover', onDragOver);
    board.addEventListener('drop', onDrop);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('cut', onCopy, true);
    document.addEventListener('paste', onPaste, true);
    window.addEventListener('blur', onBlur);
    const ro = new ResizeObserver(() => { if (alive) layoutOverlay(); });
    ro.observe(board);

    /* ---------- first paint ---------- */
    renderAll();
    const v = content.view;
    if (v && isFinite(v.x) && isFinite(v.y) && isFinite(v.k) && v.k > 0) {
      view.x = v.x; view.y = v.y; view.k = clamp(v.k, 0.1, 4);
      applyView(false);
    } else fitView(false);
    hist.stack = [JSON.stringify(items)];
    hist.idx = 0;
    histButtons();
    setTool('select');
    if (!board.contains(document.activeElement)) board.focus({ preventScroll: true });

    function prepareExport() {
      if (editing) commitEdit();
      nudgeCommit.flush();
      saveView.flush();
    }

    return {
      prepareExport,
      unmount() {
        prepareExport();
        alive = false;
        cancelAnimationFrame(fitRaf);
        ro.disconnect();
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('keyup', onKeyUp);
        document.removeEventListener('copy', onCopy, true);
        document.removeEventListener('cut', onCopy, true);
        document.removeEventListener('paste', onPaste, true);
        window.removeEventListener('blur', onBlur);
      },
      insertImage(rec) {
        if (!rec || !rec.id) return;
        if (editing) commitEdit();
        if (tool !== 'select') setTool('select');
        const c = viewCentre();
        const it = addItem(imageItem(rec, c.x, c.y));
        select([it.id]);
        commit();
      },
      focusTitle() { U.caret.set(titleEl, 'end'); }
    };
  };
})();
