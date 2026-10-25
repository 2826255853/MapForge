export function normalizeCeilingGrids(value, id = 'object') {
  if (value == null) return [];
  const fail = message => { throw new Error(`${id} 的天花板网格：${message}`); };
  if (!Array.isArray(value)) fail('必须是数组。');
  const ids = new Set();
  return value.map(g => {
    if (!g || typeof g.id !== 'string' || !g.id.trim() || ids.has(g.id.trim())) fail('ID 必须非空且唯一。');
    ids.add(g.id.trim());
    const number = (key, fallback, min, max, integer = false) => {
      const n = g[key] ?? fallback;
      if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) fail(`${key} 无效。`);
      return n;
    };
    const vector = (key, fallback) => {
      const v = g[key] ?? fallback;
      if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) fail(`${key} 需要三个有限数值。`);
      return [...v];
    };
    const columns = number('columns', 4, 1, 256, true), rows = number('rows', 4, 1, 256, true);
    if (g.autoFit != null && typeof g.autoFit !== 'boolean') fail('autoFit 必须是布尔值。');
    if (g.openCells != null && (!Array.isArray(g.openCells) || g.openCells.length !== columns * rows || !g.openCells.every(v => typeof v === 'boolean'))) fail('openCells 必须是与尺寸一致的布尔数组。');
    return { ...g, id: g.id.trim(), origin: vector('origin', [0, -.5, 0]), rotation: vector('rotation', [Math.PI / 2, 0, 0]), columns, rows,
      cellSize: number('cellSize', 1, .01, 100), surfaceOffset: number('surfaceOffset', .01, 0, 10),
      autoFit: g.autoFit ?? true, openCells: g.openCells ? [...g.openCells] : Array(columns * rows).fill(true) };
  });
}

export function assertCeilingSupport(node) {
  if (!node || !['cube', 'plane'].includes(node.type) || !node.static || !node.collision
      || !['auto', 'box'].includes(node.unity.collider.type) || node.unity.collider.isTrigger
      || node.transform.scale.some(n => n <= 0)
      || Math.abs(node.transform.rotation[0]) > .001 || Math.abs(node.transform.rotation[2]) > .001)
    throw new Error('请选择水平、静态、有实体盒碰撞的板块；不支持倾斜、动态或负缩放。');
}

export function addCeilingGrid(node) {
  assertCeilingSupport(node);
  if (node.unity.ceilingTrapGrids?.length) return node.unity.ceilingTrapGrids[0];
  const size = node.type === 'plane' ? [3, .12, 3] : [1, 1, 1];
  const columns = Math.floor(size[0] * node.transform.scale[0] + .001), rows = Math.floor(size[2] * node.transform.scale[2] + .001);
  const grid = normalizeCeilingGrids([{ id: 'bottom', columns, rows, origin: [-size[0] / 2, -size[1] / 2, -size[2] / 2] }], node.id)[0];
  node.unity.ceilingTrapGrids = [grid]; return grid;
}

export function resizeCeilingMask(grid, columns, rows) {
  const old = grid.openCells, oldColumns = grid.columns, oldRows = grid.rows;
  grid.columns = columns; grid.rows = rows;
  grid.openCells = Array.from({ length: columns * rows }, (_, i) => {
    const x = i % columns, y = Math.floor(i / columns);
    return x < oldColumns && y < oldRows ? old[x + y * oldColumns] : true;
  });
}

export function ceilingSectionHtml(node, escape) {
  const g = node.unity.ceilingTrapGrids?.[0];
  const input = (label, key, value, min, max) => `<label>${label}<input data-ceiling="${key}" type="number" min="${min}" max="${max}" step="${key === 'columns' || key === 'rows' ? 1 : 'any'}" value="${value}"></label>`;
  return `<section class="section"><div class="eyebrow">天花板陷阱安装区域</div><button class="btn" id="addCeilingGridBtn">为底面添加／刷新网格</button>${g ? `
    <p>${escape(g.id)} · 法线朝下 · ${g.columns}×${g.rows} 格</p>
    <label><input id="ceilingAutoFit" type="checkbox" ${g.autoFit ? 'checked' : ''}> 自动贴合底面（随板块缩放）</label>
    ${input('列数', 'columns', g.columns, 1, 256)}${input('行数', 'rows', g.rows, 1, 256)}
    ${input('格距（米）', 'cellSize', g.cellSize, .01, 100)}${input('表面偏移（米）', 'surfaceOffset', g.surfaceOffset, 0, 10)}
    <p>点击开关格；绿色开放，红色关闭。</p>
    <div style="display:grid;grid-template-columns:repeat(${Math.min(g.columns, 16)},1fr);gap:2px;max-height:180px;overflow:auto">${g.openCells.slice(0, 256).map((v, i) => `<button type="button" data-ceiling-cell="${i}" title="格 ${i % g.columns},${Math.floor(i / g.columns)}" style="background:${v ? '#326e59' : '#843e43'};padding:4px">${i}</button>`).join('')}</div>
    <details><summary>完整开放格掩码（行主序）</summary><textarea id="ceilingMask" rows="4">${g.openCells.join(',')}</textarea><button class="btn" id="applyCeilingMask">应用掩码</button></details>
    <button class="danger" id="removeCeilingGridBtn">移除天花板网格</button>` : ''}</section>`;
}

export function wireCeilingSection(node, root, edit, refresh) {
  root.querySelector('#addCeilingGridBtn').onclick = () => edit(o => { addCeilingGrid(o); refresh(o); });
  const g = node.unity.ceilingTrapGrids?.[0]; if (!g) return;
  root.querySelector('#ceilingAutoFit').onchange = e => edit(o => { o.unity.ceilingTrapGrids[0].autoFit = e.target.checked; refresh(o); });
  root.querySelectorAll('[data-ceiling]').forEach(input => input.onchange = () => edit(o => {
    const grid = o.unity.ceilingTrapGrids[0], key = input.dataset.ceiling, value = Number(input.value);
    if (!input.value.trim() || !input.validity.valid) throw new Error('请输入有效天花板网格参数。');
    if (key === 'columns' || key === 'rows') { grid.autoFit = false; resizeCeilingMask(grid, key === 'columns' ? value : grid.columns, key === 'rows' ? value : grid.rows); }
    else grid[key] = value;
    refresh(o);
  }));
  root.querySelectorAll('[data-ceiling-cell]').forEach(button => button.onclick = () => edit(o => {
    const grid = o.unity.ceilingTrapGrids[0], i = Number(button.dataset.ceilingCell); grid.openCells[i] = !grid.openCells[i];
  }));
  root.querySelector('#applyCeilingMask').onclick = () => edit(o => {
    const parts = root.querySelector('#ceilingMask').value.split(',').map(v => v.trim());
    if (parts.length !== g.columns * g.rows || parts.some(v => v !== 'true' && v !== 'false')) throw new Error('掩码长度须等于行×列，只能填写 true/false。');
    o.unity.ceilingTrapGrids[0].openCells = parts.map(v => v === 'true');
  });
  root.querySelector('#removeCeilingGridBtn').onclick = () => edit(o => { o.unity.ceilingTrapGrids = []; });
}
