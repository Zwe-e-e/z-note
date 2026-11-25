/* Z Note · search everything (Ctrl+K): pages by title, tag and content, plus quick commands */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store;

  const cache = new Map();          // page id → { updated, text }

  function pageText(p) {
    const c = cache.get(p.id);
    if (c && c.updated === p.updated) return c.text;
    let text = '';
    const content = p.content || {};
    if (p.type === 'note') text = ZN.note ? ZN.note.textOf(p) : '';
    else if (p.type === 'todo') text = (content.tasks || []).map(t => t.text + (t.note ? '\n' + t.note : '')).join('\n');
    else if (p.type === 'board') {
      text = ZN.board && ZN.board.textOf ? ZN.board.textOf(p)
        : (content.items || []).map(i => (i.text ? U.text(i.text) : '') + (i.title ? ' ' + i.title : '')).filter(Boolean).join('\n');
    }
    else if (p.type === 'budget') text = ZN.budget ? ZN.budget.textOf(p) : '';
    cache.set(p.id, { updated: p.updated, text });
    return text;
  }

  function commands() {
    const sh = ZN.shell;
    return [
      { label: 'New note', icon: 'note', hint: 'Alt N', run: () => sh.newPage('note') },
      { label: 'New to-do list', icon: 'todo', hint: 'Alt T', run: () => sh.newPage('todo') },
      { label: 'New board', icon: 'board', hint: 'Alt B', run: () => sh.newPage('board') },
      { label: 'New budget & expenses', icon: 'budget', run: () => sh.newPage('budget') },
      { label: 'New notebook', icon: 'book', run: () => sh.newNotebook() },
      { label: 'Start from a template', icon: 'layout', run: () => ZN.templates.pick() },
      { label: 'Snip the screen', icon: 'snip', hint: 'Alt S', run: () => ZN.snip && ZN.snip.start() },
      { label: 'Go to Home', icon: 'home', hint: 'Alt H', run: () => ZN.go('home') },
      { label: 'Go to Tasks', icon: 'tasks', run: () => ZN.go('tasks') },
      { label: 'Go to Snips', icon: 'snip', run: () => ZN.go('snips') },
      { label: 'Go to Trash', icon: 'trash', run: () => ZN.go('trash') },
      { label: 'Style & data', icon: 'palette', run: () => ZN.settings.open('style') },
      { label: 'Back up my notebook', icon: 'data', run: () => ZN.settings.open('data') },
      { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => ZN.settings.open('keys') },
      {
        label: S.settings.style.paper === 'night' ? 'Switch to cream paper' : 'Switch to night paper',
        icon: S.settings.style.paper === 'night' ? 'sun' : 'moon',
        run: () => ZN.settings.setStyle('paper', S.settings.style.paper === 'night' ? 'cream' : 'night')
      }
    ];
  }

  /* escaped text with each found term wrapped in <mark> */
  function mark(text, terms) {
    const ts = (terms || []).filter(Boolean);
    if (!ts.length) return U.esc(text);
    const re = new RegExp('(' + ts.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    return String(text).split(re).map((part, i) => (i % 2 ? '<mark>' + U.esc(part) + '</mark>' : U.esc(part))).join('');
  }

  function find(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const tags = words.filter(w => w[0] === '#' && w.length > 1).map(w => w.slice(1));
    const terms = words.filter(w => w[0] !== '#');
    const out = [];
    S.live().forEach(p => {
      if (p.type === 'notebook' && !terms.length) return;
      const pTags = (p.tags || []).map(t => t.toLowerCase());
      if (tags.length && !tags.every(t => pTags.some(x => x.indexOf(t) === 0))) return;
      const title = ZN.pageTitle(p), lt = title.toLowerCase();
      const body = p.type === 'notebook' ? '' : pageText(p);
      const lb = body.toLowerCase();
      let score = tags.length ? 30 : 0, firstHit = -1;
      for (const t of terms) {
        const inTitle = lt.indexOf(t);
        const inTag = pTags.some(x => x.indexOf(t) >= 0);
        const inBody = lb.indexOf(t);
        if (inTitle < 0 && !inTag && inBody < 0) return;
        if (inTitle === 0) score += 100; else if (inTitle > 0) score += 60;
        if (inTag) score += 35;
        if (inBody >= 0) { score += 10; if (firstHit < 0) firstHit = inBody; }
      }
      score += Math.max(0, 8 - (Date.now() - p.updated) / 864e5);     // a nudge for recently edited pages
      let snip = '';
      if (firstHit >= 0) {
        const a = Math.max(0, firstHit - 34);
        snip = (a > 0 ? '…' : '') + body.slice(a, firstHit + 90).replace(/\s+/g, ' ').trim() + (firstHit + 90 < body.length ? '…' : '');
      }
      out.push({ page: p, score, title, snip });
    });
    out.sort((a, b) => b.score - a.score);
    return { items: out.slice(0, 40), terms };
  }

  let openNow = null;

  function open(initial) {
    if (openNow) { openNow.input.focus(); if (typeof initial === 'string') { openNow.input.value = initial; openNow.refresh(); } return; }
    const prevFocus = document.activeElement;
    const input = h('input', { type: 'text', placeholder: 'Search pages, or type a command…', 'aria-label': 'Search', spellcheck: 'false', value: typeof initial === 'string' ? initial : '' });
    const list = h('div.palette-list', { role: 'listbox' });
    const back = h('div.palette-back',
      h('div.palette.sheet', { role: 'dialog', 'aria-label': 'Search' },
        h('div.palette-in', ZN.icon('search', 19), input),
        list,
        h('div.palette-foot', h('span', h('kbd', '↑'), ' ', h('kbd', '↓'), ' move'), h('span', h('kbd', 'Enter'), ' open'), h('span', h('kbd', '#tag'), ' filter by tag'), h('span', h('kbd', 'Esc'), ' close'))));
    let rows = [], idx = 0;

    function close(restore) {
      if (!openNow) return;
      openNow = null;
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      if (restore !== false && prevFocus && prevFocus.isConnected && prevFocus.focus) { try { prevFocus.focus({ preventScroll: true }); } catch (e) {} }
    }
    function run(r) {
      if (!r) return;
      close(false);
      if (r.page) ZN.openPage(r.page.id); else r.run();
    }
    function setHot(i) {
      idx = i;
      list.querySelectorAll('.palette-item').forEach((el, k) => el.classList.toggle('hot', k === idx));
      const hot = list.querySelector('.palette-item.hot');
      if (hot) hot.scrollIntoView({ block: 'nearest' });
    }
    function refresh() {
      const q = input.value.trim();
      U.clear(list);
      rows = [];
      const addHead = t => list.append(h('div.menu-head', t));
      const addPage = (r, terms) => {
        const p = r.page, nb = S.notebookOf(p.id);
        rows.push(r);
        list.append(h('button.palette-item', { type: 'button', role: 'option', dataset: { i: String(rows.length - 1) } },
          p.type === 'notebook' ? ZN.icon('book', 18) : ZN.pageIcon(p, 18),
          h('div.palette-main',
            h('div.palette-title', { html: mark(r.title, terms || []) }),
            r.snip ? h('div.palette-snip', { html: mark(r.snip, terms || []) }) : null),
          h('span.palette-where', p.type === 'notebook' ? 'Notebook' : (nb ? ZN.pageTitle(nb) : ''))));
      };
      const addCmd = c => {
        rows.push(c);
        list.append(h('button.palette-item', { type: 'button', role: 'option', dataset: { i: String(rows.length - 1) } },
          ZN.icon(c.icon, 18), h('div.palette-main', h('div.palette-title', c.label)), c.hint ? h('kbd', c.hint) : null));
      };
      if (!q) {
        const recent = S.settings.recent.map(id => S.get(id)).filter(p => p && S.isLive(p)).slice(0, 6);
        if (recent.length) { addHead('recent'); recent.forEach(p => addPage({ page: p, title: ZN.pageTitle(p), snip: '' })); }
        addHead('do something');
        commands().slice(0, 8).forEach(addCmd);
      } else {
        const res = find(q);
        const lq = q.toLowerCase();
        const cmds = q[0] === '#' ? [] : commands().filter(c => c.label.toLowerCase().indexOf(lq) >= 0);
        if (res.items.length) { addHead(res.items.length === 1 ? '1 page' : res.items.length + ' pages'); res.items.forEach(r => addPage(r, res.terms)); }
        if (cmds.length) { addHead('commands'); cmds.forEach(addCmd); }
        if (!rows.length) list.append(h('div.empty', 'Nothing found for “' + q + '”', h('small', 'Try fewer or different words.')));
      }
      setHot(0);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        if (rows.length) setHot((idx + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
      } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(rows[idx]); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); close(); }
    }

    input.addEventListener('input', refresh);
    list.addEventListener('click', e => { const it = e.target.closest('.palette-item'); if (it) run(rows[+it.dataset.i]); });
    list.addEventListener('mousemove', e => { const it = e.target.closest('.palette-item'); if (it && +it.dataset.i !== idx) setHot(+it.dataset.i); });
    back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey, true);
    document.getElementById('layer').appendChild(back);
    openNow = { input, refresh };
    refresh();
    input.focus();
    input.select();
  }

  ZN.search = { open, find, pageText };
})();
