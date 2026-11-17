/* Z Note · home: greeting, quick capture, today's tasks, recent pages, latest snips */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store, ui = ZN.ui;

  function greeting() {
    const hr = new Date().getHours();
    return hr < 5 ? ['Still', 'up'] : hr < 12 ? ['Good', 'morning'] : hr < 18 ? ['Good', 'afternoon'] : ['Good', 'evening'];
  }

  /* the note that quick-captured ideas are added to (created on first use) */
  function ideasPage() {
    let p = S.settings.ideasId ? S.get(S.settings.ideasId) : null;
    if (p && S.isLive(p) && p.type === 'note') return p;
    p = S.live('note').find(x => /^idea inbox$/i.test(x.title));      // e.g. the one that arrived from another PC
    if (p) { S.setSetting('ideasId', p.id); return p; }
    const nb = S.notebooks().find(n => /idea/i.test(n.title)) || S.ensureNotebook();
    p = S.create({ type: 'note', parentId: nb.id, title: 'Idea inbox', icon: 'i:bulb', content: { blocks: [] } });
    S.setSetting('ideasId', p.id);
    return p;
  }

  function captureIdea(text) {
    text = (text || '').trim();
    if (!text) return null;
    const p = ideasPage();
    const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const stamp = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const blocks = [{ id: U.uid(), t: 'ul', html: U.esc(lines[0]) + ' <span class="ink-muted">· ' + U.esc(stamp) + '</span>' }];
    lines.slice(1).forEach(l => blocks.push({ id: U.uid(), t: 'p', html: U.esc(l), indent: 1 }));
    // keep a leading heading/intro in place; new ideas go right under it
    const list = p.content.blocks;
    let at = 0;
    while (at < list.length && list[at].t !== 'ul' && at < 3) at++;
    if (at >= 3 || at === list.length) at = list.length && /^h/.test(list[0].t) ? 1 : 0;
    list.splice.apply(list, [at, 0].concat(blocks));
    S.touch(p.id);
    return p;
  }
  ZN.captureIdea = captureIdea;

  ZN.views.home = function (el) {
    const g = greeting();
    const name = (S.settings.name || '').trim();
    const hello = h('h1.home-hello');
    if (name) hello.append(g.join(' ') + ', ', h('em', name), '.');
    else hello.append(g[0] + ' ', h('em', g[1]), '.');

    /* quick capture */
    const ta = h('textarea', { rows: '1', placeholder: 'Jot down an idea or a to-do…', 'aria-label': 'Quick capture' });
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 196) + 'px'; };
    const saveIdea = () => {
      const p = captureIdea(ta.value);
      if (!p) { ta.focus(); return; }
      ta.value = ''; grow();
      ui.toast('Saved to “' + ZN.pageTitle(p) + '”', { action: { label: 'Open', fn: () => ZN.openPage(p.id) } });
    };
    const saveTodo = () => {
      if (!ta.value.trim() || !ZN.tasks) { ta.focus(); return; }
      const list = ZN.tasks.quickAdd(ta.value);
      ta.value = ''; grow();
      if (list) ui.toast('Added to “' + ZN.pageTitle(list) + '”', { action: { label: 'Open', fn: () => ZN.openPage(list.id) } });
    };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) saveTodo(); else saveIdea();
    });

    const start = (icon, label, fn, tip) => h('button.start', { type: 'button', onclick: fn, 'data-tip': tip || null }, ZN.icon(icon, 19), label);
    const grid = h('div.home-grid');

    function todayCard() {
      const card = h('section.card.sheet', h('span.tape'));
      const items = ZN.tasks ? ZN.tasks.collect().filter(t => !t.done) : [];
      const today = U.ymd();
      const due = items.filter(t => t.due && t.due <= today).sort((a, b) => a.due.localeCompare(b.due));
      const next = items.filter(t => t.due && t.due > today).sort((a, b) => a.due.localeCompare(b.due));
      const flagged = items.filter(t => !t.due && t.pri);
      const show = due.concat(flagged, next).slice(0, 7);
      card.append(h('h2.card-title', ZN.icon('tasks', 20), 'Today',
        h('button.card-more', { type: 'button', onclick: () => ZN.go('tasks') }, 'All tasks →')));
      if (!show.length) {
        card.append(h('div.empty', 'Nothing due. Enjoy the quiet.', h('small', 'Type a to-do above and press Ctrl + Enter.')));
      } else {
        card.append(h('div.plist', show.map(t => ZN.tasks.row(t, { compact: true }))));
      }
      return card;
    }

    function recentCard() {
      const card = h('section.card.sheet', h('span.tape', { style: { '--tape': 'var(--hl-blue)' } }));
      const seen = S.settings.recent.map(id => S.get(id)).filter(p => p && S.isLive(p) && p.type !== 'notebook');
      const rest = S.live().filter(p => p.type !== 'notebook' && seen.indexOf(p) < 0).sort((a, b) => b.updated - a.updated);
      const list = seen.concat(rest).slice(0, 7);
      card.append(h('h2.card-title', ZN.icon('clock', 20), 'Recent pages'));
      if (!list.length) card.append(h('div.empty', 'No pages yet', h('small', 'Start a note, a to-do list or a board above.')));
      else card.append(h('div.plist', list.map(p => {
        const nb = S.notebookOf(p.id);
        return h('button.prow', { type: 'button', onclick: () => ZN.openPage(p.id) },
          ZN.pageIcon(p, 18), h('span.prow-title', ZN.pageTitle(p)),
          h('span.prow-meta', (nb ? ZN.pageTitle(nb) + ' · ' : '') + U.ago(p.updated)));
      })));
      return card;
    }

    function snipCard(blobs) {
      const card = h('section.card.sheet', h('span.tape', { style: { '--tape': 'var(--hl-pink)' } }));
      card.append(h('h2.card-title', ZN.icon('snip', 20), 'Latest snips',
        h('button.card-more', { type: 'button', onclick: () => ZN.go('snips') }, 'All snips →')));
      if (!blobs.length) {
        card.append(h('div.empty', 'No snips yet', h('small', 'Press Alt + S to capture part of your screen — or take a screenshot with Win + Shift + S and paste it here with Ctrl + V.')));
      } else {
        card.append(h('div.thumbs', blobs.slice(0, 8).map(b =>
          h('button.thumb', { type: 'button', 'aria-label': b.name || 'Snip', onclick: () => ui.lightbox(b.id) }, S.setImg(h('img', { alt: '' }), b.id)))));
      }
      return card;
    }

    function notebooksCard() {
      const card = h('section.card.sheet.wide', h('span.tape', { style: { '--tape': 'var(--hl-green)' } }));
      card.append(h('h2.card-title', ZN.icon('book', 20), 'Notebooks',
        h('button.card-more', { type: 'button', onclick: () => ZN.shell.newNotebook() }, '+ New notebook')));
      const nbs = S.notebooks();
      if (!nbs.length) card.append(h('div.empty', 'No notebooks yet'));
      else card.append(h('div.nb-cards', nbs.map(nb => {
        const n = S.descendants(nb.id).map(id => S.get(id)).filter(p => S.isLive(p)).length;
        return h('button.nb-card', { type: 'button', style: { '--nb': ZN.nbVar(nb) }, onclick: () => ZN.openPage(nb.id) },
          h('b', ZN.pageTitle(nb)), h('span', n + (n === 1 ? ' page' : ' pages')));
      })));
      return card;
    }

    let alive = true;
    async function fill() {
      const blobs = await S.listBlobs();
      if (!alive) return;
      U.clear(grid);
      grid.append(todayCard(), recentCard(), snipCard(blobs), notebooksCard());
    }
    const refill = U.debounce(fill, 120);

    el.append(h('div.home',
      h('header.home-head', h('div.home-date', U.longDate()), hello),
      h('div.capture', ta,
        h('div.capture-actions',
          h('button.btn.sm.primary', { type: 'button', onclick: saveIdea, 'data-tip': 'Save as an idea|Enter' }, ZN.icon('bulb', 15), 'Idea'),
          h('button.btn.sm', { type: 'button', onclick: saveTodo, 'data-tip': 'Add as a to-do|Ctrl Enter' }, ZN.icon('tasks', 15), 'To-do'))),
      h('div.home-start',
        start('note', 'New note', () => ZN.shell.newPage('note'), 'Alt N'),
        start('todo', 'New to-do list', () => ZN.shell.newPage('todo'), 'Alt T'),
        start('board', 'New board', () => ZN.shell.newPage('board'), 'Alt B'),
        start('snip', 'Snip the screen', () => ZN.snip && ZN.snip.start(), 'Alt S'),
        start('layout', 'From a template', () => ZN.templates && ZN.templates.pick())),
      grid));
    fill();

    const offs = [S.on('tree', refill), S.on('content', refill), S.on('blobs', refill)];
    return { unmount() { alive = false; refill.cancel(); offs.forEach(f => f()); } };
  };
})();
