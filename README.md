# MapForge 3D 地图编辑器

面向 Unity 工作流的浏览器地图编辑器：使用基础积木拼装场景，整理层级、编辑属性，导出 JSON 后通过 Unity 导入器创建场景。

## 启动

需要 .NET SDK 10+、支持 WebGL 的浏览器，以及可访问 Three.js CDN 的网络。

双击 `启动MapForge.bat`，或运行：

```powershell
.\Start-MapForge.ps1
# 也可直接启动后端：
dotnet run --project .\MapEditor.csproj --urls http://localhost:5090
```

打开 [http://localhost:5090](http://localhost:5090)。关闭后端进程即可停止服务。启动器支持 `-Port 5200` 切换端口。

## 场景组织（第二优先级已完成）

### 文件夹、分组和父子层级

- 层级顶部的 **＋ 文件夹** 创建文件夹；选中文件夹或分组时，新积木和文件夹会加入其中。
- Ctrl/⌘ 点击层级行进行追加选择或取消选择；点击 **选区分组** 或按 Ctrl/⌘ G 将选区放入新分组。分组包含原有子层级。
- 在属性面板的 **父级** 下拉框中调整父子关系，或点击 **移至根层级**。普通积木也可以拥有子对象。
- 改父级和建立分组保持世界位置、旋转与尺寸。若非均匀缩放与旋转组合会导致无法表示的剪切变形，操作会提示原因并保留原场景。
- 点击层级行左侧箭头折叠/展开；编辑 **名称** 重命名。对象 ID 独立、只读，重命名不会破坏父级引用。
- 文件夹和分组自身没有几何体；其 Transform 会影响所有子对象。属性面板显示相对父级的局部 Transform。
- 删除父级会删除完整子树；复制、粘贴、阵列复制保留子层级和扩展属性，并重新分配唯一 ID。

点击左侧 **载入组织示例（可撤销）**，可试用包含以下结构的地图：

```text
Environment
├─ Roads
├─ Buildings
├─ SpawnPoints
├─ Decorations
└─ Ground（锁定）
```

示例文件：`wwwroot/examples/organized-world.json`。载入示例会替换当前场景，可撤销恢复。

### 对象属性

| 属性 | 用途 |
| --- | --- |
| 名称 | 自定义显示名称，独立于 ID |
| 位置 / 旋转 / 缩放 | 局部变换；界面旋转为度，文件为弧度；缩放至少 0.01 |
| 颜色 | #RRGGBB 色值 |
| 材质 | 标准受光照 / 无光照；粗糙度和金属度 0–1 |
| 标签 | 多标签，使用英文或中文逗号分隔 |
| Layer | Unity Layer 索引 0–31 |
| 碰撞 | 是否参与碰撞；视图线框展示其包围范围 |
| 静态 | Unity 静态对象标记 |
| Prefab | Prefab 类型标识，例如 EnemySpawnPoint |
| 显示分类 | 场景几何 / 路径点 / 装饰物 |
| 游戏逻辑参数 | JSON 对象；点击“应用参数”提交，支持嵌套值与数组 |

Prefab 类型和逻辑参数是供游戏代码读取的配置，不会自动实例化任意 Prefab 或执行脚本。无效参数不会覆盖已保存值。

### 搜索、过滤和定位

- 按名称、ID、中英文类型或标签搜索；多个空格分隔的关键词必须同时匹配。
- 类型下拉框限制匹配类型；**选中类型** 将过滤器设为当前单选对象的类型。
- 搜索结果保留父级路径，临时展开折叠节点，方便定位深层对象。重置搜索后恢复原折叠状态。
- 搜索和类型过滤仅影响层级列表，不改变场景、对象可见性或导出内容。
- 双击层级名称、点击 **定位选区** 或按 **F**，相机将对准整个选区。隐藏对象仍保持隐藏。

### 显示和锁定

- 层级右侧的圆点按钮控制显示，锁按钮控制锁定；两者随地图文件保存。
- 父级隐藏或锁定会传递到子对象，不改写子对象自身的设置。继承锁定需要在父级解除。
- 隐藏或锁定对象不会被视口点击、框选或 Ctrl/⌘ A 选中，仍可通过层级查看属性。
- 锁定对象禁止改名、改属性、移动、删除及改父级；如果子对象锁定，也禁止通过移动/删除父级间接修改它。
- 左侧分别控制 **场景几何 / 路径点 / 装饰物 / 碰撞范围线框**。关闭几何显示后仍可单独观察碰撞线框。
- 分类开关仅影响当前视图，不写入 JSON，不修改对象的碰撞属性。碰撞线框为世界轴对齐包围盒，不是物理模拟。

## 视口和快捷键

| 操作 | 按键 / 鼠标 |
| --- | --- |
| 环绕 / 缩放 | 左键拖动 / 滚轮 |
| 单选 / 追加或取消 | 点击 / Ctrl/⌘ 点击 |
| 追加框选 | 选择工具下 Ctrl/⌘ 拖拽 |
| 选择 / 移动 / 旋转 / 缩放 | Q / W / E / R |
| 分组 | Ctrl/⌘ G |
| 定位 | F |
| 复制 / 粘贴 | Ctrl/⌘ C / V |
| 撤销 / 重做 | Ctrl/⌘ Z / Y，或 Ctrl/⌘ Shift Z |
| 删除 / 清除选区 | Delete / Esc |

Gizmo 操作支持单个对象或分组；多个独立对象可先分组再整体变换。吸附开启时移动按网格间距、旋转按 15°、缩放按 0.1 步进。

新增、删除、属性编辑、分组、改父级、隐藏、锁定、Gizmo 拖动、导入和新建都支持撤销/重做（最近 80 步）。当前场景保存在浏览器内存中，关闭或刷新页面前请导出 JSON。

## Unity 组件映射

导出时每个对象都可以携带一份 Unity 组件配置，导入器据此在场景中创建对应组件，而不是只创建空物体。

### 在编辑器里配置

- **对象属性 → Unity Mapping / Unity 组件映射**：顶部徽章显示当前对象已配置的组件；下方按组件分组，未配置的部分保持 Unity 默认值。
- **左侧 → Unity 组件映射 · 场景级**：管理 Prefab 库、波次配置和 NavMesh 烘焙选项，Esc 关闭。
- 层级行会显示 `Unity n` 徽章，鼠标悬停行名可看到组件摘要；搜索支持 Prefab ID 和资产路径。
- 显示控制里的 **Unity 组件预览** 开关只影响视口高亮，不写入 JSON。
- 所有修改都进入撤销/重做；越界或非法取值会被拒绝并保留原值。

### 对象级 `unity` 字段

```json
{
  "prefab": { "id": "enemy_ground", "guid": "", "assetPath": "Assets/Prefabs/TestMonster.prefab" },
  "collider": { "type": "box", "isTrigger": false, "center": [0, 0, 0], "size": [1, 1, 1], "radius": 0.5, "height": 2, "direction": 1 },
  "navMesh": { "role": "walkable", "area": 0, "agentType": "Humanoid", "ignoreFromBuild": false, "applyToChildren": false, "linkStart": [0, 0, 0], "linkEnd": [0, 0, 0], "linkWidth": 1, "bidirectional": true },
  "spawnPoint": { "enabled": false, "spawnInterval": 1, "initialDelay": 2, "enemiesPerWave": 10, "moveSpeed": 2, "travelDirection": [0, 0, 1], "monsterType": "Ground", "flightHeight": 3, "flyingEntrance": false, "entranceAltitude": 12, "laneId": "", "enemyPrefabId": "", "waves": [] },
  "enemyCore": { "enabled": false, "maxHealth": 30, "groundDamage": 2, "flyingDamage": 1, "arrivalRadius": 0.35 },
  "pathNode": { "enabled": false, "role": "node", "waitTime": 0, "links": [] },
  "trigger": { "enabled": false, "shape": "box", "isTrigger": true, "once": false, "center": [0, 0, 0], "size": [1, 2, 1], "radius": 1, "events": [] }
}
```

| 字段 | 取值 | Unity 结果 |
| --- | --- | --- |
| `prefab.id` / `guid` / `assetPath` | 文本，需与顶层 Prefab 库对应 | 导入时按 ID 或资产路径实例化 Prefab 替换图元 |
| `collider.type` | `auto` / `box` / `sphere` / `capsule` / `mesh` / `none` | `auto` 按图元类型选择；`none` 不添加碰撞体 |
| `collider.isTrigger`、`center`、`size`、`radius`、`height`、`direction`(0–2) | 布尔 / 三维向量 / 数值 | 写入对应 Collider 的 `isTrigger`、`center`、`size`、`radius`、`height`、轴向 |
| `navMesh.role` | `none` / `walkable` / `obstacle` / `notWalkable` / `link` / `source` | `walkable`、`obstacle`、`notWalkable` 生成 `NavMeshModifier`（`area` 0–31 为区域编号）；`link` 生成 `NavMeshLink`（`linkStart` / `linkEnd` / `linkWidth` / `bidirectional`）；`source` 生成 `NavMeshSurface` |
| `navMesh.ignoreFromBuild`、`applyToChildren` | 布尔 | `NavMeshModifier` 的烘焙跳过与子对象继承 |
| `navMesh.agentType` | 文本，默认 `Humanoid` | 按名称解析 Agent Type；名称不存在时退回默认值并提示 |
| `spawnPoint.*` | 见上 | 生成 `EnemySpawnPoint`：出怪间隔、首波延迟、每波数量、移动速度、行进方向、怪物类型（`Ground` / `Flying`）、飞行高度、飞行入口与入口高度、路线 ID、敌人 Prefab |
| `spawnPoint.waves[]` | `{ enabled, enemyCount(0–999), monsterType(可为空), flightHeight(0–200) }` | 逐波覆盖 `WaveSpawnSettings`，覆盖每波数量与怪物类型 |
| `enemyCore.*` | `maxHealth`(1–1e6)、`groundDamage`、`flyingDamage`(0–1e6)、`arrivalRadius`(≥0.01) | 生成 `EnemyCore`：血量、地面/飞行到达伤害、到达半径 |
| `pathNode.*` | `role` = `node` / `waypoint` / `junction` / `end`，`waitTime`(0–600)，`links[]` 为其他对象 ID | 生成 `MapForgePathNode` 并建立连线；`links` 必须指向已存在的对象 |
| `trigger.*` | `shape` = `box` / `sphere`，`isTrigger`、`once`、`center`、`size`、`radius` | 生成 `MapForgeTrigger` 与对应形状的 Trigger Collider |
| `trigger.events[]` | `when` = `enter` / `exit`，`action` = `spawn` / `damage` / `goal` / `message` / `enable` / `disable`，`target`、`message`、`amount`(0–1e9)、`delay`(0–600) | 写入触发器事件表，由项目侧逻辑执行 |

`Junction_Marker` 一类只做标记的静态对象仍不会获得碰撞体，避免挡住怪物路线。

### 顶层 `unity` 字段

```json
{
  "prefabs": [{ "id": "enemy_ground", "name": "Ground Bug", "kind": "enemy", "assetPath": "Assets/Prefabs/TestMonster.prefab", "guid": "" }],
  "waves": { "totalWaves": 5, "initialDelay": 3, "enemiesPerWave": 12, "spawnInterval": 0.75, "transitionDelays": [4, 4, 6] },
  "settings": { "buildNavMeshOnImport": true, "agentType": "Humanoid", "collectObjects": "volume" }
}
```

- `prefabs[].id` 唯一且非空，`kind` 为 `object` / `enemy` / `tower` / `trap` / `prop`；对象通过 `unity.prefab.id` 引用。
- `waves` 写入 `WaveManager`：总波次 1–99 的整数、每波数量 0–999 的整数、间隔 0.01–600、波间隔最多 32 个非负数值。对象级 `spawnPoint.waves` 优先于这里的全局值。
- `settings.collectObjects` 为 `all` / `volume` / `children` / `markedWithModifier`，对应 `NavMeshSurface.collectObjects`；`buildNavMeshOnImport` 为真时导入器在 `Assets/NavMesh/<场景名>.asset` 烘焙并保存 NavMeshData。

导出完成后的提示会汇总 Prefab / Collider / NavMesh / SpawnPoint / EnemyCore / 路径节点 / 触发器 / 总波次数量。

## JSON 和 Unity

导出文件名为 `mapforge-world.json`。格式为 v2，也是当前唯一支持的版本，顶层信封固定包含：

```json
{
  "version": 2,
  "name": "Three Branch Map",
  "settings": { "gridSize": 1, "unit": "meter" },
  "objects": [],
  "groups": [],
  "gameplay": {},
  "unity": { "prefabs": [], "waves": {}, "settings": {} }
}
```

`objects` 保存对象和父子关系，`groups` 是可选的组元数据集合，`gameplay` 保存游戏逻辑配置，`unity` 保存 Unity 组件映射。顶层和对象均允许扩展字段；编辑器导入后会原样保留未知字段。完整约束见 `map-format.schema.json`。`rotationUnit: "radians"` 是当前编辑器的兼容扩展字段。

导入和校验都要求 `version` 恰好为 `2`，缺 `version`、写成别的版本号或非数字都会被拒绝，编辑器不会把旧文件迁移到 v2（导出的永远是最新格式）。导入前检查 ID、父级循环、物体类型和数值；失败时保留当前场景。

`gameplay`、`roadsideSteps` 以及未识别的扩展字段会随导入/导出保留。参数以 `parameters` 对象保存，同时生成 `parametersJson` 字符串供 Unity JsonUtility 读取；二者以 `parameters` 为准。

Unity 工程 `C:\Unity Project\ProjectAlphaOperationStriker` 的 `MapForge/Import...` 菜单只接受 v2 地图：

- 创建真实父子层级，正确换算 Three.js XYZ 弧度旋转。
- 原始几何尺寸在独立网格子对象上换算，避免父级平面/球体尺寸影响其子对象。
- 应用颜色、标准/无光照材质、Layer、碰撞、静态、可见性及编辑器选择锁定。
- 材质资产生成到 `Assets/MapForgeMaterials`，按场景名称和稳定 ID 区分。
- 所有标签、Prefab 类型、分类和逻辑参数保存到 `MapForgeObjectProperties` 组件。第一个标签已存在于 Unity Tag 列表时，同步到内置 Tag；其余标签保留在组件数组中。
- 读取对象级 `unity` 映射：按 Prefab ID / 资产路径实例化 Prefab，按配置创建 Box / Sphere / Capsule / Mesh Collider，添加 `NavMeshModifier`、`NavMeshLink`、`NavMeshSurface`，并创建 `EnemySpawnPoint`、`EnemyCore`、`MapForgePathNode`、`MapForgeTrigger`。
- 对象级波次覆盖写入 `EnemySpawnPoint.waveSpawnSettings`；顶层 `unity.waves` 写入 `WaveManager`，并在所有 spawn 之间同步总波次。
- `unity.settings.buildNavMeshOnImport` 为真时在 `Assets/NavMesh/<场景名>.asset` 烘焙并保存 NavMeshData；烘焙失败只提示，不中断导入。
- 导入完成后输出一条汇总日志：Prefab / Collider / NavMesh / SpawnPoint / EnemyCore / 路径节点 / 触发器数量、Prefab 库大小与总波次。
- 只走 v2 层级导入：`version` 不是 `2` 的地图直接报错退出，不再有扁平旧格式的兜底分支。保留游戏逻辑创建流程（`gameplay` 造出 `MonsterPathGrid`、`Enemy Core` 与陷阱网格），以及世界轴对齐平台的 `roadsideSteps` 台阶切割；旋转后的平台不能使用台阶切割配置，导入时会提示。

浏览器“预览地图”提供 Unity 导入指引，尚不执行角色、寻路或碰撞模拟。

### 一键发送到 Unity

除手动菜单导入外，编辑器可以直接把当前地图推给正在运行的 Unity 工程：点击视口右上角的 **⚡ 发送到 Unity**，Unity 侧会自动读取并刷新场景，浏览器同步显示进度与回执。同步对话框（同一按钮再次点击或 Esc 关闭）显示目标工程、连接状态、本次变更预览，并提供 **增量发送 / 完整重建 / 清除基线** 三个动作。

传输走本地文件，不开网络端口：MapForge 写入 `<UnityProject>/MapForgeSync/`，Unity 编辑器插件轮询同一目录。

| 路径 | 方向 | 作用 |
| --- | --- | --- |
| `mail/pending.json` | MapForge → Unity | 本次版本（协议号、版本号、基线号、模式、变更集） |
| `mail/applied.txt` / `mail/applied.json` | Unity → MapForge | Unity 已应用的版本号与场景/地图名 |
| `mail/baseline.json` | MapForge 本地 | 上一版发出的完整文档，用于计算下一次增量 |
| `outbox/result.json` | Unity → MapForge | 回执：成功与否、新建/修改/删除数量、耗时、日志 |
| `status.json` | Unity → MapForge | 每 15 秒一次心跳，浏览器据此显示“编辑器在线” |

Unity 侧每 2 秒轮询一次，在编译、刷新资源或 Play Mode 期间自动跳过；应用失败不记为已应用，下次仍会重试。

增量更新的边界：

- 默认只发送相对上一版新增、修改、删除的对象，Unity 在场景里就地改这些对象，保留已有对象、组件引用和手工调整，不重建整个场景。
- 版本号用于对齐：Unity 发现自己的已应用版本不是本次的 `baseRevision`（例如编辑器重启期间漏了一版）时会拒绝这版补丁并提示重新完整发送，而不是把增量套在错误的基线上。
- 以下情况自动升级为完整重建：首次发送（无基线）、场景里的对象没有 MapForge 标识（无法按 ID 对齐）、地图名称 / `gameplay` / `roadsideSteps` / 场景级 `unity` 映射变化、变更对象超过总数 60%、上次发送未被应用、或用户显式选择“完整重建”。
- 如果 Unity 里打开的场景里对象没有 `MapForgeObjectProperties`（例如场景是在编辑器还没有写入对象标识时建的），增量补丁无从下手。这种场景会在发送前就被识别出来并自动改为完整重建，浏览器预览里会写明原因；重建一次之后该场景就带上了标识，后续都能增量。
- 完整重建复用同一个导入器，只重建 `MapForgeWorld` 这一棵子树，场景文件路径、GUID 以及项目自己放在场景里的其他对象都不受影响。
- 历史遗留：把手工添加的对象放在 `MapForgeWorld` 下面时，重建前会先按“上次构建生成的子对象名单”把它摘出来、重建后再放回去；如果新地图恰好生成了同名对象，会保留为 `<名字> (MapForge kept)` 并在 Console 警告。想彻底避免歧义，可以把手工对象放到 `MapForgeWorld` 之外。

后端接口：

- `GET /api/unity/status`：目标工程、连接状态、已应用/待应用版本、上一版回执。
- `POST /api/unity/target`：`{ "unityProject": "C:\\path" }` 指定工程；空值改回自动检测。
- `POST /api/unity/preview`：请求体为地图 JSON，返回本次会发送的变更集，不写任何文件。
- `POST /api/unity/send`：请求体 `{ "map": { ... }, "mode": "increment" | "full" }`，写入待应用版本并返回变更摘要。
- `POST /api/unity/reset`：清除基线，下一次发送必定完整重建。

目标工程默认自动检测：扫描上级目录、`C:\Unity Project` 等常见位置，并按证据打分（是否含 `MapForgeLiveSync.cs`、`MapForgeWorldImporter.cs`、`Assets/mapforge-world.json`、是否已有 `MapForgeSync` 目录）。也可用环境变量 `MAPFORGE_UNITY_PROJECT` 固定，或在同步对话框里直接填写路径（保存在内容根的 `mapforge-sync.json`）。

Unity 侧菜单（`MapForge`）：

- **应用待同步版本**：手动触发一次拉取，等同于等待轮询。
- **下次发送时完整重建**：把当前场景标记为需要重建，下一次发送必定完整重建。

## 后端接口

- `GET /api/health`：返回 `{ "status": "ready", "engine": "MapForge" }`。
- `POST /api/maps/validate`：请求体为实际导出的 JSON；校验成功返回 `200` 和 `objectCount`，结构、层级或属性错误返回 `400` 和 `error`。

## 验证

```powershell
dotnet build
npm install
npm test
# 启动后端后运行 API 和 Edge 无头浏览器回归：
$env:MAPFORGE_URL = 'http://localhost:5090'
npm test
npm run test:browser
```

浏览器测试需要本机 Microsoft Edge，覆盖完整属性、层级搜索、父级切换、继承锁定、复制/删除、文件往返、版本校验（拒绝缺 `version` 的旧文档）、视口选中、Gizmo、分组撤销、Unity 组件映射对话框、Inspector、校验、撤销和往返，以及一键发送对话框的状态/预览/目标校验。截图输出到 `artifacts/`（目前是 `scene-organization.png`），该目录由测试按需重新生成。

Unity 测试地图仍位于原工程的 `Assets/mapforge-world.json` 和对应 Scenes 中；本次只精简导入器与编辑器代码，没有重新生成现有游戏场景。

## 常见问题

页面未显示 3D 视口时，检查 Three.js CDN 是否可访问。启动失败时执行 `dotnet --version` 确认安装的是 SDK，或切换端口。无法移动分组时，检查它的子对象是否有锁定。搜索不到对象时，点击“重置”清除类型和文本过滤。
