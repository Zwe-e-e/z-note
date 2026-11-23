'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type, props = {}) {
    const e = Object.assign({ type, button: 0, pointerId: 1, isPrimary: true, clientX: 20, clientY: 90,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }, props);
    for (const fn of [...(this.listeners.get(type) || [])]) fn(e);
    return e;
  }
  count(type) { return this.listeners.get(type)?.size || 0; }
}
class Element extends Events {
  constructor(classes, rect = [0, 0, 900, 600]) {
    super(); this.classes = new Set(classes.split('.').filter(Boolean)); this.children = []; this.parent = null;
    this.style = {}; this.hidden = false; this.offsetParent = {}; this.scrollTop = 100;
    this.rect = { left: rect[0], top: rect[1], right: rect[0] + rect[2], bottom: rect[1] + rect[3], width: rect[2], height: rect[3] };
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name) };
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  contains(el) { for (; el; el = el.parent) if (el === this) return true; return false; }
  closest(sel) { for (let el = this; el; el = el.parent) if (el.classes.has(sel.slice(1))) return el; return null; }
  querySelectorAll(sel) { return this.children.flatMap(el => [...(el.classes.has(sel.slice(1)) ? [el] : []), ...el.querySelectorAll(sel)]); }
  getBoundingClientRect() { return this.rect; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
}

function harness() {
  const document = new Events(), windowEvents = new Events(), layer = new Element('layer'), timers = new Map();
  let timerId = 0;
  document.body = new Element('body'); document.getElementById = id => id === 'layer' ? layer : null;
  const ZN = { util: { h: selector => new Element(selector.split('.').slice(1).join('.')) } };
  const context = { ZN, document, console, setTimeout, clearTimeout,
    setInterval: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id),
    addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents) };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/ui.js'), 'utf8'), context);
  const board = new Element('board'), scroller = new Element('scroller');
  const a = board.appendChild(new Element('todo-column', [0, 0, 280, 600]));
  const b = board.appendChild(new Element('todo-column', [300, 0, 280, 600]));
  const c = board.appendChild(new Element('todo-column', [600, 0, 280, 600]));
  const task = (column, top) => { const item = column.appendChild(new Element('task', [column.rect.left + 10, top, 260, 60])); item.grip = item.appendChild(new Element('task-grip')); return item; };
  const a1 = task(a, 80), a2 = task(a, 180), b1 = task(b, 80), b2 = task(b, 180), drops = [];
  const cleanup = ZN.ui.dragColumns({ container: board, column: '.todo-column', item: '.task', handle: '.task-grip', scroller,
    onDrop: (item, before, column) => drops.push({ item, before, column }) });
  const start = () => board.dispatch('pointerdown', { target: a1.grip });
  const move = (x, y, extra) => document.dispatch('pointermove', Object.assign({ clientX: x, clientY: y }, extra));
  const up = (x, y, extra) => document.dispatch('pointerup', Object.assign({ clientX: x, clientY: y }, extra));
  const clean = () => {
    assert.equal(document.count('pointermove'), 0); assert.equal(document.count('pointerup'), 0); assert.equal(document.count('pointercancel'), 0);
    assert.equal(document.count('keydown'), 1); // Existing tooltip listener is retained.
    assert.equal(windowEvents.count('blur'), 0); assert.equal(timers.size, 0); assert.equal(layer.children.length, 0);
    assert.equal(document.body.classList.contains('is-dragging'), false); assert.equal(a1.classList.contains('dragging'), false);
    for (const col of [a, b, c]) assert.equal(col.classList.contains('drop-target'), false);
  };
  return { document, windowEvents, board, scroller, layer, timers, a, b, c, a1, a2, b1, b2, drops, cleanup, start, move, up, clean };
}

test('cross-column drag previews insertion and commits only on release without mutating DOM order', () => {
  const h = harness(); h.start(); h.move(350, 150);
  assert.equal(h.b.classList.contains('drop-target'), true); assert.equal(h.a1.classList.contains('dragging'), true);
  assert.equal(h.layer.children[0].style.top, '179px'); assert.equal(h.drops.length, 0);
  assert.equal(h.a.children[0], h.a1); assert.equal(h.b.children[0], h.b1);
  h.up(350, 150);
  assert.deepEqual(h.drops, [{ item: h.a1, before: h.b2, column: h.b }]); h.clean();
});

test('empty columns and column headings accept a task', () => {
  const h = harness(); h.start(); h.move(650, 30); h.up(650, 30);
  assert.deepEqual(h.drops, [{ item: h.a1, before: null, column: h.c }]); h.clean();
  h.start(); h.move(350, 20); h.up(350, 20);
  assert.deepEqual(h.drops[1], { item: h.a1, before: h.b1, column: h.b }); h.clean();
});

test('same-column reorder excludes the dragged task and accepts an end position', () => {
  const h = harness(); h.start(); h.move(70, 500); h.up(70, 500);
  assert.deepEqual(h.drops, [{ item: h.a1, before: null, column: h.a }]); h.clean();
});

test('a click or a drop outside the board does not change tasks', () => {
  const h = harness(); h.start(); h.move(22, 92); h.up(22, 92); assert.equal(h.drops.length, 0); h.clean();
  h.start(); h.move(350, 100); h.up(950, 100); assert.equal(h.drops.length, 0); h.clean();
  h.start(); h.move(350, 100); h.move(295, 100); assert.equal(h.layer.children[0].hidden, true);
  h.up(295, 100); assert.equal(h.drops.length, 0); h.clean();
});

test('unrelated pointers cannot move, cancel or complete the active drag', () => {
  const h = harness(); h.start(); h.move(650, 100, { pointerId: 2 }); assert.equal(h.layer.children.length, 0);
  h.move(350, 150); h.document.dispatch('pointercancel', { pointerId: 2 }); h.up(650, 100, { pointerId: 2 });
  assert.equal(h.drops.length, 0); assert.equal(h.b.classList.contains('drop-target'), true);
  h.up(350, 150); assert.equal(h.drops[0].column, h.b); h.clean();
});

test('Escape, pointer cancellation and window blur remove all drag state', () => {
  const h = harness();
  for (const cancel of [() => h.document.dispatch('keydown', { key: 'Escape' }), () => h.document.dispatch('pointercancel'), () => h.windowEvents.dispatch('blur')]) {
    h.start(); h.move(350, 590); assert.equal(h.timers.size, 1); cancel(); h.clean();
    h.up(350, 590); assert.equal(h.drops.length, 0);
  }
});

test('unmount cancels an active drag and removes the container handler', () => {
  const h = harness(); h.start(); h.move(650, 200); h.cleanup(); h.clean();
  assert.equal(h.board.count('pointerdown'), 0); h.up(650, 200); assert.equal(h.drops.length, 0);
});

test('auto-scroll updates geometry and stops once a drag ends', () => {
  const h = harness(); h.start(); h.move(650, 590);
  for (const fn of h.timers.values()) fn();
  assert.equal(h.scroller.scrollTop, 114); h.up(650, 590); h.clean();
});

test('removed source tasks and content clipped by the scroller cannot be dropped', () => {
  const h = harness(); h.start(); h.move(350, 100); h.a1.remove(); h.up(350, 100);
  assert.equal(h.drops.length, 0); h.clean();
  h.a.appendChild(h.a1); h.scroller.rect.bottom = 400; h.start(); h.move(650, 500); h.up(650, 500);
  assert.equal(h.drops.length, 0); h.clean();
});
