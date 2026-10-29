import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeDocument, makeNode } from '../wwwroot/scene-model.js';
import { addWallGrid, assertWallSupport, normalizeWallGrids, resizeWallMask } from '../wwwroot/wall-traps.js';

const wall = () => {
  const node = makeNode('cube', 'wall');
  node.static = true;
  node.collision = true;
  node.transform.scale = [4, 3, .2];
  return node;
};

test('wall quick setup adds a single centered front grid and reuses it', () => {
  const node = wall(), grid = addWallGrid(node);
  assert.equal(grid.columns, 4);
  assert.equal(grid.rows, 3);
  assert.deepEqual(grid.origin, [-.5, -.5, .5]);
  assert.deepEqual(grid.rotation, [0, 0, 0]);
  assert.equal(addWallGrid(node), grid);
  assert.equal(node.unity.wallTrapGrids.length, 1);
});

test('wall grids and masks survive normalize/export/import; legacy objects get an empty list', () => {
  const node = wall();
  addWallGrid(node).openCells[5] = false;
  const document = normalizeDocument({ version: 2, objects: [node] });
  const imported = normalizeDocument(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(imported.objects[0].unity.wallTrapGrids, document.objects[0].unity.wallTrapGrids);
  assert.deepEqual(makeNode('cube', 'legacy').unity.wallTrapGrids, []);
});

test('mask resizing preserves cells by row and column and opens new cells', () => {
  const grid = addWallGrid(wall());
  grid.openCells[5] = false;
  resizeWallMask(grid, 6, 5);
  assert.equal(grid.openCells[7], false);
  assert.equal(grid.openCells[5], true);
  assert.equal(grid.openCells.length, 30);
});

test('invalid dimensions, ids, vectors and masks are rejected', () => {
  for (const change of [
    { id: '' }, { columns: 0 }, { columns: 1.5 }, { rows: 257 }, { cellSize: 0 },
    { surfaceOffset: 11 }, { openCells: [true] }, { autoFit: 'yes' }, { origin: [0, Infinity, 0] },
  ]) assert.throws(() => normalizeWallGrids([{ id: 'front', ...change }]));
  assert.throws(() => normalizeWallGrids([{ id: 'front' }, { id: ' front ' }]));
});

test('dynamic, tilted, trigger and non-box wall supports are rejected', () => {
  const dynamic = wall(); dynamic.static = false;
  const tilted = wall(); tilted.transform.rotation[0] = .2;
  const trigger = wall(); trigger.unity.collider.isTrigger = true;
  const sphere = wall(); sphere.unity.collider.type = 'sphere';
  const plane = makeNode('plane', 'plane'); plane.static = true; plane.collision = true;
  for (const node of [dynamic, tilted, trigger, sphere, plane]) assert.throws(() => assertWallSupport(node));
});

test('the public schema describes wall grid dimensions and mask values', async () => {
  const schema = JSON.parse(await readFile(new URL('../map-format.schema.json', import.meta.url), 'utf8'));
  const grid = schema.$defs.unityMapping.properties.wallTrapGrids.items;
  assert.deepEqual(grid.required, ['id']);
  assert.equal(grid.properties.columns.minimum, 1);
  assert.equal(grid.properties.columns.maximum, 256);
  assert.equal(grid.properties.rows.minimum, 1);
  assert.equal(grid.properties.rows.maximum, 256);
  assert.equal(grid.properties.rows.default, 3);
  assert.equal(grid.properties.openCells.items.type, 'boolean');
});
