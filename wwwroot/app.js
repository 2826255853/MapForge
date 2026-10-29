import * as THREE from 'three';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/TransformControls.js';
import { normalizeDocument, makeNode, clone, descendants, rootsOf, effectiveState, assertEditable, searchHierarchy, History, TYPE_LABELS, MAP_FORMAT_VERSION, unityStats, unitySummary } from './scene-model.js';
import { createAutosaveStore } from './autosave.js';
import { unitySectionHtml, wireUnitySection, unitySceneHtml, wireUnityScene } from './unity-ui.js';
import { addCeilingGrid, assertCeilingSupport, resizeCeilingMask, ceilingSectionHtml, wireCeilingSection } from './ceiling-traps.js';
import { addWallGrid, assertWallSupport, resizeWallMask, wallSectionHtml, wireWallSection } from './wall-traps.js';
import { unitySyncHtml, wireUnitySync, fetchSyncStatus, fetchSyncPreview, sendMapToUnity, setUnityTarget, resetSyncBaseline } from './unity-sync.js';

const $ = selector => document.querySelector(selector);
const labels = TYPE_LABELS;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const viewport = $('#viewport'), scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1218);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000); camera.position.set(8, 7, 9);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); viewport.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.enableDamping = true;
const gizmo = new TransformControls(camera, renderer.domElement); scene.add(gizmo);
scene.add(new THREE.HemisphereLight(0xb7d9ff, 0x18232e, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(5, 10, 4); scene.add(sun);
scene.add(new THREE.GridHelper(200, 200, 0x38505a, 0x1d2a32));
const world = new THREE.Group(), overlays = new THREE.Group(); scene.add(world, overlays);
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), history = new History();
let doc = normalizeDocument({ version: MAP_FORMAT_VERSION, objects: [] }), selected = new Set(), runtime = new Map(), states = new Map();
let activeTool = 'select', gridStep = 1, snapEnabled = true, clipboard = null, pasteCount = 0, dragBefore = null;
const filters = { query: '', type: '', geometry: true, waypoint: true, decoration: true, colliders: false, unity: false };
let selectionBoxes = [], colliderBoxes = [];
const capture = () => ({ document: clone(doc), selection: [...selected] });
const unityDialog = $('#unityDialog');
const unitySyncDialog = $('#unitySyncDialog');
const autosaveDialog = $('#autosaveDialog');
const autosaveStore = createAutosaveStore({ normalizeDocument });
let autosaveTimer = null, autosaveDirty = false, pendingAutosaveDraft = null;
// Unity edits reuse the shared commit path, so validation, undo/redo and locked-object rules still apply.
const unityApi = {
  edit: (action, message) => safely(() => commit(d => action(d.unity), null, message)),
  editScene: (action, message) => commit(d => action(d.unity), null, message),
  notice,
};
const find = id => doc.objects.find(o => o.id === id);
const single = () => selected.size === 1 ? find([...selected][0]) : null;
function notice(message, error = false) { $('#message').textContent = message; $('#message').classList.toggle('error', error); }
function setAutosaveStatus(message, error = false) {
  const status = $('#autosaveStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', error);
  status.title = error ? message : '';
}
function displaySavedAt(value) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function markAutosaveDirty() {
  autosaveDirty = true;
  setAutosaveStatus('待自动保存');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 500);
}
function writeAutosave(status = 'pending') {
  const result = status === 'acknowledged' ? autosaveStore.saveAcknowledged(doc) : autosaveStore.savePending(doc);
  if (!result.ok) {
    setAutosaveStatus('自动保存失败', true);
    const statusNode = $('#autosaveStatus');
    if (statusNode) statusNode.title = `自动保存失败：${result.error.message}`;
    return result;
  }
  autosaveDirty = false;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  setAutosaveStatus(`已自动保存 ${displaySavedAt(result.draft.savedAt)}`);
  return result;
}
function flushAutosave() {
  autosaveTimer = null;
  if (autosaveDirty) writeAutosave('pending');
}
function resetHistory() {
  history.undoStack.length = 0;
  history.redoStack.length = 0;
}
function recoverDraft(draft) {
  if (!draft) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  autosaveDirty = false;
  pendingAutosaveDraft = null;
  resetHistory();
  restore({ document: draft.document, selection: [] });
  const result = writeAutosave('acknowledged');
  autosaveDialog.hidden = true;
  notice('已恢复自动保存的地图草稿');
  return result;
}
function initializeAutosave() {
  const result = autosaveStore.load();
  const statusNode = $('#autosaveStatus');
  if (result.error) {
    setAutosaveStatus(result.invalid ? '无效草稿已清除' : '自动保存不可用', true);
    if (statusNode) statusNode.title = result.invalid
      ? `无效草稿已清除：${result.error.message}`
      : `无法读取自动保存：${result.error.message}`;
  }
  const draft = result.draft;
  if (draft?.status === 'acknowledged') {
    resetHistory();
    restore({ document: draft.document, selection: [] });
    setAutosaveStatus(`已自动保存 ${displaySavedAt(draft.savedAt)}`);
    return;
  }
  if (draft?.status === 'pending') {
    pendingAutosaveDraft = draft;
    $('#autosaveSummary').textContent = `发现尚未确认的自动保存草稿“${draft.document.name}”，包含 ${draft.document.objects.length} 个对象，保存于 ${new Date(draft.savedAt).toLocaleString()}。`;
    autosaveDialog.hidden = false;
    setAutosaveStatus('有待恢复的草稿');
  } else if (!result.error) {
    setAutosaveStatus('自动保存就绪');
  }
  rebuild();
}
$('#autosaveRestoreBtn').onclick = () => recoverDraft(pendingAutosaveDraft);
$('#autosaveDiscardBtn').onclick = () => {
  const result = autosaveStore.clear();
  pendingAutosaveDraft = null;
  autosaveDialog.hidden = true;
  setAutosaveStatus(result.ok ? '草稿已丢弃' : '无法清除自动保存草稿', !result.ok);
  if (!result.ok) {
    const statusNode = $('#autosaveStatus');
    if (statusNode) statusNode.title = `无法清除自动保存草稿：${result.error.message}`;
  }
};
setInterval(() => { if (autosaveDirty) flushAutosave(); }, 30_000);
addEventListener('pagehide', flushAutosave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAutosave(); });
/**
 * Runs an action and reports whatever it throws. Async actions are awaited too: without the
 * catch below a rejected fetch (an unreachable target, a refused Unity project) escapes as an
 * unhandled rejection instead of reaching the notice bar.
 */
function safely(action) {
  try {
    const result = action();
    if (result && typeof result.then === 'function') result.catch(error => notice(error.message, true));
    return result;
  } catch (error) { notice(error.message, true); }
}
/** Chromium refuses to replace markup that still holds the focused control while that control's own change event is dispatching, so drop the focus first. */
function blurActiveInside(root) { const active = document.activeElement; if (active && active !== root && root.contains(active) && typeof active.blur === 'function') active.blur(); }
function nextId(document) { const ids = new Set(document.objects.map(o => o.id)); let n = 1; while (ids.has(`obj_${n}`)) n++; return `obj_${n}`; }
function commit(change, selection = null, message = '修改已保存，可撤销') {
  if (gizmo.dragging) return;
  const before = capture(), draft = clone(doc); change(draft); refreshCeilings(draft); refreshWalls(draft);
  const after = { document: normalizeDocument(draft), selection: selection instanceof Function ? selection(draft) : selection ?? [...selected] };
  const changed = history.record(before, after);
  restore(after);
  if (changed) markAutosaveDirty();
  notice(message);
}
function restore(snapshot) {
  doc = clone(snapshot.document); selected = new Set(snapshot.selection.filter(id => doc.objects.some(o => o.id === id)));
  gridStep = doc.settings.gridSize; $('#gridSize').value = String(gridStep); $('#gridStatus').textContent = `GRID ${gridStep}M · PERSPECTIVE`;
  rebuild();
}

function refreshCeilings(document) {
  const matrices = new Map(), byId = new Map(document.objects.map(o => [o.id, o]));
  const matrix = node => {
    if (matrices.has(node.id)) return matrices.get(node.id);
    const t = node.transform, m = new THREE.Matrix4().compose(new THREE.Vector3(...t.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation)), new THREE.Vector3(...t.scale));
    if (node.parentId) m.premultiply(matrix(byId.get(node.parentId)));
    matrices.set(node.id, m); return m;
  };
  for (const node of document.objects) {
    if (!node.unity.ceilingTrapGrids?.length) continue;
    assertCeilingSupport(node);
    const base = matrix(node), right = new THREE.Vector3().setFromMatrixColumn(base, 0), up = new THREE.Vector3().setFromMatrixColumn(base, 1), forward = new THREE.Vector3().setFromMatrixColumn(base, 2);
    if (up.clone().normalize().dot(new THREE.Vector3(0, 1, 0)) < .999 || Math.abs(right.clone().normalize().dot(forward.clone().normalize())) > .001 || base.determinant() <= 0)
      throw new Error('天花板的父级变换造成倾斜、剪切或负缩放，请先调整父级。');
    const size = node.type === 'plane' ? [3, .12, 3] : [1, 1, 1];
    const box = node.unity.collider, center = box.type === 'box' ? box.center.map((v, i) => v * size[i]) : [0, 0, 0];
    if (box.type === 'box') size.forEach((v, i) => { size[i] = v * box.size[i]; });
    for (const g of node.unity.ceilingTrapGrids) {
      if (!g.autoFit) continue;
      const columns = Math.floor(size[0] * right.length() / g.cellSize + .001), rows = Math.floor(size[2] * forward.length() / g.cellSize + .001);
      if (columns < 1 || rows < 1 || columns > 256 || rows > 256) throw new Error('天花板底面须能容纳 1–256 行/列完整格。');
      if (columns !== g.columns || rows !== g.rows) resizeCeilingMask(g, columns, rows);
      g.origin = [center[0] - columns * g.cellSize / right.length() / 2, center[1] - size[1] / 2, center[2] - rows * g.cellSize / forward.length() / 2];
      g.rotation = [Math.PI / 2, 0, 0];
    }
  }
}

function createCeiling() {
  let id;
  commit(d => {
    id = nextId(d); const node = makeNode('cube', id);
    node.name = '天花板'; node.static = true; node.collision = true; node.color = '#7894ad';
    node.transform.position = [0, 4.1, 0]; node.transform.scale = [4, .2, 4];
    addCeilingGrid(node); d.objects.push(node);
  }, () => [id], '已创建天花板与朝下安装网格，可撤销');
  focusNodes([id]);
}

function createWall() {
  let id;
  commit(d => {
    id = nextId(d);
    const node = makeNode('cube', id);
    node.name = '陷阱墙';
    node.static = true;
    node.collision = true;
    node.color = '#7894ad';
    node.transform.position = [0, 1.5, 0];
    node.transform.scale = [4, 3, .2];
    addWallGrid(node);
    d.objects.push(node);
  }, () => [id], '已创建墙面与陷阱网格，可撤销');
  focusNodes([id]);
}

function refreshWalls(document) {
  const matrices = new Map(), byId = new Map(document.objects.map(o => [o.id, o]));
  const matrix = node => {
    if (matrices.has(node.id)) return matrices.get(node.id);
    const t = node.transform, m = new THREE.Matrix4().compose(new THREE.Vector3(...t.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation)), new THREE.Vector3(...t.scale));
    if (node.parentId) m.premultiply(matrix(byId.get(node.parentId)));
    matrices.set(node.id, m);
    return m;
  };
  for (const node of document.objects) {
    if (!node.unity.wallTrapGrids?.length) continue;
    assertWallSupport(node);
    const base = matrix(node);
    const right = new THREE.Vector3().setFromMatrixColumn(base, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(base, 1);
    const forward = new THREE.Vector3().setFromMatrixColumn(base, 2);
    const axes = [right.clone().normalize(), up.clone().normalize(), forward.clone().normalize()];
    if (axes[1].dot(new THREE.Vector3(0, 1, 0)) < .999
        || Math.abs(axes[0].dot(axes[1])) > .001 || Math.abs(axes[0].dot(axes[2])) > .001
        || Math.abs(axes[1].dot(axes[2])) > .001 || base.determinant() <= 0)
      throw new Error('墙面的父级变换造成倾斜、剪切或负缩放，请先调整父级。');
    const dimensions = [1, 1, 1], collider = node.unity.collider;
    const center = collider.type === 'box' ? collider.center.map((v, i) => v * dimensions[i]) : [0, 0, 0];
    if (collider.type === 'box') dimensions.forEach((v, i) => { dimensions[i] = v * collider.size[i]; });
    for (const grid of node.unity.wallTrapGrids) {
      if (!grid.autoFit) continue;
      const columns = Math.floor(dimensions[0] * right.length() / grid.cellSize + .001);
      const rows = Math.floor(dimensions[1] * up.length() / grid.cellSize + .001);
      if (columns < 1 || rows < 1 || columns > 256 || rows > 256)
        throw new Error('墙面须能容纳 1–256 行、列的完整网格。');
      if (columns !== grid.columns || rows !== grid.rows) resizeWallMask(grid, columns, rows);
      grid.origin = [center[0] - columns * grid.cellSize / right.length() / 2,
        center[1] - rows * grid.cellSize / up.length() / 2, center[2] + dimensions[2] / 2];
      grid.rotation = [0, 0, 0];
    }
  }
}
function disposeTree(root) { root.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); }); root.clear(); }
function geometry(type) { return type === 'cube' ? new THREE.BoxGeometry(1, 1, 1) : type === 'sphere' ? new THREE.SphereGeometry(0.6, 24, 16) : type === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1.4, 24) : type === 'plane' ? new THREE.BoxGeometry(3, 0.12, 3) : null; }
function rebuild() {
  gizmo.detach(); disposeTree(world); disposeTree(overlays); runtime.clear(); selectionBoxes = []; colliderBoxes = [];
  for (const node of doc.objects) {
    const root = new THREE.Group(); root.name = node.name; root.userData.id = node.id;
    root.position.fromArray(node.transform.position); root.rotation.set(...node.transform.rotation); root.scale.fromArray(node.transform.scale);
    const geo = geometry(node.type); let mesh = null;
    if (geo) {
      const options = { color: node.color };
      const material = node.material.type === 'unlit' ? new THREE.MeshBasicMaterial(options) : new THREE.MeshStandardMaterial({ ...options, roughness: node.material.roughness, metalness: node.material.metalness });
      mesh = new THREE.Mesh(geo, material); mesh.userData.id = node.id; root.add(mesh);
    }
    runtime.set(node.id, { root, mesh });
  }
  for (const node of doc.objects) (node.parentId ? runtime.get(node.parentId).root : world).add(runtime.get(node.id).root);
  states = effectiveState(doc); world.updateMatrixWorld(true); refreshVisibility(); renderAll();
}
function isShown(node) { return states.get(node.id).visible && filters[node.category]; }
function refreshVisibility() {
  // Mesh-only visibility keeps independent display categories independent of hierarchy.
  for (const node of doc.objects) { const item = runtime.get(node.id); if (item.mesh) item.mesh.visible = isShown(node); }
  updateOverlays(); attachGizmo();
}
function updateOverlays() {
  disposeTree(overlays); selectionBoxes = []; colliderBoxes = [];
  const highlighted = descendants(doc, selected);
  for (const node of doc.objects) {
    const item = runtime.get(node.id); if (!item.mesh || !states.get(node.id).visible) continue;
    if (filters.colliders && node.collision) { const helper = new THREE.BoxHelper(item.mesh, 0xff9c63); overlays.add(helper); colliderBoxes.push(helper); }
    if (highlighted.has(node.id) && isShown(node)) { const helper = new THREE.BoxHelper(item.mesh, states.get(node.id).locked ? 0x83909b : 0x69e0bf); overlays.add(helper); selectionBoxes.push(helper); }
  }
  if (filters.unity) unityOverlays();
  ceilingOverlays();
  wallOverlays();
}

function wallOverlays() {
  for (const node of doc.objects) {
    if (!isShown(node) || (!selected.has(node.id) && !filters.unity)) continue;
    const base = runtime.get(node.id).root.matrixWorld;
    const right = new THREE.Vector3().setFromMatrixColumn(base, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(base, 1).normalize();
    const normal = new THREE.Vector3().setFromMatrixColumn(base, 2).normalize();
    for (const g of node.unity.wallTrapGrids ?? []) {
      const origin = new THREE.Vector3(...g.origin).applyMatrix4(base).addScaledVector(normal, g.surfaceOffset);
      const positions = new Float32Array(g.columns * g.rows * 72), colors = new Float32Array(positions.length);
      const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      const open = new THREE.Color(0x69e0bf), closed = new THREE.Color(0xff5f8d);
      const rightValues = right.toArray(), upValues = up.toArray(), normalValues = normal.toArray(), originValues = origin.toArray();
      let cursor = 0;
      for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.columns; x++) {
        const color = g.openCells[x + y * g.columns] ? open : closed;
        for (const [a, b] of edges) for (const corner of [corners[a], corners[b]]) {
          const dx = (x + .5) * g.cellSize + corner[0] * g.cellSize * .48;
          const dy = (y + .5) * g.cellSize + corner[1] * g.cellSize * .48;
          const dz = corner[2] * .01;
          positions[cursor] = originValues[0] + rightValues[0] * dx + upValues[0] * dy + normalValues[0] * dz;
          positions[cursor + 1] = originValues[1] + rightValues[1] * dx + upValues[1] * dy + normalValues[1] * dz;
          positions[cursor + 2] = originValues[2] + rightValues[2] * dx + upValues[2] * dy + normalValues[2] * dz;
          colors[cursor] = color.r; colors[cursor + 1] = color.g; colors[cursor + 2] = color.b;
          cursor += 3;
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      overlays.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })));
      overlays.add(new THREE.ArrowHelper(normal, origin.clone().addScaledVector(right, g.columns * g.cellSize / 2).addScaledVector(up, g.rows * g.cellSize / 2), .8, 0xffc35f));
    }
  }
}

function ceilingOverlays() {
  for (const node of doc.objects) {
    if (!isShown(node) || (!selected.has(node.id) && !filters.unity)) continue;
    const base = runtime.get(node.id).root.matrixWorld;
    const right = new THREE.Vector3().setFromMatrixColumn(base, 0).normalize();
    const forward = new THREE.Vector3().setFromMatrixColumn(base, 2).normalize();
    const normal = new THREE.Vector3().setFromMatrixColumn(base, 1).normalize().negate();
    for (const g of node.unity.ceilingTrapGrids ?? []) {
      const origin = new THREE.Vector3(...g.origin).applyMatrix4(base).addScaledVector(normal, g.surfaceOffset);
      const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, forward, normal));
      for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.columns; x++) {
        const center = origin.clone().addScaledVector(right, (x + .5) * g.cellSize).addScaledVector(forward, (y + .5) * g.cellSize);
        const m = new THREE.Matrix4().compose(center, rotation, new THREE.Vector3(g.cellSize * .96, g.cellSize * .96, .02));
        previewLine(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), m, g.openCells[x + y * g.columns] ? 0x69e0bf : 0xff5f8d);
      }
      overlays.add(new THREE.ArrowHelper(normal, origin.clone().addScaledVector(right, g.columns * g.cellSize / 2).addScaledVector(forward, g.rows * g.cellSize / 2), .8, 0x6ba7ff));
    }
  }
}
// Display-only preview of the authored Unity components, so a mapping edit is visible in
// the viewport before it is exported. This never mutates the document.
const PREVIEW_COLORS = { collider: 0xff9c63, trigger: 0xff5f8d, navLink: 0x6ba7ff, path: 0x69e0bf, core: 0xff9c63, flying: 0x6ba7ff };
function previewLine(geometry, matrix, color) {
  const object = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
  object.matrixAutoUpdate = false; object.matrix.copy(matrix); overlays.add(object); return object;
}
function previewPoint(base, offset = [0, 0, 0]) {
  return new THREE.Vector3().setFromMatrixPosition(base).add(new THREE.Vector3(...offset));
}
function previewOffsetMatrix(base, offset, scale) {
  const matrix = base.clone().multiply(new THREE.Matrix4().makeTranslation(...offset));
  return scale ? matrix.multiply(new THREE.Matrix4().makeScale(...scale)) : matrix;
}
function unityOverlays() {
  for (const node of doc.objects) {
    const item = runtime.get(node.id); if (!item || !states.get(node.id).visible || !item.mesh) continue;
    const unity = node.unity, base = item.root.matrixWorld;
    const { collider, navMesh, spawnPoint, enemyCore, pathNode, trigger } = unity;
    const colliderColor = collider.isTrigger ? PREVIEW_COLORS.trigger : PREVIEW_COLORS.collider;
    if (collider.type === 'box') previewLine(new THREE.EdgesGeometry(new THREE.BoxGeometry(...collider.size)), previewOffsetMatrix(base, collider.center), colliderColor);
    else if (collider.type === 'sphere') previewLine(new THREE.WireframeGeometry(new THREE.SphereGeometry(collider.radius, 12, 8)), previewOffsetMatrix(base, collider.center), colliderColor);
    else if (collider.type === 'capsule') previewLine(new THREE.WireframeGeometry(new THREE.CapsuleGeometry(collider.radius, Math.max(collider.height - collider.radius * 2, 0.01), 4, 8)), previewOffsetMatrix(base, collider.center), colliderColor);
    if (trigger.enabled) {
      const shape = trigger.shape === 'sphere' ? new THREE.SphereGeometry(trigger.radius, 12, 8) : new THREE.BoxGeometry(...trigger.size);
      previewLine(new THREE.WireframeGeometry(shape), previewOffsetMatrix(base, trigger.center), PREVIEW_COLORS.trigger);
    }
    if (navMesh.role === 'link') previewLine(new THREE.BufferGeometry().setFromPoints([previewPoint(base, navMesh.linkStart), previewPoint(base, navMesh.linkEnd)]), new THREE.Matrix4(), PREVIEW_COLORS.navLink);
    if (spawnPoint.enabled) {
      const direction = new THREE.Vector3(...spawnPoint.travelDirection);
      if (direction.lengthSq()) overlays.add(new THREE.ArrowHelper(direction.normalize(), previewPoint(base), 1.6, spawnPoint.monsterType === 'Flying' ? PREVIEW_COLORS.flying : PREVIEW_COLORS.collider));
    }
    if (enemyCore.enabled) previewLine(new THREE.WireframeGeometry(new THREE.SphereGeometry(Math.max(enemyCore.arrivalRadius, 0.15), 10, 6)), new THREE.Matrix4().makeTranslation(...previewPoint(base).toArray()), PREVIEW_COLORS.core);
    if (pathNode.enabled) {
      const origin = previewPoint(base);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: PREVIEW_COLORS.path }));
      marker.position.copy(origin); overlays.add(marker);
      for (const id of pathNode.links) { const target = runtime.get(id); if (target) previewLine(new THREE.BufferGeometry().setFromPoints([origin, previewPoint(target.root.matrixWorld)]), new THREE.Matrix4(), PREVIEW_COLORS.path); }
    }
  }
}
function canTransform(node) { if (!node || !isShown(node)) return false; try { assertEditable(doc, [node.id], true); return true; } catch { return false; } }
function attachGizmo() { const node = single(); if (activeTool !== 'select' && canTransform(node)) gizmo.attach(runtime.get(node.id).root); else gizmo.detach(); }
function select(ids, additive = false, toggle = false) {
  if (!additive) selected.clear();
  for (const id of ids) if (find(id)) { if (toggle && selected.has(id)) selected.delete(id); else selected.add(id); }
  updateOverlays(); attachGizmo();
  $('#objectCount').textContent = `${doc.objects.length} OBJECTS · ${selected.size} SELECTED`;
  document.querySelectorAll('.object-row').forEach(row => { row.classList.toggle('selected', selected.has(row.dataset.id)); row.setAttribute('aria-selected', selected.has(row.dataset.id)); });
  renderInspector();
}
function renderAll() {
  $('#mapName').textContent = `/ ${doc.name}`; $('#objectCount').textContent = `${doc.objects.length} OBJECTS · ${selected.size} SELECTED`;
  $('#undoBtn').disabled = !history.undoStack.length; $('#redoBtn').disabled = !history.redoStack.length; renderList(); renderInspector(); renderUnityDialog();
}
function renderList() {
  const activeFilter = filters.query.trim() || filters.type, { matches, included } = searchHierarchy(doc, filters.query, filters.type);
  $('#searchCount').textContent = activeFilter ? `${matches.size} 个匹配 · 保留父级路径` : `${doc.objects.length} 个对象 · Ctrl/⌘ 多选`;
  const children = new Map(); for (const node of doc.objects) { if (!children.has(node.parentId)) children.set(node.parentId, []); children.get(node.parentId).push(node); }
  const fragment = document.createDocumentFragment();
  function append(parent, depth) {
    for (const node of children.get(parent) ?? []) {
      if (!included.has(node.id)) continue;
      const state = states.get(node.id), hasChildren = children.has(node.id);
      const unity = unitySummary(node), unityTitle = unity.length ? ` · ${escape(unity.join(' · '))}` : '';
      const row = document.createElement('div'); row.className = `object-row${selected.has(node.id) ? ' selected' : ''}${!state.visible ? ' hidden-object' : ''}${state.locked ? ' locked-object' : ''}${!matches.has(node.id) ? ' ancestor-row' : ''}`;
      row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', depth + 1); row.setAttribute('aria-selected', selected.has(node.id));
      if (hasChildren) row.setAttribute('aria-expanded', !!activeFilter || !node.collapsed);
      row.style.paddingLeft = `${6 + depth * 14}px`; row.dataset.id = node.id;
      row.innerHTML = `<button class="row-action fold" title="${node.collapsed ? '展开' : '折叠'}" ${!hasChildren ? 'disabled' : ''}>${hasChildren ? (!node.collapsed || activeFilter ? '▾' : '▸') : '·'}</button><button class="row-name" title="${escape(pathFor(node))} · ${escape(node.id)}${unityTitle}">${node.type === 'folder' ? '▤' : node.type === 'group' ? '▧' : '◇'} ${escape(node.name)}<small>${labels[node.type]}</small>${unity.length ? `<em class="unity-badge">Unity ${unity.length}</em>` : ''}</button><button class="row-action visibility" title="${node.visible ? '隐藏' : '显示'} ${escape(node.name)}" aria-pressed="${node.visible}">${node.visible ? '◉' : '○'}</button><button class="row-action lock" title="${node.locked ? '解锁' : '锁定'} ${escape(node.name)}${state.locked && !node.locked ? '（继承父级锁定）' : ''}" aria-pressed="${state.locked}">${state.locked ? '🔒' : '🔓'}</button>`;
      row.querySelector('.row-name').onclick = event => select([node.id], event.ctrlKey || event.metaKey, event.ctrlKey || event.metaKey);
      row.querySelector('.row-name').ondblclick = () => focusNodes([node.id]);
      row.querySelector('.fold').onclick = () => safely(() => commit(d => { d.objects.find(o => o.id === node.id).collapsed = !node.collapsed; }));
      row.querySelector('.visibility').onclick = () => safely(() => commit(d => { d.objects.find(o => o.id === node.id).visible = !node.visible; }));
      row.querySelector('.lock').onclick = () => safely(() => { if (state.locked && !node.locked) throw new Error('此对象继承父级锁定，请先解锁父级。'); commit(d => { d.objects.find(o => o.id === node.id).locked = !node.locked; }); });
      fragment.appendChild(row); if (hasChildren && (!node.collapsed || activeFilter)) append(node.id, depth + 1);
    }
  }
  append(null, 0); blurActiveInside($('#objectList')); $('#objectList').replaceChildren(fragment); if (!$('#objectList').childNodes.length) $('#objectList').textContent = '没有匹配的对象';
}
function pathFor(node) { const parts = [node.name]; while (node.parentId) { node = find(node.parentId); parts.unshift(node.name); } return parts.join(' / '); }
function field(label, html) { return `<div class="field"><label>${label}</label>${html}</div>`; }
function renderInspector() {
  const el = $('#inspector'), node = single();
  if (!selected.size) { blurActiveInside(el); el.innerHTML = '<p class="empty">选择对象以编辑属性。<br>文件夹和分组可包含积木或其他分组。</p>'; return; }
  if (!node) {
    blurActiveInside(el); el.innerHTML = `<p class="empty">已选择 ${selected.size} 个对象。可分组、复制或删除；锁定对象会阻止修改。</p><button class="btn" id="focusSelection">定位选区 · F</button><button class="danger" id="deleteBtn">删除选中对象及子对象</button>`;
    $('#focusSelection').onclick = () => focusNodes([...selected]); $('#deleteBtn').onclick = () => safely(deleteSelection); return;
  }
  const blocked = states.get(node.id).locked, excluded = descendants(doc, [node.id]);
  const parentOptions = '<option value="">场景根节点</option>' + doc.objects.filter(o => !excluded.has(o.id)).map(o => `<option value="${escape(o.id)}" ${o.id === node.parentId ? 'selected' : ''}>${escape(pathFor(o))}</option>`).join('');
  blurActiveInside(el); el.innerHTML = `<div class="inspector-heading"><strong>${escape(node.name)}</strong><button class="btn" id="focusSelection">定位 · F</button></div><div class="node-path">${escape(pathFor(node))}</div><div class="node-id">ID: ${escape(node.id)} · ${labels[node.type]}</div>${blocked ? '<p class="lock-notice">已锁定（含父级继承）。在层级中解锁后编辑。</p>' : ''}<fieldset ${blocked ? 'disabled' : ''}>${field('名称', `<input id="objName" value="${escape(node.name)}" maxlength="200">`)}${field('父级', `<select id="parentId">${parentOptions}</select>`)}<div class="eyebrow">Local Transform / 相对父级</div>${['position', 'rotation', 'scale'].map(prop => `<div class="transform-label">${{ position: '位置（米）', rotation: '旋转（度）', scale: '缩放' }[prop]}</div><div class="axis-grid">${node.transform[prop].map((value, i) => `<label>${'XYZ'[i]}<input type="number" step="any" ${prop === 'scale' ? 'min="0.01"' : ''} data-prop="${prop}" data-axis="${i}" value="${Number((prop === 'rotation' ? THREE.MathUtils.radToDeg(value) : value).toFixed(4))}"></label>`).join('')}</div>`).join('')}<div class="eyebrow">Object Properties / 对象属性</div>${field('颜色', `<input id="objColor" type="color" value="${node.color}">`)}${field('材质', `<select id="materialType"><option value="standard" ${node.material.type === 'standard' ? 'selected' : ''}>标准 / 受光照</option><option value="unlit" ${node.material.type === 'unlit' ? 'selected' : ''}>无光照</option></select>`)}${field('粗糙度', `<input id="roughness" type="number" min="0" max="1" step="any" value="${node.material.roughness}">`)}${field('金属度', `<input id="metalness" type="number" min="0" max="1" step="any" value="${node.material.metalness}">`)}${field('标签', `<input id="objTags" value="${escape(node.tags.join(', '))}" placeholder="多个标签用逗号分隔">`)}${field('Layer', `<input id="objLayer" type="number" min="0" max="31" step="1" value="${node.layer}">`)}${field('碰撞', `<input id="objCollision" type="checkbox" ${node.collision ? 'checked' : ''}>`)}${field('静态', `<input id="objStatic" type="checkbox" ${node.static ? 'checked' : ''}>`)}${field('Prefab', `<input id="objPrefab" value="${escape(node.prefabType)}" placeholder="例如 EnemySpawnPoint">`)}${field('显示分类', `<select id="objCategory"><option value="geometry" ${node.category === 'geometry' ? 'selected' : ''}>场景几何</option><option value="waypoint" ${node.category === 'waypoint' ? 'selected' : ''}>路径点</option><option value="decoration" ${node.category === 'decoration' ? 'selected' : ''}>装饰物</option></select>`)}<label class="parameters-label" for="objParameters">游戏逻辑参数（JSON 对象）</label><textarea id="objParameters" rows="6" spellcheck="false">${escape(JSON.stringify(node.parameters, null, 2))}</textarea><button class="btn" id="applyParameters">应用参数</button><button class="danger" id="deleteBtn">删除对象及子对象</button>${ceilingSectionHtml(node, escape)}${unitySectionHtml(node, doc, { escape, field })}</fieldset>`;
  el.querySelector('fieldset').insertAdjacentHTML('beforeend', wallSectionHtml(node, escape));
  $('#focusSelection').onclick = () => focusNodes([node.id]);
  const edit = (action, subtree = false, message = '修改已保存，可撤销') => safely(() => { assertEditable(doc, [node.id], subtree); commit(d => action(d.objects.find(o => o.id === node.id)), null, message); });
  $('#objName').onchange = e => edit(o => { o.name = e.target.value.trim() || o.id; });
  $('#parentId').onchange = e => { const value = e.target.value; safely(() => reparent([node.id], value || null)); $('#parentId').value = find(node.id).parentId ?? ''; };
  el.querySelectorAll('[data-prop]').forEach(input => input.onchange = () => {
    edit(o => { if (!input.value.trim() || !input.validity.valid) throw new Error('请输入有效数值，缩放至少为 0.01。'); o.transform[input.dataset.prop][Number(input.dataset.axis)] = input.dataset.prop === 'rotation' ? THREE.MathUtils.degToRad(Number(input.value)) : Number(input.value); }, true);
    if (input.isConnected) { const value = find(node.id).transform[input.dataset.prop][Number(input.dataset.axis)]; input.value = Number((input.dataset.prop === 'rotation' ? THREE.MathUtils.radToDeg(value) : value).toFixed(4)); }
  });
  $('#objColor').onchange = e => edit(o => { o.color = e.target.value; }); $('#materialType').onchange = e => edit(o => { o.material.type = e.target.value; });
  for (const key of ['roughness', 'metalness']) $(`#${key}`).onchange = e => edit(o => { if (!e.target.value.trim()) throw new Error('材质数值不能为空。'); o.material[key] = Number(e.target.value); });
  $('#objTags').onchange = e => edit(o => { o.tags = e.target.value.split(/[,，]/); });
  $('#objLayer').onchange = e => edit(o => { if (!e.target.value.trim()) throw new Error('Layer 不能为空。'); o.layer = Number(e.target.value); });
  $('#objCollision').onchange = e => edit(o => { o.collision = e.target.checked; }); $('#objStatic').onchange = e => edit(o => { o.static = e.target.checked; });
  $('#objPrefab').onchange = e => edit(o => { o.prefabType = e.target.value.trim(); }); $('#objCategory').onchange = e => edit(o => { o.category = e.target.value; });
  $('#applyParameters').onclick = () => edit(o => { try { o.parameters = JSON.parse($('#objParameters').value); } catch { throw new Error('游戏逻辑参数不是有效的 JSON。'); } });
  $('#deleteBtn').onclick = () => safely(deleteSelection);
  wireCeilingSection(node, el, edit, () => {});
  wireWallSection(node, el, edit, () => {});
  wireUnitySection(node, doc, { root: el, edit: (action, message) => edit(action, false, message), editScene: unityApi.editScene, notice });
}

// Preserve world placement, rejecting shear that cannot be represented as TRS.
function transformFromMatrix(matrix) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); matrix.decompose(p, q, s); const recomposed = new THREE.Matrix4().compose(p, q, s);
  if (matrix.elements.some((v, i) => Math.abs(v - recomposed.elements[i]) > 1e-5 * Math.max(1, Math.abs(v)))) throw new Error('此父级变更会产生剪切变形，请先统一父级缩放。');
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ'); return { position: p.toArray(), rotation: [e.x, e.y, e.z], scale: s.toArray() };
}
function reparent(ids, parentId) {
  const roots = rootsOf(doc, ids); assertEditable(doc, roots, true);
  if (parentId) { assertEditable(doc, [parentId]); if (descendants(doc, roots).has(parentId)) throw new Error('不能移入自身或子对象。'); }
  world.updateMatrixWorld(true); const parentMatrix = parentId ? runtime.get(parentId).root.matrixWorld : world.matrixWorld;
  const transforms = new Map(roots.map(id => [id, transformFromMatrix(parentMatrix.clone().invert().multiply(runtime.get(id).root.matrixWorld))]));
  commit(d => { for (const node of d.objects) if (transforms.has(node.id)) { node.parentId = parentId; node.transform = transforms.get(node.id); } });
}
function add(type) {
  const parent = single(), parentId = parent && ['folder', 'group'].includes(parent.type) ? parent.id : null; if (parentId) assertEditable(doc, [parentId]); let id;
  commit(d => { id = nextId(d); const node = makeNode(type, id, parentId); node.name = `${labels[type]} ${id.slice(4)}`; if (!['folder', 'group'].includes(type)) node.transform.position = [0, type === 'plane' ? -0.06 : 0.7, 0]; d.objects.push(node); if (parentId) d.objects.find(o => o.id === parentId).collapsed = false; }, () => [id]);
}
function groupSelection() {
  if (!selected.size) { add('group'); return; } const roots = rootsOf(doc, selected); assertEditable(doc, roots, true); world.updateMatrixWorld(true);
  const transforms = new Map(roots.map(id => [id, transformFromMatrix(runtime.get(id).root.matrixWorld)])); let id;
  commit(d => { id = nextId(d); const group = makeNode('group', id); group.name = `分组 ${id.slice(4)}`; d.objects.push(group); for (const node of d.objects) if (transforms.has(node.id)) { node.parentId = id; node.transform = transforms.get(node.id); } }, () => [id]);
}
function deleteSelection() { if (!selected.size) return; assertEditable(doc, selected, true); const removed = descendants(doc, selected); commit(d => { d.objects = d.objects.filter(o => !removed.has(o.id)); }, []); }
function copySelection() {
  if (!selected.size) return; const roots = rootsOf(doc, selected), all = descendants(doc, roots); world.updateMatrixWorld(true);
  clipboard = doc.objects.filter(o => all.has(o.id)).map(o => { const n = clone(o); if (roots.includes(o.id)) { n.parentId = null; n.transform = transformFromMatrix(runtime.get(o.id).root.matrixWorld); } return n; }); pasteCount = 0; notice(`已复制 ${clipboard.length} 个对象（包含子层级）`);
}
function pasteSelection(count = 1) {
  if (!clipboard?.length) return; const created = [];
  commit(d => { for (let i = 1; i <= count; i++) {
    const mapping = new Map(); for (const source of clipboard) { const node = clone(source); node.id = nextId(d); mapping.set(source.id, node.id); d.objects.push(node); }
    for (const source of clipboard) { const node = d.objects.find(o => o.id === mapping.get(source.id)); node.parentId = mapping.get(source.parentId) ?? null; if (!node.parentId) { node.transform.position[0] += gridStep * (pasteCount + i); created.push(node.id); } }
  } }, () => created); pasteCount += count;
}
function arrayDuplicate() {
  if (!selected.size) throw new Error('请先选择对象。'); const input = prompt('沿世界 X 轴阵列复制数量（1–50）', '3'); if (input === null) return;
  const count = Number(input); if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('请输入 1–50 的整数。'); copySelection(); pasteSelection(count);
}
function alignSelection() {
  const roots = rootsOf(doc, selected); if (roots.length < 2) throw new Error('请至少选择两个独立对象。'); assertEditable(doc, roots, true);
  const axis = prompt('世界坐标对齐轴：x / y / z', 'x')?.toLowerCase(); if (axis === undefined) return; if (!['x', 'y', 'z'].includes(axis)) throw new Error('对齐轴必须为 x、y 或 z。');
  world.updateMatrixWorld(true); const points = roots.map(id => runtime.get(id).root.getWorldPosition(new THREE.Vector3())), average = points.reduce((sum, p) => sum + p[axis], 0) / points.length;
  commit(d => roots.forEach((id, i) => { points[i][axis] = average; const root = runtime.get(id).root; d.objects.find(o => o.id === id).transform.position = root.parent.worldToLocal(points[i]).toArray(); }));
}
function focusNodes(ids) {
  const all = descendants(doc, ids), box = new THREE.Box3(); world.updateMatrixWorld(true);
  for (const id of all) { const item = runtime.get(id); if (item?.mesh) box.union(new THREE.Box3().setFromObject(item.mesh)); }
  if (box.isEmpty()) for (const id of ids) { const item = runtime.get(id); if (item) box.expandByPoint(item.root.getWorldPosition(new THREE.Vector3())); } if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3()), radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
  const vertical = THREE.MathUtils.degToRad(camera.fov / 2), horizontal = Math.atan(Math.tan(vertical) * camera.aspect), distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.2;
  const direction = camera.position.clone().sub(controls.target).normalize(); if (!direction.lengthSq()) direction.set(1, 1, 1).normalize();
  controls.target.copy(center); camera.position.copy(center).addScaledVector(direction, distance); camera.far = Math.max(5000, distance * 4); camera.updateProjectionMatrix(); controls.update(); notice('已定位选区；隐藏对象保持隐藏，可在层级中显示。');
}
function setTool(mode) { activeTool = mode; document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === mode)); if (mode !== 'select') gizmo.setMode(mode === 'move' ? 'translate' : mode); attachGizmo(); }
function applySnap() { gizmo.setTranslationSnap(snapEnabled ? gridStep : null); gizmo.setRotationSnap(snapEnabled ? Math.PI / 12 : null); gizmo.setScaleSnap(snapEnabled ? 0.1 : null); }
gizmo.addEventListener('dragging-changed', event => {
  controls.enabled = !event.value; if (event.value) { dragBefore = capture(); return; } if (!dragBefore) return; const before = dragBefore; dragBefore = null;
  try {
    const node = single(); assertEditable(doc, [node.id], true); const root = runtime.get(node.id).root, draft = clone(doc), target = draft.objects.find(o => o.id === node.id);
    target.transform = { position: root.position.toArray(), rotation: [root.rotation.x, root.rotation.y, root.rotation.z], scale: root.scale.toArray() };
    refreshCeilings(draft); refreshWalls(draft); doc = normalizeDocument(draft); const changed = history.record(before, capture()); rebuild(); if (changed) markAutosaveDirty(); notice('变换已保存，可撤销');
  } catch (error) { restore(before); notice(error.message, true); }
});
gizmo.addEventListener('objectChange', () => { const root = gizmo.object; if (!root) return; document.querySelectorAll('[data-prop]').forEach(input => { const value = root[input.dataset.prop]['xyz'[Number(input.dataset.axis)]]; input.value = Number((input.dataset.prop === 'rotation' ? THREE.MathUtils.radToDeg(value) : value).toFixed(4)); }); });
applySnap();
function undo() { if (gizmo.dragging) return; const previous = history.undo(capture()); if (previous) { restore(previous); markAutosaveDirty(); notice('已撤销'); } }
function redo() { if (gizmo.dragging) return; const next = history.redo(capture()); if (next) { restore(next); markAutosaveDirty(); notice('已重做'); } }
function importMapText(text) {
  let source; try { source = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON。'); }
  const next = normalizeDocument(source), before = capture(), after = { document: next, selection: [] }; const changed = history.record(before, after); restore(after); if (changed) markAutosaveDirty(); notice(`已导入 ${next.objects.length} 个对象`);
}
function exportMap() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = 'mapforge-world.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); const stats = unityStats(doc);
  writeAutosave('acknowledged');
  notice(`地图已导出：${doc.objects.length} 个对象 · Unity 组件 Prefab ${stats.linkedPrefabs} / Collider ${stats.colliders} / 天花板网格 ${stats.ceilingTrapGrids} / 墙面网格 ${stats.wallTrapGrids} / NavMesh ${stats.navMesh} / SpawnPoint ${stats.spawnPoints} / EnemyCore ${stats.enemyCores} / 路径节点 ${stats.pathNodes} / 触发器 ${stats.triggers} / 总波次 ${stats.totalWaves}`);
}
document.querySelectorAll('.piece').forEach(b => b.onclick = () => safely(() => add(b.dataset.type))); document.querySelectorAll('.tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('#ceilingBtn').onclick = () => safely(createCeiling);
$('#wallBtn').onclick = () => safely(createWall);
for (const [id, action] of Object.entries({ undoBtn: undo, redoBtn: redo, copyBtn: copySelection, pasteBtn: () => pasteSelection(), arrayBtn: arrayDuplicate, alignBtn: alignSelection, folderBtn: () => add('folder'), groupBtn: groupSelection, rootBtn: () => reparent([...selected], null), focusBtn: () => focusNodes([...selected]), saveBtn: exportMap })) $(`#${id}`).onclick = () => safely(action);
$('#newBtn').onclick = () => { const before = capture(), after = { document: normalizeDocument({ version: MAP_FORMAT_VERSION, objects: [] }), selection: [] }; const changed = history.record(before, after); restore(after); if (changed) markAutosaveDirty(); notice('已新建场景，可撤销恢复'); };
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => { const file = e.target.files?.[0]; if (!file) return; try { importMapText(await file.text()); } catch (error) { notice(`导入失败：${error.message}`, true); } finally { e.target.value = ''; } };
$('#playBtn').onclick = () => notice('请导出 JSON 后在 Unity 的 MapForge 菜单中导入并运行地图。');
$('#exampleBtn').onclick = async () => {
  try { const response = await fetch('/examples/organized-world.json'); if (!response.ok) throw new Error('示例地图加载失败。'); importMapText(await response.text()); select(doc.objects.filter(o => !o.parentId).map(o => o.id)); focusNodes([...selected]); }
  catch (error) { notice(error.message, true); }
};
/** Scene dialog that owns the prefab library, wave configuration and NavMesh bake options. */
function closeUnityDialog() { blurActiveInside(unityDialog); unityDialog.hidden = true; unityDialog.replaceChildren(); }
function renderUnityDialog() {
  if (unityDialog.hidden) return;
  blurActiveInside(unityDialog); unityDialog.innerHTML = `<div class="dialog-panel">${unitySceneHtml(doc, { escape, field })}</div>`;
  unityDialog.querySelector('[data-close]').onclick = closeUnityDialog;
  wireUnityScene(unityDialog, doc, unityApi);
}
/**
 * One-click hand-off to the Unity editor. The backend writes a revision and the
 * Unity plug-in applies it; this dialog shows the change set that will be sent and
 * the result that came back, so a send is never a blind action.
 */
const syncState = { status: null, preview: null, result: null, error: null, busy: false, targetDraft: '', sentRevision: 0 };
let syncPoll = null;
function stopSyncPolling() { if (syncPoll) { clearInterval(syncPoll); syncPoll = null; } }
function closeSyncDialog() { blurActiveInside(unitySyncDialog); unitySyncDialog.hidden = true; unitySyncDialog.replaceChildren(); stopSyncPolling(); }
/** Skips the redraw while the path field has focus so polling cannot interrupt typing. */
function renderSyncDialog(force = false) {
  if (unitySyncDialog.hidden) return;
  const active = document.activeElement;
  if (!force && active && active.id === 'syncTarget' && unitySyncDialog.contains(active)) return;
  blurActiveInside(unitySyncDialog);
  unitySyncDialog.innerHTML = `<div class="dialog-panel">${unitySyncHtml(syncState, { escape })}</div>`;
  wireUnitySync(unitySyncDialog, {
    close: closeSyncDialog,
    send: mode => safely(() => sendToUnity(mode)),
    refresh: () => safely(loadSyncState),
    target: path => safely(() => applyUnityTarget(path)),
    reset: () => safely(clearSyncBaseline),
    draft: value => { syncState.targetDraft = value; },
  });
}
async function loadSyncState() {
  const status = await fetchSyncStatus();
  syncState.status = status; syncState.error = null;
  if (!syncState.targetDraft) syncState.targetDraft = status.unityProject ?? '';
  try { syncState.preview = await fetchSyncPreview(doc); } catch (error) { syncState.preview = null; syncState.error = error.message; }
  renderSyncDialog();
}
async function applyUnityTarget(path) {
  const result = await setUnityTarget(path);
  syncState.targetDraft = result.unityProject ?? '';
  notice(result.message ?? 'Unity 工程路径已更新');
  await loadSyncState();
}
async function clearSyncBaseline() {
  const result = await resetSyncBaseline();
  notice(result.message ?? '已清除基线');
  await loadSyncState();
}
async function sendToUnity(mode) {
  syncState.busy = true; syncState.error = null; renderSyncDialog(true);
  try {
    const result = await sendMapToUnity(doc, mode);
    syncState.busy = false; syncState.preview = result; syncState.sentRevision = result.revision;
    notice(result.message ?? '地图已发送到 Unity');
    renderSyncDialog(true);
    // The editor applies the revision on its next poll, so wait for its receipt
    // instead of claiming success the moment the file is written.
    startSyncPolling(result.revision);
  } catch (error) {
    syncState.busy = false; syncState.error = error.message; renderSyncDialog(true); throw error;
  }
}
function startSyncPolling(revision) {
  stopSyncPolling();
  let attempts = 0;
  syncPoll = setInterval(async () => {
    attempts++;
    try { syncState.status = await fetchSyncStatus(); } catch { /* keep waiting for the next poll */ }
    const applied = syncState.status?.lastResult?.revision ?? 0;
    if (applied >= revision) {
      stopSyncPolling();
      syncState.result = syncState.status.lastResult;
      notice(syncState.result.ok
        ? `Unity 已应用第 ${applied} 版：新建 ${syncState.result.created} / 修改 ${syncState.result.updated} / 删除 ${syncState.result.deleted}。`
        : `Unity 未能应用第 ${applied} 版：${syncState.result.message ?? '见回执日志'}`);
    }
    renderSyncDialog();
    if (attempts >= 60) stopSyncPolling();
  }, 1500);
}
function refreshSyncBadge() {
  fetchSyncStatus().then(status => {
    const button = $('#sendUnityBtn');
    button.classList.toggle('connected', Boolean(status.connected));
    button.title = status.connected
      ? `Unity 编辑器在线${status.appliedScene ? ` · ${status.appliedScene}` : ''}（第 ${status.appliedRevision} 版）`
      : '把当前地图增量发送到 Unity 编辑器（当前未检测到 Unity 编辑器）';
  }).catch(() => { });
}
$('#sendUnityBtn').onclick = async () => {
  unitySyncDialog.hidden = false;
  renderSyncDialog(true);
  notice('正在读取 Unity 同步状态…');
  try { await loadSyncState(); if (syncState.sentRevision) startSyncPolling(syncState.sentRevision); }
  catch (error) { notice(`读取同步状态失败：${error.message}`, true); }
};
setInterval(refreshSyncBadge, 20000); refreshSyncBadge();
$('#unityBtn').onclick = () => { unityDialog.hidden = false; renderUnityDialog(); notice('场景级 Unity 配置：Prefab 库、波次与 NavMesh 烘焙。'); };
$('#gridSize').onchange = e => safely(() => {
  const value = Number(e.target.value); commit(d => { d.settings.gridSize = value; }, null, '场景设置已保存，可撤销'); applySnap();
}); $('#snap').onchange = e => { snapEnabled = e.target.value === '开启'; applySnap(); };
$('#hierarchySearch').oninput = e => { filters.query = e.target.value; renderList(); }; $('#typeFilter').onchange = e => { filters.type = e.target.value; renderList(); };
$('#selectedTypeBtn').onclick = () => { const node = single(); if (!node) { notice('请先选择一个对象', true); return; } filters.type = node.type; $('#typeFilter').value = node.type; renderList(); };
$('#clearFilterBtn').onclick = () => { filters.query = ''; filters.type = ''; $('#hierarchySearch').value = ''; $('#typeFilter').value = ''; renderList(); };
document.querySelectorAll('[data-display]').forEach(input => input.onchange = () => { filters[input.dataset.display] = input.checked; refreshVisibility(); });

let pointerStart = null, dragBox = null;
function endPointer() { pointerStart = null; dragBox?.remove(); dragBox = null; if (!gizmo.dragging) controls.enabled = true; }
renderer.domElement.addEventListener('pointerdown', event => {
  if (event.button !== 0 || gizmo.dragging || gizmo.axis) return; const additive = event.ctrlKey || event.metaKey;
  if (additive && activeTool === 'select') { controls.enabled = false; event.preventDefault(); }
  pointerStart = { x: event.clientX, y: event.clientY, additive, box: additive && activeTool === 'select' }; renderer.domElement.setPointerCapture(event.pointerId);
}, true);
renderer.domElement.addEventListener('pointermove', event => {
  if (!pointerStart?.box) return; const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y;
  if (!dragBox && Math.hypot(dx, dy) > 5) { dragBox = document.createElement('div'); dragBox.className = 'selection-box'; viewport.appendChild(dragBox); }
  if (dragBox) { const rect = viewport.getBoundingClientRect(); Object.assign(dragBox.style, { left: `${Math.min(pointerStart.x, event.clientX) - rect.left}px`, top: `${Math.min(pointerStart.y, event.clientY) - rect.top}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` }); }
});
renderer.domElement.addEventListener('pointerup', event => {
  if (!pointerStart) return; const start = pointerStart, box = dragBox?.getBoundingClientRect(); endPointer(); if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
  const candidates = doc.objects.filter(o => runtime.get(o.id).mesh && isShown(o) && !states.get(o.id).locked), rect = renderer.domElement.getBoundingClientRect();
  if (box) {
    const hits = candidates.filter(o => { const p = runtime.get(o.id).root.getWorldPosition(new THREE.Vector3()).project(camera), x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2; return p.z >= -1 && p.z <= 1 && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom; }); select(hits.map(o => o.id), true); return;
  }
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 || gizmo.dragging) return;
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(candidates.map(o => runtime.get(o.id).mesh), false)[0]; if (hit) select([hit.object.userData.id], start.additive, start.additive); else if (!start.additive) select([]);
});
renderer.domElement.addEventListener('pointercancel', endPointer); renderer.domElement.addEventListener('lostpointercapture', endPointer); addEventListener('blur', endPointer);
addEventListener('keydown', e => {
  if (!autosaveDialog.hidden) { e.preventDefault(); return; }
  if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
  const key = e.key.toLowerCase(), modifier = e.ctrlKey || e.metaKey;
  if (modifier) { const action = key === 'z' ? (e.shiftKey ? redo : undo) : ({ y: redo, c: copySelection, v: () => pasteSelection(), g: groupSelection, a: () => select(doc.objects.filter(o => isShown(o) && !states.get(o.id).locked).map(o => o.id)) })[key]; if (action) { e.preventDefault(); safely(action); } return; }
  const mode = { q: 'select', w: 'move', e: 'rotate', r: 'scale' }[key]; if (mode) setTool(mode);
  if (key === 'delete' || key === 'backspace') { e.preventDefault(); safely(deleteSelection); } if (key === 'f') focusNodes([...selected]); if (key === 'escape') { if (!unitySyncDialog.hidden) closeSyncDialog(); else if (!unityDialog.hidden) closeUnityDialog(); else select([]); }
});
function resize() { const w = viewport.clientWidth, h = viewport.clientHeight; if (!w || !h) return; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); }
new ResizeObserver(resize).observe(viewport); resize(); initializeAutosave();
(function loop() { requestAnimationFrame(loop); controls.update(); world.updateMatrixWorld(true); selectionBoxes.forEach(b => b.update()); colliderBoxes.forEach(b => b.update()); renderer.render(scene, camera); })();
