// Unity component mapping UI: per-object inspector blocks plus the scene-level
// dialog for the prefab library, wave configuration and NavMesh bake options.
import {
  MONSTER_TYPES, UNITY_COLLIDER_TYPES, UNITY_COLLECT_OBJECTS, UNITY_LABELS, UNITY_NAV_ROLES,
  UNITY_PATH_ROLES, UNITY_PREFAB_KINDS, UNITY_TRIGGER_ACTIONS, UNITY_TRIGGER_SHAPES, UNITY_TRIGGER_WHENS,
} from './scene-model.js';

const COMPONENTS = [
  ['prefab', 'Prefab 引用', node => node.unity.prefab.id, '未引用'],
  ['collider', 'Collider', node => node.unity.collider.type !== 'auto' || node.unity.collider.isTrigger, '图元默认'],
  ['navMesh', 'NavMesh', node => node.unity.navMesh.role !== 'none', '未标记'],
  ['spawnPoint', 'SpawnPoint', node => node.unity.spawnPoint.enabled, '未启用'],
  ['enemyCore', 'EnemyCore', node => node.unity.enemyCore.enabled, '未启用'],
  ['pathNode', '路径节点', node => node.unity.pathNode.enabled, '未启用'],
  ['trigger', '触发器', node => node.unity.trigger.enabled, '未启用'],
];
const isOn = (node, key) => COMPONENTS.find(component => component[0] === key)[2](node);

const option = (value, label, selected) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`;
const options = (values, table, selected) => values.map(value => option(value, table?.[value] ?? value, selected)).join('');
const group = (title, note, body) => `<div class="unity-group"><div class="unity-title">${title}${note ? `<span class="unity-note-inline">${note}</span>` : ''}</div>${body}</div>`;

/** Inspector markup for every Unity component the exporter understands. */
export function unitySectionHtml(node, doc, helper) {
  const { escape, field } = helper;
  const { prefab, collider, navMesh, spawnPoint, enemyCore, pathNode, trigger } = node.unity;
  const prefabPicker = option('', '（不引用 Prefab）', prefab.id) +
    doc.unity.prefabs.map(entry => option(entry.id, `${entry.name} · ${entry.id}`, prefab.id)).join('');
  const enemyPicker = option('', '（使用默认 Prefab）', spawnPoint.enemyPrefabId) +
    doc.unity.prefabs.map(entry => option(entry.id, entry.name, spawnPoint.enemyPrefabId)).join('');
  const vector = (label, groupName, key, values, step) => field(label, `<div class="axis-grid">${values.map((value, axis) =>
    `<label>${'XYZ'[axis]}<input type="number" ${step} step="any" data-unity-vector="${groupName}" data-unity-key="${key}" data-axis="${axis}" value="${value}"></label>`).join('')}</div>`);
  const waveRows = spawnPoint.waves.map((wave, index) => `<div class="unity-row" data-wave="${index}">
      <label class="unity-check" title="第 ${index + 1} 波是否出怪"><input type="checkbox" data-wave-field="enabled" ${wave.enabled ? 'checked' : ''}></label>
      <input type="number" min="0" max="999" step="1" data-wave-field="enemyCount" value="${wave.enemyCount}" title="第 ${index + 1} 波数量">
      <select data-wave-field="monsterType" title="第 ${index + 1} 波怪物类型">${options(['', ...MONSTER_TYPES], { '': '默认类型', Ground: '地面', Flying: '飞行' }, wave.monsterType)}</select>
      <input type="number" min="0" step="any" data-wave-field="flightHeight" value="${wave.flightHeight}" title="第 ${index + 1} 波飞行高度">
      <button class="row-action" data-wave-remove title="删除第 ${index + 1} 波">✕</button>
    </div>`).join('');
  const eventRows = trigger.events.map((event, index) => `<div class="unity-row event-row" data-event="${index}">
      <select data-event-field="when" title="触发时机">${options(UNITY_TRIGGER_WHENS, { enter: '进入', exit: '离开' }, event.when)}</select>
      <select data-event-field="action" title="触发动作">${options(UNITY_TRIGGER_ACTIONS, UNITY_LABELS.action, event.action)}</select>
      <input data-event-field="target" value="${escape(event.target)}" placeholder="目标对象 ID" title="目标对象 ID，可留空">
      <input data-event-field="message" value="${escape(event.message)}" placeholder="消息 / 说明">
      <input type="number" min="0" step="any" data-event-field="amount" value="${event.amount}" title="数值">
      <input type="number" min="0" step="any" data-event-field="delay" value="${event.delay}" title="延迟秒数">
      <button class="row-action" data-event-remove title="删除事件">✕</button>
    </div>`).join('');
  const chips = COMPONENTS.map(([key, label, , off]) => {
    const on = isOn(node, key);
    return `<span class="unity-chip${on ? ' on' : ''}">${label}<small>${on ? '已配置' : off}</small></span>`;
  }).join('');
  return `<div class="unity-section"><div class="eyebrow">Unity Mapping / Unity 组件映射</div>
  <div class="unity-chips">${chips}</div>
  <div class="hint">组件配置随地图保存并导出，Unity 导入器据此创建组件；未配置的部分保持 Unity 默认值。</div>
  ${group('Prefab 引用', '导出为 Prefab ID',
    field('选择', `<select id="unityPrefabPick">${prefabPicker}</select>`) +
    field('Prefab ID', `<input id="unityPrefabId" value="${escape(prefab.id)}" placeholder="例如 EnemySpawnPoint">`) +
    field('资产路径', `<input id="unityPrefabPath" value="${escape(prefab.assetPath)}" placeholder="Assets/Prefabs/TestMonster.prefab">`) +
    field('GUID', `<input id="unityPrefabGuid" value="${escape(prefab.guid)}" placeholder="可选">`))}
  ${group('Collider 类型', 'auto 保留 Unity 图元碰撞体',
    field('类型', `<select id="unityColliderType">${options(UNITY_COLLIDER_TYPES, UNITY_LABELS.collider, collider.type)}</select>`) +
    field('Is Trigger', `<input id="unityColliderTrigger" type="checkbox" ${collider.isTrigger ? 'checked' : ''}>`) +
    vector('中心', 'collider', 'center', collider.center) +
    vector('尺寸', 'collider', 'size', collider.size, 'min="0.001"') +
    field('半径', `<input id="unityColliderRadius" type="number" min="0.01" step="any" value="${collider.radius}">`) +
    field('高度', `<input id="unityColliderHeight" type="number" min="0.01" step="any" value="${collider.height}">`) +
    field('轴向', `<select id="unityColliderDirection">${options(['0', '1', '2'], { 0: 'X 轴', 1: 'Y 轴（默认）', 2: 'Z 轴' }, String(collider.direction))}</select>`))}
  ${group('NavMesh 标记', '写入 NavMeshModifier / NavMeshLink / NavMeshSurface',
    field('标记', `<select id="unityNavRole">${options(UNITY_NAV_ROLES, UNITY_LABELS.nav, navMesh.role)}</select>`) +
    field('区域', `<input id="unityNavArea" type="number" min="0" max="31" step="1" value="${navMesh.area}">`) +
    field('代理类型', `<input id="unityNavAgent" value="${escape(navMesh.agentType)}" placeholder="Humanoid">`) +
    field('烘焙跳过', `<input id="unityNavIgnore" type="checkbox" ${navMesh.ignoreFromBuild ? 'checked' : ''}>`) +
    field('含子对象', `<input id="unityNavChildren" type="checkbox" ${navMesh.applyToChildren ? 'checked' : ''}>`) +
    (navMesh.role === 'link'
      ? vector('连接起点', 'navMesh', 'linkStart', navMesh.linkStart) +
        vector('连接终点', 'navMesh', 'linkEnd', navMesh.linkEnd) +
        field('连接宽度', `<input id="unityNavLinkWidth" type="number" min="0.01" step="any" value="${navMesh.linkWidth}">`) +
        field('双向', `<input id="unityNavBidirectional" type="checkbox" ${navMesh.bidirectional ? 'checked' : ''}>`)
      : ''))}
  ${group('SpawnPoint', '敌人出怪口与波次覆盖',
    field('启用', `<input id="unitySpawnEnabled" type="checkbox" ${spawnPoint.enabled ? 'checked' : ''}>`) +
    field('出怪间隔', `<input id="unitySpawnInterval" type="number" min="0.01" max="600" step="any" value="${spawnPoint.spawnInterval}">`) +
    field('首波延迟', `<input id="unitySpawnDelay" type="number" min="0" max="600" step="any" value="${spawnPoint.initialDelay}">`) +
    field('每波数量', `<input id="unitySpawnCount" type="number" min="0" max="999" step="1" value="${spawnPoint.enemiesPerWave}">`) +
    field('移动速度', `<input id="unitySpawnSpeed" type="number" min="0" max="100" step="any" value="${spawnPoint.moveSpeed}">`) +
    vector('行进方向', 'spawnPoint', 'travelDirection', spawnPoint.travelDirection) +
    field('怪物类型', `<select id="unitySpawnMonster">${options(MONSTER_TYPES, { Ground: '地面', Flying: '飞行' }, spawnPoint.monsterType)}</select>`) +
    field('飞行高度', `<input id="unitySpawnFlight" type="number" min="0" max="200" step="any" value="${spawnPoint.flightHeight}">`) +
    field('飞行入口', `<input id="unitySpawnFlying" type="checkbox" ${spawnPoint.flyingEntrance ? 'checked' : ''}>`) +
    field('入口高度', `<input id="unitySpawnAltitude" type="number" min="0" max="500" step="any" value="${spawnPoint.entranceAltitude}">`) +
    field('路线 ID', `<input id="unitySpawnLane" value="${escape(spawnPoint.laneId)}" placeholder="可选，例如 lane_0">`) +
    field('敌人 Prefab', `<select id="unitySpawnPrefab">${enemyPicker}</select>`) +
    `<div class="unity-title">逐波覆盖<span class="unity-note-inline">第 1 波起依次生效</span></div>` +
    `<div class="unity-table wave-table"><div class="unity-row head"><span>启用</span><span>数量</span><span>类型</span><span>高度</span><span></span></div>${waveRows || '<div class="unity-note">没有逐波覆盖，使用上面的默认数量。</div>'}</div>` +
    `<button class="btn" id="unityWaveAdd">＋ 添加波次覆盖</button>`)}
  ${group('EnemyCore', '敌人终点核心属性',
    field('启用', `<input id="unityCoreEnabled" type="checkbox" ${enemyCore.enabled ? 'checked' : ''}>`) +
    field('核心血量', `<input id="unityCoreHealth" type="number" min="1" step="any" value="${enemyCore.maxHealth}">`) +
    field('地面伤害', `<input id="unityCoreGround" type="number" min="0" step="any" value="${enemyCore.groundDamage}">`) +
    field('飞行伤害', `<input id="unityCoreFlying" type="number" min="0" step="any" value="${enemyCore.flyingDamage}">`) +
    field('到达半径', `<input id="unityCoreRadius" type="number" min="0.01" step="any" value="${enemyCore.arrivalRadius}">`))}
  ${group('路径节点', '路径点标记与连线',
    field('启用', `<input id="unityPathEnabled" type="checkbox" ${pathNode.enabled ? 'checked' : ''}>`) +
    field('角色', `<select id="unityPathRole">${options(UNITY_PATH_ROLES, UNITY_LABELS.path, pathNode.role)}</select>`) +
    field('停留', `<input id="unityPathWait" type="number" min="0" max="600" step="any" value="${pathNode.waitTime}">`) +
    field('连线', `<input id="unityPathLinks" value="${escape(pathNode.links.join(', '))}" placeholder="目标对象 ID，逗号分隔">`))}
  ${group('触发器', '触发体与事件列表',
    field('启用', `<input id="unityTriggerEnabled" type="checkbox" ${trigger.enabled ? 'checked' : ''}>`) +
    field('形状', `<select id="unityTriggerShape">${options(UNITY_TRIGGER_SHAPES, { box: '盒体', sphere: '球体' }, trigger.shape)}</select>`) +
    field('Is Trigger', `<input id="unityTriggerIs" type="checkbox" ${trigger.isTrigger ? 'checked' : ''}>`) +
    field('仅触发一次', `<input id="unityTriggerOnce" type="checkbox" ${trigger.once ? 'checked' : ''}>`) +
    vector('中心', 'trigger', 'center', trigger.center) +
    vector('尺寸', 'trigger', 'size', trigger.size, 'min="0.001"') +
    field('半径', `<input id="unityTriggerRadius" type="number" min="0.01" step="any" value="${trigger.radius}">`) +
    `<div class="unity-table event-table"><div class="unity-row head"><span>时机</span><span>动作</span><span>目标</span><span>消息</span><span>数值</span><span>延迟</span><span></span></div>${eventRows || '<div class="unity-note">还没有触发事件。</div>'}</div>` +
    `<button class="btn" id="unityEventAdd">＋ 添加触发事件</button>`)}
  </div>`;
}

/**
 * Wires the Unity section. Every edit is funnelled through api.edit, so the
 * shared commit path keeps validation, undo/redo and locked-object rules.
 */
export function wireUnitySection(node, doc, api) {
  const root = api.root, read = input => {
    if (!input.value.trim() || !input.validity.valid) throw new Error('请输入有效数值，注意各项的取值范围。');
    return Number(input.value);
  };
  const edit = (action, message) => api.edit(draft => action(draft.unity), message);
  const onCheck = (id, action, message) => { const input = root.querySelector(`#${id}`); if (input) input.onchange = () => edit(u => action(u, input.checked), message); };
  const onNumber = (id, action, message) => { const input = root.querySelector(`#${id}`); if (input) input.onchange = () => edit(u => action(u, read(input)), message); };
  const onSelect = (id, action, message) => { const input = root.querySelector(`#${id}`); if (input) input.onchange = () => edit(u => action(u, input.value), message); };
  const onText = (id, action, message) => { const input = root.querySelector(`#${id}`); if (input) input.onchange = () => edit(u => action(u, input.value.trim()), message); };
  const onVector = (groupName, key, action, message) => root.querySelectorAll(`[data-unity-vector="${groupName}"][data-unity-key="${key}"]`).forEach(input =>
    input.onchange = () => edit(u => { action(u)[key][Number(input.dataset.axis)] = read(input); }, message));

  onSelect('unityPrefabPick', (u, value) => {
    const entry = doc.unity.prefabs.find(item => item.id === value);
    u.prefab = entry ? { id: entry.id, guid: entry.guid, assetPath: entry.assetPath } : { id: '', guid: '', assetPath: '' };
  }, 'Prefab 引用已更新');
  onText('unityPrefabId', (u, value) => { u.prefab.id = value; }, 'Prefab ID 已保存');
  onText('unityPrefabPath', (u, value) => { u.prefab.assetPath = value; }, 'Prefab 资产路径已保存');
  onText('unityPrefabGuid', (u, value) => { u.prefab.guid = value; }, 'Prefab GUID 已保存');
  onSelect('unityColliderType', (u, value) => { u.collider.type = value; }, 'Collider 类型已保存');
  onCheck('unityColliderTrigger', (u, value) => { u.collider.isTrigger = value; }, 'Collider 触发器标记已保存');
  onVector('collider', 'center', u => u.collider, 'Collider 中心已保存');
  onVector('collider', 'size', u => u.collider, 'Collider 尺寸已保存');
  onNumber('unityColliderRadius', (u, value) => { u.collider.radius = value; }, 'Collider 半径已保存');
  onNumber('unityColliderHeight', (u, value) => { u.collider.height = value; }, 'Collider 高度已保存');
  onSelect('unityColliderDirection', (u, value) => { u.collider.direction = Number(value); }, 'Collider 轴向已保存');
  onSelect('unityNavRole', (u, value) => { u.navMesh.role = value; }, 'NavMesh 标记已保存');
  onNumber('unityNavArea', (u, value) => { u.navMesh.area = value; }, 'NavMesh 区域已保存');
  onText('unityNavAgent', (u, value) => { u.navMesh.agentType = value || 'Humanoid'; }, 'NavMesh 代理类型已保存');
  onCheck('unityNavIgnore', (u, value) => { u.navMesh.ignoreFromBuild = value; }, 'NavMesh 烘焙跳过已保存');
  onCheck('unityNavChildren', (u, value) => { u.navMesh.applyToChildren = value; }, 'NavMesh 子对象选项已保存');
  onVector('navMesh', 'linkStart', u => u.navMesh, 'NavMesh 连接起点已保存');
  onVector('navMesh', 'linkEnd', u => u.navMesh, 'NavMesh 连接终点已保存');
  onNumber('unityNavLinkWidth', (u, value) => { u.navMesh.linkWidth = value; }, 'NavMesh 连接宽度已保存');
  onCheck('unityNavBidirectional', (u, value) => { u.navMesh.bidirectional = value; }, 'NavMesh 连接方向已保存');
  onCheck('unitySpawnEnabled', (u, value) => { u.spawnPoint.enabled = value; }, 'SpawnPoint 标记已保存');
  onNumber('unitySpawnInterval', (u, value) => { u.spawnPoint.spawnInterval = value; }, '出怪间隔已保存');
  onNumber('unitySpawnDelay', (u, value) => { u.spawnPoint.initialDelay = value; }, '首波延迟已保存');
  onNumber('unitySpawnCount', (u, value) => { u.spawnPoint.enemiesPerWave = value; }, '每波数量已保存');
  onNumber('unitySpawnSpeed', (u, value) => { u.spawnPoint.moveSpeed = value; }, '移动速度已保存');
  onVector('spawnPoint', 'travelDirection', u => u.spawnPoint, '行进方向已保存');
  onSelect('unitySpawnMonster', (u, value) => { u.spawnPoint.monsterType = value; }, '怪物类型已保存');
  onNumber('unitySpawnFlight', (u, value) => { u.spawnPoint.flightHeight = value; }, '飞行高度已保存');
  onCheck('unitySpawnFlying', (u, value) => { u.spawnPoint.flyingEntrance = value; }, '飞行入口已保存');
  onNumber('unitySpawnAltitude', (u, value) => { u.spawnPoint.entranceAltitude = value; }, '入口高度已保存');
  onText('unitySpawnLane', (u, value) => { u.spawnPoint.laneId = value; }, '路线 ID 已保存');
  onSelect('unitySpawnPrefab', (u, value) => { u.spawnPoint.enemyPrefabId = value; }, '敌人 Prefab 已保存');
  root.querySelectorAll('[data-wave]').forEach(element => {
    const index = Number(element.dataset.wave);
    element.querySelectorAll('[data-wave-field]').forEach(input => input.onchange = () => {
      const field = input.dataset.waveField;
      edit(u => { u.spawnPoint.waves[index][field] = field === 'enabled' ? input.checked : field === 'monsterType' ? input.value : read(input); }, `第 ${index + 1} 波配置已保存`);
    });
    element.querySelector('[data-wave-remove]').onclick = () => edit(u => { u.spawnPoint.waves.splice(index, 1); }, `已删除第 ${index + 1} 波覆盖`);
  });
  root.querySelector('#unityWaveAdd').onclick = () => edit(u => {
    u.spawnPoint.waves.push({ enabled: true, enemyCount: u.spawnPoint.enemiesPerWave, monsterType: '', flightHeight: u.spawnPoint.flightHeight });
  }, '已添加波次覆盖');
  onCheck('unityCoreEnabled', (u, value) => { u.enemyCore.enabled = value; }, 'EnemyCore 标记已保存');
  onNumber('unityCoreHealth', (u, value) => { u.enemyCore.maxHealth = value; }, '核心血量已保存');
  onNumber('unityCoreGround', (u, value) => { u.enemyCore.groundDamage = value; }, '地面伤害已保存');
  onNumber('unityCoreFlying', (u, value) => { u.enemyCore.flyingDamage = value; }, '飞行伤害已保存');
  onNumber('unityCoreRadius', (u, value) => { u.enemyCore.arrivalRadius = value; }, '到达半径已保存');
  onCheck('unityPathEnabled', (u, value) => { u.pathNode.enabled = value; }, '路径节点标记已保存');
  onSelect('unityPathRole', (u, value) => { u.pathNode.role = value; }, '路径角色已保存');
  onNumber('unityPathWait', (u, value) => { u.pathNode.waitTime = value; }, '停留时间已保存');
  const links = root.querySelector('#unityPathLinks');
  links.onchange = () => {
    try {
      const ids = [...new Set(links.value.split(/[,，\s]+/).filter(Boolean))];
      const missing = ids.filter(id => id !== node.id && !doc.objects.some(o => o.id === id));
      if (missing.length) throw new Error(`路径连线指向不存在的对象：${missing.join(', ')}`);
      edit(u => { u.pathNode.links = ids; }, '路径连线已保存');
    } catch (error) {
      // Keep the authored links visible so the user can fix the typo.
      links.value = node.unity.pathNode.links.join(', ');
      api.notice(error.message, true);
    }
  };
  onCheck('unityTriggerEnabled', (u, value) => { u.trigger.enabled = value; }, '触发器标记已保存');
  onSelect('unityTriggerShape', (u, value) => { u.trigger.shape = value; }, '触发器形状已保存');
  onCheck('unityTriggerIs', (u, value) => { u.trigger.isTrigger = value; }, 'Is Trigger 已保存');
  onCheck('unityTriggerOnce', (u, value) => { u.trigger.once = value; }, '触发次数已保存');
  onVector('trigger', 'center', u => u.trigger, '触发器中心已保存');
  onVector('trigger', 'size', u => u.trigger, '触发器尺寸已保存');
  onNumber('unityTriggerRadius', (u, value) => { u.trigger.radius = value; }, '触发器半径已保存');
  root.querySelectorAll('[data-event]').forEach(element => {
    const index = Number(element.dataset.event);
    element.querySelectorAll('[data-event-field]').forEach(input => input.onchange = () => {
      const field = input.dataset.eventField;
      edit(u => {
        u.trigger.events[index][field] = field === 'when' || field === 'action' ? input.value
          : field === 'amount' || field === 'delay' ? read(input) : input.value.trim();
      }, '触发事件已保存');
    });
    element.querySelector('[data-event-remove]').onclick = () => edit(u => { u.trigger.events.splice(index, 1); }, '已删除触发事件');
  });
  root.querySelector('#unityEventAdd').onclick = () => edit(u => {
    u.trigger.events.push({ when: 'enter', action: 'spawn', target: '', message: '', amount: 1, delay: 0 });
  }, '已添加触发事件');
}

/** Scene-level dialog markup: prefab library, wave configuration and bake options. */
export function unitySceneHtml(doc, helper) {
  const { escape } = helper, { prefabs, waves, settings } = doc.unity;
  const prefabRows = prefabs.map((entry, index) => `<div class="unity-row prefab-row" data-prefab="${index}">
      <input data-prefab-field="id" value="${escape(entry.id)}" placeholder="Prefab ID">
      <input data-prefab-field="name" value="${escape(entry.name)}" placeholder="显示名">
      <select data-prefab-field="kind">${options(UNITY_PREFAB_KINDS, UNITY_LABELS.prefab, entry.kind)}</select>
      <input data-prefab-field="assetPath" value="${escape(entry.assetPath)}" placeholder="Assets/Prefabs/....prefab">
      <input data-prefab-field="guid" value="${escape(entry.guid)}" placeholder="GUID（可选）">
      <button class="row-action" data-prefab-remove title="删除 Prefab">✕</button>
    </div>`).join('');
  return `<div class="dialog-head"><strong>场景 Unity 配置</strong><button class="btn" data-close>关闭</button></div>
  <p class="hint">导出时写入顶层 <code>unity</code> 字段：Prefab 库供对象引用，波次配置生成 WaveManager，烘焙选项供 NavMeshSurface 使用。</p>
  ${group('Prefab 库', '对象属性中按 ID 引用',
    `<div class="unity-table prefab-table"><div class="unity-row head"><span>ID</span><span>显示名</span><span>用途</span><span>资产路径</span><span>GUID</span><span></span></div>${prefabRows || '<div class="unity-note">还没有 Prefab。添加后即可在对象属性中选择引用。</div>'}</div>` +
    `<button class="btn" data-prefab-add>＋ 新增 Prefab</button>`)}
  ${group('波次配置', '写入 WaveManager',
    `<div class="dialog-grid">
      <label>总波次<input data-wave-scene="totalWaves" type="number" min="1" max="99" step="1" value="${waves.totalWaves}"></label>
      <label>首波延迟<input data-wave-scene="initialDelay" type="number" min="0" max="600" step="any" value="${waves.initialDelay}"></label>
      <label>每波数量<input data-wave-scene="enemiesPerWave" type="number" min="0" max="999" step="1" value="${waves.enemiesPerWave}"></label>
      <label>出怪间隔<input data-wave-scene="spawnInterval" type="number" min="0.01" max="600" step="any" value="${waves.spawnInterval}"></label>
      <label class="wide">波间隔（逗号分隔）<input data-wave-scene="transitionDelays" value="${escape(waves.transitionDelays.join(', '))}"></label>
    </div>`)}
  ${group('NavMesh 烘焙', '写入 NavMeshSurface',
    `<div class="dialog-grid">
      <label class="check"><input data-bake="buildNavMeshOnImport" type="checkbox" ${settings.buildNavMeshOnImport ? 'checked' : ''}>导入后烘焙 NavMesh</label>
      <label>代理类型<input data-bake="agentType" value="${escape(settings.agentType)}" placeholder="Humanoid"></label>
      <label>收集方式<select data-bake="collectObjects">${options(UNITY_COLLECT_OBJECTS, { all: '全部场景', volume: '体积范围', children: '子对象', markedWithModifier: '仅标记对象' }, settings.collectObjects)}</select></label>
    </div>`)}
  <div class="unity-note" id="unitySceneStatus"></div>`;
}

/** Wires the scene dialog; edits go through the same undoable document commit. */
export function wireUnityScene(root, doc, api) {
  const status = message => { const element = root.querySelector('#unitySceneStatus'); if (element) element.textContent = message; };
  const fail = error => { status(error.message); api.notice(error.message, true); };
  root.querySelectorAll('[data-prefab]').forEach(element => {
    const index = Number(element.dataset.prefab);
    element.querySelectorAll('[data-prefab-field]').forEach(input => input.onchange = () => {
      if (input.dataset.prefabField === 'id' && !input.value.trim()) { fail(new Error('Prefab ID 不能为空。')); return; }
      try { api.editScene(u => { u.prefabs[index][input.dataset.prefabField] = input.value.trim(); }, 'Prefab 库已更新'); }
      catch (error) { fail(error); }
    });
    element.querySelector('[data-prefab-remove]').onclick = () => api.editScene(u => { u.prefabs.splice(index, 1); }, '已删除 Prefab');
  });
  root.querySelector('[data-prefab-add]').onclick = () => api.editScene(u => {
    let n = u.prefabs.length + 1;
    while (u.prefabs.some(entry => entry.id === `prefab_${n}`)) n++;
    u.prefabs.push({ id: `prefab_${n}`, name: `Prefab ${n}`, guid: '', assetPath: '', kind: 'object' });
  }, '已新增 Prefab');
  root.querySelectorAll('[data-wave-scene]').forEach(input => input.onchange = () => {
    const key = input.dataset.waveScene, current = doc.unity.waves[key];
    try {
      api.editScene(u => {
        if (key === 'transitionDelays') {
          const values = input.value.split(/[,，\s]+/).filter(Boolean).map(Number);
          if (!values.length || values.length > 32 || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('波间隔必须是最多 32 个非负数值。');
          u.waves.transitionDelays = values;
          return;
        }
        if (!input.value.trim() || !input.validity.valid) throw new Error('请输入有效数值，注意各项的取值范围。');
        u.waves[key] = Number(input.value);
      }, '波次配置已保存');
    } catch (error) { fail(error); input.value = Array.isArray(current) ? current.join(', ') : String(current); }
  });
  root.querySelectorAll('[data-bake]').forEach(input => input.onchange = () => {
    const key = input.dataset.bake;
    try {
      api.editScene(u => { u.settings[key] = key === 'buildNavMeshOnImport' ? input.checked : input.value.trim() || 'Humanoid'; }, 'NavMesh 烘焙配置已保存');
    } catch (error) { fail(error); }
  });
}
