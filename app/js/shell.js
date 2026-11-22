/* Z Note · shell: sidebar tree, top bar, routing, page actions, notebook + trash views */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store, ui = ZN.ui;

  const TYPE_ICON = { notebook: 'book', note: 'note', todo: 'todo', board: 'board' };
  const TYPE_NAME = { notebook: 'Notebook', note: 'Note', todo: 'To-do list', board: 'Board' };
  const NB_COLORS = [
    { id: 'blue', css: 'var(--blue)', label: 'Blue' }, { id: 'red', css: 'var(--red)', label: 'Red' },
    { id: 'green', css: 'var(--green)', label: 'Green' }, { id: 'amber', css: 'var(--amber)', label: 'Amber' },
    { id: 'violet', css: 'var(--violet)', label: 'Violet' }, { id: 'teal', css: 'var(--teal)', label: 'Teal' }
  ];
  const ROUTES = {
    home: { title: 'Home', icon: 'home' }, tasks: { title: 'Tasks', icon: 'tasks' },
    snips: { title: 'Snips', icon: 'snip' }, trash: { title: 'Trash', icon: 'trash' }
  };
  ZN.TYPE_ICON = TYPE_ICON;
  ZN.TYPE_NAME = TYPE_NAME;
  ZN.NB_COLORS = NB_COLORS;
  ZN.views = ZN.views || {};

  let appEl, sideEl, topEl, viewEl, saveEl = null, saveFade = null;
  let current = null;                       // the mounted view: { unmount?, insertImage?, focusTitle? }
  let route = { name: 'home', arg: '' };

  ZN.pageTitle = p => (p && p.title) || (p && p.type === 'notebook' ? 'Untitled notebook' : 'Untitled');
  ZN.pageIcon = function (p, size) {
    size = size || 17;
    if (p.icon && p.icon.indexOf('i:') === 0) return ZN.icon(p.icon.slice(2), size);
    if (p.icon) return h('span.emoji', { style: { fontSize: Math.round(size * .92) + 'px' } }, p.icon);
    return ZN.icon(TYPE_ICON[p.type] || 'note', size);
  };
  const nbVar = p => 'var(--' + ((p && p.color) || 'blue') + ')';
  ZN.nbVar = nbVar;

  /* ---------- routing ---------- */
  function parseHash() {
    let s = location.hash.replace(/^#\/?/, '');
    try { s = decodeURIComponent(s); } catch (e) {}
    const i = s.indexOf('/');
    return i < 0 ? { name: s || 'home', arg: '' } : { name: s.slice(0, i), arg: s.slice(i + 1) };
  }
  ZN.go = function (r) {
    const target = '#/' + r;
    if (location.hash === target) renderRoute(); else location.hash = target;
  };
  ZN.openPage = id => ZN.go('p/' + id);

  function renderRoute() {
    ui.closeMenu();
    if (current && current.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
    current = null;
    route = parseHash();
    U.clear(viewEl);
    viewEl.className = '';
    viewEl.removeAttribute('style');
    viewEl.scrollTop = 0;
    let page = null;
    try {
      if (route.name === 'p') {
        page = S.get(route.arg);
        if (!page || !S.isLive(page)) { page = null; missingView(); }
        else {
          const mount = ZN.views[page.type];
          if (!mount) throw new Error('No view for page type "' + page.type + '"');
          current = mount(viewEl, page) || {};
          S.visit(page.id);
          if (expandTo(page.id)) renderSidebar();
        }
      } else if (ZN.views[route.name]) {
        current = ZN.views[route.name](viewEl, route.arg) || {};
      } else { location.replace('#/home'); return; }
    } catch (e) {
      console.error('[Z Note] could not open view', e);
      U.clear(viewEl);
      viewEl.append(h('div.page-wrap', h('div.sheet.listing', h('h1', 'Something went wrong'),
        h('p.sub', 'This page could not be opened: ' + (e && e.message ? e.message : e)),
        h('button.btn', { type: 'button', onclick: () => ZN.go('home') }, 'Back to Home'))));
    }
    renderTopbar();
    markActive();
  }

  function missingView() {
    viewEl.append(h('div.page-wrap', h('div.sheet.listing',
      h('h1', 'This page is gone'),
      h('p.sub', 'It may have been deleted. Have a look in the trash, or head back home.'),
      h('div.listing-actions',
        h('button.btn.primary', { type: 'button', onclick: () => ZN.go('home') }, 'Back to Home'),
        h('button.btn', { type: 'button', onclick: () => ZN.go('trash') }, 'Open trash')))));
  }

  /* ---------- sidebar ---------- */
  function navRow(to, icon, label, badge) {
    return h('button.row.nav-row', { type: 'button', 'data-act': 'go', 'data-to': to },
      h('span.row-icon', ZN.icon(icon, 17)), h('span.row-title', label), badge ? h('span.badge', String(badge)) : null);
  }

  function treeRow(p, depth, hasKids, open, flat) {
    const isNb = p.type === 'notebook';
    return h('div.row.tree-row' + (isNb ? '.nb' : ''), {
      role: 'treeitem', tabindex: '0', draggable: !flat, dataset: { id: p.id, flat: flat ? '1' : null },
      style: { '--depth': depth, '--nb': isNb ? nbVar(p) : null }
    },
      flat ? null : h('button.twisty' + (open ? '.open' : '') + (hasKids || isNb ? '' : '.none'),
        { type: 'button', tabindex: '-1', 'data-act': 'toggle', 'aria-label': open ? 'Collapse' : 'Expand' }, ZN.icon('chevR', 13)),
      isNb ? h('span.nb-tab') : h('span.row-icon', ZN.pageIcon(p, 16)),
      h('span.row-title', ZN.pageTitle(p)),
      flat ? null : h('span.row-actions',
        h('button.ibtn.sm', { type: 'button', tabindex: '-1', 'data-act': 'add', 'data-tip': isNb ? 'Add a page' : 'Add a page inside' }, ZN.icon('plus', 14)),
        h('button.ibtn.sm', { type: 'button', tabindex: '-1', 'data-act': 'more', 'data-tip': 'More' }, ZN.icon('more', 14))));
  }

  function addTree(host, p, depth) {
    const kids = S.children(p.id);
    const open = !!S.settings.expanded[p.id];
    host.append(treeRow(p, depth, kids.length > 0, open));
    if (!open) return;
    kids.forEach(k => addTree(host, k, depth + 1));
    if (!kids.length && p.type === 'notebook') host.append(h('div.tree-empty', { style: { '--depth': depth } }, 'Empty — press + to add a page'));
  }

  function renderSidebar() {
    const old = sideEl.querySelector('.side-scroll');
    const top = old ? old.scrollTop : 0;
    U.clear(sideEl);
    const due = ZN.tasks ? ZN.tasks.dueCount() : 0;
    const scroll = h('div.side-scroll', { role: 'tree' });

    const favs = S.live().filter(p => p.fav && p.type !== 'notebook')
      .sort((a, b) => ZN.pageTitle(a).localeCompare(ZN.pageTitle(b)));
    if (favs.length) {
      scroll.append(h('div.side-section', h('span.section-label', 'favourites')));
      favs.forEach(p => scroll.append(treeRow(p, 0, false, false, true)));
    }
    scroll.append(h('div.side-section', h('span.section-label', 'notebooks'),
      h('button.ibtn.sm', { type: 'button', 'data-act': 'new-nb', 'data-tip': 'New notebook' }, ZN.icon('plus', 14))));
    const nbs = S.children(null);
    nbs.forEach(nb => addTree(scroll, nb, 0));
    if (!nbs.length) scroll.append(h('div.tree-empty', 'No notebooks yet — press + to start one'));

    sideEl.append(
      h('div.brand',
        h('div.brand-mark', 'Z'), h('div.brand-name', 'Note'),
        h('button.ibtn', { type: 'button', 'data-act': 'collapse', 'data-tip': 'Hide sidebar|Ctrl \\' }, ZN.icon('sidebar', 17))),
      h('button.side-search', { type: 'button', 'data-act': 'search' }, ZN.icon('search', 15), h('span', 'Search'), h('kbd', 'Ctrl K')),
      h('div.side-new', h('button.btn.primary', { type: 'button', 'data-act': 'new' }, ZN.icon('plus', 15), 'New')),
      h('nav.side-nav', navRow('home', 'home', 'Home'), navRow('tasks', 'tasks', 'Tasks', due), navRow('snips', 'snip', 'Snips')),
      scroll,
      h('div.side-foot',
        ZN.sourceFolder ? ZN.sourceFolder.button() : null,
        navRow('trash', 'trash', 'Trash'),
        h('button.row.nav-row', { type: 'button', 'data-act': 'style' }, h('span.row-icon', ZN.icon('palette', 17)), h('span.row-title', 'Style & data'))));
    scroll.scrollTop = top;
    markActive();
  }
  const queueSidebar = U.frame(renderSidebar);

  function markActive() {
    if (!sideEl) return;
    sideEl.querySelectorAll('.row.active').forEach(r => r.classList.remove('active'));
    if (route.name === 'p') {
      sideEl.querySelectorAll('.tree-row').forEach(r => { if (r.dataset.id === route.arg) r.classList.add('active'); });
    } else {
      const r = sideEl.querySelector('.nav-row[data-to="' + route.name + '"]');
      if (r) r.classList.add('active');
    }
  }

  /* open every ancestor of a page in the tree; true when something changed */
  function expandTo(id) {
    let changed = false;
    S.path(id).slice(0, -1).forEach(a => { if (!S.settings.expanded[a.id]) { S.settings.expanded[a.id] = true; changed = true; } });
    if (changed) S.saveSettings();
    return changed;
  }
  function toggleExpand(id) {
    S.settings.expanded[id] = !S.settings.expanded[id];
    S.saveSettings();
    renderSidebar();
  }
  function toggleSidebar() {
    const off = appEl.classList.toggle('side-off');
    S.setSetting('sidebarCollapsed', off);
    renderTopbar();
  }

  function isAncestor(aId, bId) {
    return S.path(bId).some(x => x.id === aId);
  }

  function bindSidebar() {
    sideEl.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      const row = e.target.closest('.tree-row');
      if (act && sideEl.contains(act)) {
        const a = act.dataset.act;
        if (a === 'toggle') { toggleExpand(row.dataset.id); return; }
        if (a === 'add') { addMenu(act, row.dataset.id); return; }
        if (a === 'more') { pageMenu(act, S.get(row.dataset.id)); return; }
        if (a === 'go') { ZN.go(act.dataset.to); return; }
        if (a === 'new') { newMenu(act); return; }
        if (a === 'new-nb') { newNotebook(); return; }
        if (a === 'search') { if (ZN.search) ZN.search.open(); return; }
        if (a === 'style') { if (ZN.settings) ZN.settings.open(); return; }
        if (a === 'collapse') { toggleSidebar(); return; }
      }
      if (row) ZN.openPage(row.dataset.id);
    });
    sideEl.addEventListener('keydown', e => {
      const row = e.target.closest ? e.target.closest('.tree-row') : null;
      if (!row || e.target !== row) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ZN.openPage(row.dataset.id); }
      else if (e.key === 'ArrowRight' && !S.settings.expanded[row.dataset.id]) { e.preventDefault(); toggleExpand(row.dataset.id); }
      else if (e.key === 'ArrowLeft' && S.settings.expanded[row.dataset.id]) { e.preventDefault(); toggleExpand(row.dataset.id); }
    });
    sideEl.addEventListener('contextmenu', e => {
      const row = e.target.closest('.tree-row');
      if (!row) return;
      e.preventDefault();
      pageMenu({ x: e.clientX, y: e.clientY }, S.get(row.dataset.id));
    });

    /* drag pages around the tree */
    let dragId = null;
    const clearDrop = () => sideEl.querySelectorAll('.drop-in, .drop-before, .drop-after')
      .forEach(x => x.classList.remove('drop-in', 'drop-before', 'drop-after'));
    function dropPos(row, e) {
      const moving = S.get(dragId), target = S.get(row.dataset.id);
      if (!moving || !target || moving === target || row.dataset.flat) return null;
      const r = row.getBoundingClientRect();
      const f = (e.clientY - r.top) / r.height;
      if (moving.type === 'notebook') return target.type === 'notebook' ? (f < .5 ? 'before' : 'after') : null;
      if (isAncestor(moving.id, target.id)) return null;
      if (target.type === 'notebook') return 'in';
      return f < .28 ? 'before' : f > .72 ? 'after' : 'in';
    }
    sideEl.addEventListener('dragstart', e => {
      const row = e.target.closest ? e.target.closest('.tree-row') : null;
      if (!row || row.dataset.flat) { e.preventDefault(); return; }
      dragId = row.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ZN.pageTitle(S.get(dragId)));
      row.classList.add('dragging');
    });
    sideEl.addEventListener('dragend', () => {
      dragId = null;
      clearDrop();
      sideEl.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging'));
    });
    sideEl.addEventListener('dragover', e => {
      if (!dragId) return;
      clearDrop();
      const row = e.target.closest('.tree-row');
      const pos = row ? dropPos(row, e) : null;
      if (!pos) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-' + pos);
    });
    sideEl.addEventListener('drop', e => {
      const row = e.target.closest('.tree-row');
      const id = dragId;
      const pos = row && id ? dropPos(row, e) : null;
      clearDrop();
      if (!pos) return;
      e.preventDefault();
      const target = S.get(row.dataset.id);
      if (pos === 'in') {
        if (S.move(id, target.id, null)) { S.settings.expanded[target.id] = true; S.saveSettings(); renderSidebar(); }
        return;
      }
      const sibs = S.children(target.parentId).filter(x => x.id !== id);
      const i = sibs.indexOf(target);
      const before = pos === 'before' ? target : sibs[i + 1];
      S.move(id, target.parentId, before ? before.id : null);
    });
  }

  /* ---------- page actions ---------- */
  const NEW_ITEMS = parentId => [
    { label: 'Note', sub: 'Write ideas with headings, lists and pictures', icon: 'note', hint: parentId ? '' : 'Alt N', onClick: () => newPage('note', parentId) },
    { label: 'To-do list', sub: 'Tasks with due dates', icon: 'todo', hint: parentId ? '' : 'Alt T', onClick: () => newPage('todo', parentId) },
    { label: 'Board', sub: 'Sticky notes, shapes and arrows on a big canvas', icon: 'board', hint: parentId ? '' : 'Alt B', onClick: () => newPage('board', parentId) }
  ];
  function newMenu(anchor) {
    ui.menu(anchor, NEW_ITEMS(null).concat([
      { sep: true },
      { label: 'From a template…', icon: 'layout', onClick: () => ZN.templates && ZN.templates.pick() },
      { label: 'Notebook', sub: 'A new binder for pages', icon: 'book', onClick: newNotebook }
    ]));
  }
  function addMenu(anchor, parentId) {
    ui.menu(anchor, [{ head: 'add inside' }].concat(NEW_ITEMS(parentId)).concat([
      { sep: true },
      { label: 'From a template…', icon: 'layout', onClick: () => ZN.templates && ZN.templates.pick(parentId) }
    ]));
  }

  /* where a new page goes when nothing is specified: next to the page you are looking at */
  function defaultParent() {
    const cur = route.name === 'p' ? S.get(route.arg) : null;
    if (cur && S.isLive(cur)) return cur.type === 'notebook' ? cur : (S.get(cur.parentId) || S.ensureNotebook());
    return S.ensureNotebook();
  }

  function newPage(type, parentId, props) {
    const parent = (parentId && S.get(parentId)) || defaultParent();
    const p = S.create(Object.assign({ type, parentId: parent.id }, props || {}));
    S.settings.expanded[parent.id] = true;
    S.saveSettings();
    ZN.openPage(p.id);
    if (!p.title) setTimeout(() => { if (current && current.focusTitle) current.focusTitle(); }, 30);
    return p;
  }

  async function newNotebook() {
    const name = await ui.prompt('New notebook', '', { placeholder: 'e.g. Site visits, Reading, Home', ok: 'Create' });
    if (name === null) return;
    const used = S.notebooks().map(n => n.color);
    const free = NB_COLORS.find(c => used.indexOf(c.id) < 0) || NB_COLORS[S.notebooks().length % NB_COLORS.length];
    const nb = S.create({ type: 'notebook', title: name, color: free.id });
    S.settings.expanded[nb.id] = true;
    S.saveSettings();
    ZN.openPage(nb.id);
  }

  async function rename(p) {
    const name = await ui.prompt('Rename', p.title, { placeholder: 'Title' });
    if (name === null) return;
    S.update(p.id, { title: name });
    if (route.name === 'p' && route.arg === p.id) renderRoute();
  }

  async function removePage(p) {
    const n = S.descendants(p.id).length;
    if (p.type === 'notebook' || n > 0) {
      const ok = await ui.confirm('“' + ZN.pageTitle(p) + '”' + (n ? ' and the ' + n + ' page' + (n > 1 ? 's' : '') + ' inside it' : '') +
        ' will move to the trash. You can restore it from there.',
        { title: p.type === 'notebook' ? 'Delete this notebook?' : 'Move to trash?', ok: 'Move to trash', danger: true });
      if (!ok) return;
    }
    const wasOpen = route.name === 'p' && isAncestor(p.id, route.arg);
    S.trash(p.id);
    if (wasOpen) ZN.go(p.parentId && S.get(p.parentId) ? 'p/' + p.parentId : 'home');
    ui.toast('Moved to trash', { action: { label: 'Undo', fn: () => S.restore(p.id) } });
  }

  function pageMenu(anchor, p, opts) {
    if (!p) return;
    const isNb = p.type === 'notebook';
    const isOpen = route.name === 'p' && route.arg === p.id;
    ui.menu(anchor, [
      isOpen ? null : { label: 'Open', icon: 'open', onClick: () => ZN.openPage(p.id) },
      { label: 'Rename', icon: 'pen', onClick: () => rename(p) },
      isNb ? {
        label: 'Tab colour', icon: 'palette',
        items: NB_COLORS.map(c => ({ label: c.label, swatch: c.css, checked: (p.color || 'blue') === c.id, onClick: () => S.update(p.id, { color: c.id }, { keepTime: true }) }))
      } : { label: p.fav ? 'Remove from favourites' : 'Add to favourites', icon: 'star', onClick: () => S.update(p.id, { fav: !p.fav }, { keepTime: true }) },
      { sep: true },
      { label: 'Add inside', icon: 'plus', items: NEW_ITEMS(p.id) },
      isNb ? null : { label: 'Duplicate', icon: 'copy', onClick: () => { const c = S.duplicate(p.id); if (c) ZN.openPage(c.id); } },
      isNb ? null : {
        label: 'Move to', icon: 'move',
        items: () => S.notebooks().map(nb => ({
          label: ZN.pageTitle(nb), swatch: nbVar(nb), checked: p.parentId === nb.id,
          onClick: () => { if (S.move(p.id, nb.id, null)) { S.settings.expanded[nb.id] = true; S.saveSettings(); ui.toast('Moved to ' + ZN.pageTitle(nb)); } }
        }))
      },
      { sep: true },
      { label: isNb ? 'Delete notebook' : 'Move to trash', icon: 'trash', danger: true, onClick: () => removePage(p) }
    ], opts);
  }

  /* ---------- top bar ---------- */
  function renderTopbar() {
    U.clear(topEl);
    if (appEl.classList.contains('side-off')) {
      topEl.append(h('button.ibtn', { type: 'button', 'data-tip': 'Show sidebar|Ctrl \\', onclick: toggleSidebar }, ZN.icon('sidebar', 18)));
    }
    const crumbs = h('div.crumbs');
    let page = route.name === 'p' ? S.get(route.arg) : null;
    if (page && !S.isLive(page)) page = null;
    if (page) {
      const pth = S.path(page.id);
      pth.forEach((x, i) => {
        if (i) crumbs.append(h('span.crumb-sep', '/'));
        const last = i === pth.length - 1;
        const lead = x.type === 'notebook' ? h('span.nb-tab', { style: { '--nb': nbVar(x) } }) : ZN.pageIcon(x, 15);
        crumbs.append(last
          ? h('span.crumb.cur', lead, h('span', ZN.pageTitle(x)))
          : h('button.crumb', { type: 'button', onclick: () => ZN.openPage(x.id) }, lead, h('span', ZN.pageTitle(x))));
      });
    } else {
      const r = ROUTES[route.name] || ROUTES.home;
      crumbs.append(h('span.crumb.cur', ZN.icon(r.icon, 15), h('span', r.title)));
    }
    saveEl = h('span.save-state.quiet', 'saved');
    const right = h('div.top-right', saveEl, ZN.sync && ZN.sync.dir ? ZN.sync.chip() : null,
      ZN.awake ? ZN.awake.button() : null,
      h('button.btn.sm', { type: 'button', 'data-tip': 'Capture part of your screen|Alt S', onclick: e => ZN.snip && ZN.snip.menu(e.currentTarget) }, ZN.icon('snip', 15), 'Snip'));
    if (page && page.type !== 'notebook') {
      right.append(h('button.ibtn' + (page.fav ? '.fav-on' : ''), {
        type: 'button', 'data-tip': page.fav ? 'Remove from favourites' : 'Add to favourites',
        onclick: () => S.update(page.id, { fav: !page.fav }, { keepTime: true })
      }, ZN.icon('star', 18)));
    }
    if (page) right.append(h('button.ibtn', { type: 'button', 'data-tip': 'Page options', onclick: e => pageMenu(e.currentTarget, page, { align: 'end' }) }, ZN.icon('more', 18)));
    topEl.append(crumbs, right);
    document.title = (page ? ZN.pageTitle(page) + ' · ' : route.name !== 'home' && ROUTES[route.name] ? ROUTES[route.name].title + ' · ' : '') + 'Z Note';
    if (S.hasUnsaved()) showSave('dirty');
  }
  const queueTopbar = U.frame(renderTopbar);

  function showSave(state) {
    if (!saveEl) return;
    clearTimeout(saveFade);
    saveEl.classList.remove('quiet', 'error');
    if (state === 'dirty') saveEl.textContent = 'saving…';
    else if (state === 'error') { saveEl.textContent = 'could not save — retrying'; saveEl.classList.add('error'); }
    else {
      saveEl.textContent = 'saved ✓';
      saveFade = setTimeout(() => saveEl && saveEl.classList.add('quiet'), 1600);
    }
  }

  /* ---------- notebook overview ---------- */
  ZN.views.notebook = function (el, nb) {
    const title = h('span', { contenteditable: 'plaintext-only', spellcheck: 'false', 'data-ph': 'Untitled notebook' }, nb.title);
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    title.addEventListener('input', () => S.update(nb.id, { title: title.textContent.replace(/\s+/g, ' ').trim() }));
    const list = h('div.plist');
    const sub = h('p.sub');
    function fill() {
      const kids = S.children(nb.id);
      sub.textContent = kids.length ? kids.length + (kids.length === 1 ? ' page' : ' pages') + ' in this notebook' : 'This notebook is empty. Add your first page below.';
      U.clear(list);
      kids.forEach(p => {
        const inner = S.children(p.id).length;
        list.append(h('button.prow', { type: 'button', onclick: () => ZN.openPage(p.id) },
          ZN.pageIcon(p, 18), h('span.prow-title', ZN.pageTitle(p)),
          h('span.prow-meta', (inner ? inner + ' inside · ' : '') + U.ago(p.updated))));
      });
    }
    el.append(h('div.page-wrap', h('div.sheet.listing',
      h('h1', h('span.nb-tab', { style: { '--nb': nbVar(nb), width: '12px', height: '34px' } }), title),
      sub,
      h('div.listing-actions',
        h('button.btn.primary', { type: 'button', onclick: () => newPage('note', nb.id) }, ZN.icon('note', 15), 'New note'),
        h('button.btn', { type: 'button', onclick: () => newPage('todo', nb.id) }, ZN.icon('todo', 15), 'New to-do list'),
        h('button.btn', { type: 'button', onclick: () => newPage('board', nb.id) }, ZN.icon('board', 15), 'New board'),
        h('button.btn.quiet', { type: 'button', onclick: () => ZN.templates && ZN.templates.pick(nb.id) }, ZN.icon('layout', 15), 'From a template')),
      list)));
    fill();
    const off = S.on('tree', U.frame(fill));
    return { unmount: off, focusTitle: () => U.caret.set(title, 'end') };
  };

  /* ---------- trash ---------- */
  ZN.views.trash = function (el) {
    function render() {
      U.clear(el);
      const items = S.trashed();
      const row = p => h('div.prow',
        ZN.pageIcon(p, 18), h('span.prow-title', ZN.pageTitle(p)),
        h('span.prow-meta', TYPE_NAME[p.type] + ' · deleted ' + U.ago(p.trashed)),
        h('span.prow-actions',
          h('button.btn.sm', { type: 'button', onclick: () => { S.restore(p.id); ui.toast('Restored “' + ZN.pageTitle(p) + '”', { action: { label: 'Open', fn: () => ZN.openPage(p.id) } }); } }, 'Restore'),
          h('button.btn.sm.danger', {
            type: 'button', onclick: async () => {
              if (await ui.confirm('“' + ZN.pageTitle(p) + '” and anything inside it will be deleted for good. This cannot be undone.', { title: 'Delete forever?', ok: 'Delete forever', danger: true })) S.purge(p.id);
            }
          }, 'Delete')));
      el.append(h('div.page-wrap', h('div.sheet.listing',
        h('h1', ZN.icon('trash', 32), 'Trash'),
        h('p.sub', 'Deleted pages wait here until you restore them or delete them for good.'),
        items.length ? [
          h('div.listing-actions', h('button.btn.sm.danger', {
            type: 'button', onclick: async () => {
              if (await ui.confirm('All ' + items.length + ' item' + (items.length > 1 ? 's' : '') + ' in the trash will be deleted for good. This cannot be undone.', { title: 'Empty the trash?', ok: 'Empty trash', danger: true })) {
                S.trashed().forEach(p => S.purge(p.id));
              }
            }
          }, ZN.icon('trash', 14), 'Empty trash')),
          h('div.plist', items.map(row))
        ] : h('div.empty', 'Nothing in the trash', h('small', 'Deleted pages will show up here.')))));
    }
    render();
    const off = S.on('tree', U.frame(render));
    return { unmount: off };
  };

  /* ---------- boot ---------- */
  function init() {
    appEl = document.getElementById('app');
    sideEl = document.getElementById('sidebar');
    topEl = document.getElementById('topbar');
    viewEl = document.getElementById('view');
    if (S.settings.sidebarCollapsed) appEl.classList.add('side-off');
    bindSidebar();
    renderSidebar();

    S.on('tree', () => { queueSidebar(); queueTopbar(); });
    S.on('content', U.debounce(renderSidebar, 400));
    S.on('save', showSave);
    S.on('external', ids => { if (route.name === 'p' && ids.indexOf(route.arg) >= 0) renderRoute(); });
    S.on('sync', queueTopbar);
    S.on('sourcefolder', queueTopbar);
    S.on('otherwindow', () => {
      if (document.querySelector('.banner')) return;
      const b = h('div.banner', ZN.icon('info', 16), h('span', 'Z Note is also open in another window. Work in one window at a time so edits don’t overwrite each other.'),
        h('button.ibtn.sm', { type: 'button', 'aria-label': 'Dismiss', onclick: () => b.remove() }, ZN.icon('x', 14)));
      topEl.after(b);
    });

    window.addEventListener('hashchange', renderRoute);
    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      const k = (e.key || '').toLowerCase();
      if (mod && !e.shiftKey && !e.altKey && k === 'k') {
        if (e.defaultPrevented) return;          // the note editor uses Ctrl+K for links when text is selected
        e.preventDefault();
        if (ZN.search) ZN.search.open();
      } else if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
      else if (e.altKey && !mod && !e.shiftKey) {
        if (k === 's') { e.preventDefault(); if (ZN.snip) ZN.snip.start(); }
        else if (k === 'n') { e.preventDefault(); newPage('note'); }
        else if (k === 't') { e.preventDefault(); newPage('todo'); }
        else if (k === 'b') { e.preventDefault(); newPage('board'); }
        else if (k === 'h') { e.preventDefault(); ZN.go('home'); }
      }
    });
    if (!location.hash) history.replaceState(null, '', '#/home');
    renderRoute();
  }

  ZN.shell = {
    init, newPage, newNotebook, pageMenu, removePage, toggleSidebar,
    refresh: renderRoute,
    route: () => route,
    view: () => current,
    currentPage: () => { const p = route.name === 'p' ? S.get(route.arg) : null; return p && S.isLive(p) ? p : null; },
    /* hand a freshly saved image to whatever page is open; false when the view can't take it */
    insertImage: rec => (current && current.insertImage ? (current.insertImage(rec), true) : false)
  };
})();
