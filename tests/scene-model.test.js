import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocument, makeNode, descendants, rootsOf, effectiveState, assertEditable, searchHierarchy, History,
  UNITY_COLLIDER_TYPES, UNITY_NAV_ROLES, UNITY_PATH_ROLES, UNITY_TRIGGER_SHAPES, UNITY_PREFAB_KINDS, UNITY_COLLECT_OBJECTS,
  defaultUnityMapping, defaultUnityScene, normalizeUnityMapping, normalizeUnityScene, unitySummary, unityStats } from '../wwwroot/scene-model.js';

const scene = () => normalizeDocument({ version: 2, name: '组织测试', gameplay: { spawns: [{ id: 'spawn_1' }] }, objects: [
  { type: 'folder', id: 'env', name: 'Environment' },
  { type: 'group', id: 'roads', name: 'Roads', parentId: 'env' },
  { type: 'cube', id: 'road', name: 'Main Road', parentId: 'roads', tags: ['walkable', 'route'], color: '#ff1122', layer: 8, collision: false, static: true, prefabType: 'RoadTile', parameters: { speed: 2, enabled: true, waves: [1, 2] } },
  { type: 'sphere', id: 'spawn', name: 'SpawnPoint', category: 'waypoint' },
] });
test('documents without the current version marker are rejected instead of migrated', () => {
  for (const source of [
    { objects: [{ id: 'obj_7', type: 'cube', transform: { rotation: [0, Math.PI / 2, 0] } }], gameplay: { core: { position: [1, 2, 3] } }, roadsideSteps: [{ platformId: 'obj_7' }] },
    { version: 1, objects: [{ id: 'obj_7', type: 'cube' }] },
    { version: '2', objects: [] }, { version: null, objects: [] }, { version: true, objects: [] },
  ]) assert.throws(() => normalizeDocument(source), /不支持的地图版本。/, JSON.stringify(source));
  // The current format still fills in the per-object defaults the editor relies on.
  const doc = normalizeDocument({ version: 2, objects: [{ id: 'obj_7', type: 'cube', transform: { rotation: [0, Math.PI / 2, 0] } }], gameplay: { core: { position: [1, 2, 3] } } });
  assert.equal(doc.objects[0].name, 'obj_7'); assert.equal(doc.objects[0].parentId, null);
  assert.equal(doc.objects[0].collision, true); assert.equal(doc.objects[0].locked, false); assert.equal(doc.objects[0].transform.rotation[1], Math.PI / 2);
  assert.deepEqual(doc.gameplay, { core: { position: [1, 2, 3] } });
});
test('v2 uses a stable top-level envelope and preserves extension fields', () => {
  const doc = normalizeDocument({ version: 2, name: 'Three Branch Map', settings: { gridSize: 0.5, unit: 'meter', snap: true }, objects: [], groups: [{ id: 'roads' }], gameplay: { rules: { score: 10 } }, editorExtension: { theme: 'dark' } });
  assert.deepEqual(doc.settings, { gridSize: 0.5, unit: 'meter', snap: true });
  assert.deepEqual(doc.groups, [{ id: 'roads' }]); assert.deepEqual(doc.gameplay, { rules: { score: 10 } });
  assert.deepEqual(doc.editorExtension, { theme: 'dark' });
  assert.deepEqual(normalizeDocument({ version: 2, objects: [] }).settings, { gridSize: 1, unit: 'meter' });
  for (const source of [{ version: 3, objects: [] }, { version: 2, settings: { gridSize: 0 }, objects: [] }, { version: 2, settings: { gridSize: null }, objects: [] }, { version: 2, settings: { unit: 'feet' }, objects: [] }, { version: 2, settings: { unit: null }, objects: [] }, { version: 2, settings: null, objects: [] }, { version: 2, groups: {}, objects: [] }, { version: 2, gameplay: [], objects: [] }, { version: 2, gameplay: null, objects: [] }]) assert.throws(() => normalizeDocument(source));
});
test('JSON roundtrip preserves organization, all attributes, and Unity parameter bridge', () => {
  const doc = scene(), imported = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(imported, doc); assert.deepEqual(JSON.parse(imported.objects[2].parametersJson), imported.objects[2].parameters);
  assert.equal(makeNode('folder', 'f').collision, false);
});
test('invalid parent references, cycles and duplicate stable IDs are rejected', () => {
  for (const mutate of [d => d.objects[0].parentId = 'road', d => d.objects[2].parentId = 'missing', d => d.objects[2].id = 'env']) {
    const doc = scene(); mutate(doc); assert.throws(() => normalizeDocument(doc));
  }
});
test('bad values cannot silently replace a valid scene', () => {
  for (const patch of [{ transform: { scale: [1, 0, 1] } }, { transform: { position: [Infinity, 0, 0] } }, { transform: { position: [1, 2] } }, { color: '<img>' }, { tags: [1] }, { layer: 32 }, { layer: 1.5 }, { visible: 'false' }, { material: { roughness: -1 } }, { parameters: [] }, { category: 'unknown' }]) {
    assert.throws(() => normalizeDocument({ version: 2, objects: [{ type: 'cube', id: 'a', ...patch }] }));
  }
  assert.throws(() => normalizeDocument({ version: 2, objects: null }));
});
test('locked descendants prevent indirect transformations and deletion', () => {
  const doc = scene(); doc.objects[2].locked = true;
  assert.throws(() => assertEditable(doc, ['roads'], true));
  assert.doesNotThrow(() => assertEditable(doc, ['roads']));
  doc.objects[0].locked = true; assert.equal(effectiveState(doc).get('road').locked, true); assert.throws(() => assertEditable(doc, ['road']));
});
test('parent visibility is inherited without overwriting child flags', () => {
  const doc = scene(); doc.objects[0].visible = false;
  assert.equal(effectiveState(doc).get('road').visible, false); assert.equal(doc.objects[2].visible, true);
  doc.objects[0].visible = true; assert.equal(effectiveState(doc).get('road').visible, true);
});
test('search combines name, type and tags, and retains ancestor context', () => {
  const doc = scene(), result = searchHierarchy(doc, 'MAIN walkable', 'cube');
  assert.deepEqual([...result.matches], ['road']); assert.deepEqual([...result.included].sort(), ['env', 'road', 'roads']);
  assert.equal(searchHierarchy(doc, 'sphere').matches.has('spawn'), true); assert.equal(searchHierarchy(doc, 'walkable', 'sphere').matches.size, 0);
  assert.deepEqual([...searchHierarchy(doc, '立方体').matches], ['road']);
});
test('subtree operations do not duplicate nested selections', () => {
  const doc = scene(); assert.deepEqual(rootsOf(doc, ['env', 'roads', 'road', 'spawn']), ['env', 'spawn']);
  assert.deepEqual([...descendants(doc, ['roads'])].sort(), ['road', 'roads']);
});
test('history restores a deleted hierarchy and properties; edits invalidate redo', () => {
  const history = new History(), before = { document: scene(), selection: ['env'] }, after = structuredClone(before);
  after.document.objects = after.document.objects.filter(o => o.id === 'spawn'); after.selection = [];
  assert.equal(history.record(before, after), true); assert.deepEqual(history.undo(after), before); assert.deepEqual(history.redo(before), after);
  history.undo(after); const renamed = structuredClone(before); renamed.document.objects[0].name = 'New'; history.record(before, renamed); assert.equal(history.redo(renamed), null);
  assert.equal(history.record(renamed, renamed), false);
});
const unityScene = () => ({
  version: 2,
  unity: {
    prefabs: [
      { id: 'enemy_ground', name: 'Ground Bug', kind: 'enemy', assetPath: 'Assets/Prefabs/TestMonster.prefab', guid: 'a1' },
      { id: 'turret', name: 'Auto Sentry', kind: 'tower', assetPath: 'Assets/Prefabs/AutoSentryTurret.prefab' },
    ],
    waves: { totalWaves: 5, initialDelay: 3, enemiesPerWave: 12, spawnInterval: 0.75, transitionDelays: [4, 4, 6] },
    settings: { buildNavMeshOnImport: true, agentType: 'Humanoid', collectObjects: 'volume' },
  },
  objects: [
    { type: 'folder', id: 'env', name: 'Environment' },
    { type: 'cube', id: 'road', name: 'Main Road', parentId: 'env', unity: {
      prefab: { id: 'turret', assetPath: 'Assets/Prefabs/AutoSentryTurret.prefab' },
      collider: { type: 'box', isTrigger: false, center: [0, 0.5, 0], size: [4, 1, 4] },
      navMesh: { role: 'walkable', area: 0, agentType: 'Humanoid' },
    } },
    { type: 'sphere', id: 'gate', name: 'North Gate', parentId: 'env', unity: {
      prefab: { id: 'enemy_ground' },
      navMesh: { role: 'link', linkStart: [0, 0, 0], linkEnd: [2, 0, 0], linkWidth: 1.5, bidirectional: false },
    } },
    { type: 'cylinder', id: 'core', name: 'Enemy Core', unity: { enemyCore: { enabled: true, maxHealth: 45, arrivalRadius: 0.5 } } },
    { type: 'sphere', id: 'spawn_a', name: 'Spawn A', unity: { spawnPoint: { enabled: true, laneId: 'lane_0', enemyPrefabId: 'enemy_ground', monsterType: 'Flying', flightHeight: 5, flyingEntrance: true, waves: [{ enemyCount: 4 }, { enabled: false, enemyCount: 2, monsterType: 'Flying', flightHeight: 8 }] } } },
    { type: 'cube', id: 'node_1', name: 'Node 1', parentId: 'gate', unity: { pathNode: { enabled: true, role: 'junction', waitTime: 1.5, links: ['node_2', 'node_3'] } } },
    { type: 'cube', id: 'node_2', name: 'Node 2', parentId: 'gate' },
    { type: 'cube', id: 'node_3', name: 'Node 3', parentId: 'gate' },
    { type: 'cube', id: 'zone', name: 'Goal Zone', unity: { trigger: { enabled: true, shape: 'sphere', radius: 3, events: [{ when: 'enter', action: 'goal', message: 'win', amount: 2, delay: 0.5 }] } } },
  ],
});
test('Unity mapping defaults mirror the Unity component defaults', () => {
  const mapping = defaultUnityMapping(), scene = defaultUnityScene();
  assert.equal(mapping.collider.type, 'auto'); assert.deepEqual(mapping.collider.size, [1, 1, 1]); assert.equal(mapping.navMesh.role, 'none');
  assert.equal(mapping.spawnPoint.enabled, false); assert.deepEqual(mapping.spawnPoint.waves, []);
  assert.equal(mapping.enemyCore.enabled, false); assert.equal(mapping.pathNode.role, 'node'); assert.deepEqual(mapping.trigger.events, []);
  assert.deepEqual(scene.prefabs, []); assert.equal(scene.waves.totalWaves, 3); assert.equal(scene.settings.buildNavMeshOnImport, false);
  const doc = normalizeDocument({ version: 2, objects: [{ type: 'cube', id: 'a' }] });
  assert.deepEqual(doc.objects[0].unity, defaultUnityMapping()); assert.deepEqual(doc.unity, defaultUnityScene());
  assert.equal(UNITY_COLLIDER_TYPES.includes(mapping.collider.type), true); assert.equal(UNITY_NAV_ROLES.includes('link'), true);
  assert.equal(UNITY_PATH_ROLES.includes('end'), true); assert.deepEqual(UNITY_TRIGGER_SHAPES, ['box', 'sphere']);
  assert.equal(UNITY_PREFAB_KINDS.includes('trap'), true); assert.equal(UNITY_COLLECT_OBJECTS.includes('markedWithModifier'), true);
  assert.deepEqual(normalizeUnityMapping(undefined, 'a', () => { throw new Error('unused'); }), defaultUnityMapping());
  assert.deepEqual(normalizeUnityScene(null, () => { throw new Error('unused'); }), defaultUnityScene());
});
test('Unity mapping normalizes partial input, prefab library and wave configuration', () => {
  const doc = normalizeDocument(unityScene());
  const road = doc.objects.find(o => o.id === 'road'), gate = doc.objects.find(o => o.id === 'gate'), spawn = doc.objects.find(o => o.id === 'spawn_a');
  assert.deepEqual(road.unity.prefab, { id: 'turret', guid: '', assetPath: 'Assets/Prefabs/AutoSentryTurret.prefab' });
  assert.equal(road.unity.collider.isTrigger, false); assert.equal(road.unity.collider.radius, 0.5); assert.deepEqual(road.unity.collider.center, [0, 0.5, 0]);
  assert.equal(road.unity.navMesh.ignoreFromBuild, false); assert.equal(road.unity.navMesh.linkWidth, 1); assert.equal(gate.unity.navMesh.bidirectional, false);
  assert.equal(doc.unity.prefabs[0].name, 'Ground Bug'); assert.equal(doc.unity.prefabs[1].kind, 'tower');
  assert.deepEqual(doc.unity.waves, { totalWaves: 5, initialDelay: 3, enemiesPerWave: 12, spawnInterval: 0.75, transitionDelays: [4, 4, 6] });
  assert.deepEqual(doc.unity.settings, { buildNavMeshOnImport: true, agentType: 'Humanoid', collectObjects: 'volume' });
  assert.deepEqual(spawn.unity.spawnPoint.waves, [{ enabled: true, enemyCount: 4, monsterType: '', flightHeight: 3 }, { enabled: false, enemyCount: 2, monsterType: 'Flying', flightHeight: 8 }]);
  assert.equal(spawn.unity.spawnPoint.travelDirection[2], 1); assert.equal(spawn.unity.spawnPoint.initialDelay, 2); assert.equal(spawn.unity.spawnPoint.moveSpeed, 2);
  const zone = doc.objects.find(o => o.id === 'zone');
  assert.deepEqual(zone.unity.trigger.events, [{ when: 'enter', action: 'goal', target: '', message: 'win', amount: 2, delay: 0.5 }]);
  assert.equal(zone.unity.trigger.once, false); assert.deepEqual(zone.unity.trigger.size, [1, 2, 1]);
  assert.equal(doc.objects.find(o => o.id === 'core').unity.enemyCore.maxHealth, 45);
  assert.deepEqual(doc.objects.find(o => o.id === 'node_1').unity.pathNode.links, ['node_2', 'node_3']);
});
test('Unity mapping rejects invalid enums, ids, links and ranges', () => {
  const object = unity => ({ version: 2, objects: [{ type: 'cube', id: 'a', ...(unity === undefined ? {} : { unity }) }] });
  const rejects = [
    unity => { unity.collider = { type: 'capsuleX' }; }, unity => { unity.collider = { type: 'box', radius: 0 }; },
    unity => { unity.collider = { center: [0, 0] }; }, unity => { unity.collider = { size: [1, 0, 1] }; },
    unity => { unity.collider = { direction: 3 }; }, unity => { unity.collider = { isTrigger: 'yes' }; },
    unity => { unity.navMesh = { role: 'walk' }; }, unity => { unity.navMesh = { area: 32 }; }, unity => { unity.navMesh = { area: 1.5 }; },
    unity => { unity.navMesh = { linkWidth: 0 }; }, unity => { unity.navMesh = { linkStart: [0, 0, 0, 0] }; },
    unity => { unity.spawnPoint = { spawnInterval: 0 }; }, unity => { unity.spawnPoint = { initialDelay: 601 }; },
    unity => { unity.spawnPoint = { enemiesPerWave: 2.5 }; }, unity => { unity.spawnPoint = { moveSpeed: 101 }; },
    unity => { unity.spawnPoint = { monsterType: 'Ghost' }; }, unity => { unity.spawnPoint = { flightHeight: 201 }; },
    unity => { unity.spawnPoint = { entranceAltitude: -1 }; }, unity => { unity.spawnPoint = { laneId: 7 }; },
    unity => { unity.spawnPoint = { waves: [null] }; }, unity => { unity.spawnPoint = { waves: [{ enemyCount: 1000 }] }; },
    unity => { unity.spawnPoint = { waves: [{ monsterType: 'Ground ' }] }; },
    unity => { unity.enemyCore = { maxHealth: 0 }; }, unity => { unity.enemyCore = { groundDamage: -1 }; },
    unity => { unity.enemyCore = { flyingDamage: 1e7 }; }, unity => { unity.enemyCore = { arrivalRadius: 0 }; },
    unity => { unity.pathNode = { role: 'crossing' }; }, unity => { unity.pathNode = { waitTime: 601 }; }, unity => { unity.pathNode = { links: [1] }; },
    unity => { unity.trigger = { shape: 'capsule' }; }, unity => { unity.trigger = { radius: 0 }; }, unity => { unity.trigger = { size: [1, 1, 0] }; },
    unity => { unity.trigger = { events: [null] }; }, unity => { unity.trigger = { events: [{ when: 'stay' }] }; },
    unity => { unity.trigger = { events: [{ action: 'explode' }] }; }, unity => { unity.trigger = { events: [{ amount: -1 }] }; },
    unity => { unity.trigger = { events: [{ delay: 601 }] }; }, unity => { unity.trigger = { events: [{ when: 'enter', message: 5 }] }; },
    unity => { unity.prefab = { id: 5 }; }, 'not-an-object',
  ];
  for (const mutate of rejects) { const unity = {}; const patch = typeof mutate === 'string' ? { unity: mutate } : (mutate(unity), { unity }); assert.throws(() => normalizeDocument(object(patch.unity)), undefined, JSON.stringify(patch)); }
  assert.throws(() => normalizeDocument({ version: 2, unity: unityScene().unity, objects: [{ type: 'cube', id: 'a', parentId: 'b' }] }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: [] }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { prefabs: {} } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { prefabs: [{ name: 'no id' }] } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { prefabs: [{ id: 'a', kind: 'boss' }] } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { prefabs: [{ id: 'a' }, { id: 'a' }] } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { prefabs: [{ id: 'a', guid: 3 }] } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { waves: { totalWaves: 0 } } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { waves: { totalWaves: 100 } } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { waves: { enemiesPerWave: 3.5 } } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { waves: { spawnInterval: 0 } } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { waves: { transitionDelays: [-1] } } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { waves: { transitionDelays: new Array(33).fill(1) } } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { settings: { buildNavMeshOnImport: 1 } } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { settings: { collectObjects: 'nearby' } } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [], unity: { settings: [] } }));
  assert.throws(() => normalizeDocument({ version: 2, objects: [{ type: 'cube', id: 'a', unity: { pathNode: { links: ['ghost'] } } }] }));
  for (const type of UNITY_COLLIDER_TYPES) assert.doesNotThrow(() => normalizeDocument(object({ collider: { type } })));
});
test('Unity mapping survives a JSON roundtrip and keeps prefab ids searchable', () => {
  const doc = normalizeDocument(unityScene()), imported = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(imported, doc); assert.deepEqual(imported.unity, doc.unity);
  assert.deepEqual(imported.objects[1].unity, doc.objects[1].unity);
  assert.deepEqual([...searchHierarchy(imported, 'turret').matches], ['road']);
  assert.deepEqual([...searchHierarchy(imported, 'AutoSentryTurret').matches], ['road']);
  assert.equal(searchHierarchy(imported, 'enemy_ground').matches.has('gate'), true);
  assert.equal(searchHierarchy(imported, 'enemy_ground', 'sphere').matches.has('gate'), true);
  assert.deepEqual([...searchHierarchy(imported, 'Turret', 'cube').matches], ['road']);
});
test('Unity summary and stats count the enabled components', () => {
  const doc = normalizeDocument(unityScene());
  const road = doc.objects.find(o => o.id === 'road'), spawn = doc.objects.find(o => o.id === 'spawn_a'), zone = doc.objects.find(o => o.id === 'zone');
  assert.deepEqual(unitySummary(road), ['Prefab:turret', 'Collider:box', 'NavMesh:walkable']);
  assert.deepEqual(unitySummary(spawn), ['SpawnPoint']);
  assert.deepEqual(unitySummary(zone), ['Trigger:sphere']);
  assert.deepEqual(unitySummary(doc.objects[0]), []);
  assert.deepEqual(unityStats(doc), { prefabs: 2, linkedPrefabs: 2, colliders: 1, navMesh: 2, spawnPoints: 1, enemyCores: 1, pathNodes: 1, triggers: 1, triggers_events: 1, waveOverrides: 2, totalWaves: 5 });
  assert.deepEqual(unityStats(normalizeDocument({ version: 2, objects: [] })), { prefabs: 0, linkedPrefabs: 0, colliders: 0, navMesh: 0, spawnPoints: 0, enemyCores: 0, pathNodes: 0, triggers: 0, triggers_events: 0, waveOverrides: 0, totalWaves: 3 });
});
