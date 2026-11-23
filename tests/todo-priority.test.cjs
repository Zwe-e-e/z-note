'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the real task model/view with synthetic tasks only. No browser
// storage, notebook directories, or user notes are read by these checks.
function harness(tasks = [], options = {}) {
  let serial = 0;
  const touched = [], saved = new Map(), messages = [], drag = [], timers = [], settingWrites = [];
  const document = { activeElement: null };

  function simpleMatch(el, selector) {
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    selector = selector.replace(/\[[^\]]*\]/g, '');
    const tag = selector.match(/^[a-z][a-z0-9-]*/i);
    if (tag && el.tag !== tag[0]) return false;
    if ([...selector.matchAll(/\.([\w-]+)/g)].some(m => !el.classes.has(m[1]))) return false;
    return attrs.every(([, key, value]) => {
      const actual = key.startsWith('data-') ? el.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : el.attributes[key];
      return value === undefined ? actual !== undefined : String(actual) === value;
    });
  }
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const bits = part.trim().split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      if (!simpleMatch(el, bits.pop())) return false;
      let parent = el.parentElement;
      while (bits.length) {
        const next = bits.pop();
        while (parent && !simpleMatch(parent, next)) parent = parent.parentElement;
        if (!parent) return false;
        parent = parent.parentElement;
      }
      return true;
    });
  }
  class Element {
    constructor(selector) {
      this.nodeType = 1;
      this.tag = selector.match(/^[^.#]+/)[0];
      this.classes = new Set(selector.split('.').slice(1));
      this.children = []; this.parentElement = null; this.dataset = {}; this.attributes = {};
      this.events = new Map(); this.value = ''; this.offsetTop = 0; this.isConnected = true;
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.classList = {
        contains: key => this.classes.has(key),
        add: (...keys) => keys.forEach(key => this.classes.add(key)),
        remove: (...keys) => keys.forEach(key => this.classes.delete(key)),
        toggle: (key, on) => { if (on === undefined) on = !this.classes.has(key); if (on) this.classes.add(key); else this.classes.delete(key); return on; }
      };
    }
    append(...children) {
      for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue;
        if (child instanceof Element) { child.remove(); child.parentElement = this; }
        this.children.push(child);
      }
      if (this.tag === 'select' && !this.value) this.value = this.children.find(c => c.selected)?.value || this.children[0]?.value || '';
    }
    appendChild(child) { this.append(child); return child; }
    remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
    get textContent() { return this.children.map(c => c instanceof Element ? c.textContent : String(c)).join(''); }
    set textContent(value) { this.children = [String(value)]; }
    setAttribute(name, value) {
      this.attributes[name] = value;
      if (name === 'value') this.value = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
    removeEventListener(name, callback) { this.events.set(name, (this.events.get(name) || []).filter(fn => fn !== callback)); }
    all() { return this.children.flatMap(c => c instanceof Element ? [c, ...c.all()] : []); }
    querySelectorAll(selector) { return this.all().filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { let el = this; while (el && !matches(el, selector)) el = el.parentElement; return el; }
    contains(el) { for (; el; el = el.parentElement) if (el === this) return true; return false; }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = null; }
    scrollIntoView() {}
    getBoundingClientRect() { return { top: 0, bottom: 28, left: 0, width: 300, height: 28 }; }
    fire(type, extra = {}) {
      const event = Object.assign({ type, target: this, key: '', preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }, extra);
      let el = this;
      while (el) { for (const fn of el.events.get(type) || []) fn(event); if (event.stopped) break; el = el.parentElement; }
      return event;
    }
  }
  function h(selector, props, ...children) {
    if (props == null) props = {};
    else if (typeof props !== 'object' || props instanceof Element || Array.isArray(props)) { children.unshift(props); props = {}; }
    const el = new Element(selector);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style') Object.assign(el.style, value);
      else { el[key] = value; el.setAttribute(key, value); }
    }
    el.append(...children);
    return el;
  }
  const page = { id: 'list1', type: 'todo', title: 'Example list', parentId: 'book1', content: { tasks } };
  const pages = [page, ...(options.pages || [])];
  const ZN = {
    views: {}, db: {},
    util: {
      h, uid: () => 'task' + ++serial, dueInfo: due => due ? { label: due, cls: 'later' } : null,
      ymd: () => '2026-11-23', parseDue: text => text === 'fri' ? '2026-11-27' : null,
      text: text => String(text), cleanHTML: text => String(text),
      clear: el => { for (const c of el.children) if (c instanceof Element) c.parentElement = null; el.children = []; return el; },
      append: (el, kids) => el.append(kids),
      caret: { set: el => el?.focus(), offset: () => 0, rect: () => ({ top: 0, bottom: 28, left: 0 }), setAtX: el => el.focus() }
    },
    store: {
      settings: { ...(options.settings || {}) },
      live: type => pages.filter(p => !p.trashed && (!type || p.type === type)),
      get: id => pages.find(p => p.id === id), isLive: p => pages.includes(p) && !p.trashed,
      touch: id => { touched.push(id); saved.set(id, JSON.parse(JSON.stringify(pages.find(p => p.id === id)))); },
      update: (id, patch) => { const p = pages.find(p => p.id === id); Object.assign(p, patch); saved.set(id, JSON.parse(JSON.stringify(p))); },
      setSetting: (key, value) => { settingWrites.push([key, value]); ZN.store.settings[key] = value; },
      on: () => () => {}, blank: () => ({ tasks: [] })
    },
    ui: {
      toast: text => messages.push(text),
      dragColumns: options => { drag.push(options); return () => {}; },
      dragSort: options => { drag.push(options); return () => {}; },
      menu: (anchor, items) => { ZN.ui.lastMenu = items; },
      datePicker: () => {}
    },
    icon: () => h('svg'), tickHTML: '', pageTitle: p => p.title,
    pageHead: () => ({ el: h('header'), focusTitle() {} }), openPage() {}
  };
  const context = { window: { ZN }, document, console, requestAnimationFrame: fn => fn(), getComputedStyle: () => ({ lineHeight: '28' }),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/todo.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/settings.js'), 'utf8'), context);
  const host = h('main');
  return { ZN, model: ZN.tasks, page, pages, tasks, h, host, touched, saved, messages, drag, document, settingWrites,
    mount() { return ZN.views.todo(host, page); }, drainTimers() { while (timers.length) timers.shift()(); } };
}

const task = (id, extra = {}) => Object.assign({ id, text: id + ' task', pri: 0, done: false, due: null, note: '', created: 100, doneAt: 0 }, extra);
const ids = tasks => Array.from(tasks, t => t.id);

test('legacy important tasks become High and unflagged tasks become Medium without mutating saved data', () => {
  const h = harness(), old = [task('one', { pri: 1 }), task('two'), task('three', { priority: 'C', pri: 1 }), task('four', { priority: 'invalid', pri: 1 })];
  const before = JSON.stringify(old);
  assert.deepEqual(old.map(h.model.priorityOf), ['A', 'B', 'C', 'A']);
  assert.equal(JSON.stringify(old), before);
});

test('priority changes preserve metadata and keep legacy importance flags compatible', () => {
  const h = harness(), t = task('one', { note: 'Keep this note', due: '2026-12-02', custom: { untouched: true } });
  const original = { ...t };
  for (const level of ['A', 'B', 'C']) {
    h.model.setPriority(t, level);
    assert.equal(h.model.priorityOf(t), level); assert.equal(t.pri, level === 'A' ? 1 : 0);
    for (const field of ['id', 'text', 'due', 'note', 'created', 'done', 'doneAt', 'custom']) assert.equal(t[field], original[field]);
  }
  const before = JSON.stringify(t);
  assert.equal(h.model.setPriority(t, 'invalid'), false); assert.equal(JSON.stringify(t), before);
});

test('new tasks default to Medium, urgent quick entry remains High, and explicit Low survives duplication', () => {
  const h = harness();
  assert.equal(h.model.priorityOf(h.model.newTask('New')), 'B');
  const quick = h.model.parseQuick('Call supplier @fri !');
  const urgent = h.model.newTask(quick.text, quick);
  assert.equal(h.model.priorityOf(urgent), 'A'); assert.equal(urgent.due, '2026-11-27');
  const copy = h.model.newTask('Copied', { priority: 'C', pri: 1, note: 'Retain', due: '2026-12-04' });
  assert.equal(h.model.priorityOf(copy), 'C'); assert.equal(copy.pri, 0); assert.equal(copy.note, 'Retain');
});

test('moving a task between columns retains the same record and orders it before the chosen destination task', () => {
  const h = harness(), a = task('high', { priority: 'A' }), b = task('medium', { priority: 'B', note: 'Detail', due: '2026-12-04' }), c = task('low', { priority: 'C' });
  const tasks = [a, b, c], before = { ...b };
  h.model.movePriority(tasks, b.id, 'C', c.id);
  assert.deepEqual(ids(tasks), ['high', 'medium', 'low']); assert.equal(tasks[1], b); assert.equal(h.model.priorityOf(b), 'C');
  for (const field of ['id', 'text', 'due', 'note', 'created', 'doneAt']) assert.equal(b[field], before[field]);
  h.model.movePriority(tasks, b.id, 'A');
  assert.deepEqual(ids(tasks.filter(t => h.model.priorityOf(t) === 'A')), ['high', 'medium']);
  assert.equal(tasks.length, 3); assert.equal(new Set(ids(tasks)).size, 3);
});

test('dragging to an empty column and reordering inside a column each preserve every task', () => {
  const h = harness(), tasks = [task('one', { priority: 'A' }), task('two', { priority: 'A' }), task('three', { priority: 'B' })];
  h.model.movePriority(tasks, 'one', 'C');
  assert.equal(h.model.priorityOf(tasks.find(t => t.id === 'one')), 'C');
  h.model.movePriority(tasks, 'three', 'A', 'two');
  assert.deepEqual(ids(tasks.filter(t => h.model.priorityOf(t) === 'A')), ['three', 'two']);
  assert.deepEqual(ids(tasks).sort(), ['one', 'three', 'two']);
});

test('invalid moves, completed tasks and stale destination IDs cannot remove or change tasks', () => {
  const h = harness(), tasks = [task('one', { priority: 'A' }), task('two', { priority: 'B' }), task('done', { priority: 'C', done: true, doneAt: 1000 })];
  for (const args of [['missing', 'B'], ['done', 'A'], ['one', 'invalid'], ['one', 'C', 'missing'], ['one', 'C', 'two'], ['one', 'C', 'done']]) {
    const before = JSON.stringify(tasks);
    assert.equal(h.model.movePriority(tasks, ...args), false);
    assert.equal(JSON.stringify(tasks), before);
  }
});

test('priorities and task order survive the existing JSON backup and folder page normalization', () => {
  const h = harness([task('one', { priority: 'A', pri: 1 }), task('two', { priority: 'C' }), task('three')]);
  h.model.movePriority(h.tasks, 'three', 'C', 'two');
  const restored = h.ZN.settings.normalizePage(JSON.parse(JSON.stringify(h.page)));
  assert.deepEqual(ids(restored.content.tasks), ids(h.tasks));
  assert.deepEqual(Array.from(restored.content.tasks, h.model.priorityOf), Array.from(h.tasks, h.model.priorityOf));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.content.tasks)), JSON.parse(JSON.stringify(h.tasks)));
});

test('the list renders all three columns, puts legacy tasks in the right column, and keeps completed tasks below them', () => {
  const h = harness([task('urgent', { pri: 1 }), task('regular'), task('later', { priority: 'C' }), task('finished', { priority: 'A', done: true, doneAt: 200 })]);
  h.ZN.store.settings.taskLayout = 'columns';
  h.mount();
  const columns = h.host.querySelectorAll('.todo-column');
  assert.deepEqual(columns.map(el => el.dataset.priority), ['A', 'B', 'C']);
  assert.deepEqual(columns.map(el => el.querySelectorAll('.task').map(row => row.dataset.id)), [['urgent'], ['regular'], ['later']]);
  assert.deepEqual(h.host.querySelector('.tasks-done').querySelectorAll('.task').map(row => row.dataset.id), ['finished']);
  assert.equal(h.touched.length, 0);
});

test('the drag callback saves a cross-column move and renders it in the destination', () => {
  const h = harness([task('one', { priority: 'A', due: '2026-12-04', note: 'Keep details' }), task('two', { priority: 'B' })]);
  h.ZN.store.settings.taskLayout = 'columns';
  h.mount();
  const row = h.host.querySelector('.task[data-id="one"]'), column = h.host.querySelector('.todo-column[data-priority="C"]');
  h.drag[0].onDrop(row, null, column);
  assert.equal(h.model.priorityOf(h.tasks.find(t => t.id === 'one')), 'C');
  assert.deepEqual(h.host.querySelector('.todo-column[data-priority="C"]').querySelectorAll('.task').map(el => el.dataset.id), ['one']);
  assert.equal(h.saved.get('list1').content.tasks.find(t => t.id === 'one').priority, 'C');
  assert.equal(h.saved.get('list1').content.tasks.find(t => t.id === 'one').note, 'Keep details');
});

test('the priority select moves a task without dragging and persists its choice', () => {
  const h = harness([task('one')], { settings: { taskLayout: 'columns' } }); h.mount();
  const select = h.host.querySelector('.task[data-id="one"] select');
  assert.ok(select, 'Each task must have a keyboard-accessible priority select');
  select.value = 'A'; select.fire('change');
  assert.equal(h.model.priorityOf(h.tasks[0]), 'A');
  assert.equal(h.saved.get('list1').content.tasks[0].priority, 'A');
  assert.equal(h.host.querySelector('.todo-column[data-priority="A"] .task').dataset.id, 'one');
});

test('Enter creates the next editable task in the same priority column', () => {
  const h = harness([task('one', { priority: 'C' })], { settings: { taskLayout: 'columns' } }); h.mount();
  h.host.querySelector('.task[data-id="one"] .task-text').fire('keydown', { key: 'Enter' });
  assert.equal(h.tasks.length, 2);
  assert.equal(h.model.priorityOf(h.tasks[1]), 'C');
  assert.equal(h.host.querySelector('.todo-column[data-priority="C"]').querySelectorAll('.task').length, 2);
});

test('Duplicate retains priority, notes and due date with a new task ID', () => {
  const h = harness([task('one', { priority: 'C', note: 'Keep note', due: '2026-12-04' })]); h.mount();
  h.host.querySelector('.task[data-id="one"] [data-act="more"]').fire('click');
  const duplicate = h.ZN.ui.lastMenu.find(item => item && item.label === 'Duplicate');
  assert.ok(duplicate); duplicate.onClick();
  assert.equal(h.tasks.length, 2); assert.notEqual(h.tasks[0].id, h.tasks[1].id);
  assert.equal(h.model.priorityOf(h.tasks[1]), 'C'); assert.equal(h.tasks[1].note, 'Keep note'); assert.equal(h.tasks[1].due, '2026-12-04');
  assert.equal(h.saved.get('list1').content.tasks.length, 2);
});

test('completing and reopening a task keeps its priority and returns it to the same column', () => {
  const h = harness([task('one', { priority: 'C', note: 'Retain the detail' })], { settings: { taskLayout: 'columns' } }); h.mount();
  h.host.querySelector('.task[data-id="one"] [data-act="check"]').fire('click'); h.drainTimers();
  assert.equal(h.tasks[0].done, true); assert.equal(h.model.priorityOf(h.tasks[0]), 'C');
  assert.equal(h.host.querySelector('.tasks-done .task').dataset.id, 'one');
  h.host.querySelector('.tasks-done .task [data-act="check"]').fire('click'); h.drainTimers();
  assert.equal(h.tasks[0].done, false); assert.equal(h.tasks[0].doneAt, 0);
  assert.equal(h.host.querySelector('.todo-column[data-priority="C"] .task').dataset.id, 'one');
  assert.equal(h.saved.get('list1').content.tasks[0].note, 'Retain the detail');
});

test('adding from a column uses its priority and the explicit urgent shortcut still selects High', () => {
  const h = harness([], { settings: { taskLayout: 'columns' } }); h.mount();
  h.host.querySelector('.todo-column[data-priority="C"] .todo-column-add').fire('click');
  const input = h.host.querySelector('.todo-input');
  input.value = 'Plan a future activity @fri'; input.fire('keydown', { key: 'Enter' });
  assert.equal(h.tasks[0].priority, 'C'); assert.equal(h.tasks[0].due, '2026-11-27');
  input.value = 'Important activity !'; input.fire('keydown', { key: 'Enter' });
  assert.equal(h.tasks[1].priority, 'A'); assert.equal(h.tasks[1].pri, 1);
  assert.equal(h.saved.get('list1').content.tasks.length, 2);
});

const layoutButton = (h, label) => h.host.querySelectorAll('button').find(button => button.textContent === label);
const pendingIds = h => h.host.querySelectorAll('.task').filter(row => !row.closest('.tasks-done')).map(row => row.dataset.id);

test('one-column mode is the default and preserves the original pending-task order without assigning priorities', () => {
  const h = harness([task('later', { priority: 'C' }), task('regular'), task('urgent', { pri: 1 }), task('done', { done: true, doneAt: 200 })]);
  const before = JSON.stringify(h.page);
  h.mount();
  assert.deepEqual(pendingIds(h), ['later', 'regular', 'urgent']);
  assert.equal(h.host.querySelectorAll('.todo-column').length, 0);
  assert.equal(layoutButton(h, '1 column').getAttribute('aria-pressed'), 'true');
  assert.equal(layoutButton(h, '3 columns').getAttribute('aria-pressed'), 'false');
  assert.equal(JSON.stringify(h.page), before);
  assert.deepEqual(h.touched, []); assert.equal(h.saved.size, 0); assert.deepEqual(h.settingWrites, []);
});

test('switching layouts changes only the saved view preference and restores one-column task order', () => {
  const h = harness([task('later', { priority: 'C', due: '2026-12-08', note: 'Keep notes' }), task('regular'), task('urgent', { pri: 1 })]);
  const before = JSON.stringify(h.page), records = h.tasks.slice();
  h.mount();
  layoutButton(h, '3 columns').fire('click');
  assert.deepEqual(h.host.querySelectorAll('.todo-column').map(column => column.querySelectorAll('.task').map(row => row.dataset.id)), [['urgent'], ['regular'], ['later']]);
  assert.equal(layoutButton(h, '3 columns').getAttribute('aria-pressed'), 'true');
  assert.equal(h.ZN.store.settings.taskLayout, 'columns');
  layoutButton(h, '1 column').fire('click');
  assert.deepEqual(pendingIds(h), ['later', 'regular', 'urgent']);
  assert.deepEqual(h.settingWrites, [['taskLayout', 'columns'], ['taskLayout', 'list']]);
  assert.equal(h.ZN.store.settings.taskLayout, 'list');
  assert.equal(JSON.stringify(h.page), before);
  assert.ok(h.tasks.every((record, index) => record === records[index]));
  assert.deepEqual(h.touched, []); assert.equal(h.saved.size, 0);
});

test('a saved three-column preference is read on a later view without touching task records', () => {
  const h = harness([task('regular'), task('urgent', { pri: 1 })], { settings: { taskLayout: 'columns' } });
  const before = JSON.stringify(h.page);
  const view = h.mount(); view.unmount();
  h.host.children = []; h.mount();
  assert.equal(h.host.querySelectorAll('.todo-column').length, 3);
  assert.equal(layoutButton(h, '3 columns').getAttribute('aria-pressed'), 'true');
  assert.equal(JSON.stringify(h.page), before); assert.deepEqual(h.touched, []); assert.equal(h.saved.size, 0);
});

test('collecting priorities across lists and note checkboxes is a read-only operation', () => {
  const note = { id: 'note2', type: 'note', title: 'Meeting note', parentId: 'book2', content: { blocks: [
    { id: 'same', t: 'todo', html: 'Read this later', checked: false, priority: 'C', custom: { retain: true } },
    { id: 'high', t: 'todo', html: 'Important note checkbox', checked: false, priority: 'A' },
    { id: 'para', t: 'p', html: 'Ordinary paragraph' }
  ] } };
  const h = harness([task('same', { pri: 1 }), task('regular')], { pages: [note] });
  const before = JSON.stringify(h.pages), items = h.model.collect();
  assert.deepEqual(Array.from(items, item => [item.key, item.priority]), [['list1:same', 'A'], ['list1:regular', 'B'], ['note2:same', 'C'], ['note2:high', 'A']]);
  assert.equal(items.find(item => item.key === 'note2:high').pri, 0, 'A note checkbox does not become a new flagged Today item just from grouping');
  assert.equal(JSON.stringify(h.pages), before); assert.deepEqual(h.touched, []); assert.equal(h.saved.size, 0);
});

test('a manual aggregate priority change targets its owning list even when task IDs repeat in other lists', () => {
  const otherTask = task('same', { note: 'Other list', priority: 'C' });
  const second = { id: 'list2', type: 'todo', title: 'Second list', parentId: 'book2', custom: 'Keep page', content: { tasks: [otherTask, task('next')] } };
  const local = task('same', { note: 'Original list', due: '2026-12-08' });
  const h = harness([local, task('after')], { pages: [second] });
  const firstBefore = JSON.stringify(h.page), secondBefore = JSON.parse(JSON.stringify(second));
  const order = second.content.tasks.slice();
  assert.equal(h.model.changeCollectedPriority('list2:same', 'A'), true);
  assert.equal(JSON.stringify(h.page), firstBefore);
  assert.ok(second.content.tasks.every((record, index) => record === order[index]));
  assert.equal(second.parentId, secondBefore.parentId); assert.equal(second.custom, secondBefore.custom);
  assert.deepEqual({ ...otherTask, priority: secondBefore.content.tasks[0].priority, pri: secondBefore.content.tasks[0].pri }, secondBefore.content.tasks[0]);
  assert.equal(otherTask.priority, 'A'); assert.equal(otherTask.pri, 1);
  assert.deepEqual(h.touched, ['list2']); assert.equal(h.saved.get('list2').content.tasks[0].priority, 'A'); assert.equal(h.saved.has('list1'), false);
});

test('manual note-checkbox priority changes preserve rich text, check state, sibling order and block metadata', () => {
  const block = { id: 'check', t: 'todo', html: '<b>Keep formatting</b>', checked: false, custom: { keep: true } };
  const note = { id: 'note2', type: 'note', title: 'Notes', parentId: 'book2', content: { blocks: [{ id: 'before', t: 'p', html: 'Before' }, block, { id: 'after', t: 'p', html: 'After' }] } };
  const h = harness([], { pages: [note] });
  const before = JSON.parse(JSON.stringify(note));
  assert.equal(h.model.changeCollectedPriority('note2:check', 'A'), true);
  assert.deepEqual({ ...block, priority: undefined }, { ...before.content.blocks[1], priority: undefined });
  assert.equal('pri' in block, false, 'Do not add an old to-do-list flag to a note block');
  assert.deepEqual(ids(note.content.blocks), ['before', 'check', 'after']);
  assert.equal(note.parentId, before.parentId); assert.equal(note.content.blocks[1], block);
  assert.deepEqual(h.touched, ['note2']); assert.equal(h.saved.get('note2').content.blocks[1].priority, 'A');
});

test('aggregate manual changes resolve the current record rather than a stale collected object', () => {
  const original = task('same', { note: 'Old copy' });
  const h = harness([original]);
  const stale = h.model.collect()[0];
  const fresh = task('same', { note: 'Newest synced copy', due: '2026-12-09' });
  h.page.content.tasks = [fresh];
  assert.equal(h.model.changeCollectedPriority(stale.key, 'C'), true);
  assert.equal(fresh.priority, 'C'); assert.equal(fresh.note, 'Newest synced copy'); assert.equal(fresh.due, '2026-12-09');
  assert.equal('priority' in original, false); assert.equal(original.note, 'Old copy');
  assert.deepEqual(h.touched, ['list1']);
});

test('missing, completed, invalid, unchanged and deleted aggregate targets never write task data', () => {
  const note = { id: 'note2', type: 'note', title: 'Notes', content: { blocks: [{ id: 'done', t: 'todo', html: 'Done checkbox', checked: true }] } };
  const h = harness([task('regular'), task('done', { done: true }), task('low', { priority: 'C' })], { pages: [note] });
  const before = JSON.stringify(h.pages);
  for (const [key, priority] of [['missing:regular', 'A'], ['list1:missing', 'A'], ['list1:done', 'A'], ['note2:done', 'A'], ['list1:regular', 'invalid'], ['list1:regular', 'B'], ['list1:low', 'C']]) {
    assert.equal(h.model.changeCollectedPriority(key, priority), false);
  }
  assert.equal(JSON.stringify(h.pages), before); assert.deepEqual(h.touched, []); assert.equal(h.saved.size, 0);
  h.page.trashed = 123;
  assert.equal(h.model.changeCollectedPriority('list1:regular', 'A'), false);
  assert.equal('priority' in h.tasks[0], false); assert.deepEqual(h.touched, []);
});
