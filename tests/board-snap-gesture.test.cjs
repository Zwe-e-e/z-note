'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/js/board.js'), 'utf8');
const ZN = { util: {}, store: {}, ui: {}, views: {} };
vm.runInNewContext(source, { window: { ZN } });
const copy = value => JSON.parse(JSON.stringify(value));
const sticky = (id, x, y) => ({ id, kind: 'sticky', x, y, w: 100, h: 100, text: id, color: 'yellow' });

// Exercise the actual gesture and movement/copy routines without mounting board furniture.
// Painting, storage and selection UI are the only effects replaced by observable stubs.
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'board routine boundaries must exist');
  return source.slice(from, to);
}
const routines = [
  section('  function sanitize(', '  function textOf('),
  section('    function payload(', '    function pasteItems('),
  section('    const centreIn =', '    function nudge('),
  section('    function moveGesture(', '    function inMarquee(')
].join('\n');

function harness(records, selected = ['moving'], zoom = 1) {
  const items = copy(records), trace = { commits: [], lines: [], paints: 0, overlays: 0, clears: 0, selections: 0 };
  let uid = 0;
  const context = {
    items, sel: new Set(selected), view: { k: zoom }, snapGuides: [],
    snapStickyMove: ZN.board.snapStickyMove,
    KINDS: { sticky: 1, text: 1, shape: 1, frame: 1, image: 1, ink: 1, line: 1 },
    ATTACH: { sticky: 1, text: 1, shape: 1, image: 1 },
    num: (n, fallback) => typeof n === 'number' && isFinite(n) ? n : fallback,
    f1: n => Math.round(n * 10) / 10,
    U: { uid: () => 'copy-' + (++uid), text: text => text },
    get: id => items.find(item => item.id === id),
    selItems: () => items.filter(item => context.sel.has(item.id)),
    addMany: added => { items.push(...added); return added; },
    nudgeEl: () => trace.paints++,
    paintLines: ids => trace.lines.push([...ids]),
    layoutOverlay: () => trace.overlays++,
    commit: () => trace.commits.push(copy(items)),
    afterSel: () => trace.selections++,
    clearSnapGuides: () => { context.snapGuides = []; trace.clears++; },
    select: ids => { context.sel = new Set(ids); },
    clicked: () => false,
    onDouble: () => { throw new Error('unexpected double-click'); }
  };
  vm.createContext(context);
  vm.runInContext(routines, context);
  const hit = context.get(selected[0]);
  const gesture = context.moveGesture({}, { sx: 0, sy: 0 }, hit, true);
  const move = (sx, sy, modifiers = {}) => gesture.move({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers }, { sx, sy });
  return { items, trace, context, move, end: (cancelled = false) => gesture.end({}, { sx: 0, sy: 0 }, cancelled),
    guides: () => copy(context.snapGuides), get: context.get };
}

test('a click or movement below the drag threshold never shifts or saves notes', () => {
  const h = harness([sticky('moving', 0, 0), sticky('next', 240, 100)]), before = copy(h.items);
  h.move(2, 2); h.end();
  assert.deepEqual(h.items, before);
  assert.equal(h.trace.paints, 0); assert.equal(h.trace.commits.length, 0);
  assert.deepEqual(h.guides(), []);
});

test('snapped movement commits only on release and clears its temporary guides', () => {
  const h = harness([sticky('moving', 0, 0), sticky('next', 240, 100)]);
  h.move(100, 106);
  assert.deepEqual([h.get('moving').x, h.get('moving').y], [100, 100]);
  assert.equal(h.guides()[0].targetId, 'next');
  assert.equal(h.trace.commits.length, 0);
  h.move(100, 103); h.end();
  assert.equal(h.trace.commits.length, 1);
  assert.equal(h.trace.commits[0][0].y, 100);
  assert.equal(h.trace.selections, 1);
  assert.deepEqual(h.guides(), []);
  assert.deepEqual(h.get('next'), sticky('next', 240, 100));
});

test('moving away recomputes from the original grab position without accumulating snap offsets', () => {
  const h = harness([sticky('moving', 0, 0), sticky('next', 240, 100)]);
  h.move(100, 106); h.move(113, 119);
  assert.deepEqual([h.get('moving').x, h.get('moving').y], [113, 119]);
  assert.deepEqual(h.guides(), []);
  h.move(100, 104);
  assert.deepEqual([h.get('moving').x, h.get('moving').y], [100, 100]);
  assert.equal(h.trace.commits.length, 0);
});

test('a selection moves rigidly and redraws attached connectors without changing their attachments', () => {
  const line = { id: 'link', kind: 'line', x: 0, y: 0, w: 1, h: 1, a: { id: 'moving' }, b: { x: 40, y: 30 } };
  const h = harness([sticky('moving', 0, 0), sticky('companion', -200, 40), sticky('next', 240, 100), line], ['moving', 'companion', 'link']);
  h.move(100, 106);
  assert.deepEqual([h.get('moving').x, h.get('moving').y], [100, 100]);
  assert.deepEqual([h.get('companion').x, h.get('companion').y], [-100, 140]);
  assert.deepEqual(h.get('link').a, { id: 'moving' });
  assert.deepEqual(h.get('link').b, { x: 140, y: 130 });
  assert.deepEqual(h.trace.lines[0], ['link']);
  assert.equal(h.guides()[0].targetId, 'next');
});

test('moving a frame carries contained notes with the same snapped delta', () => {
  const frame = { id: 'frame', kind: 'frame', x: -10, y: -10, w: 120, h: 120, title: 'Group' };
  const h = harness([frame, sticky('moving', 0, 0), sticky('next', 240, 100)], ['frame']);
  h.move(100, 106);
  assert.deepEqual([h.get('frame').x, h.get('frame').y], [90, 90]);
  assert.deepEqual([h.get('moving').x, h.get('moving').y], [100, 100]);
  assert.deepEqual(h.get('next'), sticky('next', 240, 100));
});

test('Ctrl and Command temporarily bypass capture and remove guides while dragging', () => {
  for (const key of ['ctrlKey', 'metaKey']) {
    const h = harness([sticky('moving', 0, 0), sticky('next', 240, 100)]);
    h.move(100, 106);
    assert.equal(h.get('moving').y, 100);
    h.move(100, 106, { [key]: true });
    assert.equal(h.get('moving').y, 106); assert.deepEqual(h.guides(), []);
    h.move(100, 106);
    assert.equal(h.get('moving').y, 100);
  }
});

test('Shift constrains the drag axis before alignment so snapping cannot unlock it', () => {
  const h = harness([sticky('moving', 0, 0), sticky('next', 100, 5)]);
  h.move(20, 20, { ctrlKey: true }); // establish a drag before pressing Shift
  h.move(104, 6, { shiftKey: true });
  assert.deepEqual([h.get('moving').x, h.get('moving').y], [100, 0]);
  assert.deepEqual(h.guides().map(g => g.axis), ['x']);
  h.move(6, 104, { shiftKey: true });
  assert.equal(h.get('moving').x, 0);
});

test('Alt-drag snaps only fresh copies while the originals remain fixed', () => {
  const original = sticky('moving', 0, 0);
  const h = harness([original]);
  h.move(150, 6, { altKey: true });
  const duplicate = h.items.find(item => item.id !== 'moving');
  assert.ok(duplicate); assert.deepEqual(h.get('moving'), original);
  assert.deepEqual([duplicate.x, duplicate.y], [150, 0]);
  assert.equal(h.guides()[0].targetId, 'moving');
  h.move(160, 6, { altKey: true });
  assert.equal(h.items.length, 2); // one copy per gesture
  assert.deepEqual([duplicate.x, duplicate.y], [160, 0]);
  h.end(); assert.equal(h.trace.commits.length, 1);
});

test('screen coordinates convert once at non-default zoom and cancellation removes guides', () => {
  const h = harness([sticky('moving', 0, 0), sticky('next', 240, 100)], ['moving'], 2);
  h.move(200, 208);
  assert.deepEqual([h.get('moving').x, h.get('moving').y], [100, 100]);
  h.end(true);
  assert.deepEqual(h.guides(), []);
  assert.equal(h.trace.commits.length, 1); // preserves the board's existing cancellation semantics
});
