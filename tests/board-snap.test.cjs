'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ZN = { util: {}, store: {}, ui: {}, views: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/board.js'), 'utf8'), { window: { ZN } });
const snap = (...args) => JSON.parse(JSON.stringify(ZN.board.snapStickyMove(...args)));
const sticky = (id, x, y, w = 100, h = 100) => ({ id, kind: 'sticky', x, y, w, h });

test('nearby notes align their top edges and show a guide spanning both notes', () => {
  const result = snap([sticky('moving', 0, 0)], [sticky('next', 240, 100)], 100, 106, 1);
  assert.equal(result.dx, 100);
  assert.equal(result.dy, 100);
  assert.deepEqual(result.guides, [{ axis: 'y', value: 100, from: 100, to: 340, targetId: 'next' }]);
});

test('matching centres and bottom edges work with differently sized notes', () => {
  const centre = snap([sticky('moving', 0, 0, 80, 80)], [sticky('next', 200, 60, 100, 160)], 40, 104, 1);
  assert.equal(centre.dy, 100);
  assert.equal(centre.guides[0].value, 140);
  const bottom = snap([sticky('moving', 0, 0, 80, 80)], [sticky('next', 200, 60, 100, 160)], 40, 145, 1);
  assert.equal(bottom.dy, 140);
  assert.equal(bottom.guides[0].value, 220);
});

test('left, centre and right alignment work at negative board coordinates', () => {
  const source = [sticky('moving', 0, 0, 80, 80)], target = [sticky('next', -300, -50, 160, 100)];
  const left = snap(source, target, -294, 100, 1);
  const centre = snap(source, target, -256, 100, 1);
  const right = snap(source, target, -214, 100, 1);
  assert.equal(left.dx, -300); assert.equal(left.guides[0].value, -300);
  assert.equal(centre.dx, -260); assert.equal(centre.guides[0].value, -220);
  assert.equal(right.dx, -220); assert.equal(right.guides[0].value, -140);
});

test('capture tolerance remains eight screen pixels when zoomed in or out', () => {
  const source = [sticky('moving', 0, 0)], target = [sticky('next', 140, 100)];
  assert.equal(snap(source, target, 0, 104, 2).dy, 100);
  assert.equal(snap(source, target, 0, 104.1, 2).dy, 104.1);
  assert.equal(snap(source, target, 0, 116, 0.5).dy, 100);
  assert.equal(snap(source, target, 0, 116.1, 0.5).dy, 116.1);
});

test('the nearest qualifying sticky wins even when a farther alignment needs less correction', () => {
  const result = snap([sticky('moving', 0, 0)], [sticky('farther', 300, 105), sticky('nearer', 150, 100)], 0, 106, 1);
  assert.equal(result.dy, 100);
  assert.equal(result.guides[0].targetId, 'nearer');
});

test('distant notes do not attract a dragged note and neighbour range scales with zoom', () => {
  const moving = [sticky('moving', 0, 0)], targets = [sticky('far', 400, 100)];
  assert.deepEqual(snap(moving, targets, 0, 106, 1), { dx: 0, dy: 106, guides: [] });
  assert.equal(snap(moving, targets, 0, 106, 0.5).dy, 100);
  assert.deepEqual(snap(moving, [sticky('near', 240, 100)], 0, 103, 2), { dx: 0, dy: 103, guides: [] });
});

test('a group receives one rigid translation and ignores all of its own notes', () => {
  const a = sticky('a', 0, 0), b = sticky('b', 200, 50), target = sticky('next', 400, 150);
  const result = snap([a, b], [a, b, target], 50, 106, 1);
  assert.equal(result.dx, 50); assert.equal(result.dy, 100);
  assert.equal((b.y + result.dy) - (a.y + result.dy), 50);
  assert.equal(result.guides[0].targetId, 'next');
  assert.deepEqual(snap([a, b], [a, b], 4, 4, 1), { dx: 4, dy: 4, guides: [] });
});

test('non-sticky objects cannot attract a note or act as a moving anchor', () => {
  const shape = { ...sticky('shape', 150, 100), kind: 'shape' };
  assert.deepEqual(snap([sticky('moving', 0, 0)], [shape], 0, 106, 1), { dx: 0, dy: 106, guides: [] });
  assert.deepEqual(snap([shape], [sticky('next', 150, 100)], 4, 4, 1), { dx: 4, dy: 4, guides: [] });
});

test('axis constraint leaves the locked coordinate untouched', () => {
  const moving = [sticky('moving', 0, 0)], target = [sticky('next', 100, 100)];
  const x = snap(moving, target, 104, 106, 1, { axis: 'x' });
  const y = snap(moving, target, 104, 106, 1, { axis: 'y' });
  assert.equal(x.dx, 100); assert.equal(x.dy, 106); assert.equal(x.guides.length, 1);
  assert.equal(y.dx, 104); assert.equal(y.dy, 100); assert.equal(y.guides.length, 1);
});

test('temporary bypass preserves free movement with no guides', () => {
  assert.deepEqual(snap([sticky('moving', 0, 0)], [sticky('next', 100, 100)], 104, 106, 1, { disabled: true }),
    { dx: 104, dy: 106, guides: [] });
});

test('both guides use the final snapped coordinates', () => {
  const result = snap([sticky('moving', 0, 0)], [sticky('next', 100, 100)], 104, 106, 1);
  assert.equal(result.dx, 100); assert.equal(result.dy, 100);
  assert.deepEqual(result.guides, [
    { axis: 'x', value: 100, from: 100, to: 200, targetId: 'next' },
    { axis: 'y', value: 100, from: 100, to: 200, targetId: 'next' }
  ]);
});

test('alignment reads frozen snapshots without changing content, order or geometry', () => {
  const moving = Object.freeze([Object.freeze({ ...sticky('moving', 0, 0), text: '<b>Keep me</b>', color: 'pink' })]);
  const targets = Object.freeze([Object.freeze(sticky('next', 150, 100))]);
  const before = JSON.stringify({ moving, targets });
  assert.equal(snap(moving, targets, 0, 106, 1).dy, 100);
  assert.equal(JSON.stringify({ moving, targets }), before);
});

test('ties are deterministic regardless of the stationary item array order', () => {
  const a = sticky('a', 150, 100), b = sticky('b', 150, 100), moving = [sticky('moving', 0, 0)];
  assert.deepEqual(snap(moving, [a, b], 0, 106, 1), snap(moving, [b, a], 0, 106, 1));
  assert.equal(snap(moving, [b, a], 0, 106, 1).guides[0].targetId, 'a');
});
