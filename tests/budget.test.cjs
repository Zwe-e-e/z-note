'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/js/home.js'), 'utf8');

function harness(initial) {
  let nextId = 0;
  const modals = [], touched = [], downloads = [], toasts = [], subscriptions = new Map(), refreshes = [];
  const blobs = new Map();
  const documentEvents = {};
  const document = { activeElement: null, blocked: false,
    addEventListener(type, fn) { (documentEvents[type] ||= []).push(fn); },
    removeEventListener(type, fn) { documentEvents[type] = (documentEvents[type] || []).filter(item => item !== fn); },
    querySelector() { return modals[0] || (this.blocked ? {} : null); }
  };
  class Element {
    constructor(selector) {
      this.tagName = selector.split(/[.#]/)[0].toUpperCase();
      this.classes = selector.split('.').slice(1);
      this.children = []; this.attributes = {}; this.events = {}; this.value = ''; this.disabled = false; this.files = [];
      this.dataset = {}; this.style = {}; this.parent = null;
    }
    append(...items) { items.flat(Infinity).filter(item => item != null && item !== false).forEach(item => { this.children.push(item); if (item instanceof Element) item.parent = this; }); }
    appendChild(item) { this.append(item); return item; }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      // Match real HTML: input value attributes initialize a value; textarea value attributes do not.
      if (key === 'value' && this.tagName !== 'TEXTAREA') this.value = String(value);
    }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    fire(type, props = {}) { const event = { target: this, preventDefault() {}, stopPropagation() {}, ...props }; return (this.events[type] || []).map(fn => fn(event)); }
    focus() { document.activeElement = this; }
    contains(other) { return other === this || this.all().includes(other); }
    closest(selector) { for (let el = this; el; el = el.parent) if (selector === '[inert]' && el.inert) return el; return null; }
    reportValidity() { return true; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    get textContent() { return this.children.map(child => child instanceof Element ? child.textContent : String(child)).join(''); }
    set textContent(value) { this.children = [String(value)]; }
    all() { return this.children.flatMap(child => child instanceof Element ? [child, ...child.all()] : []); }
    querySelectorAll(selector) { return this.all().filter(el => selector.split(',').some(part => {
      const s = part.trim(), tag = s.split(/[:[.#]/)[0];
      if (tag && el.tagName !== tag.toUpperCase()) return false;
      if (s.includes(':not(:disabled)') && el.disabled) return false;
      if (s.startsWith('.') && !el.classes.includes(s.slice(1))) return false;
      return true;
    })); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  function h(selector, props, ...kids) {
    if (props == null) props = {};
    else if (typeof props !== 'object' || props instanceof Element || Array.isArray(props)) { kids.unshift(props); props = {}; }
    const el = new Element(selector);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'style' || key === 'dataset') Object.assign(el[key], value);
      else if (typeof value === 'boolean') el[key] = value;
      else el.setAttribute(key, value);
    }
    el.append(kids); return el;
  }
  document.body = new Element('body');
  const originalPage = { id: 'budget-page', type: 'budget', title: 'My budget', tags: [], created: 1, content: initial || { currency: 'SGD', budgets: {}, expenses: [] } };
  let current = originalPage;
  const ZN = { views: {}, shell: { refresh: () => refreshes.push(true) }, util: { h, uid: () => 'id-' + ++nextId, ymd: () => '2026-11-25', clear: el => { el.children = []; return el; },
    download: (...args) => downloads.push(args), isEditable: el => !!el && (el.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) }, icon: () => h('svg'), pageHead: () => ({ el: h('header'), focusTitle() {} }),
    store: { get: () => current, isLive: page => !page.trashed, touch: id => touched.push(id), trackDataWork: task => task(),
      async addAttachment(file) { const rec = { id: 'blob-' + ++nextId, name: file.name, mime: file.type, blob: file }; blobs.set(rec.id, rec); return rec; },
      async getAttachment(id) { return blobs.get(id) || null; },
      async withAttachments(ids, commit) {
        for (const id of new Set(ids || [])) if (!await this.getAttachment(id)) throw new Error('A receipt is no longer available. Sync its source folder before restoring this expense.');
        const result = commit(); assert.ok(!result || typeof result.then !== 'function', 'attachment restore commits synchronously'); return result;
      },
      on(name, fn) { subscriptions.set(name, fn); return () => subscriptions.delete(name); } },
    ui: { toast: (...args) => toasts.push(args), confirm: async () => true,
      modal(options) { const el = h('section', options.body); let closed = false; const modal = { el, body: options.body, close() { if (closed) return; closed = true; modals.splice(modals.indexOf(modal), 1); if (options.onClose) options.onClose(); } }; modals.push(modal); return modal; }
    }
  };
  vm.runInNewContext(source, { window: { ZN }, document, console, Date, Intl });
  const host = h('main');
  const mount = () => ZN.views.budget(host, originalPage);
  const button = (root, text) => root.all().find(el => el.tagName === 'BUTTON' && el.textContent === text);
  const field = label => {
    const match = modals[0].el.all().find(el => el.tagName === 'LABEL' && el.children[0] instanceof Element && el.children[0].textContent === label);
    assert.ok(match, 'field exists: ' + label);
    return match.children.find(el => el instanceof Element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  };
  const submit = () => modals[0].el.querySelector('form').fire('submit');
  const press = async (props = {}) => {
    const event = { key: 'z', ctrlKey: true, target: document.activeElement || document.body, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...props };
    await Promise.all((documentEvents.keydown || []).map(fn => fn(event))); return event;
  };
  return { ZN, host, mount, originalPage, modals, field, submit, button, touched, downloads, blobs, toasts, subscriptions, refreshes, document, press, element: tag => new Element(tag), replace(page) { current = page; } };
}
const logic = () => harness().ZN.budget;
const expense = (id, amount, extra = {}) => ({ id, date: '2026-11-25', description: id, category: 'Food & dining', amount, note: '', attachments: [], ...extra });
const content = expenses => ({ currency: 'SGD', budgets: { '2026-11': 10000 }, expenses });
const plain = value => JSON.parse(JSON.stringify(value));
function fillExpense(h, extra = {}) {
  h.field('Description').value = extra.description || 'Coffee';
  h.field('Date').value = extra.date || '2026-11-25';
  h.field('Amount (SGD)').value = extra.amount || '4.20';
}

test('decimal entry uses exact integer cents and rejects ambiguous or excessive precision', () => {
  const b = logic();
  for (const [input, expected] of [['0', 0], ['0.01', 1], ['1.2', 120], [' 12.34 ', 1234], ['0001.05', 105], ['999999999.99', 99999999999]]) assert.equal(b.parseAmount(input), expected);
  for (const input of ['', '-1', '+2', '.50', '1.', '1.001', '1,000', '1e3', 'Infinity', '1000000000', 20, null]) assert.equal(b.parseAmount(input), null, String(input));
});
test('dates and month selection reject impossible dates and honor leap years', () => {
  const b = logic();
  assert.equal(b.validDate('2024-02-29'), true); assert.equal(b.validDate('2026-02-29'), false);
  assert.equal(b.validDate('2026-04-31'), false); assert.equal(b.validDate('2026-11-25'), true);
  assert.equal(b.validMonth('2026-13'), false); assert.equal(b.validMonth('2026-11'), true);
});
test('monthly totals and category pie values isolate month and year without mutating records', () => {
  const b = logic(), data = content([expense('one', 10), expense('two', 20), expense('bus', 70, { category: 'Transport' }), expense('old', 500, { date: '2025-11-25' }), expense('next', 1000, { date: '2026-12-01' })]);
  const before = JSON.stringify(data), summary = b.monthlySummary(data, '2026-11');
  assert.equal(summary.spent, 100); assert.equal(summary.remaining, 9900); assert.equal(summary.count, 3);
  assert.deepEqual(plain(summary.categories), [{ name: 'Transport', amount: 70, percentage: 70 }, { name: 'Food & dining', amount: 30, percentage: 30 }]);
  assert.equal(JSON.stringify(data), before);
});
test('zero budget differs from absent budget and overspending remains exact', () => {
  const b = logic();
  assert.equal(b.monthlySummary(b.blank(), '2026-11').remaining, null);
  const data = content([expense('bill', 10550)]); data.budgets['2026-11'] = 0;
  assert.equal(b.monthlySummary(data, '2026-11').remaining, -10550);
});
test('import normalization rejects invalid financial entries and preserves extra fields and receipt references', () => {
  const b = logic();
  assert.deepEqual(plain(b.normalizeContent({})), { currency: 'SGD', budgets: {}, expenses: [] });
  for (const row of [expense('x', 1.5), expense('x', -1), expense('x', 0), expense('x', 1, { date: '2026-02-30' }), expense('x', 1, { attachments: [null] })]) assert.throws(() => b.normalizeContent(content([row])));
  assert.throws(() => b.normalizeContent(content([expense('same', 1), expense('same', 2)])), /repeated ID/);
  assert.throws(() => b.normalizeContent({ currency: 'SGD', budgets: { '2026-13': 50 }, expenses: [] }), /budget.*invalid/);
  const data = content([expense('kept', 120, { custom: 'keep', note: 'Details', attachments: ['a', 'b', 'a'] })]);
  const normalized = b.normalizeContent(data);
  assert.equal(normalized.expenses[0].custom, 'keep'); assert.deepEqual(plain(normalized.expenses[0].attachments), ['a', 'b']);
  assert.deepEqual(plain(b.attachmentIds({ content: data })), ['a', 'b']);
});
test('opening and switching months do not modify a notebook', () => {
  const h = harness(content([expense('Lunch', 1000)])), before = JSON.stringify(h.originalPage.content), view = h.mount();
  const month = h.host.all().find(el => el.attributes['aria-label'] === 'Expense month'); month.value = '2026-12'; month.fire('change');
  assert.equal(h.host.textContent.includes('A fresh month'), true); assert.deepEqual(h.touched, []); assert.equal(JSON.stringify(h.originalPage.content), before);
  view.unmount(); assert.equal(h.subscriptions.size, 0);
});
test('editing an expense preloads and preserves notes when another field changes', async () => {
  const h = harness(content([expense('Lunch', 1000, { note: 'Invoice details\nKeep the second line.' })])), view = h.mount();
  h.button(h.host, 'Edit').fire('click');
  assert.equal(h.field('Notes').value, 'Invoice details\nKeep the second line.');
  h.field('Amount (SGD)').value = '12.50'; h.submit(); await view.prepareExport();
  assert.equal(h.originalPage.content.expenses[0].amount, 1250);
  assert.equal(h.originalPage.content.expenses[0].note, 'Invoice details\nKeep the second line.');
  assert.equal(h.modals.length, 0); assert.deepEqual(h.touched, ['budget-page']);
});
test('unfinished editor blocks backup and cancel leaves expenses untouched', async () => {
  const h = harness(), view = h.mount(); h.button(h.host, 'Add expense').fire('click'); fillExpense(h);
  await assert.rejects(view.prepareExport(), /Save or cancel/);
  h.button(h.modals[0].el, 'Cancel').fire('click'); await view.prepareExport();
  assert.equal(h.originalPage.content.expenses.length, 0); assert.deepEqual(h.touched, []);
});
test('all receipt bytes finish saving before the expense and backup can complete', async () => {
  const h = harness(), view = h.mount(); let release;
  const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  h.ZN.store.addAttachment = async file => { calls++; if (calls === 2) await gate; return { id: 'receipt-' + calls, name: file.name }; };
  h.button(h.host, 'Add expense').fire('click'); fillExpense(h);
  h.modals[0].el.all().find(el => el.attributes.type === 'file').files = [{ name: 'receipt.jpg' }, { name: 'invoice.pdf' }];
  h.submit(); let backedUp = false; const exportReady = view.prepareExport().then(() => { backedUp = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(backedUp, false); assert.equal(h.originalPage.content.expenses.length, 0);
  release(); await exportReady;
  assert.deepEqual(plain(h.originalPage.content.expenses[0].attachments), ['receipt-1', 'receipt-2']); assert.equal(backedUp, true);
});
test('failed receipt save does not commit a partial expense, and retry reuses saved files', async () => {
  const h = harness(), view = h.mount(); let calls = 0;
  h.ZN.store.addAttachment = async file => { calls++; if (calls === 2) throw new Error('Disk is full'); return { id: file.name }; };
  h.button(h.host, 'Add expense').fire('click'); fillExpense(h);
  h.modals[0].el.all().find(el => el.attributes.type === 'file').files = [{ name: 'first.pdf' }, { name: 'second.jpg' }];
  h.submit(); await assert.rejects(view.prepareExport(), /Disk is full/); await Promise.resolve();
  assert.equal(h.originalPage.content.expenses.length, 0); assert.match(h.modals[0].el.textContent, /Disk is full/);
  h.submit(); await view.prepareExport(); assert.equal(calls, 3);
  assert.deepEqual(plain(h.originalPage.content.expenses[0].attachments), ['first.pdf', 'second.jpg']);
});
test('sync replacement during receipt upload cannot resurrect or overwrite the page', async () => {
  const h = harness(), view = h.mount(); let release; const wait = new Promise(resolve => { release = resolve; });
  h.ZN.store.addAttachment = async () => { await wait; return { id: 'late-receipt' }; };
  h.button(h.host, 'Add expense').fire('click'); fillExpense(h);
  h.modals[0].el.all().find(el => el.attributes.type === 'file').files = [{ name: 'invoice.pdf' }]; h.submit();
  const ready = view.prepareExport(); h.replace({ ...h.originalPage, content: content([expense('From another PC', 800)]) }); release();
  await assert.rejects(ready, /changed or closed/); assert.deepEqual(h.touched, []); assert.equal(h.originalPage.content.expenses.length, 0);
});
test('closing a view during a receipt upload does not commit to the abandoned view', async () => {
  const h = harness(), view = h.mount(); let release; const wait = new Promise(resolve => { release = resolve; });
  h.ZN.store.addAttachment = async () => { await wait; return { id: 'late-receipt' }; };
  h.button(h.host, 'Add expense').fire('click'); fillExpense(h);
  h.modals[0].el.all().find(el => el.attributes.type === 'file').files = [{ name: 'invoice.pdf' }]; h.submit();
  const ready = view.prepareExport(); view.unmount(); release(); await assert.rejects(ready, /changed or closed/);
  assert.equal(h.modals.length, 0); assert.deepEqual(h.touched, []);
});
test('an external page update keeps the visible draft until the user cancels', async () => {
  const h = harness(), view = h.mount(); assert.equal(view.handleExternalChange(), false);
  h.button(h.host, 'Add expense').fire('click'); fillExpense(h, { description: 'Keep my typed draft' });
  const replacement = { ...h.originalPage, content: content([expense('Remote expense', 600)]) };
  h.replace(replacement); assert.equal(view.handleExternalChange(), true);
  assert.equal(h.field('Description').value, 'Keep my typed draft');
  assert.match(h.modals[0].el.textContent, /Your draft is kept here/);
  h.submit(); await assert.rejects(view.prepareExport(), /changed or closed/); await Promise.resolve();
  assert.equal(replacement.content.expenses.length, 1); assert.deepEqual(h.touched, []);
  h.button(h.modals[0].el, 'Cancel').fire('click'); assert.equal(h.modals.length, 0); assert.equal(h.refreshes.length, 1);
});
test('a monthly budget can be set to zero and removed without deleting expenses', async () => {
  const h = harness(content([expense('Lunch', 1250)])), view = h.mount();
  h.button(h.host, 'Set monthly budget').fire('click'); h.field('Monthly budget (SGD)').value = '0'; h.submit(); await view.prepareExport();
  assert.equal(h.originalPage.content.budgets['2026-11'], 0); assert.match(h.host.textContent, /Over budget/);
  await Promise.resolve(); h.button(h.host, 'Set monthly budget').fire('click'); h.field('Monthly budget (SGD)').value = ''; h.submit(); await view.prepareExport();
  assert.equal(Object.hasOwn(h.originalPage.content.budgets, '2026-11'), false); assert.equal(h.originalPage.content.expenses.length, 1);
});
test('expense removal and Undo keep receipts available for copies and restored rows', async () => {
  const h = harness(content([expense('Lunch', 1250, { attachments: ['shared-receipt'] })])); h.mount();
  h.blobs.set('shared-receipt', { id: 'shared-receipt', name: 'invoice.pdf' });
  h.ZN.store.delBlob = () => { throw new Error('Removing an expense must not delete shared receipt bytes'); };
  const remove = h.host.all().find(el => el.attributes['aria-label'] === 'Remove Lunch'); await Promise.all(remove.fire('click'));
  assert.equal(h.originalPage.content.expenses.length, 0); assert.equal(h.blobs.has('shared-receipt'), true);
  await h.toasts[0][1].action.fn(); assert.equal(h.originalPage.content.expenses.length, 1); assert.deepEqual(plain(h.originalPage.content.expenses[0].attachments), ['shared-receipt']);
});
test('Undo refuses to restore an expense when another window purged its receipt', async () => {
  const h = harness(content([expense('Lunch', 1250, { attachments: ['shared-receipt'] })])); h.mount();
  h.blobs.set('shared-receipt', { id: 'shared-receipt', name: 'invoice.pdf' });
  const remove = h.host.all().find(el => el.attributes['aria-label'] === 'Remove Lunch'); await Promise.all(remove.fire('click'));
  h.blobs.delete('shared-receipt');
  await h.toasts[0][1].action.fn();
  assert.equal(h.originalPage.content.expenses.length, 0); assert.equal(h.touched.length, 1);
  assert.match(h.toasts[1][0], /receipt is no longer available/);
});
test('Undo rechecks the page after asynchronous receipt verification', async () => {
  const h = harness(content([expense('Lunch', 1250, { attachments: ['shared-receipt'] })])); h.mount();
  const remove = h.host.all().find(el => el.attributes['aria-label'] === 'Remove Lunch'); await Promise.all(remove.fire('click'));
  let release; const gate = new Promise(resolve => { release = resolve; });
  h.ZN.store.getAttachment = async () => { await gate; return { id: 'shared-receipt' }; };
  const restoring = h.toasts[0][1].action.fn();
  const replacement = { ...h.originalPage, content: content([expense('Remote expense', 600)]) }; h.replace(replacement); release(); await restoring;
  assert.equal(h.originalPage.content.expenses.length, 0); assert.equal(replacement.content.expenses.length, 1); assert.equal(h.touched.length, 1);
  assert.match(h.toasts[1][0], /changed or closed/);
});

async function addExpense(h, view, extra = {}) {
  h.button(h.host, 'Add expense').fire('click'); fillExpense(h, extra);
  h.submit(); await view.prepareExport(); await Promise.resolve();
}
async function setBudget(h, view, value) {
  h.button(h.host, 'Set monthly budget').fire('click'); h.field('Monthly budget (SGD)').value = value;
  h.submit(); await view.prepareExport(); await Promise.resolve();
}

test('Ctrl+Z undoes multiple saved expenses; Ctrl+Y and Command+Shift+Z redo them', async () => {
  const h = harness(), view = h.mount();
  assert.equal(h.button(h.host, 'Undo').disabled, true);
  await addExpense(h, view, { description: 'Coffee' });
  await addExpense(h, view, { description: 'Lunch', amount: '12.80' });
  assert.equal((await h.press()).defaultPrevented, true);
  assert.deepEqual(plain(h.originalPage.content.expenses.map(row => row.description)), ['Coffee']);
  await h.press(); assert.equal(h.originalPage.content.expenses.length, 0);
  const touched = h.touched.length; await h.press(); assert.equal(h.touched.length, touched);
  await h.press({ key: 'y' }); await h.press({ ctrlKey: false, metaKey: true, shiftKey: true });
  assert.deepEqual(plain(h.originalPage.content.expenses.map(row => row.description)), ['Coffee', 'Lunch']);
  assert.match(h.host.textContent, /SGD\s*17.00/);
  assert.equal(h.button(h.host, 'Redo').disabled, true);
});

test('budget undo restores edits and receipt references without deleting receipt bytes', async () => {
  const h = harness(content([expense('Lunch', 1000, { note: 'Keep me', attachments: ['receipt'] })])), view = h.mount();
  h.blobs.set('receipt', { id: 'receipt', name: 'receipt.pdf' });
  h.button(h.host, 'Edit').fire('click'); h.field('Amount (SGD)').value = '15.50'; h.field('Notes').value = 'Changed';
  h.button(h.modals[0].el, 'Remove').fire('click'); h.submit(); await view.prepareExport(); await Promise.resolve();
  await h.press();
  assert.deepEqual(plain(h.originalPage.content.expenses[0]), expense('Lunch', 1000, { note: 'Keep me', attachments: ['receipt'] }));
  await h.press({ key: 'y' });
  assert.equal(h.originalPage.content.expenses[0].amount, 1550); assert.equal(h.originalPage.content.expenses[0].attachments.length, 0);
  assert.equal(h.blobs.has('receipt'), true);
});

test('month switches and no-op saves do not add undo steps; new changes discard the redo branch', async () => {
  const h = harness(), view = h.mount();
  await setBudget(h, view, '100'); await setBudget(h, view, '100');
  const month = h.host.all().find(el => el.attributes['aria-label'] === 'Expense month'); month.value = '2026-12'; month.fire('change');
  await h.press(); assert.equal(Object.hasOwn(h.originalPage.content.budgets, '2026-11'), false);
  await setBudget(h, view, '50'); await h.press({ key: 'y' });
  assert.deepEqual(plain(h.originalPage.content.budgets), { '2026-12': 5000 });
});

test('currency changes participate in undo without converting or changing expense amounts', async () => {
  const h = harness(content([expense('Lunch', 1250)])); h.mount();
  const select = h.host.all().find(el => el.attributes['aria-label'] === 'Budget currency');
  select.value = 'USD'; await Promise.all(select.fire('change'));
  assert.equal(h.originalPage.content.currency, 'USD');
  select.focus();
  await h.press(); assert.equal(h.originalPage.content.currency, 'SGD');
  await h.press({ shiftKey: true }); assert.equal(h.originalPage.content.currency, 'USD');
  assert.equal(h.originalPage.content.expenses[0].amount, 1250);
});

test('toast Undo and keyboard history use one ordering and cannot replay a stale removal', async () => {
  const h = harness(content([expense('Lunch', 1250)])), view = h.mount();
  await Promise.all(h.host.all().find(el => el.attributes['aria-label'] === 'Remove Lunch').fire('click'));
  const undoRemoval = h.toasts[0][1].action.fn;
  await setBudget(h, view, '50'); await undoRemoval();
  assert.equal(h.originalPage.content.expenses.length, 0); assert.equal(h.originalPage.content.budgets['2026-11'], 5000);
  await h.press(); await undoRemoval();
  assert.equal(h.originalPage.content.expenses.length, 1); assert.equal(h.originalPage.content.budgets['2026-11'], 10000);
  await h.press({ key: 'y' }); assert.equal(h.originalPage.content.expenses.length, 0);
});

test('failed receipt validation keeps the undo position available for retry', async () => {
  const h = harness(content([expense('Lunch', 1250, { attachments: ['receipt'] })])); h.mount();
  await Promise.all(h.host.all().find(el => el.attributes['aria-label'] === 'Remove Lunch').fire('click'));
  await h.press(); assert.equal(h.originalPage.content.expenses.length, 0); assert.equal(h.button(h.host, 'Undo').disabled, false);
  h.blobs.set('receipt', { id: 'receipt' }); await h.press(); assert.equal(h.originalPage.content.expenses.length, 1);
});

test('pending history waits for receipts, blocks repeated actions, and delays backup preparation', async () => {
  const h = harness(content([expense('Lunch', 1250, { attachments: ['receipt'] })])), view = h.mount();
  await Promise.all(h.host.all().find(el => el.attributes['aria-label'] === 'Remove Lunch').fire('click'));
  let release; const gate = new Promise(resolve => { release = resolve; });
  h.ZN.store.getAttachment = async () => { await gate; return { id: 'receipt' }; };
  const undoing = h.press(); let ready = false; const exporting = view.prepareExport().then(() => { ready = true; });
  await h.press(); h.button(h.host, 'Add expense').fire('click'); await Promise.resolve();
  assert.equal(h.modals.length, 0); assert.equal(ready, false); assert.equal(h.originalPage.content.expenses.length, 0);
  release(); await undoing; await exporting;
  assert.equal(h.originalPage.content.expenses.length, 1); assert.equal(h.touched.length, 2);
});

test('Ctrl+Z preserves native text undo and ignores modals, sidebar focus, IME, and frozen updates', async () => {
  const h = harness(), view = h.mount(); await setBudget(h, view, '100');
  for (const tag of ['input', 'textarea', 'select', 'div']) {
    const field = h.element(tag); if (tag === 'div') field.isContentEditable = true;
    h.host.append(field); h.document.activeElement = field;
    assert.equal((await h.press()).defaultPrevented, false);
  }
  h.document.activeElement = h.element('button'); assert.equal((await h.press()).defaultPrevented, false);
  h.document.activeElement = h.document.body;
  for (const props of [{ altKey: true }, { isComposing: true }, { defaultPrevented: true }, { ctrlKey: false }]) await h.press(props);
  h.document.blocked = true; assert.equal((await h.press()).defaultPrevented, false); h.document.blocked = false;
  h.host.inert = true; assert.equal((await h.press()).defaultPrevented, false); h.host.inert = false;
  h.button(h.host, 'Add expense').fire('click'); assert.equal((await h.press()).defaultPrevented, false);
  h.button(h.modals[0].el, 'Cancel').fire('click'); assert.equal(h.originalPage.content.budgets['2026-11'], 10000);
  await h.press(); assert.equal(Object.hasOwn(h.originalPage.content.budgets, '2026-11'), false);
});

test('external content changes invalidate budget history and unmount removes the keyboard handler', async () => {
  const h = harness(), view = h.mount(); await setBudget(h, view, '100');
  h.originalPage.content.budgets['2026-11'] = 90000; await h.press();
  assert.equal(h.originalPage.content.budgets['2026-11'], 90000); assert.equal(h.button(h.host, 'Undo').disabled, true);
  await setBudget(h, view, '200'); view.handleExternalChange(); await h.press(); assert.equal(h.originalPage.content.budgets['2026-11'], 20000);
  await setBudget(h, view, '300'); view.unmount(); assert.equal((await h.press()).defaultPrevented, false); assert.equal(h.originalPage.content.budgets['2026-11'], 30000);
});

test('history keeps only the most recent fifty budget changes', async () => {
  const h = harness(), view = h.mount();
  for (let i = 1; i <= 51; i++) await setBudget(h, view, String(i));
  for (let i = 0; i < 51; i++) await h.press();
  assert.equal(h.originalPage.content.budgets['2026-11'], 100);
});
