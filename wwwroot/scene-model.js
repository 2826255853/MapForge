import { normalizeCeilingGrids } from './ceiling-traps.js';
// Serializable scene data, shared by the editor and the regression tests.
export const TYPES = ['cube', 'sphere', 'cylinder', 'plane', 'folder', 'group'];
export const CATEGORIES = ['geometry', 'waypoint', 'decoration'];
export const COLORS = { cube: '#69e0bf', sphere: '#ff9c63', cylinder: '#6ba7ff', plane: '#c5d46b' };
export const TYPE_LABELS = { cube: '立方体', sphere: '球体', cylinder: '柱体', plane: '平面', folder: '文件夹', group: '分组' };
export const MAP_FORMAT_VERSION = 2;
export const DEFAULT_MAP_SETTINGS = Object.freeze({ gridSize: 1, unit: 'meter' });

// ---- Unity component mapping ------------------------------------------------
// Every value mirrors the matching Unity component default so the exporter never
// changes behaviour the Unity importer would otherwise leave alone.
export const UNITY_COLLIDER_TYPES = ['auto', 'box', 'sphere', 'capsule', 'mesh', 'none'];
export const UNITY_NAV_ROLES = ['none', 'walkable', 'obstacle', 'notWalkable', 'link', 'source'];
export const UNITY_PATH_ROLES = ['node', 'waypoint', 'junction', 'end'];
export const UNITY_TRIGGER_SHAPES = ['box', 'sphere'];
export const UNITY_TRIGGER_WHENS = ['enter', 'exit'];
export const UNITY_TRIGGER_ACTIONS = ['spawn', 'damage', 'goal', 'message', 'enable', 'disable'];
export const MONSTER_TYPES = ['Ground', 'Flying'];
export const UNITY_WAVE_MONSTER_TYPES = ['', ...MONSTER_TYPES];
export const UNITY_PREFAB_KINDS = ['object', 'enemy', 'tower', 'trap', 'prop'];
export const UNITY_COLLECT_OBJECTS = ['all', 'volume', 'children', 'markedWithModifier'];
export const UNITY_LABELS = {
  collider: { auto: '自动（图元默认）', box: '盒体 BoxCollider', sphere: '球体 SphereCollider', capsule: '胶囊 CapsuleCollider', mesh: '网格 MeshCollider', none: '无碰撞体' },
  nav: { none: '未标记', walkable: '可行走区', obstacle: '障碍物', notWalkable: '不可行走', link: '导航连接 NavMeshLink', source: '烘焙源 NavMeshSurface' },
  path: { node: '路径节点', waypoint: '必经路点', junction: '分岔点', end: '终点' },
  action: { spawn: '生成敌人', damage: '核心受伤', goal: '判定到达', message: '发送消息', enable: '启用对象', disable: '停用对象' },
  prefab: { object: '通用物体', enemy: '敌人', tower: '炮塔', trap: '陷阱', prop: '装饰' },
};
export const DEFAULT_UNITY_WAVES = Object.freeze({ totalWaves: 3, initialDelay: 2, enemiesPerWave: 10, spawnInterval: 1, transitionDelays: [5, 5] });
export const DEFAULT_UNITY_SETTINGS = Object.freeze({ buildNavMeshOnImport: false, agentType: 'Humanoid', collectObjects: 'all' });

/** Editor-side mirror of the Unity component defaults (EnemyCore, EnemySpawnPoint, colliders). */
export function defaultUnityMapping() {
  return {
    ceilingTrapGrids: [],
    prefab: { id: '', guid: '', assetPath: '' },
    collider: { type: 'auto', isTrigger: false, center: [0, 0, 0], size: [1, 1, 1], radius: 0.5, height: 2, direction: 1 },
    navMesh: { role: 'none', area: 0, agentType: 'Humanoid', ignoreFromBuild: false, applyToChildren: false, linkStart: [0, 0, 0], linkEnd: [0, 0, 0], linkWidth: 1, bidirectional: true },
    spawnPoint: { enabled: false, spawnInterval: 1, initialDelay: 2, enemiesPerWave: 10, moveSpeed: 2, travelDirection: [0, 0, 1], monsterType: 'Ground', flightHeight: 3, flyingEntrance: false, entranceAltitude: 12, laneId: '', enemyPrefabId: '', waves: [] },
    enemyCore: { enabled: false, maxHealth: 30, groundDamage: 2, flyingDamage: 1, arrivalRadius: 0.35 },
    pathNode: { enabled: false, role: 'node', waitTime: 0, links: [] },
    trigger: { enabled: false, shape: 'box', isTrigger: true, once: false, center: [0, 0, 0], size: [1, 2, 1], radius: 1, events: [] },
  };
}

/** Scene-wide Unity mapping: prefab library, wave configuration and bake options. */
export function defaultUnityScene() {
  return {
    prefabs: [],
    waves: { totalWaves: 3, initialDelay: 2, enemiesPerWave: 10, spawnInterval: 1, transitionDelays: [5, 5] },
    settings: { buildNavMeshOnImport: false, agentType: 'Humanoid', collectObjects: 'all' },
  };
}

function unityReader(id, failure) {
  const label = key => `${id} 的 unity.${key}`;
  const reader = {
    record(key, value) {
      if (value === undefined || value === null) return {};
      if (!object(value)) failure(`${label(key)} 必须是 JSON 对象。`);
      return value;
    },
    list(key, value) {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) failure(`${label(key)} 必须是数组。`);
      return value;
    },
    bool(key, value, fallback) {
      if (value === undefined || value === null) return fallback;
      if (typeof value !== 'boolean') failure(`${label(key)} 必须是布尔值。`);
      return value;
    },
    text(key, value, fallback = '') {
      if (value === undefined || value === null) return fallback;
      if (typeof value !== 'string') failure(`${label(key)} 必须是文本。`);
      return value.trim();
    },
    choice(key, value, allowed, fallback) {
      if (value === undefined || value === null) return fallback;
      if (!allowed.includes(value)) failure(`${label(key)} 只能是 ${allowed.join(' / ')}。`);
      return value;
    },
    number(key, value, fallback, min = -Infinity, max = Infinity) {
      if (value === undefined || value === null) return fallback;
      if (!Number.isFinite(value)) failure(`${label(key)} 需要有限数值。`);
      if (value < min || value > max) failure(`${label(key)} 必须在 ${min}–${max} 之间。`);
      return value;
    },
    integer(key, value, fallback, min = -Infinity, max = Infinity) {
      const result = reader.number(key, value, fallback, min, max);
      if (!Number.isInteger(result)) failure(`${label(key)} 必须是整数。`);
      return result;
    },
    vector(key, value, fallback, positive = false) {
      if (value === undefined || value === null) return [...fallback];
      if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) failure(`${label(key)} 需要三个有限数值。`);
      if (positive && value.some(component => component <= 0)) failure(`${label(key)} 的每个分量都必须大于 0。`);
      return [...value];
    },
    numbers(key, value, fallback) {
      if (value === undefined || value === null) return [...fallback];
      if (!Array.isArray(value) || !value.every(component => Number.isFinite(component) && component >= 0)) failure(`${label(key)} 必须是非负数值数组。`);
      return [...value];
    },
    strings(key, value) {
      const list = reader.list(key, value);
      if (list.some(entry => typeof entry !== 'string')) failure(`${label(key)} 必须是文本数组。`);
      return [...new Set(list.map(entry => entry.trim()).filter(Boolean))];
    },
  };
  return reader;
}

export function normalizeUnityMapping(raw, id, failure) {
  const defaults = defaultUnityMapping();
  if (raw === undefined || raw === null) return defaults;
  if (!object(raw)) failure(`${id} 的 unity 必须是 JSON 对象。`);
  const r = unityReader(id, failure);
  const prefab = r.record('prefab', raw.prefab), collider = r.record('collider', raw.collider), navMesh = r.record('navMesh', raw.navMesh);
  const spawnPoint = r.record('spawnPoint', raw.spawnPoint), enemyCore = r.record('enemyCore', raw.enemyCore);
  const pathNode = r.record('pathNode', raw.pathNode), trigger = r.record('trigger', raw.trigger);
  const waveOverrides = r.list('spawnPoint.waves', spawnPoint.waves).map((wave, index) => {
    if (!object(wave)) failure(`${id} 的 unity.spawnPoint.waves[${index}] 必须是 JSON 对象。`);
    const w = unityReader(`${id} 的 unity.spawnPoint.waves[${index}]`, failure);
    const scope = (key, value) => (value === undefined || value === null ? undefined : value);
    return {
      enabled: w.bool('enabled', scope('enabled', wave.enabled), true),
      enemyCount: w.integer('enemyCount', scope('enemyCount', wave.enemyCount), 10, 0, 999),
      monsterType: w.choice('monsterType', scope('monsterType', wave.monsterType), UNITY_WAVE_MONSTER_TYPES, ''),
      flightHeight: w.number('flightHeight', scope('flightHeight', wave.flightHeight), 3, 0, 200),
    };
  });
  const events = r.list('trigger.events', trigger.events).map((event, index) => {
    if (!object(event)) failure(`${id} 的 unity.trigger.events[${index}] 必须是 JSON 对象。`);
    const e = unityReader(`${id} 的 unity.trigger.events[${index}]`, failure);
    const scope = (key, value) => (value === undefined || value === null ? undefined : value);
    return {
      when: e.choice('when', scope('when', event.when), UNITY_TRIGGER_WHENS, 'enter'),
      action: e.choice('action', scope('action', event.action), UNITY_TRIGGER_ACTIONS, 'message'),
      target: e.text('target', scope('target', event.target)),
      message: e.text('message', scope('message', event.message)),
      amount: e.number('amount', scope('amount', event.amount), 1, 0, 1e9),
      delay: e.number('delay', scope('delay', event.delay), 0, 0, 600),
    };
  });
  return {
    ceilingTrapGrids: normalizeCeilingGrids(raw.ceilingTrapGrids, id),
    ...(raw.wallTrapGrids === undefined ? {} : { wallTrapGrids: clone(raw.wallTrapGrids) }),
    prefab: { id: r.text('prefab.id', prefab.id), guid: r.text('prefab.guid', prefab.guid), assetPath: r.text('prefab.assetPath', prefab.assetPath) },
    collider: {
      type: r.choice('collider.type', collider.type, UNITY_COLLIDER_TYPES, defaults.collider.type),
      isTrigger: r.bool('collider.isTrigger', collider.isTrigger, defaults.collider.isTrigger),
      center: r.vector('collider.center', collider.center, defaults.collider.center),
      size: r.vector('collider.size', collider.size, defaults.collider.size, true),
      radius: r.number('collider.radius', collider.radius, defaults.collider.radius, 0.01, 1e4),
      height: r.number('collider.height', collider.height, defaults.collider.height, 0.01, 1e4),
      direction: r.integer('collider.direction', collider.direction, defaults.collider.direction, 0, 2),
    },
    navMesh: {
      role: r.choice('navMesh.role', navMesh.role, UNITY_NAV_ROLES, defaults.navMesh.role),
      area: r.integer('navMesh.area', navMesh.area, defaults.navMesh.area, 0, 31),
      agentType: r.text('navMesh.agentType', navMesh.agentType, defaults.navMesh.agentType),
      ignoreFromBuild: r.bool('navMesh.ignoreFromBuild', navMesh.ignoreFromBuild, defaults.navMesh.ignoreFromBuild),
      applyToChildren: r.bool('navMesh.applyToChildren', navMesh.applyToChildren, defaults.navMesh.applyToChildren),
      linkStart: r.vector('navMesh.linkStart', navMesh.linkStart, defaults.navMesh.linkStart),
      linkEnd: r.vector('navMesh.linkEnd', navMesh.linkEnd, defaults.navMesh.linkEnd),
      linkWidth: r.number('navMesh.linkWidth', navMesh.linkWidth, defaults.navMesh.linkWidth, 0.01, 1e4),
      bidirectional: r.bool('navMesh.bidirectional', navMesh.bidirectional, defaults.navMesh.bidirectional),
    },
    spawnPoint: {
      enabled: r.bool('spawnPoint.enabled', spawnPoint.enabled, defaults.spawnPoint.enabled),
      spawnInterval: r.number('spawnPoint.spawnInterval', spawnPoint.spawnInterval, defaults.spawnPoint.spawnInterval, 0.01, 600),
      initialDelay: r.number('spawnPoint.initialDelay', spawnPoint.initialDelay, defaults.spawnPoint.initialDelay, 0, 600),
      enemiesPerWave: r.integer('spawnPoint.enemiesPerWave', spawnPoint.enemiesPerWave, defaults.spawnPoint.enemiesPerWave, 0, 999),
      moveSpeed: r.number('spawnPoint.moveSpeed', spawnPoint.moveSpeed, defaults.spawnPoint.moveSpeed, 0, 100),
      travelDirection: r.vector('spawnPoint.travelDirection', spawnPoint.travelDirection, defaults.spawnPoint.travelDirection),
      monsterType: r.choice('spawnPoint.monsterType', spawnPoint.monsterType, MONSTER_TYPES, defaults.spawnPoint.monsterType),
      flightHeight: r.number('spawnPoint.flightHeight', spawnPoint.flightHeight, defaults.spawnPoint.flightHeight, 0, 200),
      flyingEntrance: r.bool('spawnPoint.flyingEntrance', spawnPoint.flyingEntrance, defaults.spawnPoint.flyingEntrance),
      entranceAltitude: r.number('spawnPoint.entranceAltitude', spawnPoint.entranceAltitude, defaults.spawnPoint.entranceAltitude, 0, 500),
      laneId: r.text('spawnPoint.laneId', spawnPoint.laneId),
      enemyPrefabId: r.text('spawnPoint.enemyPrefabId', spawnPoint.enemyPrefabId),
      waves: waveOverrides,
    },
    enemyCore: {
      enabled: r.bool('enemyCore.enabled', enemyCore.enabled, defaults.enemyCore.enabled),
      maxHealth: r.number('enemyCore.maxHealth', enemyCore.maxHealth, defaults.enemyCore.maxHealth, 1, 1e6),
      groundDamage: r.number('enemyCore.groundDamage', enemyCore.groundDamage, defaults.enemyCore.groundDamage, 0, 1e6),
      flyingDamage: r.number('enemyCore.flyingDamage', enemyCore.flyingDamage, defaults.enemyCore.flyingDamage, 0, 1e6),
      arrivalRadius: r.number('enemyCore.arrivalRadius', enemyCore.arrivalRadius, defaults.enemyCore.arrivalRadius, 0.01, 1e4),
    },
    pathNode: {
      enabled: r.bool('pathNode.enabled', pathNode.enabled, defaults.pathNode.enabled),
      role: r.choice('pathNode.role', pathNode.role, UNITY_PATH_ROLES, defaults.pathNode.role),
      waitTime: r.number('pathNode.waitTime', pathNode.waitTime, defaults.pathNode.waitTime, 0, 600),
      links: r.strings('pathNode.links', pathNode.links),
    },
    trigger: {
      enabled: r.bool('trigger.enabled', trigger.enabled, defaults.trigger.enabled),
      shape: r.choice('trigger.shape', trigger.shape, UNITY_TRIGGER_SHAPES, defaults.trigger.shape),
      isTrigger: r.bool('trigger.isTrigger', trigger.isTrigger, defaults.trigger.isTrigger),
      once: r.bool('trigger.once', trigger.once, defaults.trigger.once),
      center: r.vector('trigger.center', trigger.center, defaults.trigger.center),
      size: r.vector('trigger.size', trigger.size, defaults.trigger.size, true),
      radius: r.number('trigger.radius', trigger.radius, defaults.trigger.radius, 0.01, 1e4),
      events,
    },
  };
}

export function normalizeUnityScene(raw, failure) {
  const defaults = defaultUnityScene();
  if (raw === undefined || raw === null) return defaults;
  if (!object(raw)) failure('地图 unity 必须是 JSON 对象。');
  const record = (key, value) => {
    if (value === undefined || value === null) return {};
    if (!object(value)) failure(`地图 unity.${key} 必须是 JSON 对象。`);
    return value;
  };
  const prefabs = raw.prefabs ?? [];
  if (!Array.isArray(prefabs)) failure('地图 unity.prefabs 必须是数组。');
  const ids = new Set();
  const normalized = prefabs.map((entry, index) => {
    if (!object(entry)) failure(`unity.prefabs[${index}] 必须是 JSON 对象。`);
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) failure(`unity.prefabs[${index}] 缺少 Prefab ID。`);
    if (ids.has(id)) failure(`unity.prefabs 的 ID 重复：${id}`);
    ids.add(id);
    const text = (key) => {
      if (entry[key] === undefined || entry[key] === null) return '';
      if (typeof entry[key] !== 'string') failure(`unity.prefabs[${index}].${key} 必须是文本。`);
      return entry[key].trim();
    };
    const kind = entry.kind ?? 'object';
    if (!UNITY_PREFAB_KINDS.includes(kind)) failure(`unity.prefabs[${index}].kind 只能是 ${UNITY_PREFAB_KINDS.join(' / ')}。`);
    return { id, name: text('name') || id, guid: text('guid'), assetPath: text('assetPath'), kind };
  });
  const waves = record('waves', raw.waves);
  const waveNumber = (key, value, fallback, min, max) => {
    if (value === undefined || value === null) return fallback;
    if (!Number.isFinite(value) || value < min || value > max) failure(`地图 unity.waves.${key} 必须在 ${min}–${max} 之间。`);
    return value;
  };
  const totalWaves = waveNumber('totalWaves', waves.totalWaves, defaults.waves.totalWaves, 1, 99);
  if (!Number.isInteger(totalWaves)) failure('地图 unity.waves.totalWaves 必须是整数。');
  const enemiesPerWave = waveNumber('enemiesPerWave', waves.enemiesPerWave, defaults.waves.enemiesPerWave, 0, 999);
  if (!Number.isInteger(enemiesPerWave)) failure('地图 unity.waves.enemiesPerWave 必须是整数。');
  const transitionDelays = waves.transitionDelays ?? defaults.waves.transitionDelays;
  if (!Array.isArray(transitionDelays) || transitionDelays.length > 32 || !transitionDelays.every(value => Number.isFinite(value) && value >= 0)) failure('地图 unity.waves.transitionDelays 必须是最多 32 个非负数值。');
  const settings = record('settings', raw.settings);
  const collectObjects = settings.collectObjects ?? defaults.settings.collectObjects;
  if (!UNITY_COLLECT_OBJECTS.includes(collectObjects)) failure(`地图 unity.settings.collectObjects 只能是 ${UNITY_COLLECT_OBJECTS.join(' / ')}。`);
  let buildNavMeshOnImport = defaults.settings.buildNavMeshOnImport;
  if (settings.buildNavMeshOnImport !== undefined && settings.buildNavMeshOnImport !== null) {
    if (typeof settings.buildNavMeshOnImport !== 'boolean') failure('地图 unity.settings.buildNavMeshOnImport 必须是布尔值。');
    buildNavMeshOnImport = settings.buildNavMeshOnImport;
  }
  let agentType = defaults.settings.agentType;
  if (settings.agentType !== undefined && settings.agentType !== null) {
    if (typeof settings.agentType !== 'string') failure('地图 unity.settings.agentType 必须是文本。');
    agentType = settings.agentType.trim() || defaults.settings.agentType;
  }
  return {
    prefabs: normalized,
    waves: {
      totalWaves,
      initialDelay: waveNumber('initialDelay', waves.initialDelay, defaults.waves.initialDelay, 0, 600),
      enemiesPerWave,
      spawnInterval: waveNumber('spawnInterval', waves.spawnInterval, defaults.waves.spawnInterval, 0.01, 600),
      transitionDelays: [...transitionDelays],
    },
    settings: { buildNavMeshOnImport, agentType, collectObjects },
  };
}

/** Enabled Unity components of one object, used by the hierarchy and the export summary. */
export function unitySummary(node) {
  const unity = node.unity ?? defaultUnityMapping(), parts = [];
  if (unity.prefab.id) parts.push(`Prefab:${unity.prefab.id}`);
  if (unity.collider.type !== 'auto' || unity.collider.isTrigger) parts.push(`Collider:${unity.collider.type}${unity.collider.isTrigger ? '+Trigger' : ''}`);
  if (unity.navMesh.role !== 'none') parts.push(`NavMesh:${unity.navMesh.role}`);
  if (unity.spawnPoint.enabled) parts.push('SpawnPoint');
  if (unity.enemyCore.enabled) parts.push('EnemyCore');
  if (unity.pathNode.enabled) parts.push(`PathNode:${unity.pathNode.role}`);
  if (unity.trigger.enabled) parts.push(`Trigger:${unity.trigger.shape}`);
  return parts;
}

/** Scene-wide Unity mapping counts for status messages, tests and the Unity importer log. */
export function unityStats(doc) {
  const stats = { prefabs: doc.unity?.prefabs?.length ?? 0, linkedPrefabs: 0, colliders: 0, navMesh: 0, spawnPoints: 0, enemyCores: 0, pathNodes: 0, triggers: 0, triggers_events: 0, waveOverrides: 0, totalWaves: doc.unity?.waves?.totalWaves ?? 0 };
  for (const node of doc.objects) {
    const unity = node.unity;
    if (!unity) continue;
    if (unity.prefab.id) stats.linkedPrefabs++;
    if (unity.collider.type !== 'auto' || unity.collider.isTrigger) stats.colliders++;
    if (unity.navMesh.role !== 'none') stats.navMesh++;
    if (unity.spawnPoint.enabled) { stats.spawnPoints++; stats.waveOverrides += unity.spawnPoint.waves.length; }
    if (unity.enemyCore.enabled) stats.enemyCores++;
    if (unity.pathNode.enabled) stats.pathNodes++;
    if (unity.trigger.enabled) { stats.triggers++; stats.triggers_events += unity.trigger.events.length; }
  }
  return stats;
}

export const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

export function normalizeDocument(source) {
  if (!object(source) || !Array.isArray(source.objects)) fail('地图文件缺少 objects 数组。');
  // Only the current format is readable: a document without the current version
  // marker is an older export and is rejected instead of guessed at.
  if (source.version !== MAP_FORMAT_VERSION) fail('不支持的地图版本。');
  if (source.name !== undefined && typeof source.name !== 'string') fail('地图名称必须是文本。');
  if (source.settings !== undefined && !object(source.settings)) fail('地图 settings 必须是 JSON 对象。');
  const settings = source.settings ?? {};
  const gridSize = settings.gridSize ?? DEFAULT_MAP_SETTINGS.gridSize;
  if (settings.gridSize !== undefined && (!Number.isFinite(settings.gridSize) || settings.gridSize <= 0)) fail('地图 settings.gridSize 必须是大于 0 的数值。');
  const unit = settings.unit ?? DEFAULT_MAP_SETTINGS.unit;
  if (settings.unit !== undefined && settings.unit !== 'meter') fail('地图 settings.unit 必须为 meter。');
  if (source.groups !== undefined && !Array.isArray(source.groups)) fail('地图 groups 必须是数组。');
  const groups = source.groups ?? [];
  if (source.gameplay !== undefined && !object(source.gameplay)) fail('地图 gameplay 必须是 JSON 对象。');
  const gameplay = source.gameplay ?? {};
  const ids = new Set();
  const objects = source.objects.map((item, index) => {
    if (!object(item) || !TYPES.includes(item.type)) fail(`对象 ${index + 1} 的类型不受支持。`);
    const id = item.id === undefined ? `obj_${index + 1}` : item.id;
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) fail(`对象 ID 为空或重复：${id}`);
    ids.add(id);
    const text = (key, fallback) => {
      if (item[key] === undefined) return fallback;
      if (typeof item[key] !== 'string') fail(`${id} 的 ${key} 必须是文本。`);
      return item[key];
    };
    const bool = (key, fallback) => {
      if (item[key] === undefined) return fallback;
      if (typeof item[key] !== 'boolean') fail(`${id} 的 ${key} 必须是布尔值。`);
      return item[key];
    };
    if (item.transform !== undefined && !object(item.transform)) fail(`${id} 的 transform 无效。`);
    const transform = item.transform ?? {};
    const vector = (key, fallback) => {
      const value = transform[key] ?? fallback;
      if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) fail(`${id} 的 ${key} 需要三个有限数值。`);
      if (key === 'scale' && value.some(v => v < 0.01)) fail(`${id} 的缩放必须至少为 0.01。`);
      return [...value];
    };
    const parentId = item.parentId ?? null;
    if (parentId !== null && typeof parentId !== 'string') fail(`${id} 的 parentId 无效。`);
    const tags = item.tags ?? [];
    if (!Array.isArray(tags) || tags.some(v => typeof v !== 'string')) fail(`${id} 的 tags 必须是文本数组。`);
    const layer = item.layer ?? 0;
    if (!Number.isInteger(layer) || layer < 0 || layer > 31) fail(`${id} 的 Layer 必须为 0–31。`);
    const color = item.color ?? COLORS[item.type] ?? '#69e0bf';
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) fail(`${id} 的颜色需要 #RRGGBB 格式。`);
    const material = item.material ?? {};
    if (!object(material) || !['standard', 'unlit'].includes(material.type ?? 'standard')) fail(`${id} 的材质无效。`);
    for (const key of ['roughness', 'metalness']) {
      if (material[key] !== undefined && (!Number.isFinite(material[key]) || material[key] < 0 || material[key] > 1)) fail(`${id} 的 ${key} 必须为 0–1。`);
    }
    const parameters = item.parameters ?? {};
    if (!object(parameters)) fail(`${id} 的游戏逻辑参数必须是 JSON 对象。`);
    const category = item.category ?? 'geometry';
    if (!CATEGORIES.includes(category)) fail(`${id} 的显示分类无效。`);
    return {
      ...clone(item), id, type: item.type, name: text('name', id).trim() || id, parentId,
      transform: { ...clone(transform), position: vector('position', [0, 0, 0]), rotation: vector('rotation', [0, 0, 0]), scale: vector('scale', [1, 1, 1]) },
      color, material: { ...material, type: material.type ?? 'standard', roughness: material.roughness ?? 0.62, metalness: material.metalness ?? 0.08 },
      tags: [...new Set(tags.map(t => t.trim()).filter(Boolean))], layer,
      collision: bool('collision', !['folder', 'group'].includes(item.type)), static: bool('static', false),
      visible: bool('visible', true), locked: bool('locked', false), collapsed: bool('collapsed', false),
      prefabType: text('prefabType', ''), parameters: clone(parameters), parametersJson: JSON.stringify(parameters), category,
      unity: normalizeUnityMapping(item.unity, id, fail),
    };
  });
  const byId = new Map(objects.map(o => [o.id, o]));
  for (const node of objects) {
    const ancestors = new Set([node.id]);
    let current = node;
    while (current.parentId !== null) {
      if (!byId.has(current.parentId)) fail(`${current.id} 的父对象不存在。`);
      if (ancestors.has(current.parentId)) fail('父子层级不能形成循环。');
      ancestors.add(current.parentId);
      if (ancestors.size > 256) fail('父子层级不能超过 256 层。');
      current = byId.get(current.parentId);
    }
  }
  for (const node of objects)
    for (const link of node.unity.pathNode.links)
      if (!byId.has(link)) fail(`${node.id} 的路径节点连线指向不存在的对象：${link}`);
  const unity = normalizeUnityScene(source.unity, fail);
  // MapForge rotations are radians. Preserve unknown gameplay data.
  if (source.rotationUnit !== undefined && source.rotationUnit !== 'radians') fail('旋转单位必须为 radians。');
  const extensions = clone(source);
  for (const key of ['version', 'name', 'settings', 'objects', 'groups', 'gameplay', 'rotationUnit', 'unity']) delete extensions[key];
  return {
    version: MAP_FORMAT_VERSION,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : 'UNTITLED_WORLD',
    settings: { ...clone(settings), gridSize, unit },
    objects,
    groups: clone(groups),
    gameplay: clone(gameplay),
    unity,
    rotationUnit: 'radians',
    ...extensions,
  };
}

export function makeNode(type, id, parentId = null) {
  return normalizeDocument({ version: MAP_FORMAT_VERSION, objects: [{ type, id }] }).objects.map(o => ({ ...o, parentId }))[0];
}
export function descendants(doc, ids) {
  const result = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of doc.objects) if (result.has(node.parentId) && !result.has(node.id)) { result.add(node.id); changed = true; }
  }
  return result;
}
export function rootsOf(doc, ids) {
  const selected = new Set(ids), byId = new Map(doc.objects.map(o => [o.id, o]));
  return [...selected].filter(id => {
    let node = byId.get(id);
    if (!node) return false;
    while (node.parentId) { if (selected.has(node.parentId)) return false; node = byId.get(node.parentId); }
    return true;
  });
}
export function effectiveState(doc) {
  const byId = new Map(doc.objects.map(o => [o.id, o])), result = new Map();
  function visit(node) {
    if (result.has(node.id)) return result.get(node.id);
    const parent = node.parentId ? visit(byId.get(node.parentId)) : { visible: true, locked: false };
    const state = { visible: parent.visible && node.visible, locked: parent.locked || node.locked };
    result.set(node.id, state);
    return state;
  }
  doc.objects.forEach(visit);
  return result;
}
export function assertEditable(doc, ids, includeDescendants = false) {
  const state = effectiveState(doc), targets = includeDescendants ? descendants(doc, ids) : new Set(ids);
  if ([...targets].some(id => state.get(id)?.locked)) fail('对象或其子对象已锁定，请先在层级中解锁。');
}
export function searchHierarchy(doc, query = '', type = '') {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = new Set(doc.objects.filter(o => (!type || o.type === type) && words.every(w => `${o.name} ${o.id} ${o.type} ${TYPE_LABELS[o.type]} ${o.tags.join(' ')} ${o.unity.prefab.id} ${o.unity.prefab.assetPath}`.toLocaleLowerCase().includes(w))).map(o => o.id));
  const included = new Set(matches), byId = new Map(doc.objects.map(o => [o.id, o]));
  for (const id of matches) { let node = byId.get(id); while (node.parentId) { included.add(node.parentId); node = byId.get(node.parentId); } }
  return { matches, included };
}

export class History {
  constructor(limit = 80) { this.limit = limit; this.undoStack = []; this.redoStack = []; }
  record(before, after) {
    if (JSON.stringify(before.document) === JSON.stringify(after.document)) return false;
    this.undoStack.push(clone(before));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }
  undo(current) { if (!this.undoStack.length) return null; this.redoStack.push(clone(current)); return this.undoStack.pop(); }
  redo(current) { if (!this.redoStack.length) return null; this.undoStack.push(clone(current)); return this.redoStack.pop(); }
}
