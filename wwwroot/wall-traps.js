export function normalizeWallGrids(value, id = 'object') {
  if (value == null) return [];
  const fail = message => { throw new Error(id + ' 的墙面网格：' + message); };
  if (!Array.isArray(value)) fail('必须是数组。');
  const ids = new Set();
  return value.map(g => {
    if (!g || typeof g.id !== 'string' || !g.id.trim() || ids.has(g.id.trim())) fail('ID 必须非空且唯一。');
    ids.add(g.id.trim());
    const number = (key, fallback, min, max, integer = false) => {
      const n = g[key] ?? fallback;
      if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) fail(key + ' 无效。');
      return n;
    };
    const vector = (key, fallback) => {
      const v = g[key] ?? fallback;
      if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) fail(key + ' 需要三个有限数值。');
      return [...v];
    };
    const columns = number('columns', 4, 1, 256, true), rows = number('rows', 3, 1, 256, true);
    if (g.autoFit != null && typeof g.autoFit !== 'boolean') fail('autoFit 必须是布尔值。');
    if (g.openCells != null && (!Array.isArray(g.openCells) || g.openCells.length !== columns * rows || !g.openCells.every(v => typeof v === 'boolean'))) fail('openCells 必须是与尺寸一致的布尔数组。');
    return {
      ...g, id: g.id.trim(), origin: vector('origin', [-2, -1.5, .1]), rotation: vector('rotation', [0, 0, 0]),
      columns, rows, cellSize: number('cellSize', 1, .01, 100), surfaceOffset: number('surfaceOffset', .01, 0, 10),
      autoFit: g.autoFit ?? true, openCells: g.openCells ? [...g.openCells] : Array(columns * rows).fill(true),
    };
  });
}

function supportSize(node) {
  const dimensions = [1, 1, 1], collider = node.unity.collider;
  const center = collider.type === 'box' ? collider.center.map((v, i) => v * dimensions[i]) : [0, 0, 0];
  if (collider.type === 'box') dimensions.forEach((v, i) => { dimensions[i] = v * collider.size[i]; });
  return { dimensions, center };
}

export function assertWallSupport(node) {
  if (!node || node.type !== 'cube' || !node.static || !node.collision
      || !['auto', 'box'].includes(node.unity.collider.type) || node.unity.collider.isTrigger
      || node.transform.scale.some(n => n <= 0)
      || Math.abs(node.transform.rotation[0]) > .001 || Math.abs(node.transform.rotation[2]) > .001)
    throw new Error('请选择竖直、静态且带实体盒碰撞体的立方体墙面；不支持倾斜、动态或负缩放。');
}

export function addWallGrid(node) {
  assertWallSupport(node);
  if (node.unity.wallTrapGrids?.length) return node.unity.wallTrapGrids[0];
  const { dimensions, center } = supportSize(node);
  const columns = Math.floor(dimensions[0] * node.transform.scale[0] + .001);
  const rows = Math.floor(dimensions[1] * node.transform.scale[1] + .001);
  const grid = normalizeWallGrids([{
    id: 'front', columns, rows,
    origin: [center[0] - columns / node.transform.scale[0] / 2,
      center[1] - rows / node.transform.scale[1] / 2, center[2] + dimensions[2] / 2],
  }], node.id)[0];
  node.unity.wallTrapGrids = [grid];
  return grid;
}

export function resizeWallMask(grid, columns, rows) {
  const old = grid.openCells, oldColumns = grid.columns, oldRows = grid.rows;
  grid.columns = columns;
  grid.rows = rows;
  grid.openCells = Array.from({ length: columns * rows }, (_, i) => {
    const x = i % columns, y = Math.floor(i / columns);
    return x < oldColumns && y < oldRows ? old[x + y * oldColumns] : true;
  });
}

export function wallSectionHtml(node, escape) {
  const g = node.unity.wallTrapGrids?.[0];
  const input = (label, key, value, min, max) => '<label>' + label + '<input data-wall="' + key + '" type="number" min="' + min + '" max="' + max + '" step="' + (key === 'columns' || key === 'rows' ? 1 : 'any') + '" value="' + value + '"></label>';
  let html = '<section class="section"><div class="eyebrow">墙面陷阱安装区域</div><button class="btn" id="addWallGridBtn">为正面添加／刷新网格</button>';
  if (!g) return html + '</section>';
  html += '<p>' + escape(g.id) + ' · 法线朝外 · ' + g.columns + '×' + g.rows + ' 格</p>'
    + '<label><input id="wallAutoFit" type="checkbox" ' + (g.autoFit ? 'checked' : '') + '> 自动贴合墙面（随墙体缩放）</label>'
    + input('列数', 'columns', g.columns, 1, 256) + input('行数', 'rows', g.rows, 1, 256)
    + input('格距（米）', 'cellSize', g.cellSize, .01, 100) + input('表面偏移（米）', 'surfaceOffset', g.surfaceOffset, 0, 10)
    + '<p>点击格子切换陷阱开放状态；绿色开放，红色关闭。</p>'
    + '<div style="display:grid;grid-template-columns:repeat(' + Math.min(g.columns, 16) + ',1fr);gap:2px;max-height:180px;overflow:auto">'
    + g.openCells.slice(0, 256).map((v, i) => '<button type="button" data-wall-cell="' + i + '" title="格 ' + (i % g.columns) + ',' + Math.floor(i / g.columns) + '" style="background:' + (v ? '#326e59' : '#843e43') + ';padding:4px">' + i + '</button>').join('')
    + '</div><details><summary>完整开放格掩码（行主序）</summary><textarea id="wallMask" rows="4">' + g.openCells.join(',') + '</textarea><button class="btn" id="applyWallMask">应用掩码</button></details>'
    + '<button class="danger" id="removeWallGridBtn">移除墙面网格</button></section>';
  return html;
}

export function wireWallSection(node, root, edit, refresh) {
  root.querySelector('#addWallGridBtn').onclick = () => edit(o => { addWallGrid(o); refresh(o); });
  const g = node.unity.wallTrapGrids?.[0];
  if (!g) return;
  root.querySelector('#wallAutoFit').onchange = e => edit(o => { o.unity.wallTrapGrids[0].autoFit = e.target.checked; refresh(o); });
  root.querySelectorAll('[data-wall]').forEach(input => input.onchange = () => edit(o => {
    const grid = o.unity.wallTrapGrids[0], key = input.dataset.wall, value = Number(input.value);
    if (!input.value.trim() || !input.validity.valid) throw new Error('请输入有效墙面网格参数。');
    if (key === 'columns' || key === 'rows') {
      grid.autoFit = false;
      resizeWallMask(grid, key === 'columns' ? value : grid.columns, key === 'rows' ? value : grid.rows);
    } else grid[key] = value;
    refresh(o);
  }));
  root.querySelectorAll('[data-wall-cell]').forEach(button => button.onclick = () => edit(o => {
    const grid = o.unity.wallTrapGrids[0], index = Number(button.dataset.wallCell);
    grid.openCells[index] = !grid.openCells[index];
  }));
  root.querySelector('#applyWallMask').onclick = () => edit(o => {
    const parts = root.querySelector('#wallMask').value.split(',').map(v => v.trim());
    if (parts.length !== g.columns * g.rows || parts.some(v => v !== 'true' && v !== 'false')) throw new Error('掩码长度须等于行×列，只能填写 true/false。');
    o.unity.wallTrapGrids[0].openCells = parts.map(v => v === 'true');
  });
  root.querySelector('#removeWallGridBtn').onclick = () => edit(o => { o.unity.wallTrapGrids = []; });
}
