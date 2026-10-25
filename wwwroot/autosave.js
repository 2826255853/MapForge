export const AUTOSAVE_KEY = 'mapforge.autosave.v1';
const AUTOSAVE_SCHEMA_VERSION = 1;
const STATUSES = new Set(['pending', 'acknowledged']);

const asError = value => value instanceof Error ? value : new Error(String(value));

/** Browser-local storage for the active recovery draft. Storage failures are returned to the
 * caller so they can be reported without interrupting normal editing or export. */
export function createAutosaveStore({ storage = () => globalThis.localStorage, normalizeDocument, now = () => new Date().toISOString(), key = AUTOSAVE_KEY } = {}) {
  if (typeof normalizeDocument !== 'function') throw new TypeError('normalizeDocument must be a function.');

  const resolveStorage = () => typeof storage === 'function' ? storage() : storage;

  function write(document, status) {
    try {
      const normalized = normalizeDocument(document);
      const time = now();
      const savedAt = time instanceof Date ? time.toISOString() : String(time);
      if (!Number.isFinite(Date.parse(savedAt))) throw new Error('Autosave time must be a valid date.');
      const draft = { schemaVersion: AUTOSAVE_SCHEMA_VERSION, status, savedAt, document: normalized };
      resolveStorage().setItem(key, JSON.stringify(draft));
      return { ok: true, draft };
    } catch (error) {
      return { ok: false, error: asError(error) };
    }
  }

  function load() {
    let store, raw;
    try {
      store = resolveStorage();
      raw = store.getItem(key);
    } catch (error) {
      return { draft: null, error: asError(error), invalid: false };
    }
    if (raw === null) return { draft: null, error: null, invalid: false };

    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          value.schemaVersion !== AUTOSAVE_SCHEMA_VERSION || !STATUSES.has(value.status) ||
          typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) ||
          !value.document || typeof value.document !== 'object' || Array.isArray(value.document)) {
        throw new Error('Autosave draft metadata is invalid.');
      }
      return {
        draft: { ...value, document: normalizeDocument(value.document) },
        error: null,
        invalid: false,
      };
    } catch (error) {
      try {
        store.removeItem(key);
        return { draft: null, error: asError(error), invalid: true };
      } catch (clearError) {
        return { draft: null, error: asError(clearError), invalid: true };
      }
    }
  }

  function clear() {
    try {
      resolveStorage().removeItem(key);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: asError(error) };
    }
  }

  return {
    load,
    savePending: document => write(document, 'pending'),
    saveAcknowledged: document => write(document, 'acknowledged'),
    clear,
  };
}
