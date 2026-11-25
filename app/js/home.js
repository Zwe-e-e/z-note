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
      const blobs = (await S.listBlobs()).filter(b => b.kind !== 'attachment');
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
        start('budget', 'New budget page', () => ZN.shell.newPage('budget')),
        start('snip', 'Snip the screen', () => ZN.snip && ZN.snip.start(), 'Alt S'),
        start('layout', 'From a template', () => ZN.templates && ZN.templates.pick())),
      grid));
    fill();

    const offs = [S.on('tree', refill), S.on('content', refill), S.on('blobs', refill)];
    return { unmount() { alive = false; refill.cancel(); offs.forEach(f => f()); } };
  };
})();

/* Z Note · budget pages. Kept in this existing runtime file so older portable
   updaters can install the feature without accepting new archive paths. */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store, ui = ZN.ui;
  const CURRENCIES = ['SGD', 'USD', 'MMK', 'MYR', 'AUD', 'EUR', 'GBP'];
  const CATEGORIES = ['Food & dining', 'Groceries', 'Transport', 'Home & bills', 'Shopping', 'Health', 'Travel', 'Entertainment', 'Education', 'Other'];
  const COLORS = ['#4977b8', '#d68a40', '#629a72', '#b26b87', '#8776b7', '#53a0a1', '#c36257', '#a09450', '#758398', '#977260'];
  const MAX_AMOUNT = 99999999999; // 999,999,999.99 in the board's currency
  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const validMonth = value => typeof value === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);
  function validDate(value) {
    if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
    const a = value.split('-').map(Number), date = new Date(a[0], a[1] - 1, a[2]);
    return date.getFullYear() === a[0] && date.getMonth() === a[1] - 1 && date.getDate() === a[2];
  }
  function parseAmount(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!match) return null;
    const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
    return Number.isSafeInteger(amount) && amount <= MAX_AMOUNT ? amount : null;
  }
  const amountText = amount => Math.floor(amount / 100) + '.' + String(amount % 100).padStart(2, '0');
  const blank = () => ({ currency: 'SGD', budgets: {}, expenses: [] });
  function normalizeContent(raw) {
    if (raw == null) return blank();
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The budget page content is invalid.');
    const currency = raw.currency === undefined ? 'SGD' : raw.currency;
    if (!CURRENCIES.includes(currency)) throw new Error('The budget page has an unsupported currency.');
    const inputBudgets = raw.budgets === undefined ? {} : raw.budgets;
    const inputExpenses = raw.expenses === undefined ? [] : raw.expenses;
    if (!inputBudgets || typeof inputBudgets !== 'object' || Array.isArray(inputBudgets) || !Array.isArray(inputExpenses)) throw new Error('The budget page has invalid budgets or expenses.');
    const budgets = {}, seen = new Set();
    Object.keys(inputBudgets).forEach(month => {
      const value = inputBudgets[month];
      if (!validMonth(month) || !Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT) throw new Error('The budget for ' + month + ' is invalid.');
      budgets[month] = value;
    });
    const expenses = inputExpenses.map(row => {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || seen.has(row.id)) throw new Error('An expense has a missing or repeated ID.');
      seen.add(row.id);
      if (!validDate(row.date) || !Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > MAX_AMOUNT) throw new Error('An expense has an invalid date or amount.');
      if (typeof row.description !== 'string' || typeof row.category !== 'string' || (row.note !== undefined && typeof row.note !== 'string')) throw new Error('An expense has invalid text fields.');
      const ids = row.attachments === undefined ? [] : row.attachments;
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw new Error('An expense has invalid receipt references.');
      return Object.assign({}, row, { description: row.description, category: row.category.trim() || 'Other', note: row.note || '', attachments: Array.from(new Set(ids)) });
    });
    return Object.assign({}, raw, { currency, budgets, expenses });
  }
  function attachmentIds(value) {
    const content = value && value.content ? value.content : value;
    return Array.from(new Set((content && Array.isArray(content.expenses) ? content.expenses : [])
      .flatMap(row => row && Array.isArray(row.attachments) ? row.attachments.filter(id => typeof id === 'string' && id) : [])));
  }
  function monthlySummary(raw, month) {
    if (!validMonth(month)) throw new Error('Choose a valid month.');
    const content = normalizeContent(raw);
    const expenses = content.expenses.filter(row => row.date.slice(0, 7) === month)
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const totals = new Map();
    let spent = 0;
    expenses.forEach(row => {
      spent += row.amount;
      if (!Number.isSafeInteger(spent)) throw new Error('The monthly total is too large to calculate accurately.');
      totals.set(row.category, (totals.get(row.category) || 0) + row.amount);
    });
    const categories = Array.from(totals, ([name, amount]) => ({ name, amount, percentage: spent ? amount / spent * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
    const budget = own(content.budgets, month) ? content.budgets[month] : null;
    return { month, currency: content.currency, expenses, count: expenses.length, spent, budget, remaining: budget === null ? null : budget - spent, categories };
  }
  function textOf(page) {
    const c = page && page.content || {};
    return (Array.isArray(c.expenses) ? c.expenses : []).map(row => [row.date, row.description, row.category, row.note].filter(Boolean).join(' ')).join('\n');
  }
  const money = (minor, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
  const monthLabel = month => new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const dateLabel = date => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8))).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  ZN.budget = { blank, normalizeContent, attachmentIds, textOf, parseAmount, monthlySummary, validMonth, validDate, amountText, money, currencies: CURRENCIES.slice() };

  ZN.views.budget = function (el, page) {
    let alive = true, month = U.ymd().slice(0, 7), revision = 0, activeEditor = null, pendingSave = null, pendingHistory = null;
    const history = [];
    let historyAt = 0;
    const currentPage = () => {
      if (!alive || S.get(page.id) !== page || !S.isLive(page)) throw new Error('This page changed or closed. Reopen it before saving the expense.');
      return page;
    };
    const content = () => normalizeContent(currentPage().content);
    const snapshot = () => JSON.stringify(content());
    function saveContent(value) {
      const before = snapshot(), after = JSON.stringify(normalizeContent(value));
      if (before === after) return null;
      const previous = historyAt ? history[historyAt - 1].after : history.length ? history[0].before : before;
      if (previous !== before) { history.length = 0; historyAt = 0; }
      history.splice(historyAt);
      const entry = { before, after };
      history.push(entry);
      if (history.length > 50) history.shift();
      historyAt = history.length;
      currentPage().content = JSON.parse(after); S.touch(page.id); render();
      return entry;
    }
    const announcement = h('p.budget-announcement', { role: 'status', 'aria-live': 'polite' });
    const undoButton = h('button.btn', { type: 'button', title: 'Undo (Ctrl+Z)', 'aria-keyshortcuts': 'Control+Z Meta+Z', onclick: () => travelHistory(-1) }, ZN.icon('undo', 15), 'Undo');
    const redoButton = h('button.btn', { type: 'button', title: 'Redo (Ctrl+Y or Ctrl+Shift+Z)', 'aria-keyshortcuts': 'Control+Y Control+Shift+Z Meta+Shift+Z', onclick: () => travelHistory(1) }, ZN.icon('redo', 15), 'Redo');
    const monthInput = h('input.input', { type: 'month', value: month, 'aria-label': 'Expense month' });
    const currencySelect = h('select.input', { 'aria-label': 'Budget currency' }, CURRENCIES.map(code => h('option', { value: code }, code)));
    const addButton = h('button.btn.primary', { type: 'button', onclick: () => editExpense() }, ZN.icon('plus', 15), 'Add expense');
    const head = ZN.pageHead(page, { onLeave: () => addButton.focus() });
    const summaryHost = h('div.budget-summary'), chartHost = h('div.budget-chart-host'), listHost = h('div.budget-list');
    const sheet = h('div.sheet.page.budget-page', head.el,
      h('p.budget-intro', 'Keep a monthly budget, record expenses, and keep receipts with each entry.'),
      h('div.budget-toolbar', h('label.budget-field', h('span', 'Month'), monthInput),
        h('label.budget-field', h('span', 'Currency'), currencySelect),
        h('button.btn', { type: 'button', onclick: editBudget }, 'Set monthly budget'), undoButton, redoButton, addButton),
      summaryHost, chartHost, announcement, listHost);
    el.append(h('div.page-wrap', sheet));
    function updateHistoryControls() {
      const busy = !!(pendingHistory || pendingSave || activeEditor);
      undoButton.disabled = busy || historyAt <= 0;
      redoButton.disabled = busy || historyAt >= history.length;
    }
    async function travelHistory(direction, expectedEntry) {
      if (!alive || activeEditor || pendingSave || pendingHistory) return;
      const entry = history[direction < 0 ? historyAt - 1 : historyAt];
      if (!entry || expectedEntry && entry !== expectedEntry) return;
      const expected = direction < 0 ? entry.after : entry.before;
      const target = direction < 0 ? entry.before : entry.after;
      try {
        if (snapshot() !== expected) {
          history.length = 0; historyAt = 0; updateHistoryControls();
          throw new Error('This budget changed elsewhere. Its undo history has been cleared to keep the latest changes.');
        }
        const restored = JSON.parse(target);
        // Validation and reference restoration share the receipt deletion queue.
        const work = S.withAttachments(attachmentIds(restored), () => {
          if (snapshot() !== expected || history[direction < 0 ? historyAt - 1 : historyAt] !== entry) throw new Error('This budget changed while checking receipts. Its latest changes were kept.');
          currentPage().content = restored;
          historyAt += direction;
          S.touch(page.id); render();
          announcement.textContent = direction < 0 ? 'Change undone.' : 'Change redone.';
        });
        pendingHistory = work; updateHistoryControls();
        try { await work; } finally { if (pendingHistory === work) pendingHistory = null; updateHistoryControls(); }
      } catch (error) { if (alive) ui.toast(error.message, { error: true }); }
    }
    function onHistoryKey(event) {
      const key = (event.key || '').toLowerCase();
      if (!alive || event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || !['z', 'y'].includes(key)) return;
      if (activeEditor || pendingSave || pendingHistory || sheet.closest('[inert]') || document.querySelector('.modal-back, dialog[open]') || ui.menuOpen && ui.menuOpen()) return;
      const focus = document.activeElement;
      const textEditing = target => target !== currencySelect && U.isEditable(target);
      if (textEditing(event.target) || textEditing(focus) || focus && focus !== document.body && !sheet.contains(focus)) return;
      event.preventDefault();
      return travelHistory(key === 'y' || event.shiftKey ? 1 : -1);
    }
    document.addEventListener('keydown', onHistoryKey);
    monthInput.addEventListener('change', () => {
      if (!validMonth(monthInput.value)) { monthInput.value = month; announcement.textContent = 'Choose a month with a four-digit year.'; return; }
      month = monthInput.value; announcement.textContent = ''; render();
    });
    currencySelect.addEventListener('change', async () => {
      const previous = content().currency, next = currencySelect.value;
      currencySelect.value = previous;
      if (pendingHistory) return;
      if (next === previous || !CURRENCIES.includes(next)) return;
      if (activeEditor) { ui.toast('Save or cancel the open editor first.'); return; }
      const ok = await ui.confirm('Use ' + next + ' for this entire budget page? Existing amounts will keep their numbers; no currency conversion is performed.', { title: 'Change currency?', ok: 'Change currency' });
      if (!ok || !alive) return;
      try { const fresh = content(); if (fresh.currency !== previous) throw new Error('The currency changed while this dialog was open. Try again.'); fresh.currency = next; saveContent(fresh); }
      catch (error) { ui.toast(error.message); }
    });

    function editor(title, fields, onSave, saveLabel) {
      if (activeEditor || pendingHistory) return;
      const status = h('p.budget-form-error', { role: 'alert' });
      const cancel = h('button.btn.quiet', { type: 'button', onclick: () => { if (!pendingSave) modal.close(); } }, 'Cancel');
      const submit = h('button.btn.primary', { type: 'submit' }, saveLabel || 'Save');
      const controls = h('fieldset.budget-form-fields', fields, h('div.budget-form-actions', cancel, submit));
      const form = h('form.budget-form', controls, status);
      const modal = ui.modal({ title, className: 'budget-editor', width: 610, dismissable: false, body: form,
        onClose() {
          if (activeEditor === modal) activeEditor = null;
          updateHistoryControls();
          if (alive && S.get(page.id) !== page && ZN.shell && ZN.shell.refresh) ZN.shell.refresh();
        } });
      modal.budgetStatus = status;
      activeEditor = modal;
      updateHistoryControls();
      modal.el.setAttribute('aria-label', title);
      modal.el.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape' && !pendingSave) { event.preventDefault(); modal.close(); }
        if (event.key === 'Tab') {
          const focusable = Array.from(modal.el.querySelectorAll('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href]'));
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      });
      ['paste', 'drop'].forEach(type => modal.el.addEventListener(type, event => event.stopPropagation()));
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (pendingSave || !form.reportValidity()) return;
        status.textContent = 'Saving…'; controls.disabled = true;
        const saving = S.trackDataWork(async () => { currentPage(); await onSave(); modal.close(); });
        pendingSave = saving;
        saving.catch(error => { if (alive && activeEditor === modal) status.textContent = error.message || 'The expense could not be saved. Try again.'; })
          .finally(() => { if (pendingSave === saving) pendingSave = null; controls.disabled = false; updateHistoryControls(); });
      });
      return modal;
    }
    const field = (label, input, className) => h('label.budget-field' + (className ? '.' + className : ''), h('span', label), input);

    function editBudget() {
      const targetMonth = month, initial = content(), previous = initial.budgets[targetMonth];
      const input = h('input.input', { type: 'text', inputmode: 'decimal', value: previous === undefined ? '' : amountText(previous), placeholder: 'e.g. 1200.00', autofocus: true, maxlength: 12 });
      editor('Budget for ' + monthLabel(targetMonth), [
        field('Monthly budget (' + initial.currency + ')', input), h('p.budget-help', 'Leave this blank to remove the budget for this month. Expenses are kept.')
      ], async () => {
        const fresh = content();
        if (fresh.currency !== initial.currency || fresh.budgets[targetMonth] !== previous) throw new Error('This monthly budget changed. Cancel and reopen the editor.');
        const amount = input.value.trim() ? parseAmount(input.value) : null;
        if (input.value.trim() && amount === null) throw new Error('Enter a positive amount or zero, with up to two decimal places.');
        if (amount === null) delete fresh.budgets[targetMonth]; else fresh.budgets[targetMonth] = amount;
        saveContent(fresh);
      }, 'Save budget');
    }

    function editExpense(id) {
      const initial = content(), original = id ? initial.expenses.find(row => row.id === id) : null;
      if (id && !original) { ui.toast('That expense is no longer available.'); return; }
      const originalJSON = original && JSON.stringify(original);
      const today = U.ymd(), date = h('input.input', { type: 'date', required: true, value: original ? original.date : today.slice(0, 7) === month ? today : month + '-01' });
      const description = h('input.input', { type: 'text', required: true, maxlength: 400, autofocus: true, value: original ? original.description : '', placeholder: 'e.g. Lunch or electricity bill' });
      const amount = h('input.input', { type: 'text', inputmode: 'decimal', required: true, maxlength: 12, value: original ? amountText(original.amount) : '', placeholder: '0.00' });
      const listId = 'budget-categories-' + U.uid();
      const category = h('input.input', { type: 'text', list: listId, maxlength: 120, value: original ? original.category : 'Other' });
      const notes = h('textarea.input', { rows: 2, maxlength: 10000, value: original ? original.note : '', placeholder: 'Optional details' });
      notes.value = original ? original.note : '';
      const upload = h('input.budget-upload', { type: 'file', multiple: true, accept: '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp', 'aria-label': 'Attach receipts or invoices' });
      const retained = original ? original.attachments.slice() : [], existing = h('div.budget-existing-files');
      retained.forEach(attachmentId => {
        const name = h('span', 'Receipt');
        const row = h('div.budget-existing-file', name, h('button.btn.sm.quiet', { type: 'button', onclick: () => { const at = retained.indexOf(attachmentId); if (at >= 0) retained.splice(at, 1); row.remove(); } }, 'Remove'));
        existing.append(row);
        S.getAttachment(attachmentId).then(record => { if (record) name.textContent = record.name || 'Receipt'; else name.textContent = 'Receipt unavailable — sync to load it'; }).catch(() => { name.textContent = 'Receipt unavailable'; });
      });
      const imported = new Map(); // retry a failed batch without creating duplicate blobs
      editor(original ? 'Edit expense' : 'Add expense', [
        field('Description', description), h('div.budget-form-grid', field('Date', date), field('Amount (' + initial.currency + ')', amount)),
        field('Category', category), h('datalist#' + listId, CATEGORIES.map(name => h('option', { value: name }))),
        field('Notes', notes), h('div.budget-field', h('span', 'Receipts & invoices'), existing, upload,
          h('p.budget-help', 'PDF, PNG, JPG or WebP · up to 10 MB each. You can attach more than one file.'))
      ], async () => {
        const minor = parseAmount(amount.value), desc = description.value.trim();
        if (!desc) throw new Error('Enter a description for this expense.');
        if (!validDate(date.value)) throw new Error('Choose a valid expense date.');
        if (minor === null || minor <= 0) throw new Error('Enter an amount greater than zero, with up to two decimal places.');
        const assertFresh = () => {
          const fresh = content(), existingRow = id && fresh.expenses.find(row => row.id === id);
          if (fresh.currency !== initial.currency || id && (!existingRow || JSON.stringify(existingRow) !== originalJSON)) throw new Error('This expense changed while the editor was open. Cancel and reopen it to keep the latest changes.');
          return fresh;
        };
        assertFresh();
        const attachmentList = retained.slice();
        for (const file of Array.from(upload.files || [])) {
          let record = imported.get(file);
          if (!record) { record = await S.addAttachment(file, { name: file.name }); imported.set(file, record); }
          assertFresh(); attachmentList.push(record.id);
        }
        const fresh = assertFresh();
        const record = Object.assign({}, original || {}, { id: id || U.uid(), date: date.value, description: desc, amount: minor,
          category: category.value.trim() || 'Other', note: notes.value.trim(), attachments: Array.from(new Set(attachmentList)) });
        if (id) fresh.expenses = fresh.expenses.map(row => row.id === id ? record : row); else fresh.expenses.push(record);
        saveContent(normalizeContent(fresh));
        announcement.textContent = 'Expense saved' + (record.date.slice(0, 7) !== month ? ' to ' + monthLabel(record.date.slice(0, 7)) : '') + '.';
      }, original ? 'Save changes' : 'Save expense');
    }

    async function removeExpense(id) {
      if (pendingHistory) return;
      const original = content().expenses.find(row => row.id === id);
      if (!original) return;
      const before = JSON.stringify(original);
      const ok = await ui.confirm('Remove “' + original.description + '” from this budget page?', { title: 'Remove expense?', ok: 'Remove expense', danger: true });
      if (!ok || !alive) return;
      try {
        const fresh = content(), current = fresh.expenses.find(row => row.id === id);
        if (!current || JSON.stringify(current) !== before) throw new Error('This expense changed. Review it before removing it.');
        fresh.expenses = fresh.expenses.filter(row => row.id !== id);
        const entry = saveContent(fresh);
        ui.toast('Expense removed', { action: { label: 'Undo', fn: () => travelHistory(-1, entry) } });
      } catch (error) { ui.toast(error.message); }
    }

    function receiptButton(id, renderRevision) {
      const button = h('button.budget-file', { type: 'button', disabled: true }, 'Loading receipt…');
      S.getAttachment(id).then(record => {
        if (!alive || renderRevision !== revision) return;
        if (!record) { button.textContent = 'Receipt missing — sync to load'; return; }
        button.disabled = false; button.textContent = '↓ ' + (record.name || (record.mime === 'application/pdf' ? 'Invoice.pdf' : 'Receipt'));
        button.setAttribute('aria-label', 'Download ' + (record.name || 'receipt'));
      }).catch(error => { if (alive && renderRevision === revision) { button.textContent = 'Receipt unavailable'; button.title = error.message; } });
      button.addEventListener('click', async () => {
        try { const record = await S.getAttachment(id); if (!record) throw new Error('This receipt is not available yet. Sync your source folder and try again.'); U.download(record.blob, record.name || (record.mime === 'application/pdf' ? 'Invoice.pdf' : 'Receipt')); }
        catch (error) { ui.toast(error.message); }
      });
      return button;
    }

    function render() {
      if (!alive) return;
      updateHistoryControls();
      const data = monthlySummary(content(), month), renderRevision = ++revision;
      currencySelect.value = data.currency;
      U.clear(summaryHost); U.clear(chartHost); U.clear(listHost);
      const stat = (label, value, detail, negative) => h('section.budget-stat' + (negative ? '.budget-over' : ''), h('h2', label), h('strong', value), h('small', detail));
      summaryHost.append(stat('Spent', money(data.spent, data.currency), data.count + (data.count === 1 ? ' expense' : ' expenses')),
        stat('Monthly budget', data.budget === null ? 'Not set' : money(data.budget, data.currency), monthLabel(month)),
        stat(data.remaining !== null && data.remaining < 0 ? 'Over budget' : 'Remaining', data.remaining === null ? '—' : money(Math.abs(data.remaining), data.currency),
          data.remaining === null ? 'Set a budget to track what is left' : data.remaining < 0 ? 'Above your planned spending' : 'Available from your budget', data.remaining !== null && data.remaining < 0));
      const legend = h('ul.budget-legend');
      let position = 0;
      const slices = data.categories.map((category, index) => {
        const start = position; position += category.percentage;
        const color = COLORS[index % COLORS.length];
        legend.append(h('li', h('span.budget-swatch', { style: { background: color }, 'aria-hidden': 'true' }), h('span.budget-category', category.name),
          h('span.budget-category-total', money(category.amount, data.currency)), h('span.budget-percentage', category.percentage.toFixed(1) + '%')));
        return color + ' ' + start + '% ' + Math.min(100, position) + '%';
      });
      const pie = h('div.budget-pie' + (data.spent ? '' : '.empty'), { role: 'img', 'aria-label': data.spent ? 'Expense pie chart. Exact category amounts and shares are listed alongside.' : 'No expenses for this month.',
        style: data.spent ? { background: 'conic-gradient(' + slices.join(', ') + ')' } : {} }, data.spent ? null : h('span', 'No expenses'));
      chartHost.append(h('section.budget-breakdown', h('h2', 'Spending by category'),
        h('div.budget-chart-layout', pie, data.spent ? legend : h('p.budget-empty-chart', 'Add your first expense to see how this month’s spending is divided.'))));
      listHost.append(h('div.budget-list-heading', h('h2', 'Expenses'), h('span', monthLabel(month))));
      if (!data.count) { listHost.append(h('div.empty', 'A fresh month', h('small', 'Add an expense above. Receipts and invoices stay with each entry.'))); return; }
      const body = h('tbody');
      data.expenses.forEach(row => body.append(h('tr',
        h('td.budget-date', h('time', { datetime: row.date }, dateLabel(row.date))),
        h('td.budget-description', h('button.budget-expense-title', { type: 'button', onclick: () => editExpense(row.id) }, row.description || 'Untitled expense'), row.note ? h('p', row.note) : null),
        h('td', h('span.chip', row.category)), h('td.budget-amount', money(row.amount, data.currency)),
        h('td.budget-receipts', row.attachments.length ? row.attachments.map(id => receiptButton(id, renderRevision)) : h('span.muted', '—')),
        h('td', h('div.budget-row-actions', h('button.btn.sm.quiet', { type: 'button', 'aria-label': 'Edit ' + row.description, onclick: () => editExpense(row.id) }, 'Edit'),
          h('button.ibtn.sm', { type: 'button', 'aria-label': 'Remove ' + row.description, onclick: () => removeExpense(row.id) }, ZN.icon('trash', 15)))))));
      listHost.append(h('div.budget-table-scroll', h('table.budget-table', h('caption.budget-sr-only', 'Expenses for ' + monthLabel(month) + ', in ' + data.currency),
        h('thead', h('tr', ['Date', 'Expense', 'Category', 'Amount', 'Receipts / invoices', 'Actions'].map(text => h('th', { scope: 'col' }, text)))), body)));
    }
    const offBlobs = S.on('blobs', () => { if (!activeEditor && S.get(page.id) === page && S.isLive(page)) render(); });
    render();
    return { focusTitle: head.focusTitle,
      handleExternalChange() {
        history.length = 0; historyAt = 0; updateHistoryControls();
        if (!alive || !activeEditor) return false;
        activeEditor.budgetStatus.textContent = 'This page was updated elsewhere. Your draft is kept here so you can copy it. Cancel to load the latest page; this draft cannot overwrite those changes.';
        return true;
      },
      async prepareExport() { if (pendingSave) await pendingSave; if (pendingHistory) await pendingHistory; if (activeEditor) throw new Error('Save or cancel your open budget editor before making a backup or updating Z Note.'); },
      unmount() { alive = false; revision++; offBlobs(); document.removeEventListener('keydown', onHistoryKey); if (activeEditor) activeEditor.close(); history.length = 0; historyAt = 0; }
    };
  };
})();
