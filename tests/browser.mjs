import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const row = id => page.locator(`.object-row[data-id="${id}"]`);
const select = id => row(id).locator('.row-name').click();
const change = async (selector, value) => { await page.locator(selector).fill(value); await page.locator(selector).press('Tab'); };
const download = async () => { const event = page.waitForEvent('download'); await page.locator('#saveBtn').click(); return JSON.parse(await readFile(await (await event).path(), 'utf8')); };
const upload = async data => { await page.locator('#importFile').setInputFiles({ name: 'test-map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) }); };
try {
  await page.goto(process.env.MAPFORGE_URL ?? 'http://localhost:5090');
  await page.locator('#viewport canvas').waitFor();
  await page.locator('#ceilingBtn').click();
  let ceilingDoc = await download(), ceilingNode = ceilingDoc.objects[0], ceilingGrid = ceilingNode.unity.ceilingTrapGrids[0];
  assert.equal(ceilingNode.name, '天花板'); assert.equal(ceilingNode.static, true); assert.equal(ceilingNode.collision, true);
  assert.deepEqual(ceilingNode.transform.position, [0, 4.1, 0]); assert.deepEqual(ceilingNode.transform.scale, [4, 0.2, 4]);
  assert.equal(ceilingGrid.columns, 4); assert.equal(ceilingGrid.rows, 4); assert.equal(ceilingGrid.openCells.length, 16);
  assert.deepEqual(ceilingGrid.rotation, [Math.PI / 2, 0, 0]);
  await page.locator('#inspector [data-ceiling-cell="5"]').click();
  ceilingDoc = await download(); assert.equal(ceilingDoc.objects[0].unity.ceilingTrapGrids[0].openCells[5], false);
  await page.locator('#undoBtn').click(); ceilingDoc = await download();
  assert.equal(ceilingDoc.objects[0].unity.ceilingTrapGrids[0].openCells[5], true);
  await page.locator('#undoBtn').click(); assert.equal((await download()).objects.length, 0);
  console.log('PASS ceiling quick creation, underside grid, cell editing and undo');
  await page.locator('#folderBtn').click(); await change('#objName', 'Environment');
  await page.locator('#folderBtn').click(); await change('#objName', 'Roads');
  await page.locator('.piece[data-type=cube]').click(); await change('#objName', 'Main Road');
  await change('#objTags', 'walkable, route'); await change('#objLayer', '8');
  await page.locator('#objCollision').uncheck(); await page.locator('#objStatic').check();
  await change('#objPrefab', 'RoadTile'); await page.locator('#materialType').selectOption('unlit');
  await change('#objColor', '#ab1234'); await change('#roughness', '0.35');
  await page.locator('#objCategory').selectOption('decoration');
  await page.locator('#objParameters').fill('{"speed":2,"waves":[1,2],"enabled":true}'); await page.locator('#applyParameters').click();
  let saved = await download(), road = saved.objects.find(o => o.id === 'obj_3');
  assert.equal(road.parentId, 'obj_2'); assert.equal(road.name, 'Main Road'); assert.equal(road.layer, 8); assert.equal(road.color, '#ab1234'); assert.equal(road.material.type, 'unlit'); assert.equal(road.collision, false); assert.equal(road.static, true); assert.equal(road.prefabType, 'RoadTile'); assert.deepEqual(road.parameters.waves, [1, 2]);
  console.log('PASS nested folders and extended properties export');

  await row('obj_1').locator('.fold').click(); assert.equal(await row('obj_3').count(), 0);
  await page.locator('#hierarchySearch').fill('walkable'); assert.equal(await row('obj_3').count(), 1); assert.equal(await row('obj_1').count(), 1);
  await page.locator('#typeFilter').selectOption('sphere'); assert.equal(await page.locator('.object-row').count(), 0);
  await page.locator('#clearFilterBtn').click(); await row('obj_1').locator('.fold').click();
  await select('obj_3'); await page.locator('#selectedTypeBtn').click(); assert.equal(await page.locator('#typeFilter').inputValue(), 'cube'); await page.locator('#clearFilterBtn').click();
  console.log('PASS collapsed hierarchy search, tag/type filters and ancestors');

  await row('obj_1').locator('.lock').click(); await select('obj_3'); assert.equal(await page.locator('#objName').isDisabled(), true);
  await select('obj_1'); await page.locator('#groupBtn').click(); assert.match(await page.locator('#message').innerText(), /锁定/);
  await row('obj_1').locator('.lock').click(); await select('obj_3'); assert.equal(await page.locator('#objName').isEnabled(), true);
  await row('obj_3').locator('.lock').click(); await select('obj_1'); await change('[data-prop=position][data-axis="0"]', '9'); assert.match(await page.locator('#message').innerText(), /锁定/);
  saved = await download(); assert.equal(saved.objects[0].transform.position[0], 0);
  await row('obj_3').locator('.lock').click();
  await row('obj_1').locator('.visibility').click(); assert.match(await row('obj_3').getAttribute('class'), /hidden-object/);
  await page.locator('#undoBtn').click(); assert.doesNotMatch(await row('obj_3').getAttribute('class'), /hidden-object/);
  console.log('PASS inherited lock/visibility and locked-descendant protection');

  await select('obj_2'); await change('[data-prop=position][data-axis="0"]', '5');
  await select('obj_3'); await page.locator('#parentId').selectOption('obj_1');
  saved = await download(); road = saved.objects.find(o => o.id === 'obj_3'); assert.equal(road.parentId, 'obj_1'); assert.equal(road.transform.position[0], 5);
  await page.locator('#undoBtn').click(); saved = await download(); assert.equal(saved.objects[2].parentId, 'obj_2'); assert.equal(saved.objects[2].transform.position[0], 0);
  await page.locator('#redoBtn').click();
  console.log('PASS reparent preserves world placement and undo/redo');

  await select('obj_1'); await page.locator('#copyBtn').click(); await page.locator('#pasteBtn').click();
  saved = await download(); assert.equal(saved.objects.length, 6); assert.equal(new Set(saved.objects.map(o => o.id)).size, 6);
  const copyRoad = saved.objects.find(o => o.id !== 'obj_3' && o.name === 'Main Road'); assert.deepEqual(copyRoad.parameters, road.parameters); assert.equal(copyRoad.parentId, 'obj_4');
  await page.locator('#deleteBtn').click(); assert.equal((await download()).objects.length, 3);
  await page.locator('#undoBtn').click(); assert.equal((await download()).objects.length, 6);
  await page.locator('#undoBtn').click();
  console.log('PASS subtree copy/delete, stable IDs, metadata and undo');

  await select('obj_3'); await page.locator('#objParameters').fill('{invalid'); await page.locator('#applyParameters').click(); assert.match(await page.locator('#message').innerText(), /有效/);
  await page.locator('#objParameters').fill('[]'); await page.locator('#applyParameters').click(); assert.match(await page.locator('#message').innerText(), /JSON 对象/);
  const beforeInvalid = await download();
  await upload({ objects: [{ type: 'cube', id: 'a', parentId: 'missing' }] }); await page.waitForFunction(() => document.querySelector('#message').textContent.startsWith('导入失败'));
  assert.deepEqual(await download(), beforeInvalid);
  await upload(beforeInvalid); await page.waitForFunction(() => document.querySelector('#message').textContent.startsWith('已导入'));
  assert.deepEqual(await download(), beforeInvalid);
  console.log('PASS invalid import is atomic, invalid parameters, full roundtrip');

  await upload({ version: 2, name: 'Legacy', gameplay: { spawns: [{ id: 'spawn_a' }] }, objects: [{ type: 'cube', id: 'legacy', transform: { position: [0, 1, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] } }] });
  await select('legacy'); assert.equal(await page.locator('[data-prop=rotation][data-axis="1"]').inputValue(), '90'); assert.deepEqual((await download()).gameplay, { spawns: [{ id: 'spawn_a' }] });
  await page.locator('#newBtn').click(); assert.equal((await download()).objects.length, 0); await page.locator('#undoBtn').click(); assert.equal((await download()).objects.length, 1);
  console.log('PASS radians, gameplay preservation, reversible new scene');
  // An older document without the current version marker is refused, and nothing is replaced.
  const beforeUnversioned = await download();
  await upload({ name: 'No Version', objects: [{ type: 'cube', id: 'unversioned' }] });
  await page.waitForFunction(() => document.querySelector('#message').textContent.startsWith('导入失败'));
  assert.match(await page.locator('#message').innerText(), /不支持的地图版本/);
  assert.deepEqual(await download(), beforeUnversioned);
  console.log('PASS unversioned documents are rejected atomically');

  await select('legacy'); await page.locator('#focusBtn').click();
  const canvas = await page.locator('#viewport canvas').boundingBox(), cx = canvas.x + canvas.width / 2, cy = canvas.y + canvas.height / 2;
  await page.mouse.click(canvas.x + 10, canvas.y + canvas.height - 60); assert.match(await page.locator('#objectCount').innerText(), /0 SELECTED/);
  await page.mouse.click(cx, cy); assert.match(await page.locator('#objectCount').innerText(), /1 SELECTED/);
  await page.locator('.tool[data-tool=move]').click();
  await page.mouse.move(cx + 90, cy + 35); await page.mouse.down(); await page.mouse.move(cx + 230, cy + 90, { steps: 12 }); await page.mouse.up();
  const moved = await download(); assert.notEqual(moved.objects[0].transform.position[0], 0);
  await page.locator('#undoBtn').click(); assert.equal((await download()).objects[0].transform.position[0], 0);
  await page.locator('#redoBtn').click(); assert.deepEqual((await download()).objects[0].transform, moved.objects[0].transform); await page.locator('#undoBtn').click();
  await page.locator('.tool[data-tool=select]').click();
  await row('legacy').locator('.lock').click(); await page.mouse.click(cx, cy); assert.match(await page.locator('#objectCount').innerText(), /0 SELECTED/);
  await row('legacy').locator('.lock').click(); await row('legacy').locator('.visibility').click(); await page.mouse.click(cx, cy); assert.match(await page.locator('#objectCount').innerText(), /0 SELECTED/);
  await row('legacy').locator('.visibility').click();
  console.log('PASS viewport picking, locked/hidden picking exclusion, Gizmo drag undo/redo');

  await page.locator('.piece[data-type=sphere]').click(); await row('legacy').locator('.row-name').click({ modifiers: ['Control'] });
  await page.locator('#groupBtn').click(); await change('[data-prop=position][data-axis="0"]', '3');
  const grouped = await download(), group = grouped.objects.find(o => o.type === 'group'); assert.equal(grouped.objects.filter(o => o.parentId === group.id).length, 2); assert.equal(group.transform.position[0], 3);
  await page.locator('#undoBtn').click(); await page.locator('#undoBtn').click(); assert.equal((await download()).objects.some(o => o.type === 'group'), false);
  console.log('PASS multi-selection grouping and group transform history');

  await upload(beforeInvalid); await select('obj_3');
  await page.locator('#unityBtn').click(); assert.equal(await page.locator('#unityDialog').isVisible(), true);
  await page.locator('#unityDialog [data-prefab-add]').click(); assert.equal(await page.locator('#unityDialog .prefab-row').count(), 1);
  await change('#unityDialog [data-prefab-field=id]', 'enemy_ground'); assert.match(await page.locator('#message').innerText(), /Prefab/);
  await change('#unityDialog [data-prefab-field=assetPath]', 'Assets/Prefabs/TestMonster.prefab');
  await page.locator('#unityDialog [data-prefab-field=kind]').selectOption('enemy');
  await change('#unityDialog [data-wave-scene=totalWaves]', '6'); await change('#unityDialog [data-wave-scene=transitionDelays]', '4, 4');
  // Regression: picking from a <select> re-renders the dialog, which used to throw while the previously edited field still held focus.
  await page.locator('#unityDialog [data-wave-scene=totalWaves]').fill('9');
  await page.locator('#unityDialog [data-bake=collectObjects]').selectOption('children');
  assert.doesNotMatch(await page.locator('#message').innerText(), /Failed to set|innerHTML/);
  assert.equal(await page.locator('#unityDialog [data-bake=collectObjects]').inputValue(), 'children');
  assert.equal(await page.locator('#unityDialog [data-wave-scene=totalWaves]').inputValue(), '9');
  await change('#unityDialog [data-wave-scene=totalWaves]', '6');
  await page.locator('#unityDialog [data-bake=buildNavMeshOnImport]').check(); await page.locator('#unityDialog [data-bake=collectObjects]').selectOption('volume');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#unityDialog').isVisible(), false);
  await select('obj_3'); await page.locator('#unityPrefabPick').selectOption('enemy_ground');
  await change('#unitySpawnInterval', '0.5');
  await page.locator('#unityColliderType').selectOption('box');
  assert.doesNotMatch(await page.locator('#message').innerText(), /Failed to set|innerHTML/);
  await change('#unitySpawnInterval', '1');
  await page.locator('#unityColliderTrigger').check();
  await page.locator('#unityNavRole').selectOption('walkable'); await change('#unityNavArea', '3');
  await page.locator('#unitySpawnEnabled').check(); await change('#unitySpawnCount', '7'); await page.locator('#unitySpawnMonster').selectOption('Flying');
  await page.locator('#unityWaveAdd').click(); await change('[data-wave-field=enemyCount]', '3'); await page.locator('[data-wave-field=monsterType]').selectOption('Flying');
  await change('[data-wave-field=flightHeight]', '6');
  saved = await download(); road = saved.objects.find(o => o.id === 'obj_3');
  assert.deepEqual(road.unity.prefab, { id: 'enemy_ground', guid: '', assetPath: 'Assets/Prefabs/TestMonster.prefab' });
  assert.equal(road.unity.collider.type, 'box'); assert.equal(road.unity.collider.isTrigger, true); assert.deepEqual(road.unity.collider.size, [1, 1, 1]);
  assert.equal(road.unity.navMesh.role, 'walkable'); assert.equal(road.unity.navMesh.area, 3);
  assert.equal(road.unity.spawnPoint.enabled, true); assert.equal(road.unity.spawnPoint.enemiesPerWave, 7); assert.equal(road.unity.spawnPoint.monsterType, 'Flying');
  assert.deepEqual(road.unity.spawnPoint.waves, [{ enabled: true, enemyCount: 3, monsterType: 'Flying', flightHeight: 6 }]);
  assert.deepEqual(saved.unity.prefabs, [{ id: 'enemy_ground', name: 'Prefab 1', guid: '', assetPath: 'Assets/Prefabs/TestMonster.prefab', kind: 'enemy' }]);
  assert.equal(saved.unity.waves.totalWaves, 6); assert.deepEqual(saved.unity.waves.transitionDelays, [4, 4]);
  assert.deepEqual(saved.unity.settings, { buildNavMeshOnImport: true, agentType: 'Humanoid', collectObjects: 'volume' });
  assert.match(await row('obj_3').locator('.unity-badge').innerText(), /Unity 4/);
  console.log('PASS Unity mapping dialog, inspector and export');

  await select('obj_3'); await change('#unityNavArea', '99'); assert.match(await page.locator('#message').innerText(), /有效数值/);
  assert.equal((await download()).objects.find(o => o.id === 'obj_3').unity.navMesh.area, 3);
  await page.locator('#unityColliderType').selectOption('none'); await page.locator('#unityColliderTrigger').uncheck();
  await page.locator('#unitySpawnEnabled').uncheck(); assert.deepEqual((await download()).objects.find(o => o.id === 'obj_3').unity.spawnPoint.waves.length, 1);
  await page.locator('#unitySpawnEnabled').check();
  await page.locator('#undoBtn').click(); assert.equal((await download()).objects.find(o => o.id === 'obj_3').unity.spawnPoint.enabled, false);
  await page.locator('#redoBtn').click(); assert.equal((await download()).objects.find(o => o.id === 'obj_3').unity.spawnPoint.enabled, true);
  await page.locator('[data-display=unity]').uncheck(); await page.locator('[data-display=unity]').check();
  await upload(saved); await select('obj_3'); assert.equal(await page.locator('#unityPrefabPick').inputValue(), 'enemy_ground');
  assert.equal(await page.locator('#unityColliderType').inputValue(), 'box');
  console.log('PASS Unity mapping validation, undo/redo, preview toggle and file roundtrip');

  // One-click send: the dialog is read-only until a send button is pressed, so this only
  // exercises the status/preview round trip and the target validation error path.
  await page.locator('#sendUnityBtn').click();
  await page.locator('#unitySyncDialog .sync-panel').waitFor();
  assert.match(await page.locator('#unitySyncDialog h2').innerText(), /一键发送到 Unity/);
  await page.waitForFunction(() => document.querySelector('#unitySyncDialog .sync-mode')?.textContent.trim() !== '—');
  assert.match(await page.locator('#unitySyncDialog .sync-mode').innerText(), /增量更新|完整重建/);
  assert.match(await page.locator('#unitySyncDialog .sync-counts').innerText(), /对象 \d+/);
  assert.equal(await page.locator('#unitySyncDialog [data-action=send]').isDisabled(), false);
  // An unusable path is refused and the working target stays in the field, so a typo cannot
  // silently redirect every later send.
  const target = await page.locator('#syncTarget').inputValue();
  assert.notEqual(target, '');
  await page.locator('#syncTarget').fill('C:\\definitely\\not\\a\\unity\\project');
  await page.locator('#unitySyncDialog [data-action=target]').click();
  await page.waitForFunction(() => /Unity/.test(document.querySelector('#message').textContent));
  // The rejected path stays editable in the field, while the status line still reports the
  // project a send would actually reach.
  assert.equal(await page.locator('#syncTarget').inputValue(), 'C:\\definitely\\not\\a\\unity\\project');
  assert.match(await page.locator('#unitySyncDialog .sync-meta').first().innerText(), /当前目标：.+/);
  await page.locator('#syncTarget').fill(target);
  await page.locator('#unitySyncDialog [data-action=target]').click();
  await page.waitForFunction(path => document.querySelector('#syncTarget')?.value === path, target);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#unitySyncDialog').isHidden(), true);
  console.log('PASS one-click send dialog, change preview and target validation');
  await upload(beforeInvalid); await select('obj_3'); await page.locator('#focusBtn').click();
  for (const category of ['waypoint', 'decoration', 'geometry']) { await page.locator(`[data-display=${category}]`).uncheck(); await page.locator(`[data-display=${category}]`).check(); }
  await page.locator('[data-display=colliders]').check();
  await page.locator('#exampleBtn').click(); await page.waitForFunction(() => document.querySelector('#mapName').textContent.includes('SCENE_ORGANIZATION_DEMO'));
  assert.equal((await download()).objects.filter(o => o.type === 'folder').length, 5);
  await select('spawn_0'); await row('spawn_0').locator('.row-name').dblclick();
  assert.match(await page.locator('#message').innerText(), /定位选区/);
  await select('environment'); await page.locator('#focusBtn').click();
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/scene-organization.png', fullPage: true });
  const beforeRecovery = await download();
  await page.locator('.piece[data-type=cube]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('mapforge.autosave.v1') ?? 'null')?.status === 'pending');
  const pendingDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('mapforge.autosave.v1')));
  assert.equal(pendingDraft.document.objects.length, beforeRecovery.objects.length + 1);
  assert.match(await page.locator('#autosaveStatus').innerText(), /已自动保存/);
  await page.reload(); await page.locator('#viewport canvas').waitFor();
  assert.equal(await page.locator('#autosaveDialog').isVisible(), true);
  assert.match(await page.locator('#autosaveSummary').innerText(), /SCENE_ORGANIZATION_DEMO.*个对象/);
  await page.locator('#autosaveRestoreBtn').click();
  assert.equal(await page.locator('#undoBtn').isDisabled(), true);
  assert.deepEqual(await download(), pendingDraft.document);
  await page.reload(); await page.locator('#viewport canvas').waitFor();
  assert.equal(await page.locator('#autosaveDialog').isHidden(), true);
  assert.deepEqual(await download(), pendingDraft.document);
  console.log('PASS autosave restore, acknowledged startup recovery and clean undo history');

  await page.locator('.piece[data-type=sphere]').click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('mapforge.autosave.v1')))).status, 'pending');
  await page.reload(); await page.locator('#viewport canvas').waitFor();
  assert.equal(await page.locator('#autosaveDialog').isVisible(), true);
  await page.locator('#autosaveDiscardBtn').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('mapforge.autosave.v1')), null);
  await page.reload(); await page.locator('#viewport canvas').waitFor();
  assert.equal(await page.locator('#autosaveDialog').isHidden(), true);
  assert.equal((await download()).objects.length, 0);
  console.log('PASS autosave discard clears the draft without restoring it');

  await page.evaluate(() => localStorage.setItem('mapforge.autosave.v1', JSON.stringify({ schemaVersion: 1, status: 'pending', savedAt: new Date().toISOString(), document: { version: 1, objects: [{ id: 'invalid', type: 'cube' }] } })));
  await page.reload(); await page.locator('#viewport canvas').waitFor();
  assert.equal(await page.locator('#autosaveDialog').isHidden(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('mapforge.autosave.v1')), null);
  assert.equal((await download()).objects.length, 0);
  console.log('PASS invalid autosave drafts are cleared without changing the current scene');
  assert.deepEqual(errors, []); console.log('PASS display controls and browser runtime: no uncaught errors');
} finally { await browser.close(); }
