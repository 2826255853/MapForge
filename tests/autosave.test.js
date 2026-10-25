import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosaveStore, AUTOSAVE_KEY } from '../wwwroot/autosave.js';
import { normalizeDocument } from '../wwwroot/scene-model.js';

const document = () => normalizeDocument({
  version: 2,
  name: 'Autosave test',
  objects: [{ type: 'cube', id: 'cube_1', name: 'Saved cube' }],
});

class MemoryStorage {
  constructor(value = null) { this.value = value; }
  getItem() { return this.value; }
  setItem(_key, value) { this.value = value; }
  removeItem() { this.value = null; }
}

test('autosave stores a normalized document and preserves pending/acknowledged state', () => {
  const storage = new MemoryStorage();
  const store = createAutosaveStore({ storage, normalizeDocument, now: () => '2026-10-25T08:00:00.000Z' });
  const saved = store.savePending(document());
  assert.equal(saved.ok, true);
  assert.equal(JSON.parse(storage.value).schemaVersion, 1);
  assert.equal(JSON.parse(storage.value).status, 'pending');
  assert.deepEqual(store.load().draft.document.objects[0].name, 'Saved cube');

  const acknowledged = store.saveAcknowledged(document());
  assert.equal(acknowledged.ok, true);
  assert.equal(store.load().draft.status, 'acknowledged');
  assert.equal(store.load().draft.savedAt, '2026-10-25T08:00:00.000Z');
});

test('invalid or unsupported drafts are removed atomically', () => {
  for (const raw of [
    '{broken',
    JSON.stringify({ schemaVersion: 99, status: 'pending', savedAt: '2026-10-25T08:00:00.000Z', document: document() }),
    JSON.stringify({ schemaVersion: 1, status: 'pending', savedAt: '2026-10-25T08:00:00.000Z' }),
    JSON.stringify({ schemaVersion: 1, status: 'pending', savedAt: '2026-10-25T08:00:00.000Z', document: { version: 1, objects: [] } }),
  ]) {
    const storage = new MemoryStorage(raw);
    const result = createAutosaveStore({ storage, normalizeDocument }).load();
    assert.equal(result.draft, null, raw);
    assert.equal(result.invalid, true, raw);
    assert.equal(storage.value, null, raw);
  }
});

test('storage errors are reported without escaping into the editor', () => {
  const failing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  const store = createAutosaveStore({ storage: failing, normalizeDocument });
  assert.equal(store.load().error.message, 'blocked');
  assert.equal(store.savePending(document()).error.message, 'quota');
  assert.equal(store.clear().error.message, 'blocked');
});

test('clear removes the single active draft key', () => {
  const storage = new MemoryStorage();
  const store = createAutosaveStore({ storage, normalizeDocument });
  store.savePending(document());
  assert.equal(storage.value !== null, true);
  assert.deepEqual(store.clear(), { ok: true });
  assert.equal(storage.value, null);
  assert.equal(AUTOSAVE_KEY, 'mapforge.autosave.v1');
});
