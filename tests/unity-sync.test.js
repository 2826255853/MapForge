import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The sync API talks to a Unity project on disk, so these tests never point it at a real
// one: a throwaway project is configured through /api/unity/target, exercised, and the
// previous target is restored afterwards. Run them against a dev server with
// MAPFORGE_URL=http://localhost:5090.
const url = process.env.MAPFORGE_URL;
const skip = !url;

/** Minimal document the validate endpoint accepts. */
const map = (overrides = {}) => ({
  version: 2,
  name: 'Unity Sync Test',
  settings: { gridSize: 1, unit: 'meter' },
  objects: [{ type: 'cube', id: 'a' }, { type: 'cube', id: 'b' }],
  groups: [],
  gameplay: {},
  ...overrides,
});

const post = (path, body) => fetch(`${url}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

/** A folder that passes the server's "is this a Unity project" check. */
async function fakeUnityProject() {
  const root = await mkdtemp(join(tmpdir(), 'mapforge-test-'));
  await mkdir(join(root, 'Assets'), { recursive: true });
  await mkdir(join(root, 'ProjectSettings'), { recursive: true });
  await writeFile(join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.6.0f1\n');
  return root;
}

const readPending = async (root) => JSON.parse(await readFile(join(root, 'MapForgeSync', 'mail', 'pending.json'), 'utf8'));

/** Heartbeat Unity writes every 15s; the server reads it to decide what the scene can take. */
async function writeHeartbeat(root, { objects, ageSeconds = 0, hasMapForgeWorld = true, sceneName = 'Unity Sync Test' }) {
  const seen = new Date(Date.now() - ageSeconds * 1000).toISOString();
  await mkdir(join(root, 'MapForgeSync'), { recursive: true });
  await writeFile(join(root, 'MapForgeSync', 'status.json'), JSON.stringify({
    protocol: 1, editor: 'Unity', appliedRevision: 1, sceneName,
    map: sceneName, hasMapForgeWorld, objects, lastSeenUtc: seen,
  }));
}

test('Unity sync previews and sends revisions without touching the previous target', { skip }, async () => {
  const before = await (await fetch(`${url}/api/unity/status`)).json();
  const project = await fakeUnityProject();
  try {
    // Point the server at the throwaway project for the duration of the test.
    const target = await post('/api/unity/target', { unityProject: project });
    assert.equal(target.status, 200);
    assert.equal((await target.json()).unityProject, project);

    // A preview of an unchanged document reports the first send as a full rebuild.
    const preview = await post('/api/unity/preview', map());
    assert.equal(preview.status, 200);
    const previewBody = await preview.json();
    assert.equal(previewBody.mode, 'full');
    assert.match(previewBody.rebuildReason, /基线/);
    // Preview is read-only: nothing may reach the mail folder before Send.
    assert.equal(existsSync(join(project, 'MapForgeSync', 'mail', 'pending.json')), false);

    // The first send always ships the whole document, because Unity has no baseline.
    const first = await post('/api/unity/send', { map: map() });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.mode, 'full');
    assert.equal(firstBody.created, 0);
    assert.equal(firstBody.unityConnected, false);
    const firstPatch = await readPending(project);
    assert.equal(firstPatch.protocol, 1);
    assert.equal(firstPatch.mode, 'full');
    assert.equal(firstPatch.revision, firstBody.revision);
    assert.equal(typeof firstPatch.world, 'string', 'a full revision carries the document as JSON text');
    assert.equal(firstPatch.objects, undefined);

    // One changed object is an increment, and the patch carries only that object.
    const moved = map();
    moved.objects[1] = { type: 'cube', id: 'b', transform: { position: [1, 0, 0] } };
    const second = await post('/api/unity/send', { map: moved });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.mode, 'increment');
    assert.equal(secondBody.updated, 1);
    assert.equal(secondBody.rebuildReason, null);
    assert.equal(secondBody.revision, firstBody.revision + 1);
    const secondPatch = await readPending(project);
    assert.equal(secondPatch.mode, 'increment');
    assert.equal(secondPatch.baseRevision, firstBody.revision);
    assert.deepEqual(secondPatch.objects.map((object) => object.id), ['b']);

    // Removing an object travels as a delete instead of a rebuild.
    const third = await post('/api/unity/send', { map: map({ objects: [{ type: 'cube', id: 'a' }] }) });
    assert.equal(third.status, 200);
    const thirdBody = await third.json();
    assert.equal(thirdBody.mode, 'increment');
    assert.deepEqual(thirdBody.changes.deleted, ['b']);
    assert.deepEqual((await readPending(project)).changes.deleted, ['b']);

    // A scene-level change cannot be patched object by object, so it forces a rebuild.
    const fourth = await post('/api/unity/send', { map: map({ gameplay: { totalWaves: 5 } }) });
    const fourthBody = await fourth.json();
    assert.equal(fourthBody.mode, 'full');
    assert.match(fourthBody.rebuildReason, /gameplay/);

    // An explicit "mode": "full" rebuilds even when the diff is incremental.
    const forced = await post('/api/unity/send', { map: map({ gameplay: { totalWaves: 5 } }), mode: 'full' });
    const forcedBody = await forced.json();
    assert.equal(forcedBody.mode, 'full');
    assert.match(forcedBody.rebuildReason, /完全重建/);

    // The status document reports the pending revision and the baseline it was diffed from.
    const status = await (await fetch(`${url}/api/unity/status`)).json();
    assert.equal(status.unityProject, project);
    assert.equal(status.pendingRevision, forcedBody.revision);
    assert.equal(status.pendingMode, 'full');
    assert.equal(status.baselineRevision, forcedBody.revision);

    // Clearing the baseline is what makes the next send a rebuild from scratch.
    const reset = await post('/api/unity/reset', {});
    assert.equal(reset.status, 200);
    assert.equal(existsSync(join(project, 'MapForgeSync', 'mail', 'baseline.json')), false);
    assert.equal(existsSync(join(project, 'MapForgeSync', 'mail', 'pending.json')), false);
    const afterReset = await (await post('/api/unity/preview', map())).json();
    assert.equal(afterReset.mode, 'full');
    assert.equal(afterReset.baselineRevision, 0);
  } finally {
    // Whatever happened, the real target is put back before the next test runs.
    await post('/api/unity/target', { unityProject: before.unityProject ?? '' });
    await rm(project, { recursive: true, force: true });
  }
});

test('Unity sync rebuilds when the open scene has no object identity to patch', { skip }, async () => {
  const before = await (await fetch(`${url}/api/unity/status`)).json();
  const project = await fakeUnityProject();
  try {
    await post('/api/unity/target', { unityProject: project });
    // A first send has no baseline, so it is a rebuild either way and gives the test one.
    const first = await (await post('/api/unity/send', { map: map() })).json();
    assert.equal(first.mode, 'full');

    // 23 of 46 objects is only 50%, so the size heuristic alone would keep this an
    // increment. A scene whose objects carry no MapForge identifiers has nothing to match
    // by, so the send has to become the rebuild that creates them instead of a patch Unity
    // would refuse.
    const changed = map();
    changed.objects[0] = { type: 'cube', id: 'a', transform: { position: [1, 0, 0] } };
    await writeHeartbeat(project, { objects: 0 });
    const blocked = await (await post('/api/unity/preview', changed)).json();
    assert.equal(blocked.mode, 'full');
    assert.match(blocked.rebuildReason, /MapForge 标识/);
    assert.equal((await (await post('/api/unity/send', { map: changed })).json()).mode, 'full');

    // Once the scene carries identifiers the same document is an ordinary increment again.
    await writeHeartbeat(project, { objects: 23 });
    const patched = await (await post('/api/unity/preview', changed)).json();
    assert.equal(patched.mode, 'increment');
    assert.equal((await (await post('/api/unity/send', { map: changed })).json()).mode, 'increment');

    // A scene of the right name without a generated root has nothing to patch either, so the
    // rebuild that creates the root is sent instead.
    await writeHeartbeat(project, { objects: 0, hasMapForgeWorld: false });
    const rootless = await (await post('/api/unity/preview', changed)).json();
    assert.equal(rootless.mode, 'full');
    assert.match(rootless.rebuildReason, /MapForgeWorld/);

    // The heartbeat describes the scene Unity has open, so it says nothing about a map of a
    // different name: the mode stays what the diff asked for instead of guessing.
    await writeHeartbeat(project, { objects: 0, sceneName: 'Some Other Scene' });
    assert.equal((await (await post('/api/unity/preview', changed)).json()).mode, 'increment');

    // A stale heartbeat means the editor is gone, so its scene cannot be inspected either.
    await writeHeartbeat(project, { objects: 0, ageSeconds: 600 });
    assert.equal((await (await post('/api/unity/preview', changed)).json()).mode, 'increment');
  } finally {
    await post('/api/unity/target', { unityProject: before.unityProject ?? '' });
    await rm(project, { recursive: true, force: true });
  }
});

test('Unity sync rejects unusable targets and documents', { skip }, async () => {
  const before = await (await fetch(`${url}/api/unity/status`)).json();
  try {
    // A folder that is not a Unity project is refused, and the target is left alone.
    const rejected = await post('/api/unity/target', { unityProject: tmpdir() });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /Unity/);
    assert.equal((await (await fetch(`${url}/api/unity/status`)).json()).unityProject, before.unityProject);

    // Invalid documents are rejected before anything is written.
    for (const body of [{}, { map: null }, { map: {} }, { map: { objects: [{ id: 'a', parentId: 'b' }] } }]) {
      const response = await post('/api/unity/send', body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(typeof (await response.json()).error, 'string');
    }
    const preview = await post('/api/unity/preview', { objects: [{ id: 'a', parentId: 'b' }] });
    assert.equal(preview.status, 400);
  } finally {
    await post('/api/unity/target', { unityProject: before.unityProject ?? '' });
  }
});