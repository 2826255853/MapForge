import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocument, makeNode, History } from '../wwwroot/scene-model.js';
import { addCeilingGrid, normalizeCeilingGrids, resizeCeilingMask } from '../wwwroot/ceiling-traps.js';

const ceiling = () => { const n = makeNode('cube', 'roof'); n.static = true; n.collision = true; n.transform.scale = [4, .2, 4]; return n; };
test('quick creation adds one 4x4 underside mapping and repeated action reuses it', () => {
  const n = ceiling(), g = addCeilingGrid(n); assert.equal(g.columns, 4); assert.equal(g.rows, 4);
  assert.deepEqual(g.rotation, [Math.PI / 2, 0, 0]); assert.equal(addCeilingGrid(n), g); assert.equal(n.unity.ceilingTrapGrids.length, 1);
});
test('ceiling mapping and masks survive normalize/export/import, legacy maps stay readable', () => {
  const n = ceiling(); addCeilingGrid(n).openCells[5] = false;
  const doc = normalizeDocument({ version: 2, objects: [n] });
  const reloaded = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(reloaded.objects[0].unity.ceilingTrapGrids, doc.objects[0].unity.ceilingTrapGrids);
  assert.deepEqual(makeNode('cube', 'legacy').unity.ceilingTrapGrids, []);
});
test('mask resizing preserves coordinates and opens newly added cells', () => {
  const g = addCeilingGrid(ceiling()); g.openCells[5] = false; resizeCeilingMask(g, 6, 5);
  assert.equal(g.openCells[7], false); assert.equal(g.openCells[5], true); assert.equal(g.openCells.length, 30);
});
test('invalid IDs, sizes, nonfinite vectors and nonboolean masks fail', () => {
  for (const change of [{ id: '' }, { columns: 0 }, { rows: 1.5 }, { cellSize: 0 }, { openCells: [true] }, { autoFit: 'yes' }, { origin: [NaN, 0, 0] }])
    assert.throws(() => normalizeCeilingGrids([{ id: 'bottom', ...change }]));
  assert.throws(() => normalizeCeilingGrids([{ id: 'same' }, { id: 'same' }]));
});
test('dynamic, tilted and non-box supports are rejected', () => {
  const a = ceiling(); a.static = false; assert.throws(() => addCeilingGrid(a));
  const b = ceiling(); b.transform.rotation[0] = .5; assert.throws(() => addCeilingGrid(b));
  const c = ceiling(); c.unity.collider.type = 'sphere'; assert.throws(() => addCeilingGrid(c));
});
test('creation, mask editing and removal are reversible document snapshots', () => {
  const history = new History(), n = ceiling(), before = { document: normalizeDocument({ version: 2, objects: [n] }), selection: [] };
  addCeilingGrid(n); const after = { document: normalizeDocument({ version: 2, objects: [n] }), selection: ['roof'] };
  history.record(before, after); assert.deepEqual(history.undo(after), before); assert.deepEqual(history.redo(before), after);
});
