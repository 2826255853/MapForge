using System.Text.Json;
using System.Text.RegularExpressions;

public static class MapValidation
{
    private static readonly HashSet<string> Types = ["cube", "sphere", "cylinder", "plane", "folder", "group"];
    private static readonly string[] ColliderTypes = ["auto", "box", "sphere", "capsule", "mesh", "none"];
    private static readonly string[] NavRoles = ["none", "walkable", "obstacle", "notWalkable", "link", "source"];
    private static readonly string[] PathRoles = ["node", "waypoint", "junction", "end"];
    private static readonly string[] TriggerShapes = ["box", "sphere"];
    private static readonly string[] TriggerWhens = ["enter", "exit"];
    private static readonly string[] TriggerActions = ["spawn", "damage", "goal", "message", "enable", "disable"];
    private static readonly string[] SpawnMonsterTypes = ["Ground", "Flying"];
    private static readonly string[] WaveMonsterTypes = ["", "Ground", "Flying"];
    private static readonly string[] PrefabKinds = ["object", "enemy", "tower", "trap", "prop"];
    private static readonly string[] CollectObjects = ["all", "volume", "children", "markedWithModifier"];
    public static string? Validate(JsonElement map)
    {
        if (map.ValueKind != JsonValueKind.Object || !map.TryGetProperty("objects", out var objects) || objects.ValueKind != JsonValueKind.Array)
            return "地图文件缺少 objects 数组。";
        // Only the current format is readable. A missing or different version is an
        // older export, which is rejected here instead of migrated on load.
        if (!map.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number ||
            !version.TryGetInt32(out var formatVersion) || formatVersion != 2) return "不支持的地图版本。";
        if (map.TryGetProperty("name", out var name) && name.ValueKind != JsonValueKind.String) return "地图名称必须是文本。";
        if (map.TryGetProperty("settings", out var settings))
        {
            if (settings.ValueKind != JsonValueKind.Object) return "地图 settings 必须是 JSON 对象。";
            if (settings.TryGetProperty("gridSize", out var gridSize) && (!Finite(gridSize, out var size) || size <= 0)) return "地图 settings.gridSize 必须是大于 0 的数值。";
            if (settings.TryGetProperty("unit", out var settingsUnit) && (settingsUnit.ValueKind != JsonValueKind.String || settingsUnit.GetString() != "meter")) return "地图 settings.unit 必须为 meter。";
        }
        if (map.TryGetProperty("groups", out var groups) && groups.ValueKind != JsonValueKind.Array) return "地图 groups 必须是数组。";
        if (map.TryGetProperty("gameplay", out var gameplay) && gameplay.ValueKind != JsonValueKind.Object) return "地图 gameplay 必须是 JSON 对象。";
        if (map.TryGetProperty("rotationUnit", out var unit) && (unit.ValueKind != JsonValueKind.String || unit.GetString() != "radians")) return "旋转单位必须为 radians。";
        if (map.TryGetProperty("unity", out var sceneUnity) && sceneUnity.ValueKind != JsonValueKind.Null)
        {
            if (sceneUnity.ValueKind != JsonValueKind.Object) return "地图 unity 必须是 JSON 对象。";
            var sceneError = ValidateUnityScene(sceneUnity);
            if (sceneError is not null) return sceneError;
        }
        var parents = new Dictionary<string, string?>();
        var pathLinks = new Dictionary<string, List<string>>();
        int index = 0;
        foreach (var item in objects.EnumerateArray())
        {
            index++;
            if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || !Types.Contains(type.GetString()!)) return $"对象 {index} 的类型不受支持。";
            var id = $"obj_{index}";
            if (item.TryGetProperty("id", out var idValue))
            {
                if (idValue.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(idValue.GetString())) return "对象 ID 不能为空。";
                id = idValue.GetString()!;
            }
            string? parent = null;
            if (item.TryGetProperty("parentId", out var p) && p.ValueKind != JsonValueKind.Null)
            {
                if (p.ValueKind != JsonValueKind.String) return $"{id} 的 parentId 无效。";
                parent = p.GetString();
            }
            if (!parents.TryAdd(id, parent)) return $"对象 ID 重复：{id}";
            foreach (var key in new[] { "name", "prefabType" })
                if (item.TryGetProperty(key, out var text) && text.ValueKind != JsonValueKind.String) return $"{id} 的 {key} 必须是文本。";
            foreach (var key in new[] { "visible", "locked", "collapsed", "collision", "static" })
                if (item.TryGetProperty(key, out var flag) && flag.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return $"{id} 的 {key} 必须是布尔值。";
            if (item.TryGetProperty("transform", out var transform))
            {
                if (transform.ValueKind != JsonValueKind.Object) return $"{id} 的 transform 无效。";
                foreach (var key in new[] { "position", "rotation", "scale" })
                {
                    if (!transform.TryGetProperty(key, out var vector) || vector.ValueKind == JsonValueKind.Null) continue;
                    if (vector.ValueKind != JsonValueKind.Array || vector.GetArrayLength() != 3) return $"{id} 的 {key} 需要三个有限数值。";
                    foreach (var component in vector.EnumerateArray())
                        if (!Finite(component, out var number) || (key == "scale" && number < 0.01)) return $"{id} 的 {key} 数值无效（缩放至少为 0.01）。";
                }
            }
            if (item.TryGetProperty("color", out var color) && color.ValueKind != JsonValueKind.Null &&
                (color.ValueKind != JsonValueKind.String || !Regex.IsMatch(color.GetString()!, "^#[0-9a-fA-F]{6}$"))) return $"{id} 的颜色需要 #RRGGBB 格式。";
            if (item.TryGetProperty("layer", out var layer) && layer.ValueKind != JsonValueKind.Null &&
                (layer.ValueKind != JsonValueKind.Number || !layer.TryGetInt32(out var l) || l is < 0 or > 31)) return $"{id} 的 Layer 必须为 0–31。";
            if (item.TryGetProperty("tags", out var tags) && tags.ValueKind != JsonValueKind.Null &&
                (tags.ValueKind != JsonValueKind.Array || tags.EnumerateArray().Any(t => t.ValueKind != JsonValueKind.String))) return $"{id} 的 tags 必须是文本数组。";
            if (item.TryGetProperty("parameters", out var parameters) && parameters.ValueKind is not (JsonValueKind.Null or JsonValueKind.Object)) return $"{id} 的游戏逻辑参数必须是 JSON 对象。";
            if (item.TryGetProperty("category", out var category) && category.ValueKind != JsonValueKind.Null &&
                (category.ValueKind != JsonValueKind.String || category.GetString() is not ("geometry" or "waypoint" or "decoration"))) return $"{id} 的显示分类无效。";
            if (item.TryGetProperty("unity", out var unity) && unity.ValueKind != JsonValueKind.Null)
            {
                if (unity.ValueKind != JsonValueKind.Object) return $"{id} 的 unity 必须是 JSON 对象。";
                var unityError = ValidateUnityObject(unity, id, out var links);
                if (unityError is not null) return unityError;
                if (links.Count > 0) pathLinks[id] = links;
            }
            if (item.TryGetProperty("material", out var material) && material.ValueKind != JsonValueKind.Null)
            {
                if (material.ValueKind != JsonValueKind.Object) return $"{id} 的材质无效。";
                if (material.TryGetProperty("type", out var mt) && mt.ValueKind != JsonValueKind.Null &&
                    (mt.ValueKind != JsonValueKind.String || mt.GetString() is not ("standard" or "unlit"))) return $"{id} 的材质类型无效。";
                foreach (var key in new[] { "roughness", "metalness" })
                    if (material.TryGetProperty(key, out var value) && (!Finite(value, out var n) || n is < 0 or > 1)) return $"{id} 的 {key} 必须为 0–1。";
            }
        }
        foreach (var id in parents.Keys)
        {
            var visited = new HashSet<string> { id };
            var parent = parents[id];
            while (parent is not null)
            {
                if (!parents.TryGetValue(parent, out var next)) return $"{id} 的父对象不存在。";
                if (!visited.Add(parent)) return "父子层级不能形成循环。";
                if (visited.Count > 256) return "父子层级不能超过 256 层。";
                parent = next;
            }
        }
        foreach (var pair in pathLinks)
            foreach (var link in pair.Value)
                if (!parents.ContainsKey(link)) return $"{pair.Key} 的路径节点连线指向不存在的对象：{link}";
        return null;
    }

    /// <summary>Validates the scene-wide Unity mapping: prefab library, waves and bake settings.</summary>
    private static string? ValidateUnityScene(JsonElement unity)
    {
        if (unity.TryGetProperty("prefabs", out var prefabs) && prefabs.ValueKind != JsonValueKind.Null)
        {
            if (prefabs.ValueKind != JsonValueKind.Array) return "地图 unity.prefabs 必须是数组。";
            var ids = new HashSet<string>();
            int index = 0;
            foreach (var entry in prefabs.EnumerateArray())
            {
                index++;
                if (entry.ValueKind != JsonValueKind.Object) return $"unity.prefabs[{index}] 必须是 JSON 对象。";
                if (!entry.TryGetProperty("id", out var prefabId) || prefabId.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(prefabId.GetString()))
                    return $"unity.prefabs[{index}] 缺少 Prefab ID。";
                if (!ids.Add(prefabId.GetString()!)) return $"unity.prefabs 的 ID 重复：{prefabId.GetString()}";
                foreach (var key in new[] { "name", "guid", "assetPath" })
                    if (entry.TryGetProperty(key, out var text) && text.ValueKind != JsonValueKind.Null && text.ValueKind != JsonValueKind.String)
                        return $"unity.prefabs[{index}].{key} 必须是文本。";
                if (entry.TryGetProperty("kind", out var kind) && kind.ValueKind != JsonValueKind.Null &&
                    (kind.ValueKind != JsonValueKind.String || !PrefabKinds.Contains(kind.GetString()!))) return $"unity.prefabs[{index}].kind 无效。";
            }
        }
        if (unity.TryGetProperty("waves", out var waves) && waves.ValueKind != JsonValueKind.Null)
        {
            if (waves.ValueKind != JsonValueKind.Object) return "地图 unity.waves 必须是 JSON 对象。";
            if (waves.TryGetProperty("totalWaves", out var totalWaves) && totalWaves.ValueKind != JsonValueKind.Null &&
                (!Finite(totalWaves, out var total) || total < 1 || total > 99) ||
                (totalWaves.ValueKind == JsonValueKind.Number && !totalWaves.TryGetInt32(out _))) return "地图 unity.waves.totalWaves 必须在 1–99 之间。";
            if (waves.TryGetProperty("initialDelay", out var initialDelay) && initialDelay.ValueKind != JsonValueKind.Null &&
                (!Finite(initialDelay, out var delay) || delay < 0 || delay > 600)) return "地图 unity.waves.initialDelay 必须在 0–600 之间。";
            if (waves.TryGetProperty("enemiesPerWave", out var enemiesPerWave) && enemiesPerWave.ValueKind != JsonValueKind.Null &&
                (!Finite(enemiesPerWave, out var enemies) || enemies < 0 || enemies > 999) ||
                (enemiesPerWave.ValueKind == JsonValueKind.Number && !enemiesPerWave.TryGetInt32(out _))) return "地图 unity.waves.enemiesPerWave 必须在 0–999 之间。";
            if (waves.TryGetProperty("spawnInterval", out var spawnInterval) && spawnInterval.ValueKind != JsonValueKind.Null &&
                (!Finite(spawnInterval, out var interval) || interval < 0.01 || interval > 600)) return "地图 unity.waves.spawnInterval 必须在 0.01–600 之间。";
            if (waves.TryGetProperty("transitionDelays", out var transitionDelays) && transitionDelays.ValueKind != JsonValueKind.Null)
            {
                if (transitionDelays.ValueKind != JsonValueKind.Array || transitionDelays.GetArrayLength() > 32) return "地图 unity.waves.transitionDelays 必须是最多 32 个非负数值。";
                foreach (var component in transitionDelays.EnumerateArray())
                    if (!Finite(component, out var value) || value < 0) return "地图 unity.waves.transitionDelays 必须是最多 32 个非负数值。";
            }
        }
        if (unity.TryGetProperty("settings", out var settings) && settings.ValueKind != JsonValueKind.Null)
        {
            if (settings.ValueKind != JsonValueKind.Object) return "地图 unity.settings 必须是 JSON 对象。";
            if (settings.TryGetProperty("buildNavMeshOnImport", out var build) && build.ValueKind != JsonValueKind.Null && build.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return "地图 unity.settings.buildNavMeshOnImport 必须是布尔值。";
            if (settings.TryGetProperty("agentType", out var agentType) && agentType.ValueKind != JsonValueKind.Null && agentType.ValueKind != JsonValueKind.String) return "地图 unity.settings.agentType 必须是文本。";
            if (settings.TryGetProperty("collectObjects", out var collect) && collect.ValueKind != JsonValueKind.Null &&
                (collect.ValueKind != JsonValueKind.String || !CollectObjects.Contains(collect.GetString()!))) return "地图 unity.settings.collectObjects 无效。";
        }
        return null;
    }

    /// <summary>Validates the Unity component mapping of one object and reports its path-node links.</summary>
    private static string? ValidateUnityObject(JsonElement unity, string id, out List<string> links)
    {
        links = new List<string>();
        var ceilingError = ValidateCeilingGrids(unity, id);
        if (ceilingError is not null) return ceilingError;
        foreach (var key in new[] { "prefab", "collider", "navMesh", "spawnPoint", "enemyCore", "pathNode", "trigger" })
            if (unity.TryGetProperty(key, out var section) && section.ValueKind != JsonValueKind.Null && section.ValueKind != JsonValueKind.Object)
                return $"{id} 的 unity.{key} 必须是 JSON 对象。";
        if (unity.TryGetProperty("prefab", out var prefab) && prefab.ValueKind == JsonValueKind.Object)
        {
            foreach (var key in new[] { "id", "guid", "assetPath" })
                if (prefab.TryGetProperty(key, out var text) && text.ValueKind != JsonValueKind.Null && text.ValueKind != JsonValueKind.String) return $"{id} 的 unity.prefab.{key} 必须是文本。";
        }
        if (unity.TryGetProperty("collider", out var collider) && collider.ValueKind == JsonValueKind.Object)
        {
            var error = Choice(collider, "type", ColliderTypes, id, "unity.collider.type");
            if (error is not null) return error;
            error = Flags(collider, id, "unity.collider.isTrigger"); if (error is not null) return error;
            error = Vector(collider, "center", false, id, "unity.collider.center"); if (error is not null) return error;
            error = Vector(collider, "size", true, id, "unity.collider.size"); if (error is not null) return error;
            error = Range(collider, "radius", 0.01, 1e4, id, "unity.collider.radius"); if (error is not null) return error;
            error = Range(collider, "height", 0.01, 1e4, id, "unity.collider.height"); if (error is not null) return error;
            if (collider.TryGetProperty("direction", out var direction) && direction.ValueKind != JsonValueKind.Null &&
                (direction.ValueKind != JsonValueKind.Number || !direction.TryGetInt32(out var axis) || axis is < 0 or > 2)) return $"{id} 的 unity.collider.direction 必须是 0–2。";
        }
        if (unity.TryGetProperty("navMesh", out var navMesh) && navMesh.ValueKind == JsonValueKind.Object)
        {
            var error = Choice(navMesh, "role", NavRoles, id, "unity.navMesh.role");
            if (error is not null) return error;
            if (navMesh.TryGetProperty("area", out var area) && area.ValueKind != JsonValueKind.Null &&
                (area.ValueKind != JsonValueKind.Number || !area.TryGetInt32(out var areaIndex) || areaIndex is < 0 or > 31)) return $"{id} 的 unity.navMesh.area 必须是 0–31。";
            if (navMesh.TryGetProperty("agentType", out var agentType) && agentType.ValueKind != JsonValueKind.Null && agentType.ValueKind != JsonValueKind.String) return $"{id} 的 unity.navMesh.agentType 必须是文本。";
            error = Flags(navMesh, id, "unity.navMesh.ignoreFromBuild", "unity.navMesh.applyToChildren", "unity.navMesh.bidirectional"); if (error is not null) return error;
            error = Vector(navMesh, "linkStart", false, id, "unity.navMesh.linkStart"); if (error is not null) return error;
            error = Vector(navMesh, "linkEnd", false, id, "unity.navMesh.linkEnd"); if (error is not null) return error;
            error = Range(navMesh, "linkWidth", 0.01, 1e4, id, "unity.navMesh.linkWidth"); if (error is not null) return error;
        }
        if (unity.TryGetProperty("spawnPoint", out var spawnPoint) && spawnPoint.ValueKind == JsonValueKind.Object)
        {
            var error = Flags(spawnPoint, id, "unity.spawnPoint.enabled", "unity.spawnPoint.flyingEntrance"); if (error is not null) return error;
            error = Range(spawnPoint, "spawnInterval", 0.01, 600, id, "unity.spawnPoint.spawnInterval"); if (error is not null) return error;
            error = Range(spawnPoint, "initialDelay", 0, 600, id, "unity.spawnPoint.initialDelay"); if (error is not null) return error;
            if (spawnPoint.TryGetProperty("enemiesPerWave", out var enemiesPerWave) && enemiesPerWave.ValueKind != JsonValueKind.Null &&
                (enemiesPerWave.ValueKind != JsonValueKind.Number || !enemiesPerWave.TryGetInt32(out var enemies) || enemies is < 0 or > 999)) return $"{id} 的 unity.spawnPoint.enemiesPerWave 必须是 0–999 的整数。";
            error = Range(spawnPoint, "moveSpeed", 0, 100, id, "unity.spawnPoint.moveSpeed"); if (error is not null) return error;
            error = Vector(spawnPoint, "travelDirection", false, id, "unity.spawnPoint.travelDirection"); if (error is not null) return error;
            error = Choice(spawnPoint, "monsterType", SpawnMonsterTypes, id, "unity.spawnPoint.monsterType"); if (error is not null) return error;
            error = Range(spawnPoint, "flightHeight", 0, 200, id, "unity.spawnPoint.flightHeight"); if (error is not null) return error;
            error = Range(spawnPoint, "entranceAltitude", 0, 500, id, "unity.spawnPoint.entranceAltitude"); if (error is not null) return error;
            foreach (var key in new[] { "laneId", "enemyPrefabId" })
                if (spawnPoint.TryGetProperty(key, out var text) && text.ValueKind != JsonValueKind.Null && text.ValueKind != JsonValueKind.String) return $"{id} 的 unity.spawnPoint.{key} 必须是文本。";
            if (spawnPoint.TryGetProperty("waves", out var waves) && waves.ValueKind != JsonValueKind.Null)
            {
                if (waves.ValueKind != JsonValueKind.Array) return $"{id} 的 unity.spawnPoint.waves 必须是数组。";
                int index = 0;
                foreach (var wave in waves.EnumerateArray())
                {
                    index++;
                    if (wave.ValueKind != JsonValueKind.Object) return $"{id} 的 unity.spawnPoint.waves[{index}] 必须是 JSON 对象。";
                    if (wave.TryGetProperty("enabled", out var enabled) && enabled.ValueKind != JsonValueKind.Null && enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return $"{id} 的 unity.spawnPoint.waves[{index}].enabled 必须是布尔值。";
                    if (wave.TryGetProperty("enemyCount", out var enemyCount) && enemyCount.ValueKind != JsonValueKind.Null &&
                        (enemyCount.ValueKind != JsonValueKind.Number || !enemyCount.TryGetInt32(out var count) || count is < 0 or > 999)) return $"{id} 的 unity.spawnPoint.waves[{index}].enemyCount 必须是 0–999 的整数。";
                    var waveError = Range(wave, "flightHeight", 0, 200, id, $"unity.spawnPoint.waves[{index}].flightHeight"); if (waveError is not null) return waveError;
                    if (wave.TryGetProperty("monsterType", out var monsterType) && monsterType.ValueKind != JsonValueKind.Null &&
                        (monsterType.ValueKind != JsonValueKind.String || !WaveMonsterTypes.Contains(monsterType.GetString()!))) return $"{id} 的 unity.spawnPoint.waves[{index}].monsterType 无效。";
                }
            }
        }
        if (unity.TryGetProperty("enemyCore", out var enemyCore) && enemyCore.ValueKind == JsonValueKind.Object)
        {
            var error = Flags(enemyCore, id, "unity.enemyCore.enabled"); if (error is not null) return error;
            error = Range(enemyCore, "maxHealth", 1, 1e6, id, "unity.enemyCore.maxHealth"); if (error is not null) return error;
            error = Range(enemyCore, "groundDamage", 0, 1e6, id, "unity.enemyCore.groundDamage"); if (error is not null) return error;
            error = Range(enemyCore, "flyingDamage", 0, 1e6, id, "unity.enemyCore.flyingDamage"); if (error is not null) return error;
            error = Range(enemyCore, "arrivalRadius", 0.01, 1e4, id, "unity.enemyCore.arrivalRadius"); if (error is not null) return error;
        }
        if (unity.TryGetProperty("pathNode", out var pathNode) && pathNode.ValueKind == JsonValueKind.Object)
        {
            var error = Flags(pathNode, id, "unity.pathNode.enabled"); if (error is not null) return error;
            error = Choice(pathNode, "role", PathRoles, id, "unity.pathNode.role"); if (error is not null) return error;
            error = Range(pathNode, "waitTime", 0, 600, id, "unity.pathNode.waitTime"); if (error is not null) return error;
            if (pathNode.TryGetProperty("links", out var nodeLinks) && nodeLinks.ValueKind != JsonValueKind.Null)
            {
                if (nodeLinks.ValueKind != JsonValueKind.Array || nodeLinks.EnumerateArray().Any(link => link.ValueKind != JsonValueKind.String)) return $"{id} 的 unity.pathNode.links 必须是文本数组。";
                foreach (var link in nodeLinks.EnumerateArray()) if (!string.IsNullOrWhiteSpace(link.GetString())) links.Add(link.GetString()!);
            }
        }
        if (unity.TryGetProperty("trigger", out var trigger) && trigger.ValueKind == JsonValueKind.Object)
        {
            var error = Flags(trigger, id, "unity.trigger.enabled", "unity.trigger.isTrigger", "unity.trigger.once"); if (error is not null) return error;
            error = Choice(trigger, "shape", TriggerShapes, id, "unity.trigger.shape"); if (error is not null) return error;
            error = Vector(trigger, "center", false, id, "unity.trigger.center"); if (error is not null) return error;
            error = Vector(trigger, "size", true, id, "unity.trigger.size"); if (error is not null) return error;
            error = Range(trigger, "radius", 0.01, 1e4, id, "unity.trigger.radius"); if (error is not null) return error;
            if (trigger.TryGetProperty("events", out var events) && events.ValueKind != JsonValueKind.Null)
            {
                if (events.ValueKind != JsonValueKind.Array) return $"{id} 的 unity.trigger.events 必须是数组。";
                int index = 0;
                foreach (var triggerEvent in events.EnumerateArray())
                {
                    index++;
                    if (triggerEvent.ValueKind != JsonValueKind.Object) return $"{id} 的 unity.trigger.events[{index}] 必须是 JSON 对象。";
                    var eventError = Choice(triggerEvent, "when", TriggerWhens, id, $"unity.trigger.events[{index}].when"); if (eventError is not null) return eventError;
                    eventError = Choice(triggerEvent, "action", TriggerActions, id, $"unity.trigger.events[{index}].action"); if (eventError is not null) return eventError;
                    foreach (var key in new[] { "target", "message" })
                        if (triggerEvent.TryGetProperty(key, out var text) && text.ValueKind != JsonValueKind.Null && text.ValueKind != JsonValueKind.String) return $"{id} 的 unity.trigger.events[{index}].{key} 必须是文本。";
                    eventError = Range(triggerEvent, "amount", 0, 1e9, id, $"unity.trigger.events[{index}].amount"); if (eventError is not null) return eventError;
                    eventError = Range(triggerEvent, "delay", 0, 600, id, $"unity.trigger.events[{index}].delay"); if (eventError is not null) return eventError;
                }
            }
        }
        return null;
    }

    private static string? ValidateCeilingGrids(JsonElement unity, string id)
    {
        if (!unity.TryGetProperty("ceilingTrapGrids", out var grids) || grids.ValueKind == JsonValueKind.Null) return null;
        string error = id + " 的天花板网格无效：需要唯一 ID、有效尺寸和对应的布尔掩码。";
        if (grids.ValueKind != JsonValueKind.Array) return error;
        var ids = new HashSet<string>();
        foreach (var grid in grids.EnumerateArray())
        {
            if (grid.ValueKind != JsonValueKind.Object || !grid.TryGetProperty("id", out var gridId)
                || gridId.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(gridId.GetString())
                || !ids.Add(gridId.GetString()!.Trim())) return error;
            int columns = 4, rows = 4;
            if (grid.TryGetProperty("columns", out var c) && (c.ValueKind != JsonValueKind.Number || !c.TryGetInt32(out columns))) return error;
            if (grid.TryGetProperty("rows", out var r) && (r.ValueKind != JsonValueKind.Number || !r.TryGetInt32(out rows))) return error;
            if (columns < 1 || columns > 256 || rows < 1 || rows > 256) return error;
            foreach (var key in new[] { "origin", "rotation" })
                if (grid.TryGetProperty(key, out var vector) && vector.ValueKind != JsonValueKind.Null
                    && (vector.ValueKind != JsonValueKind.Array || vector.GetArrayLength() != 3 || vector.EnumerateArray().Any(v => !Finite(v, out _)))) return error;
            if (grid.TryGetProperty("cellSize", out var size) && (!Finite(size, out var cell) || cell < .01 || cell > 100)) return error;
            if (grid.TryGetProperty("surfaceOffset", out var offset) && (!Finite(offset, out var gap) || gap < 0 || gap > 10)) return error;
            if (grid.TryGetProperty("autoFit", out var fit) && fit.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return error;
            if (grid.TryGetProperty("openCells", out var mask) && mask.ValueKind != JsonValueKind.Null
                && (mask.ValueKind != JsonValueKind.Array || mask.GetArrayLength() != columns * rows
                    || mask.EnumerateArray().Any(v => v.ValueKind is not (JsonValueKind.True or JsonValueKind.False)))) return error;
        }
        return null;
    }

    private static string? Choice(JsonElement section, string key, string[] allowed, string id, string path)
    {
        if (!section.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        return value.ValueKind == JsonValueKind.String && allowed.Contains(value.GetString()!) ? null : $"{id} 的 {path} 无效。";
    }

    private static string? Flags(JsonElement section, string id, params string[] paths)
    {
        foreach (var path in paths)
        {
            var key = path[(path.LastIndexOf('.') + 1)..];
            if (section.TryGetProperty(key, out var value) && value.ValueKind != JsonValueKind.Null && value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return $"{id} 的 {path} 必须是布尔值。";
        }
        return null;
    }

    private static string? Range(JsonElement section, string key, double min, double max, string id, string path)
    {
        if (!section.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        return Finite(value, out var number) && number >= min && number <= max ? null : $"{id} 的 {path} 必须在 {min}–{max} 之间。";
    }

    private static string? Vector(JsonElement section, string key, bool positive, string id, string path)
    {
        if (!section.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 3) return $"{id} 的 {path} 需要三个有限数值。";
        foreach (var component in value.EnumerateArray())
            if (!Finite(component, out var number) || (positive && number <= 0)) return $"{id} 的 {path} 需要三个" + (positive ? "大于 0" : "有限") + "的数值。";
        return null;
    }
    private static bool Finite(JsonElement value, out double number)
    {
        number = 0;
        return value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out number) && double.IsFinite(number);
    }
}
