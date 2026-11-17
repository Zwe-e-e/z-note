/* Z Note · snipping tool: capture → crop → mark up → save, and the Snips gallery */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store, ui = ZN.ui;
  const layer = () => document.getElementById('layer');

  const supported = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
  const PASTE_HINT = 'Press Win + Shift + S to take a screenshot, then paste it here with Ctrl + V.';
  const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|avif)$/i;
  const HAND = '"Ink Free", "Segoe Print", "Bradley Hand ITC", cursive';
  const LINE = 1.2;                 // line height of text written on a snip

  let busy = false;                 // a capture is being taken, or the editor is open

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const within = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const p2 = n => String(n).padStart(2, '0');

  function stamp(d) {
    d = d || new Date();
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  const defaultName = () => 'Snip ' + stamp();
  const fileName = name => String(name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'snip';
  const baseName = f => String((f && f.name) || '').replace(/\.[a-z0-9]+$/i, '').trim();
  const extOf = mime => (/jpe?g/i.test(mime) ? 'jpg' : /gif/i.test(mime) ? 'gif' : /webp/i.test(mime) ? 'webp' : /bmp/i.test(mime) ? 'bmp' : /avif/i.test(mime) ? 'avif' : 'png');

  /* ---------- delivering a finished picture ---------- */
  async function saveImage(blob, meta) {
    const rec = await S.addImage(blob, Object.assign({ kind: 'snip', name: defaultName() }, meta || {}));
    let placed = false;
    try { placed = !!(ZN.shell && ZN.shell.insertImage && ZN.shell.insertImage(rec)); }
    catch (e) { console.error('[Z Note] the open page could not take the snip', e); }
    if (placed) ui.toast('Snip added to this page');
    else if (ZN.shell && ZN.shell.route && ZN.shell.route().name === 'snips') ui.toast('Saved to Snips');
    else ui.toast('Saved to Snips', { action: { label: 'Open', fn: () => ZN.go('snips') } });
    return rec;
  }

  /* put an image onto a page that is not open right now */
  function boardCentre(c) {
    const v = c.view;
    if (v && typeof v.k === 'number' && v.k > 0) {
      const vw = Math.max(320, window.innerWidth - 280), vh = Math.max(240, window.innerHeight - 60);
      return { x: (vw / 2 - (v.x || 0)) / v.k, y: (vh / 2 - (v.y || 0)) / v.k };
    }
    // the board has never been opened: land just to the right of what is already there
    const items = (c.items || []).filter(i => i && i.kind !== 'line' && typeof i.x === 'number' && typeof i.w === 'number');
    if (!items.length) return { x: 0, y: 0 };
    let x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    items.forEach(i => { x2 = Math.max(x2, i.x + i.w); y1 = Math.min(y1, i.y); y2 = Math.max(y2, i.y + (i.h || 0)); });
    return { x: x2 + 300, y: (y1 + y2) / 2 };
  }

  function addToPage(rec, p) {
    const c = (p.content = p.content || {});
    if (p.type === 'note') {
      (c.blocks = c.blocks || []).push({ id: U.uid(), t: 'image', src: rec.id, w: null, cap: '' });
    } else if (p.type === 'board') {
      c.items = c.items || [];
      let w = rec.w || 320, hh = rec.h || 240;
      if (w > 480) { hh = Math.max(1, Math.round(hh * 480 / w)); w = 480; }
      const at = boardCentre(c);
      const nudge = (c.items.filter(i => i && i.kind === 'image').length % 6) * 22;
      c.items.push({ id: U.uid(), kind: 'image', x: Math.round(at.x - w / 2 + nudge), y: Math.round(at.y - hh / 2 + nudge), w, h: hh, src: rec.id });
    } else return false;
    S.touch(p.id);
    ui.toast('Added to “' + ZN.pageTitle(p) + '”', { action: { label: 'Open', fn: () => ZN.openPage(p.id) } });
    return true;
  }

  /* ---------- getting pictures in: clipboard, files ---------- */
  function clipboardImage(dt) {
    if (!dt) return null;
    const items = dt.items ? Array.from(dt.items) : [];
    for (const it of items) {
      if (it.kind === 'file' && IMAGE_TYPES.test(it.type)) { const f = it.getAsFile(); if (f) return f; }
    }
    const files = dt.files ? Array.from(dt.files) : [];
    return files.find(f => IMAGE_TYPES.test(f.type)) || null;
  }

  async function readClipboardImage() {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      ui.toast('This browser can’t read the clipboard from a button. Click the page and press Ctrl + V instead.', { ms: 6500 });
      return null;
    }
    let items;
    try { items = await navigator.clipboard.read(); }
    catch (e) {
      ui.toast('The browser didn’t allow reading the clipboard. Click the page and press Ctrl + V instead.', { ms: 6500 });
      return null;
    }
    for (const it of items) {
      const type = (it.types || []).find(t => IMAGE_TYPES.test(t));
      if (!type) continue;
      try { return await it.getType(type); } catch (e) { /* try the next item */ }
    }
    ui.toast('There is no picture on the clipboard yet. ' + PASTE_HINT, { ms: 7000 });
    return null;
  }

  /* open the file chooser (must be called straight from a click) */
  function chooseFiles(multiple) {
    return new Promise(resolve => {
      const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp' });
      if (multiple) inp.multiple = true;
      let done = false;
      const finish = files => { if (!done) { done = true; resolve(files); } };
      inp.addEventListener('change', () => finish(Array.from(inp.files || [])));
      inp.addEventListener('cancel', () => finish([]));
      inp.click();
    });
  }

  /* keep pictures as they are (no editor) */
  async function addPictures(files, kind) {
    files = (files || []).filter(f => f);
    if (!files.length) return 0;
    let n = 0;
    for (const f of files) {
      if (!IMAGE_TYPES.test(f.type || '')) continue;
      try { await S.addImage(f, { kind: kind || 'image', name: baseName(f) || 'Picture ' + stamp() }); n++; }
      catch (e) { console.error('[Z Note] could not add a picture', e); }
    }
    if (n) ui.toast(n === 1 ? 'Picture added to Snips' : n + ' pictures added to Snips');
    else ui.toast('Those files are not pictures Z Note can open.', { error: true });
    return n;
  }

  async function pasteToEditor() {
    const blob = await readClipboardImage();
    return blob ? fromBlob(blob, { kind: 'snip' }) : null;
  }
  async function uploadToEditor() {
    const files = (await chooseFiles(true)).filter(f => IMAGE_TYPES.test(f.type || ''));
    if (!files.length) return null;
    if (files.length > 1) { await addPictures(files, 'image'); return null; }
    return fromBlob(files[0], { kind: 'image', name: baseName(files[0]) });
  }

  /* ---------- screen capture ---------- */
  function captureFailed(e) {
    const name = (e && e.name) || '';
    const msg = String((e && e.message) || '');
    if (name === 'AbortError') return null;
    if (name === 'NotAllowedError' && !/system|policy|disallow|feature/i.test(msg)) return null;   // the picker was simply closed
    console.warn('[Z Note] screen capture failed:', name, msg);
    if (name === 'InvalidStateError') ui.toast('The browser wants a click first — press the Snip button and try again.', { ms: 6500 });
    else if (name === 'NotAllowedError') ui.toast('Screen capture is switched off for this browser. ' + PASTE_HINT, { ms: 9000 });
    else ui.toast('The screen could not be captured. ' + PASTE_HINT, { ms: 9000 });
    return null;
  }

  function firstFrame(video) {
    return new Promise(resolve => {
      const t0 = Date.now();
      (function poll() {
        if ((video.readyState >= 2 && video.videoWidth > 0) || Date.now() - t0 > 4000) resolve();
        else setTimeout(poll, 60);
      })();
    });
  }

  async function bitmapOf(track) {
    if (typeof window.ImageCapture !== 'function' || track.readyState !== 'live') return null;
    try {
      const bm = await within(new window.ImageCapture(track).grabFrame(), 2500);
      return bm && bm.width > 1 && bm.height > 1 ? bm : null;
    } catch (e) { return null; }
  }

  /* "3 … 2 … 1": time to bring another window forward. Resolves false when Esc cancels. */
  function countdown(sec) {
    return new Promise(resolve => {
      const end = Date.now() + sec * 1000;
      const num = h('b', String(sec));
      const box = h('div.snip-count', { role: 'status' }, num, h('span', 'Switch to what you want to capture'), h('small', 'Esc cancels'));
      layer().appendChild(box);
      let timer = null, done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        box.remove();
        window.removeEventListener('keydown', onKey, true);
        resolve(ok);
      };
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
      window.addEventListener('keydown', onKey, true);
      (function tick() {
        const left = end - Date.now();
        if (left <= 0) { finish(true); return; }
        if (left <= 300) { box.style.visibility = 'hidden'; timer = setTimeout(tick, left); return; }   // out of the picture before the shutter
        num.textContent = String(Math.ceil(left / 1000));
        timer = setTimeout(tick, Math.min(250, left - 300));
      })();
    });
  }

  /* ask the browser for a window or screen and take one still picture of it */
  async function grab(delay) {
    const md = navigator.mediaDevices;
    let controller = null;
    if (typeof window.CaptureController === 'function') {
      try { controller = new window.CaptureController(); controller.setFocusBehavior('no-focus-change'); }
      catch (e) { /* carry on without it */ }
    }
    const wish = {
      video: { displaySurface: 'monitor' }, audio: false,
      selfBrowserSurface: 'exclude', monitorTypeSurfaces: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude'
    };
    if (controller) wish.controller = controller;
    let stream;
    try { stream = await md.getDisplayMedia(wish); }      // must be the first await: the browser needs the click that got us here
    catch (e) {
      if (!e || e.name !== 'TypeError') return captureFailed(e);
      try { stream = await md.getDisplayMedia({ video: true, audio: false }); }
      catch (e2) { return captureFailed(e2); }
    }
    const stop = () => { try { stream.getTracks().forEach(t => t.stop()); } catch (e) {} };
    const track = stream.getVideoTracks()[0];
    if (!track) { stop(); return captureFailed(new Error('No picture came back from the screen.')); }
    const video = h('video.snip-probe', { muted: true, playsinline: true });
    video.muted = true;
    video.srcObject = stream;
    document.body.appendChild(video);
    try {
      try { await video.play(); } catch (e) { /* the frame grabber below may still work */ }
      await firstFrame(video);
      if (delay > 0) { if (!(await countdown(delay))) return null; }
      else await sleep(380);                               // let the browser's own picker leave the screen
      let shot = await bitmapOf(track);
      if (!shot && video.videoWidth > 1) {
        shot = document.createElement('canvas');
        shot.width = video.videoWidth;
        shot.height = video.videoHeight;
        shot.getContext('2d').drawImage(video, 0, 0, shot.width, shot.height);
      }
      if (!shot) { ui.toast('The screen picture came back empty. ' + PASTE_HINT, { ms: 9000 }); return null; }
      return shot;
    } finally {
      stop();
      try { video.srcObject = null; } catch (e) {}
      video.remove();
    }
  }

  async function start(opts) {
    opts = opts || {};
    if (busy) return null;
    ui.closeMenu();
    if (!supported) {
      ui.toast('This browser can’t capture the screen from here. ' + PASTE_HINT, { ms: 9000 });
      return null;
    }
    busy = true;
    try {
      const shot = await grab(+opts.delay || 0);
      if (!shot) return null;
      return await openEditor({ source: shot, stage: 'crop', kind: 'snip' });
    } catch (e) {
      console.error('[Z Note] snip failed', e);
      ui.toast('Something went wrong while snipping. ' + PASTE_HINT, { error: true, ms: 9000 });
      return null;
    } finally { busy = false; }
  }

  /* open the editor on a picture you already have. opts: { kind, name, replaceId, stage: 'crop'|'mark' } */
  async function fromBlob(blob, opts) {
    opts = opts || {};
    if (busy || !blob) return null;
    ui.closeMenu();
    busy = true;
    try {
      let bm;
      try { bm = await createImageBitmap(blob); }
      catch (e) { ui.toast('That picture could not be opened.', { error: true }); return null; }
      const big = bm.width >= 1200 || bm.height >= 800;      // looks like a whole window or screen: offer the crop first
      return await openEditor({
        source: bm, stage: opts.stage || (big ? 'crop' : 'mark'),
        kind: opts.kind || 'snip', name: opts.name, replaceId: opts.replaceId
      });
    } catch (e) {
      console.error('[Z Note] snip editor failed', e);
      ui.toast('The snip editor ran into a problem.', { error: true });
      return null;
    } finally { busy = false; }
  }

  /* ---------- marks: kept as shapes in picture pixels, painted the same on screen and in the saved file ---------- */
  const TOOLS = [
    { id: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
    { id: 'hl', icon: 'marker', label: 'Highlighter — hold Shift for a straight line', key: 'H' },
    { id: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
    { id: 'box', icon: 'square', label: 'Box', key: 'B' },
    { id: 'text', icon: 'text', label: 'Text', key: 'T' }
  ];
  const TOOL_KEYS = { p: 'pen', h: 'hl', a: 'arrow', b: 'box', t: 'text' };
  const COLORS = [
    { id: 'red', css: '#D5402B', hl: '#FF9C8C', label: 'Red pencil' },
    { id: 'blue', css: '#2457C5', hl: '#8FC2FF', label: 'Blue' },
    { id: 'black', css: '#1F1E1B', hl: '#BDB8AC', label: 'Black' },
    { id: 'green', css: '#23874B', hl: '#9BE89B', label: 'Green' },
    { id: 'yellow', css: '#F2C200', hl: '#FFE838', label: 'Yellow' }
  ];
  const WIDTHS = [{ id: 0, label: 'Thin', pen: 2.5, dot: 4 }, { id: 1, label: 'Medium', pen: 4.5, dot: 7 }, { id: 2, label: 'Thick', pen: 8, dot: 11 }];
  const HL_MULT = 4.2;              // the highlighter is this many times wider than the pen
  const TEXT_PX = [18, 26, 38];     // on-screen size of written text for thin · medium · thick
  const colorOf = (id, hl) => { const c = COLORS.find(x => x.id === id) || COLORS[0]; return hl ? c.hl : c.css; };
  const r1 = v => Math.round(v * 10) / 10;

  function tracePoints(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) { ctx.lineTo(pts[0][0] + .01, pts[0][1]); return; }
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    const l = pts[pts.length - 1];
    ctx.lineTo(l[0], l[1]);
  }

  function paintOp(ctx, op) {
    const col = colorOf(op.color, op.t === 'hl');
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = op.size;
    if (op.t === 'pen') { tracePoints(ctx, op.pts); ctx.stroke(); }
    else if (op.t === 'hl') {
      tracePoints(ctx, op.pts);
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .88; ctx.stroke();   // tints light areas, leaves dark text dark
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .2; ctx.stroke();      // and still shows on dark screenshots
    }
    else if (op.t === 'arrow') {
      const dx = op.b[0] - op.a[0], dy = op.b[1] - op.a[1], len = Math.hypot(dx, dy);
      if (len > 0) {
        const head = Math.min(len * .45, Math.max(op.size * 4.6, 10)), ang = Math.atan2(dy, dx), spread = .46;
        ctx.beginPath();
        ctx.moveTo(op.a[0], op.a[1]);
        ctx.lineTo(op.b[0], op.b[1]);
        ctx.moveTo(op.b[0] - head * Math.cos(ang - spread), op.b[1] - head * Math.sin(ang - spread));
        ctx.lineTo(op.b[0], op.b[1]);
        ctx.lineTo(op.b[0] - head * Math.cos(ang + spread), op.b[1] - head * Math.sin(ang + spread));
        ctx.stroke();
      }
    }
    else if (op.t === 'box') ctx.strokeRect(op.x, op.y, op.w, op.h);
    else if (op.t === 'text') {
      ctx.font = '400 ' + op.size + 'px ' + HAND;
      ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText(op.text);
      const asc = m.fontBoundingBoxAscent || op.size * .8, desc = m.fontBoundingBoxDescent || op.size * .25;
      const by = op.y + (op.size * LINE - (asc + desc)) / 2 + asc;
      ctx.lineWidth = Math.max(2, op.size / 5.5);                                       // a halo so it reads on any screenshot
      ctx.strokeStyle = op.color === 'yellow' ? 'rgba(20, 18, 12, .82)' : 'rgba(255, 255, 255, .92)';
      ctx.strokeText(op.text, op.x, by);
      ctx.lineWidth = op.size / 30;
      ctx.strokeStyle = col;
      ctx.strokeText(op.text, op.x, by);
      ctx.fillText(op.text, op.x, by);
    }
    ctx.restore();
  }

  let measurer = null;
  function textWidth(text, px) {
    if (!measurer) measurer = document.createElement('canvas').getContext('2d');
    measurer.font = '400 ' + px + 'px ' + HAND;
    return measurer.measureText(text).width;
  }

  /* ---------- the editor ---------- */
  /* o: { source: ImageBitmap|canvas, stage, kind, name, replaceId } → Promise<image record | null> */
  function openEditor(o) {
    return new Promise(resolve => {
      const src = o.source, sw = src.width, sh = src.height;
      ui.closeMenu();
      const prevFocus = document.activeElement;
      const prevTitle = document.title;
      const page = ZN.shell && ZN.shell.currentPage ? ZN.shell.currentPage() : null;
      const toPage = !o.replaceId && !!page && (page.type === 'note' || page.type === 'board');

      let stage = o.stage === 'mark' ? 'mark' : 'crop';
      let crop = { x: 0, y: 0, w: sw, h: sh };     // the part that is kept
      let sel = null;                              // the area being marked in the crop stage (null = the whole picture)
      let ops = [], undone = [];
      let tool = 'pen', widthIdx = 1;
      const picked = { draw: 'red', hl: 'yellow' };
      let live = null, textEntry = null, cache = null;
      let confirming = false, closed = false, working = false, useBtn = null;

      const view = h('canvas.snip-view');
      const dim = h('div.snip-dim', { html: '<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d=""></path></svg>' });
      const dimPath = dim.querySelector('path');
      const sizeText = h('span');
      const sizeTag = h('span.snip-size', ZN.icon('snip', 12), sizeText);
      const selBox = h('div.snip-sel', { hidden: true },
        ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(d => h('span.snip-h', { dataset: { h: d } })), sizeTag);
      const wrap = h('div.snip-wrap', view, dim, selBox);
      const stageEl = h('div.snip-stage', wrap);
      const top = h('div.snip-bar'), bottom = h('div.snip-bar');
      const nameInput = h('input.input.snip-name', {
        type: 'text', value: o.name || defaultName(), maxlength: '80', spellcheck: 'false', autocomplete: 'off',
        'aria-label': 'Name of this snip', 'data-tip': 'Name of this snip', 'data-tip-side': 'top'
      });
      const root = h('div.snip-ed', { tabindex: '-1', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Snip editor' }, top, stageEl, bottom);

      const viewRect = () => (stage === 'crop' ? { x: 0, y: 0, w: sw, h: sh } : crop);
      const scale = () => wrap.getBoundingClientRect().width / viewRect().w;    // on-screen px per picture px
      function toSrc(e) {
        const b = wrap.getBoundingClientRect(), r = viewRect();
        return [r.x + (e.clientX - b.left) * r.w / b.width, r.y + (e.clientY - b.top) * r.h / b.height];
      }

      /* ----- painting ----- */
      function repaint() {
        const r = viewRect();
        if (!cache) cache = document.createElement('canvas');
        cache.width = view.width;
        cache.height = view.height;
        const c = cache.getContext('2d');
        const s = cache.width / r.w;
        c.imageSmoothingEnabled = s < 2;
        c.imageSmoothingQuality = 'high';
        c.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, cache.width, cache.height);
        c.setTransform(s, 0, 0, cache.height / r.h, -r.x * s, -r.y * (cache.height / r.h));
        ops.forEach(op => paintOp(c, op));
        c.setTransform(1, 0, 0, 1, 0, 0);
        drawLive();
      }
      function drawLive() {
        if (!cache) return;
        const c = view.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, view.width, view.height);
        c.drawImage(cache, 0, 0);
        if (live) {
          const r = viewRect(), sx = view.width / r.w, sy = view.height / r.h;
          c.setTransform(sx, 0, 0, sy, -r.x * sx, -r.y * sy);
          paintOp(c, live);
          c.setTransform(1, 0, 0, 1, 0, 0);
        }
      }
      const queueLive = U.frame(drawLive);

      function layout() {
        const r = viewRect();
        const aw = Math.max(60, stageEl.clientWidth - 56), ah = Math.max(60, stageEl.clientHeight - 44);
        const longest = Math.max(r.w, r.h);
        const maxK = longest < 320 ? Math.min(4, 320 / longest) : 1;        // never blow a picture up, unless it is tiny
        const k = Math.min(aw / r.w, ah / r.h, maxK);
        const dw = Math.max(1, Math.round(r.w * k)), dh = Math.max(1, Math.round(r.h * k));
        wrap.style.width = dw + 'px';
        wrap.style.height = dh + 'px';
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        view.width = Math.max(1, Math.round(dw * dpr));
        view.height = Math.max(1, Math.round(dh * dpr));
        stageEl.classList.toggle('crop', stage === 'crop');
        wrap.className = 'snip-wrap' + (stage === 'mark' ? (tool === 'text' ? ' write' : ' draw') : '');
        repaint();
        drawSel();
      }

      function drawSel() {
        const dw = parseFloat(wrap.style.width) || 1, dh = parseFloat(wrap.style.height) || 1;
        if (stage !== 'crop') { dim.hidden = true; selBox.hidden = true; return; }
        dim.hidden = false;
        if (!sel) {
          selBox.hidden = true;
          dimPath.setAttribute('d', '');
        } else {
          const kx = dw / sw, ky = dh / sh;
          const x = sel.x * kx, y = sel.y * ky, w = sel.w * kx, hh = sel.h * ky;
          selBox.hidden = false;
          selBox.style.left = x + 'px';
          selBox.style.top = y + 'px';
          selBox.style.width = w + 'px';
          selBox.style.height = hh + 'px';
          selBox.classList.toggle('tiny', w < 46 || hh < 46);
          sizeTag.classList.toggle('in', y < 34);
          sizeText.textContent = sel.w + ' × ' + sel.h;
          dimPath.setAttribute('d', 'M0 0H' + dw + 'V' + dh + 'H0Z M' + x + ' ' + y + 'h' + w + 'v' + hh + 'h' + (-w) + 'Z');
        }
        if (useBtn) useBtn.disabled = !sel;
      }

      /* ----- pointer plumbing ----- */
      function track(e, onMove, onUp) {
        const id = e.pointerId;
        try { stageEl.setPointerCapture(id); } catch (err) {}
        const move = ev => { if (ev.pointerId === id) onMove(ev); };
        const up = ev => {
          if (ev.pointerId !== id) return;
          stageEl.removeEventListener('pointermove', move);
          stageEl.removeEventListener('pointerup', up);
          stageEl.removeEventListener('pointercancel', up);
          try { stageEl.releasePointerCapture(id); } catch (err) {}
          onUp(ev);
        };
        stageEl.addEventListener('pointermove', move);
        stageEl.addEventListener('pointerup', up);
        stageEl.addEventListener('pointercancel', up);
      }

      /* ----- stage 1: crop ----- */
      function rectFrom(x1, y1, x2, y2) {
        const ax = Math.round(U.clamp(Math.min(x1, x2), 0, sw)), ay = Math.round(U.clamp(Math.min(y1, y2), 0, sh));
        const bx = Math.round(U.clamp(Math.max(x1, x2), 0, sw)), by = Math.round(U.clamp(Math.max(y1, y2), 0, sh));
        return { x: ax, y: ay, w: bx - ax, h: by - ay };
      }
      function cropDown(e) {
        const p = toSrc(e);
        const handle = e.target.closest ? e.target.closest('.snip-h') : null;
        const before = sel ? Object.assign({}, sel) : null;
        let mode = 'new';
        if (handle && sel) mode = handle.dataset.h;
        else if (sel && p[0] >= sel.x && p[0] <= sel.x + sel.w && p[1] >= sel.y && p[1] <= sel.y + sel.h) mode = 'move';
        let moved = false;
        track(e, ev => {
          if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
          moved = true;
          const q = toSrc(ev);
          if (mode === 'new') sel = rectFrom(p[0], p[1], q[0], q[1]);
          else if (mode === 'move') {
            sel = {
              x: Math.round(U.clamp(before.x + q[0] - p[0], 0, sw - before.w)),
              y: Math.round(U.clamp(before.y + q[1] - p[1], 0, sh - before.h)), w: before.w, h: before.h
            };
          } else {
            let x1 = before.x, y1 = before.y, x2 = before.x + before.w, y2 = before.y + before.h;
            if (mode.indexOf('w') >= 0) x1 = q[0];
            if (mode.indexOf('e') >= 0) x2 = q[0];
            if (mode.indexOf('n') >= 0) y1 = q[1];
            if (mode.indexOf('s') >= 0) y2 = q[1];
            sel = rectFrom(x1, y1, x2, y2);
          }
          drawSel();
        }, () => {
          if (mode === 'new' && !moved) sel = null;                       // a plain click clears the marked area
          if (sel && (sel.w < 3 || sel.h < 3)) sel = mode === 'new' ? null : before;
          drawSel();
        });
      }
      function nudgeSel(dx, dy) {
        if (!sel) return;
        sel = { x: U.clamp(sel.x + dx, 0, sw - sel.w), y: U.clamp(sel.y + dy, 0, sh - sel.h), w: sel.w, h: sel.h };
        drawSel();
      }
      function toMark(useSel) {
        crop = useSel && sel && sel.w >= 3 && sel.h >= 3 ? Object.assign({}, sel) : { x: 0, y: 0, w: sw, h: sh };
        stage = 'mark';
        buildBars();
        layout();
      }
      function toCrop() {
        commitText();
        sel = crop.w === sw && crop.h === sh ? null : Object.assign({}, crop);
        stage = 'crop';
        live = null;
        buildBars();
        layout();
      }

      /* ----- stage 2: mark up ----- */
      function pushOp(op) { ops.push(op); undone = []; repaint(); buildBars(); }
      function undoOp() {
        if (textEntry) { cancelText(); return; }
        if (!ops.length) return;
        undone.push(ops.pop());
        repaint();
        buildBars();
      }
      function redoOp() {
        if (!undone.length) return;
        ops.push(undone.pop());
        repaint();
        buildBars();
      }
      function setTool(t) {
        commitText();
        tool = t;
        wrap.className = 'snip-wrap' + (tool === 'text' ? ' write' : ' draw');
        buildBars();
      }

      function markDown(e) {
        if (textEntry && e.target === textEntry.inp) return;
        const hadText = !!(textEntry && textEntry.inp.value.trim());
        commitText();
        const p = toSrc(e), k = scale();
        const color = tool === 'hl' ? picked.hl : picked.draw;
        if (tool === 'text') {
          if (!hadText) startText(p, k, color);       // a click away from finished text only sets it down
          else root.focus({ preventScroll: true });
          return;
        }
        if (document.activeElement !== root) root.focus({ preventScroll: true });
        const pen = WIDTHS[widthIdx].pen;
        if (tool === 'pen' || tool === 'hl') {
          const minD = 1.2 / k;
          live = { t: tool, color, size: (tool === 'hl' ? pen * HL_MULT : pen) / k, pts: [p] };
          drawLive();
          track(e, ev => {
            if (tool === 'hl' && ev.shiftKey) {                        // ruler-straight, along the stronger direction
              const q = toSrc(ev);
              live.pts = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) ? [p, [q[0], p[1]]] : [p, [p[0], q[1]]];
            } else {
              const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
              (evs.length ? evs : [ev]).forEach(c => {
                const q = toSrc(c), l = live.pts[live.pts.length - 1];
                if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= minD) live.pts.push(q);
              });
            }
            queueLive();
          }, () => {
            const op = live;
            live = null;
            op.pts = op.pts.map(pt => [r1(pt[0]), r1(pt[1])]);
            op.size = r1(op.size);
            pushOp(op);
          });
        } else if (tool === 'arrow') {
          live = { t: 'arrow', color, size: r1(pen / k), a: [r1(p[0]), r1(p[1])], b: [r1(p[0]), r1(p[1])] };
          track(e, ev => {
            let q = toSrc(ev);
            if (ev.shiftKey) {                                         // snap to 45° steps
              const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
              const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
              q = [p[0] + len * Math.cos(a), p[1] + len * Math.sin(a)];
            }
            live.b = [r1(q[0]), r1(q[1])];
            queueLive();
          }, () => {
            const op = live;
            live = null;
            if (Math.hypot(op.b[0] - op.a[0], op.b[1] - op.a[1]) * k >= 6) pushOp(op); else drawLive();
          });
        } else if (tool === 'box') {
          live = { t: 'box', color, size: r1(pen / k), x: p[0], y: p[1], w: 0, h: 0 };
          track(e, ev => {
            const q = toSrc(ev);
            live.x = r1(Math.min(p[0], q[0]));
            live.y = r1(Math.min(p[1], q[1]));
            live.w = r1(Math.abs(q[0] - p[0]));
            live.h = r1(Math.abs(q[1] - p[1]));
            queueLive();
          }, () => {
            const op = live;
            live = null;
            if (op.w * k >= 5 && op.h * k >= 5) pushOp(op); else drawLive();
          });
        }
      }

      /* text is typed into a real field sitting on the picture, then painted in when it is set down */
      function styleText(t) {
        const px = TEXT_PX[t.width], k = t.k;
        t.size = px / k;
        t.inp.style.font = '400 ' + px + 'px/' + LINE + ' ' + HAND;
        t.inp.style.color = colorOf(t.color, false);
        const r = viewRect();
        t.inp.style.left = ((t.x - r.x) * k - 3) + 'px';
        t.inp.style.top = ((t.mid - r.y) * k - px * LINE / 2) + 'px';
        t.inp.style.width = Math.max(px * 3, textWidth(t.inp.value, px) + px * .8) + 'px';
      }
      function startText(p, k, color) {
        const inp = h('input.snip-text', { type: 'text', maxlength: '160', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Text to write on the snip' });
        const t = { inp, x: p[0], mid: p[1], k, color, width: widthIdx, size: 0 };
        styleText(t);
        inp.addEventListener('input', () => styleText(t));
        inp.addEventListener('blur', () => { if (textEntry === t) commitText(); });
        wrap.appendChild(inp);
        textEntry = t;
        inp.focus({ preventScroll: true });
      }
      function commitText() {
        const t = textEntry;
        if (!t) return;
        textEntry = null;
        const val = t.inp.value.replace(/\s+/g, ' ').trim();
        t.inp.remove();
        if (val) pushOp({ t: 'text', color: t.color, size: r1(t.size), x: r1(t.x), y: r1(t.mid - t.size * LINE / 2), text: val });
        if (!closed && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
      }
      function cancelText() {
        const t = textEntry;
        if (!t) return;
        textEntry = null;
        t.inp.remove();
        if (!closed) root.focus({ preventScroll: true });
      }

      /* ----- toolbars ----- */
      function buildBars() {
        U.clear(top);
        U.clear(bottom);
        useBtn = null;
        if (stage === 'crop') {
          top.append(h('div.snip-slip.snip-hint', ZN.icon('snip', 19), h('span', 'Drag over the part you want to keep'),
            h('small', 'Enter keeps what is marked — or the whole picture')));
          useBtn = h('button.btn.sm.primary', { type: 'button', 'data-tip': 'Keep only the marked part|Enter', 'data-tip-side': 'top', onclick: () => toMark(true) }, ZN.icon('crop', 15), 'Use this area');
          useBtn.disabled = !sel;
          bottom.append(h('div.snip-slip',
            h('button.btn.sm.quiet', { type: 'button', 'data-tip': 'Close without saving|Esc', 'data-tip-side': 'top', onclick: requestCancel }, 'Cancel'),
            h('button.btn.sm', { type: 'button', onclick: () => toMark(false) }, 'Use the whole picture'),
            useBtn));
        } else {
          const cur = tool === 'hl' ? picked.hl : picked.draw;
          top.append(h('div.snip-slip',
            TOOLS.map(t => h('button.ibtn' + (tool === t.id ? '.on' : ''), {
              type: 'button', 'aria-label': t.label, 'aria-pressed': String(tool === t.id), 'data-tip': t.label + '|' + t.key, onclick: () => setTool(t.id)
            }, ZN.icon(t.icon, 19))),
            h('span.snip-sep'),
            ui.swatches(COLORS.map(c => ({ id: c.id, css: tool === 'hl' ? c.hl : c.css, label: c.label })), cur, id => {
              if (tool === 'hl') picked.hl = id; else picked.draw = id;
              if (textEntry) { textEntry.color = id; styleText(textEntry); }
              buildBars();
            }),
            h('span.snip-sep'),
            WIDTHS.map(w => h('button.ibtn.snip-w' + (widthIdx === w.id ? '.on' : ''), {
              type: 'button', 'aria-label': w.label, 'aria-pressed': String(widthIdx === w.id), 'data-tip': w.label,
              onclick: () => { widthIdx = w.id; if (textEntry) { textEntry.width = w.id; styleText(textEntry); } buildBars(); }
            }, h('i', { style: { width: w.dot + 'px', height: w.dot + 'px' } }))),
            h('span.snip-sep'),
            h('button.ibtn', { type: 'button', disabled: !ops.length && !textEntry, 'aria-label': 'Undo', 'data-tip': 'Undo|Ctrl Z', onclick: undoOp }, ZN.icon('undo', 18)),
            h('button.ibtn', { type: 'button', disabled: !undone.length, 'aria-label': 'Redo', 'data-tip': 'Redo|Ctrl Y', onclick: redoOp }, ZN.icon('redo', 18)),
            h('span.snip-sep'),
            h('button.btn.sm.quiet', { type: 'button', 'data-tip': 'Change the area you keep|C', onclick: toCrop }, ZN.icon('crop', 15), 'Crop')));

          if (confirming) {
            const keep = h('button.btn.sm.primary', { type: 'button', onclick: () => { confirming = false; buildBars(); } }, 'Keep editing');
            bottom.append(h('div.snip-slip', h('span.snip-ask', 'Throw away this snip and its markings?'),
              keep, h('button.btn.sm.danger', { type: 'button', onclick: () => close(null) }, 'Throw away')));
            keep.focus({ preventScroll: true });
          } else {
            const label = o.replaceId ? 'Save changes' : toPage ? 'Add to page' : 'Save snip';
            bottom.append(h('div.snip-slip',
              nameInput,
              h('span.snip-sep'),
              h('button.btn.sm.quiet', { type: 'button', 'data-tip': 'Copy the picture|Ctrl C', 'data-tip-side': 'top', onclick: copyIt }, ZN.icon('copy', 15), 'Copy'),
              h('button.btn.sm.quiet', { type: 'button', 'data-tip': 'Save it as a PNG file', 'data-tip-side': 'top', onclick: downloadIt }, ZN.icon('download', 15), 'Download'),
              h('span.snip-sep'),
              h('button.btn.sm.quiet', { type: 'button', 'data-tip': 'Close without saving|Esc', 'data-tip-side': 'top', onclick: requestCancel }, 'Cancel'),
              o.replaceId ? h('button.btn.sm', { type: 'button', 'data-tip': 'Keep the original and save this as another snip', 'data-tip-side': 'top', onclick: () => finish('new') }, 'Save as new') : null,
              h('button.btn.sm.primary', {
                type: 'button', 'data-tip': (toPage ? 'Add to “' + ZN.pageTitle(page) + '”' : label) + '|Enter', 'data-tip-side': 'top', onclick: () => finish('save')
              }, ZN.icon(toPage ? 'plus' : 'check', 15), label)));
          }
        }
        if (root.isConnected && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
      }

      /* ----- finishing ----- */
      function render() {
        const cv = document.createElement('canvas');
        cv.width = crop.w;
        cv.height = crop.h;
        const c = cv.getContext('2d');
        c.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
        c.setTransform(1, 0, 0, 1, -crop.x, -crop.y);
        ops.forEach(op => paintOp(c, op));
        return new Promise(res => cv.toBlob(res, 'image/png'));
      }
      const cleanName = () => nameInput.value.replace(/\s+/g, ' ').trim() || defaultName();

      async function finish(mode) {
        if (working || closed) return;
        if (stage === 'crop') { toMark(!!sel); return; }
        commitText();
        working = true;
        root.classList.add('working');
        try {
          const blob = await render();
          if (!blob) throw new Error('the picture came out empty');
          const name = cleanName();
          let rec = null;
          if (o.replaceId && mode !== 'new') {
            rec = await S.updateBlob(o.replaceId, { blob, mime: 'image/png', size: blob.size, w: crop.w, h: crop.h, name });
            if (rec) ui.toast('Snip updated');
          }
          if (!rec) rec = await saveImage(blob, { name, kind: o.kind || 'snip' });
          close(rec);
        } catch (e) {
          console.error('[Z Note] could not save the snip', e);
          ui.toast('The snip could not be saved: ' + ((e && e.message) || e), { error: true, ms: 7000 });
          working = false;
          root.classList.remove('working');
        }
      }
      async function copyIt() {
        commitText();
        const blob = await render();
        if (blob) ui.copyImage(blob);
      }
      async function downloadIt() {
        commitText();
        const blob = await render();
        if (blob) U.download(blob, fileName(cleanName()) + '.png');
      }
      function requestCancel() {
        if (textEntry) { cancelText(); return; }
        if (confirming) { confirming = false; buildBars(); return; }
        if (ops.length && stage === 'mark') { confirming = true; buildBars(); return; }
        close(null);
      }
      function close(result) {
        if (closed) return;
        closed = true;
        textEntry = null;
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('focus', titleBack);
        titleBack();
        root.remove();
        if (src.close) { try { src.close(); } catch (e) {} }
        if (!result && prevFocus && prevFocus.isConnected && prevFocus.focus && prevFocus !== document.body) {
          try { prevFocus.focus({ preventScroll: true }); } catch (e) {}
        }
        resolve(result || null);
      }

      /* ----- keyboard: nothing behind the editor hears a key while it is open ----- */
      function trapTab(e) {
        const list = Array.from(root.querySelectorAll('button, input')).filter(el => !el.disabled && el.offsetParent !== null);
        if (!list.length) { e.preventDefault(); return; }
        const i = list.indexOf(document.activeElement);
        e.preventDefault();
        const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
        list[next].focus({ preventScroll: true });
      }
      function onKey(e) {
        e.stopPropagation();
        if (closed || working) { e.preventDefault(); return; }
        const key = e.key || '', lk = key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
        const t = e.target;
        if (key === 'Tab') { trapTab(e); return; }
        if (e.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) { e.preventDefault(); return; }   // no history hops mid-snip
        if (textEntry && t === textEntry.inp) {
          if (e.isComposing) return;
          if (key === 'Enter') { e.preventDefault(); commitText(); }
          else if (key === 'Escape') { e.preventDefault(); cancelText(); }
          return;
        }
        if (key === 'Escape') { e.preventDefault(); requestCancel(); return; }
        if (t === nameInput) {
          if (key === 'Enter' && !e.isComposing) { e.preventDefault(); finish('save'); }
          else if (mod && lk === 's') { e.preventDefault(); finish('save'); }
          return;
        }
        const onButton = !!(t && t.closest && t.closest('button'));
        if (key === 'Enter' || key === ' ') {
          if (onButton) return;                                     // let the focused button do its own thing
          e.preventDefault();
          if (confirming) return;
          if (key === 'Enter') finish('save');
          return;
        }
        if (confirming) return;
        if (stage === 'crop') {
          const step = e.shiftKey ? 10 : 1;
          if (key === 'ArrowLeft') { e.preventDefault(); nudgeSel(-step, 0); }
          else if (key === 'ArrowRight') { e.preventDefault(); nudgeSel(step, 0); }
          else if (key === 'ArrowUp') { e.preventDefault(); nudgeSel(0, -step); }
          else if (key === 'ArrowDown') { e.preventDefault(); nudgeSel(0, step); }
          else if (mod && lk === 'a') { e.preventDefault(); sel = null; drawSel(); }
          return;
        }
        if (mod && !e.altKey) {
          if (lk === 'z') { e.preventDefault(); if (e.shiftKey) redoOp(); else undoOp(); }
          else if (lk === 'y') { e.preventDefault(); redoOp(); }
          else if (lk === 'c') { e.preventDefault(); copyIt(); }
          else if (lk === 's') { e.preventDefault(); finish('save'); }
          return;
        }
        if (e.altKey) return;
        if (TOOL_KEYS[lk]) { e.preventDefault(); setTool(TOOL_KEYS[lk]); }
        else if (lk === 'c') { e.preventDefault(); toCrop(); }
      }
      const onResize = U.frame(() => { if (closed) return; commitText(); layout(); });
      function titleBack() { if (document.title.indexOf('Snip ready') >= 0) document.title = prevTitle; }

      /* ----- wiring ----- */
      stageEl.addEventListener('mousedown', e => { if (!(textEntry && e.target === textEntry.inp)) e.preventDefault(); });
      stageEl.addEventListener('pointerdown', e => {
        if (e.button !== 0 || working || confirming) return;
        if (stage === 'crop') { if (document.activeElement !== root) root.focus({ preventScroll: true }); cropDown(e); }
        else if (wrap.contains(e.target)) markDown(e);
        else { commitText(); if (document.activeElement !== root) root.focus({ preventScroll: true }); }
      });
      stageEl.addEventListener('dblclick', e => {
        if (stage !== 'crop' || !sel) return;
        const p = toSrc(e);
        if (p[0] >= sel.x && p[0] <= sel.x + sel.w && p[1] >= sel.y && p[1] <= sel.y + sel.h) toMark(true);
      });
      stageEl.addEventListener('contextmenu', e => e.preventDefault());
      // toolbar clicks must not pull the caret out of text that is being written
      top.addEventListener('mousedown', e => { if (textEntry) e.preventDefault(); });
      // after a mouse click on a toolbar button, hand the keyboard back to the editor so Enter means "save"
      root.addEventListener('click', e => {
        if (closed || e.detail === 0 || textEntry || confirming) return;
        if (e.target === nameInput || !e.target.closest || !e.target.closest('.snip-bar button')) return;
        if (root.isConnected) root.focus({ preventScroll: true });
      });

      layer().appendChild(root);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', onResize);
      buildBars();
      layout();
      root.focus({ preventScroll: true });
      if (!document.hasFocus()) {                              // they switched away for the capture: flag the taskbar
        document.title = '✂ Snip ready · Z Note';
        window.addEventListener('focus', titleBack);
        try { window.focus(); } catch (e) {}
      }
    });
  }

  /* ---------- the Snip menu (top bar) ---------- */
  function menu(anchor) {
    return ui.menu(anchor, [
      { label: 'Capture a window or screen', sub: 'Pick it, then drag over the part you want', icon: 'snip', hint: 'Alt S', onClick: () => { start(); } },
      { label: 'Capture in 3 seconds', sub: 'Time to switch to another window first', icon: 'timer', onClick: () => { start({ delay: 3 }); } },
      { label: 'Paste from the clipboard', sub: 'After Win + Shift + S', icon: 'clipboard', onClick: () => { pasteToEditor(); } },
      { label: 'Upload an image…', icon: 'upload', onClick: () => { uploadToEditor(); } },
      { sep: true },
      { label: 'Open Snips', icon: 'image', onClick: () => ZN.go('snips') }
    ], { align: 'end' });
  }

  /* a screenshot pasted anywhere that isn't a text field becomes a snip */
  document.addEventListener('paste', e => {
    if (e.defaultPrevented || busy) return;
    if (U.isEditable(e.target) || U.isEditable(document.activeElement)) return;
    const f = clipboardImage(e.clipboardData);
    if (!f) return;
    e.preventDefault();
    saveImage(f, { kind: 'snip' }).catch(err => {
      console.error('[Z Note] could not save the pasted picture', err);
      ui.toast('That picture could not be saved.', { error: true });
    });
  });

  /* ---------- the Snips gallery ---------- */
  ZN.views.snips = function (el) {
    let alive = true, filter = 'all', all = [], skip = 0;
    const grid = h('div.snip-grid');
    const sub = h('p.sub');
    const seg = h('div.seg.snip-filter', { role: 'radiogroup', 'aria-label': 'Show' });
    const sheet = h('div.sheet.listing.snips',
      h('h1', ZN.icon('snip', 32), 'Snips'),
      sub,
      h('div.listing-actions',
        h('button.btn.primary', { type: 'button', 'data-tip': 'Capture a window or screen|Alt S', onclick: () => { start(); } }, ZN.icon('snip', 15), 'New snip'),
        h('button.btn', { type: 'button', 'data-tip': 'Paste a screenshot from the clipboard|Ctrl V', onclick: pasteHere }, ZN.icon('clipboard', 15), 'Paste'),
        h('button.btn', { type: 'button', 'data-tip': 'Bring in pictures from this PC', onclick: uploadHere }, ZN.icon('upload', 15), 'Upload'),
        seg),
      grid);
    el.append(h('div.page-wrap', sheet));

    async function pasteHere() {
      const blob = await readClipboardImage();
      if (blob) await saveImage(blob, { kind: 'snip' });
    }
    async function uploadHere() {
      const files = await chooseFiles(true);
      if (files.length) await addPictures(files, 'image');
    }

    const usedOn = id => S.live().filter(p => {
      const c = p.content || {};
      if (p.type === 'note') return (c.blocks || []).some(b => b && b.src === id);
      if (p.type === 'board') return (c.items || []).some(i => i && i.src === id);
      return false;
    });

    function pageItems(b) {
      const pages = S.live().filter(p => p.type === 'note' || p.type === 'board').sort((x, y) => y.updated - x.updated).slice(0, 8);
      if (!pages.length) return [{ label: 'No notes or boards yet', disabled: true }];
      return [{ head: 'recent pages' }].concat(pages.map(p => {
        const nb = S.notebookOf(p.id);
        const it = { label: ZN.pageTitle(p), sub: (nb ? ZN.pageTitle(nb) + ' · ' : '') + ZN.TYPE_NAME[p.type], onClick: () => addToPage(b, p) };
        if (p.icon && p.icon.indexOf('i:') === 0) it.icon = p.icon.slice(2);
        else if (p.icon) it.glyph = p.icon;
        else it.icon = ZN.TYPE_ICON[p.type];
        return it;
      }));
    }

    const markUp = b => fromBlob(b.blob, { replaceId: b.id, name: b.name, kind: b.kind, stage: 'mark' });

    function startRename(b) {
      const cap = grid.querySelector('.snip-card[data-id="' + b.id + '"] .snip-cap');
      if (!cap) return;
      cap.focus();
      const r = document.createRange();
      r.selectNodeContents(cap);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }

    async function remove(b) {
      const used = usedOn(b.id);
      const where = used.length
        ? ' It is used on ' + (used.length === 1 ? 'one page' : used.length + ' pages') + ' (' + used.slice(0, 3).map(p => ZN.pageTitle(p)).join(', ') + (used.length > 3 ? '…' : '') + '), which will show an empty frame instead.'
        : ' It will also disappear from any page that uses it.';
      const ok = await ui.confirm('“' + (b.name || 'This picture') + '” will be deleted for good.' + where,
        { title: 'Delete this picture?', ok: 'Delete', danger: true });
      if (!ok) return;
      await S.delBlob(b.id);
      ui.toast('Picture deleted');
    }

    function moreMenu(anchor, b) {
      ui.menu(anchor, [
        { label: 'Open', icon: 'open', onClick: () => ui.lightbox(b.id) },
        { label: 'Mark up', icon: 'pen', onClick: () => { markUp(b); } },
        { label: 'Add to a page', icon: 'plus', items: () => pageItems(b) },
        { sep: true },
        { label: 'Copy', icon: 'copy', onClick: () => ui.copyImage(b.blob) },
        { label: 'Download', icon: 'download', onClick: () => U.download(b.blob, fileName(b.name) + '.' + extOf(b.mime || (b.blob && b.blob.type) || '')) },
        { label: 'Rename', icon: 'text', onClick: () => startRename(b) },
        { sep: true },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => { remove(b); } }
      ], { align: 'end' });
    }

    function card(b) {
      const ratio = b.w && b.h ? b.w / b.h : 4 / 3;
      const cap = h('span.snip-cap', {
        contenteditable: 'plaintext-only', spellcheck: 'false', role: 'textbox', 'aria-label': 'Name', 'data-ph': 'Name this picture'
      }, b.name || '');
      cap.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); cap.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); cap.textContent = b.name || ''; cap.blur(); }
      });
      cap.addEventListener('blur', async () => {
        const v = cap.textContent.replace(/\s+/g, ' ').trim().slice(0, 80);
        cap.textContent = v;
        cap.scrollLeft = 0;
        if (v === (b.name || '')) return;
        b.name = v;
        skip++;                                                // our own change: no need to redraw the whole wall
        let rec = null;
        try { rec = await S.updateBlob(b.id, { name: v }); } catch (e) { console.error(e); }
        if (!rec) skip = Math.max(0, skip - 1);
      });
      const meta = [new Date(b.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })];
      if (b.w && b.h) meta.push(b.w + ' × ' + b.h);
      meta.push(U.bytes(b.size || (b.blob && b.blob.size) || 0));
      const fig = h('figure.snip-card', { dataset: { id: b.id } },
        h('button.snip-photo' + (ratio > 2.3 || ratio < .55 ? '.fit' : ''), { type: 'button', 'aria-label': 'Open ' + (b.name || 'picture'), onclick: () => ui.lightbox(b.id) },
          S.setImg(h('img', { alt: '', draggable: 'false' }), b.id)),
        h('div.snip-acts',
          h('button.ibtn.sm', { type: 'button', 'aria-label': 'Mark up', 'data-tip': 'Mark up', onclick: () => { markUp(b); } }, ZN.icon('pen', 15)),
          h('button.ibtn.sm', { type: 'button', 'aria-label': 'Copy', 'data-tip': 'Copy', onclick: () => ui.copyImage(b.blob) }, ZN.icon('copy', 15)),
          h('button.ibtn.sm', { type: 'button', 'aria-label': 'Add to a page', 'data-tip': 'Add to a page', onclick: e => ui.menu(e.currentTarget, pageItems(b), { align: 'end' }) }, ZN.icon('plus', 15)),
          h('button.ibtn.sm', { type: 'button', 'aria-label': 'More', 'data-tip': 'More', onclick: e => moreMenu(e.currentTarget, b) }, ZN.icon('more', 15))),
        h('figcaption', cap, h('span.snip-meta', meta.join(' · '))));
      fig.addEventListener('contextmenu', e => {
        if (e.target === cap) return;
        e.preventDefault();
        moreMenu({ x: e.clientX, y: e.clientY }, b);
      });
      return fig;
    }

    const way = (icon, title, text) => h('div.snip-way', ZN.icon(icon, 24), h('b', title), h('span', text));

    function render() {
      const snips = all.filter(b => b.kind === 'snip').length;
      const shown = all.filter(b => filter === 'all' || (filter === 'snip' ? b.kind === 'snip' : b.kind !== 'snip'));
      const bytes = all.reduce((n, b) => n + (b.size || (b.blob && b.blob.size) || 0), 0);
      sub.textContent = all.length
        ? all.length + (all.length === 1 ? ' picture' : ' pictures') + ' · ' + U.bytes(bytes) + ' — everything you snip, paste or upload is kept here.'
        : 'Everything you snip, paste or upload is kept here.';
      U.clear(seg);
      [['all', 'All', all.length], ['snip', 'Snips', snips], ['image', 'Pictures', all.length - snips]].forEach(f =>
        seg.append(h('button' + (filter === f[0] ? '.on' : ''), {
          type: 'button', role: 'radio', 'aria-checked': String(filter === f[0]), onclick: () => { filter = f[0]; render(); }
        }, f[1], h('small', String(f[2])))));
      seg.hidden = !all.length;
      U.clear(grid);
      if (!all.length) {
        grid.append(h('div.empty.snip-none', 'Nothing snipped yet',
          h('div.snip-ways',
            way('snip', 'Alt + S', 'Pick a window or screen, then drag over the part you want.'),
            way('clipboard', 'Win + Shift + S, then Ctrl + V', 'Take a Windows screenshot and paste it anywhere in Z Note.'),
            way('upload', 'Upload', 'Bring in pictures from this PC, or drop them onto this page.'))));
      } else if (!shown.length) {
        grid.append(h('div.empty.snip-none', filter === 'snip' ? 'No snips here yet' : 'No pictures here yet',
          h('small', filter === 'snip' ? 'Screen captures and pasted screenshots show up under Snips.' : 'Uploaded and dropped pictures show up under Pictures.')));
      } else shown.forEach(b => grid.append(card(b)));
    }

    async function reload() {
      const list = await S.listBlobs();
      if (!alive) return;
      all = list;
      render();
    }
    const queueReload = U.debounce(reload, 60);
    const off = S.on('blobs', () => { if (skip > 0) { skip--; return; } queueReload(); });

    /* drop picture files anywhere while this page is showing */
    const hasFiles = e => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
    const onOver = e => {
      if (!hasFiles(e) || busy) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      sheet.classList.add('drop-on');
    };
    const onLeave = e => { if (!e.relatedTarget) sheet.classList.remove('drop-on'); };
    const onDrop = e => {
      if (!hasFiles(e) || busy) return;
      e.preventDefault();
      sheet.classList.remove('drop-on');
      addPictures(Array.from(e.dataTransfer.files || []), 'image');
    };
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onDrop);

    render();
    reload();
    return {
      unmount() {
        alive = false;
        queueReload.cancel();
        off();
        document.removeEventListener('dragover', onOver);
        document.removeEventListener('dragleave', onLeave);
        document.removeEventListener('drop', onDrop);
      }
    };
  };

  ZN.snip = { supported, menu, start, fromBlob, saveImage, addToPage };
})();
