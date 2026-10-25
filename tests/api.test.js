import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocument } from '../wwwroot/scene-model.js';

const url = process.env.MAPFORGE_URL;
const unityMap = () => ({ version: 2, name: 'Unity', settings: { gridSize: 1, unit: 'meter' }, objects: [
  { type: 'cube', id: 'road', unity: { prefab: { id: 'road_tile', assetPath: 'Assets/Prefabs/Road.prefab' }, collider: { type: 'box' }, navMesh: { role: 'walkable' } } },
  { type: 'sphere', id: 'spawn', unity: { spawnPoint: { enabled: true } } },
], groups: [], gameplay: {}, unity: unitySceneFixture });
const unitySceneFixture = {
  prefabs: [{ id: 'road_tile', name: 'Road', kind: 'prop', assetPath: 'Assets/Prefabs/Road.prefab', guid: 'abc' }],
  waves: { totalWaves: 4, initialDelay: 1, enemiesPerWave: 8, spawnInterval: 0.5, transitionDelays: [3, 3, 3] },
  settings: { buildNavMeshOnImport: true, agentType: 'Humanoid', collectObjects: 'markedWithModifier' },
};
test('API validates the exported schema and rejects invalid hierarchy/properties with HTTP 400', { skip: !url }, async () => {
  const fixtures = [
    [{ version: 2, objects: [{ id: 'a', type: 'cube' }] }, 200],
    [normalizeDocument({ version: 2, objects: [{ id: 'f', type: 'folder' }, { id: 'a', type: 'plane', parentId: 'f', parameters: { speed: 2 } }] }), 200],
    [null, 400], [{}, 400], [{ objects: null }, 400], [{ objects: [null] }, 400],
    // A document without the current version marker is an older export: rejected, not migrated.
    [{ objects: [{ id: 'a', type: 'cube' }] }, 400], [{ version: 1, objects: [] }, 400],
    [{ version: 2, name: 'Three Branch Map', settings: { gridSize: 1, unit: 'meter' }, objects: [], groups: [], gameplay: {} }, 200],
    [{ version: 2, settings: { gridSize: 0 }, objects: [], groups: [], gameplay: {} }, 400],
    [{ version: 2, settings: null, objects: [], groups: [], gameplay: {} }, 400],
    [{ version: 2, groups: {}, objects: [], gameplay: {} }, 400],
    [{ version: 2, objects: [], gameplay: [] }, 400],
    [{ version: 2, objects: [{ id: 'a', type: 'folder', parentId: 'b' }, { id: 'b', type: 'cube', parentId: 'a' }] }, 400],
    [{ version: 2, objects: [{ id: 'a', type: 'cube' }, { id: 'a', type: 'cube' }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', layer: 32 }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', transform: { scale: [0, 1, 1] } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', parameters: [] }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', visible: 'false' }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', material: { metalness: 2 } }] }, 400],
    [unityMap(), 200],
    [{ version: 2, objects: [{ type: 'cube', id: 'roof', unity: { ceilingTrapGrids: [{ id: 'bottom', columns: 4, rows: 4, openCells: Array(16).fill(true) }] } }] }, 200],
    [{ version: 2, objects: [{ type: 'cube', id: 'roof', unity: { ceilingTrapGrids: [{ id: 'bottom' }, { id: 'bottom' }] } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'roof', unity: { ceilingTrapGrids: [{ id: 'bottom', columns: 2, rows: 2, openCells: [true, false] }] } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { collider: { type: 'box', size: [2, 1, 2] }, navMesh: { role: 'walkable', area: 3 }, spawnPoint: { enabled: true, waves: [{ enemyCount: 3, monsterType: 'Flying', flightHeight: 4 }] }, enemyCore: { enabled: true }, pathNode: { enabled: true, role: 'junction', links: ['b'] }, trigger: { enabled: true, shape: 'sphere', events: [{ when: 'enter', action: 'damage', amount: 5, delay: 1 }] } } }, { type: 'cube', id: 'b' }] }, 200],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: [] }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { collider: { type: 'capsulex' } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { collider: { size: [1, 0, 1] } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { collider: { direction: 3 } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { navMesh: { role: 'walk' } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { navMesh: { area: 32 } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { navMesh: { linkWidth: 0 } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { spawnPoint: { enabled: 'yes' } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { spawnPoint: { spawnInterval: 0 } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { spawnPoint: { monstersType: 'Ground' } } }] }, 200],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { spawnPoint: { monsterType: 'Ghost' } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { spawnPoint: { enemiesPerWave: 2.5 } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { spawnPoint: { waves: [{ enemyCount: 1000 }] } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { enemyCore: { maxHealth: 0 } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { enemyCore: { flyingDamage: 2e6 } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { pathNode: { links: [1] } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { pathNode: { links: ['ghost'] } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { trigger: { shape: 'capsule' } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { trigger: { events: [{ when: 'stay' }] } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { trigger: { events: [{ action: 'explode' }] } } }] }, 400],
    [{ version: 2, objects: [{ type: 'cube', id: 'a', unity: { trigger: { events: [{ delay: 601 }] } } }] }, 400],
    [{ version: 2, objects: [], unity: [] }, 400],
    [{ version: 2, objects: [], unity: { prefabs: {} } }, 400],
    [{ version: 2, objects: [], unity: { prefabs: [{ name: 'no id' }] } }, 400],
    [{ version: 2, objects: [], unity: { prefabs: [{ id: 'a' }, { id: 'a' }] } }, 400],
    [{ version: 2, objects: [], unity: { prefabs: [{ id: 'a', kind: 'boss' }] } }, 400],
    [{ version: 2, objects: [], unity: { waves: { totalWaves: 0 } } }, 400],
    [{ version: 2, objects: [], unity: { waves: { totalWaves: 100 } } }, 400],
    [{ version: 2, objects: [], unity: { waves: { enemiesPerWave: 3.5 } } }, 400],
    [{ version: 2, objects: [], unity: { waves: { transitionDelays: [-1] } } }, 400],
    [{ version: 2, objects: [], unity: { waves: { transitionDelays: Array.from({ length: 33 }, () => 1) } } }, 400],
    [{ version: 2, objects: [], unity: { settings: { buildNavMeshOnImport: 1 } } }, 400],
    [{ version: 2, objects: [], unity: { settings: { collectObjects: 'nearby' } } }, 400],
  ];
  for (const [body, expected] of fixtures) {
    const response = await fetch(`${url}/api/maps/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, expected, JSON.stringify(body));
    const result = await response.json(); assert.equal(result.valid, expected === 200);
    if (expected === 400) assert.equal(typeof result.error, 'string');
  }
});
