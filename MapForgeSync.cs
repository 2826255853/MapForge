using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

/// <summary>
/// Bridge between the browser editor and the Unity project that consumes the map.
///
/// "Send to Unity" writes one revision file into &lt;UnityProject&gt;/MapForgeSync/mail/
/// instead of asking the user to copy mapforge-world.json by hand. The Unity editor
/// plug-in (Assets/Editor/MapForgeLiveSync.cs) polls the same folder, applies the
/// revision and writes its result back, so the browser can report what happened
/// without guessing.
///
/// The revision only carries the objects that actually changed since the previous
/// send, so Unity can edit the scene in place. A full document travels only when
/// MapForge has no baseline, when the scene-level part of the map changed, or when
/// the editor asks for one because it lost track of the applied revision.
/// </summary>
public static class MapForgeSync
{
    /// <summary>Revision file format version, mirrored by MapForgeLiveSync.Protocol.</summary>
    public const int Protocol = 1;

    private const string SyncFolderName = "MapForgeSync";
    private const string MailFolderName = "mail";
    private const string OutboxFolderName = "outbox";
    private const string PendingFileName = "pending.json";
    private const string BaselineFileName = "baseline.json";
    private const string ResultFileName = "result.json";
    private const string StatusFileName = "status.json";
    private const string RevisionFileName = "revision.txt";
    private const string SettingsFileName = "mapforge-sync.json";

    /// <summary>Root the importer builds the map under; mirrored by MapForgeWorldImporter.RootName.</summary>
    private const string RootName = "MapForgeWorld";

    /// <summary>Unity counts as connected while its heartbeat is this fresh.</summary>
    private const double ConnectedSeconds = 45;

    /// <summary>Increments this large are cheaper to send as a whole document.</summary>
    private const int FullRebuildPercent = 60;

    private static readonly object Gate = new();
    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private static readonly UTF8Encoding Utf8NoBom = new(false);
    private static string? contentRoot;

    /// <summary>Folder that holds mapforge-sync.json; the MapForge project folder by default.</summary>
    public static string ContentRoot
    {
        get => contentRoot ??= FindContentRoot();
        set => contentRoot = value;
    }

    // ---------------------------------------------------------------- target project

    /// <summary>Absolute path of the Unity project MapForge sends maps to, or null when none was found.</summary>
    public static string? ResolveUnityProject()
    {
        var configured = ReadConfiguredProject();
        if (configured is not null) return configured;
        var fromEnvironment = Environment.GetEnvironmentVariable("MAPFORGE_UNITY_PROJECT");
        return IsUnityProject(fromEnvironment) ? Path.GetFullPath(fromEnvironment!) : DetectUnityProject();
    }

    /// <summary>A Unity project has an Assets folder and a ProjectSettings/ProjectVersion.txt.</summary>
    public static bool IsUnityProject(string? path) =>
        !string.IsNullOrWhiteSpace(path) && Directory.Exists(path) &&
        File.Exists(Path.Combine(path!, "ProjectSettings", "ProjectVersion.txt")) &&
        Directory.Exists(Path.Combine(path!, "Assets"));

    /// <summary>Stores (or clears) the Unity project path and returns the resulting target description.</summary>
    public static (bool Ok, JsonObject Body) SetUnityProject(string? path)
    {
        lock (Gate)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                try { if (File.Exists(SettingsPath)) File.Delete(SettingsPath); }
                catch (Exception exception) { return (false, Failure("无法清除 Unity 工程配置：" + exception.Message)); }
                var detected = DetectUnityProject();
                if (detected is null)
                    return (true, new JsonObject
                    {
                        ["connected"] = false,
                        ["unityProject"] = null,
                        ["message"] = "已改回自动检测，但没有找到 Unity 工程。请手动填写工程路径。",
                    });
                return (true, Project(detected, "已改回自动检测，当前工程由扫描得到。"));
            }
            var full = Path.GetFullPath(path.Trim().Trim('"'));
            if (!IsUnityProject(full)) return (false, Failure("这不是 Unity 工程（需要 Assets 与 ProjectSettings/ProjectVersion.txt）：" + full));
            try
            {
                Directory.CreateDirectory(ContentRoot);
                WriteJson(SettingsPath, new JsonObject { ["unityProject"] = full });
            }
            catch (Exception exception) { return (false, Failure("无法保存 Unity 工程配置：" + exception.Message)); }
            return (true, Project(full, "Unity 工程已切换。"));
        }
    }

    private static string SettingsPath => Path.Combine(ContentRoot, SettingsFileName);

    private static string? ReadConfiguredProject()
    {
        var settings = ReadObject(SettingsPath);
        var path = Text(settings?["unityProject"]);
        return IsUnityProject(path) ? Path.GetFullPath(path!) : null;
    }

    /// <summary>
    /// Scans the usual Unity project locations and keeps the project that looks most like
    /// the MapForge workspace, so a machine with several Unity projects picks the right one
    /// instead of whichever folder happens to sort first.
    /// </summary>
    private static string? DetectUnityProject()
    {
        var candidates = new List<string>();
        foreach (var root in SearchRoots())
        {
            try { if (Directory.Exists(root)) candidates.AddRange(Directory.EnumerateDirectories(root).OrderBy(name => name, StringComparer.OrdinalIgnoreCase)); }
            catch (Exception) { }
        }
        // Several Unity projects can sit side by side (C:\Unity Project holds two), and the
        // one MapForge should talk to is the one that already carries the importer, the
        // exported world or a sync folder. Scoring turns that into a choice instead of
        // whichever folder happens to sort first.
        var ranked = candidates.Where(IsUnityProject)
            .Select(candidate => (Path: Path.GetFullPath(candidate), Score: EvidenceScore(candidate)))
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.Path, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var best = ranked.FirstOrDefault(candidate => candidate.Score > 0);
        return best.Path ?? ranked.Select(candidate => candidate.Path).FirstOrDefault();
    }

    /// <summary>
    /// How strongly a Unity project looks like the one MapForge belongs to. The editor
    /// plug-in counts most, then the exported world and the materials the importer
    /// generates; a sync folder means MapForge already sent something here.
    /// </summary>
    private static int EvidenceScore(string project)
    {
        int score = 0;
        if (File.Exists(Path.Combine(project, "Assets", "Editor", "MapForgeLiveSync.cs"))) score += 8;
        if (File.Exists(Path.Combine(project, "Assets", "Editor", "MapForgeWorldImporter.cs"))) score += 4;
        if (File.Exists(Path.Combine(project, "Assets", "mapforge-world.json"))) score += 2;
        if (Directory.Exists(SyncRoot(project))) score += 1;
        return score;
    }

    private static IEnumerable<string> SearchRoots()
    {
        var parent = Path.GetDirectoryName(ContentRoot);
        yield return string.IsNullOrEmpty(parent) ? Path.Combine(ContentRoot, "Unity Project") : Path.Combine(parent, "Unity Project");
        yield return @"C:\Unity Project";
        yield return @"C:\UnityProjects";
        yield return @"C:\Projects";
        yield return @"D:\Unity Project";
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrWhiteSpace(home))
        {
            yield return Path.Combine(home, "Unity Projects");
            yield return Path.Combine(home, "Documents", "Unity Projects");
        }
    }

    private static string FindContentRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "MapForge.csproj"))) return directory.FullName;
            directory = directory.Parent;
        }
        return Directory.GetCurrentDirectory();
    }

    // ------------------------------------------------------------------------ paths

    public static string SyncRoot(string unityProject) => Path.Combine(unityProject, SyncFolderName);
    public static string MailRoot(string unityProject) => Path.Combine(SyncRoot(unityProject), MailFolderName);
    public static string OutboxRoot(string unityProject) => Path.Combine(SyncRoot(unityProject), OutboxFolderName);
    private static string PendingPath(string project) => Path.Combine(MailRoot(project), PendingFileName);
    private static string BaselinePath(string project) => Path.Combine(MailRoot(project), BaselineFileName);
    private static string ResultPath(string project) => Path.Combine(OutboxRoot(project), ResultFileName);
    private static string StatusPath(string project) => Path.Combine(SyncRoot(project), StatusFileName);
    private static string RevisionPath(string project) => Path.Combine(SyncRoot(project), RevisionFileName);

    // ----------------------------------------------------------------------- status

    /// <summary>Connection and last-result report the browser polls while it waits for Unity.</summary>
    public static JsonObject Status()
    {
        var project = ResolveUnityProject();
        if (project is null)
            return new JsonObject
            {
                ["connected"] = false,
                ["unityProject"] = null,
                ["message"] = "没有找到 Unity 工程。请指定工程路径后再发送。",
                ["hint"] = "自动扫描的位置包括 C:\\Unity Project 等常见目录，也可以用 MAPFORGE_UNITY_PROJECT 环境变量固定。",
            };
        return Project(project, null);
    }

    private static JsonObject Project(string project, string? message)
    {
        var syncRoot = SyncRoot(project);
        var heartbeat = ReadObject(StatusPath(project));
        var lastSeen = Text(heartbeat?["lastSeenUtc"]);
        double? secondsSinceSeen = null;
        if (DateTimeOffset.TryParse(lastSeen, out var seen))
            secondsSinceSeen = Math.Round((DateTimeOffset.UtcNow - seen).TotalSeconds, 1);
        var result = ReadObject(ResultPath(project));
        var pending = ReadObject(PendingPath(project));
        bool connected = secondsSinceSeen is not null && secondsSinceSeen <= ConnectedSeconds;

        var status = new JsonObject
        {
            ["connected"] = connected,
            ["unityProject"] = project,
            ["syncRoot"] = syncRoot,
            ["projectExists"] = Directory.Exists(syncRoot),
            ["editorOpen"] = connected,
            ["appliedRevision"] = Int(heartbeat?["appliedRevision"]),
            // Objects the open Unity scene can be matched by ID. Zero means the scene was
            // built by an import that predates the identifiers, so an increment has nothing
            // to patch and the send is promoted to a rebuild instead.
            ["appliedObjects"] = Int(heartbeat?["objects"]),
            ["appliedScene"] = Text(heartbeat?["sceneName"]),
            ["appliedMap"] = Text(heartbeat?["map"]),
            ["unityVersion"] = Text(heartbeat?["unityVersion"]),
            ["lastSeenUtc"] = lastSeen,
            ["secondsSinceSeen"] = secondsSinceSeen,
            ["pendingRevision"] = Int(pending?["revision"]),
            ["pendingMode"] = Text(pending?["mode"]),
            ["pendingChanges"] = Int(pending?["summary"]?["created"]) + Int(pending?["summary"]?["updated"]) + Int(pending?["summary"]?["deleted"]),
            ["baselineRevision"] = Int(ReadObject(BaselinePath(project))?["revision"]),
            ["lastResult"] = result is null ? null : result.DeepClone(),
        };
        if (message is not null) status["message"] = message;
        if (!connected) status["hint"] = "Unity 编辑器未在最近 " + ConnectedSeconds + " 秒内发出心跳。请打开工程并保持编辑器运行。";
        return status;
    }

    // --------------------------------------------------------------- change preview

    /// <summary>Change set MapForge would send right now, without writing anything.</summary>
    public static (int Code, JsonObject Body) Preview(JsonElement map)
    {
        lock (Gate)
        {
            var project = ResolveUnityProject();
            if (project is null) return (400, Failure("没有找到 Unity 工程。请先指定工程路径。"));
            // Validated here rather than in the route, so every caller of the preview sees
            // the same rejection the send endpoint gives instead of a read-only report of a
            // document that could never be sent.
            if (MapValidation.Validate(map) is string invalid) return (400, Failure(invalid));
            if (Parse(map.GetRawText()) is not JsonObject current) return (400, Failure("地图内容不是 JSON 对象。"));
            var change = BuildChange(current, PreviousDocument(project), false);
            ApplySceneBlocker(change, project);
            var body = change.Report(current);
            body["unityProject"] = project;
            body["baselineRevision"] = Int(ReadObject(BaselinePath(project))?["revision"]);
            return (200, body);
        }
    }

    /// <summary>Writes the next revision into the Unity project's mail folder.</summary>
    public static (int Code, JsonObject Body) Send(JsonElement map, bool forceFull)
    {
        lock (Gate)
        {
            var project = ResolveUnityProject();
            if (project is null) return (400, Failure("没有找到 Unity 工程。请先指定工程路径。"));
            if (Parse(map.GetRawText()) is not JsonObject current) return (400, Failure("地图内容不是 JSON 对象。"));
            var change = BuildChange(current, PreviousDocument(project), forceFull || LastSendFailed(project));
            ApplySceneBlocker(change, project);
            JsonObject patch;
            int revision;
            try
            {
                Directory.CreateDirectory(MailRoot(project));
                Directory.CreateDirectory(OutboxRoot(project));
                revision = NextRevision(project);
                patch = BuildPatch(project, current, change, revision);
                // The baseline is the document this revision was built from, so the
                // next send can keep diffing against exactly what Unity received.
                WriteJson(BaselinePath(project), new JsonObject { ["revision"] = revision, ["document"] = current.DeepClone() });
                WriteJson(PendingPath(project), patch);
                // A stale result would otherwise be reported as the answer to this revision.
                if (ReadObject(ResultPath(project))?["revision"] is JsonNode reported && Int(reported) >= revision)
                    File.Delete(ResultPath(project));
            }
            catch (Exception exception) { return (400, Failure("无法写入 Unity 同步目录：" + exception.Message)); }

            var body = change.Report(current);
            body["ok"] = true;
            body["revision"] = revision;
            body["unityProject"] = project;
            // Copied as a value, not as a node: a JsonNode taken out of one tree still has
            // that tree as its parent and cannot be attached to a second one.
            body["unityConnected"] = Project(project, null)["connected"]?.GetValue<bool>() ?? false;
            body["message"] = change.Mode == "full"
                ? $"已发送完整地图（第 {revision} 版，{change.ObjectCount} 个对象），Unity 将重建场景。"
                : $"已发送增量更新（第 {revision} 版）：新建 {change.Created.Count} / 修改 {change.Updated.Count} / 删除 {change.Deleted.Count}。";
            return (200, body);
        }
    }

    /// <summary>Drops the baseline so the next send rebuilds the scene from scratch.</summary>
    public static (int Code, JsonObject Body) ResetBaseline()
    {
        lock (Gate)
        {
            var project = ResolveUnityProject();
            if (project is null) return (400, Failure("没有找到 Unity 工程。请先指定工程路径。"));
            try
            {
                if (File.Exists(BaselinePath(project))) File.Delete(BaselinePath(project));
                if (File.Exists(PendingPath(project))) File.Delete(PendingPath(project));
            }
            catch (Exception exception) { return (400, Failure("无法清理同步状态：" + exception.Message)); }
            return (200, new JsonObject { ["ok"] = true, ["message"] = "已清除基线：下一次发送会重建整个场景。" });
        }
    }

    /// <summary>
    /// True when the last revision was sent but not applied. Unity refuses a patch it cannot
    /// apply (an older baseline, a missing scene) instead of half-applying it, so the next
    /// send has to rebuild rather than patch against a baseline Unity never reached.
    /// </summary>
    private static bool LastSendFailed(string project)
    {
        var result = ReadObject(ResultPath(project));
        if (result is null) return false;
        if (result["ok"] is JsonNode ok && ok.GetValue<bool>()) return false;
        // Only the newest revision matters: a failure that was already rebuilt on top of is
        // reported once, not for every later send.
        var baseline = ReadObject(BaselinePath(project));
        return Int(result["revision"]) >= Int(baseline?["revision"]);
    }

    /// <summary>
    /// Reason the open Unity scene cannot take an increment, or null when it can (or when Unity
    /// is offline, so the question cannot be answered yet).
    ///
    /// A scene whose objects carry no MapForgeObjectProperties has no identifier for the
    /// incremental path to match an object by. Unity refuses such a patch rather than adding a
    /// second copy of every object, which means a send that chose "increment" would fail.
    /// Promoting it here turns that dead end into the rebuild the scene needs; the rebuild
    /// writes the identifiers, so every later send is incremental.
    ///
    /// The heartbeat describes the scene Unity has open, so it only answers for a map of the
    /// same name. When another scene is open the map scene on disk cannot be inspected from
    /// here, and the send keeps the mode the diff chose; Unity then refuses the patch with the
    /// message that asks for a rebuild, and the next send is promoted by LastSendFailed.
    /// </summary>
    private static string? IncrementBlockReason(string project, string map)
    {
        var heartbeat = ReadObject(StatusPath(project));
        if (heartbeat is null) return null;
        if (!DateTimeOffset.TryParse(Text(heartbeat["lastSeenUtc"]), out var seen)) return null;
        if ((DateTimeOffset.UtcNow - seen).TotalSeconds > ConnectedSeconds) return null;
        if (!string.Equals(Text(heartbeat["sceneName"]), map, StringComparison.Ordinal)) return null;
        // No generated root at all: the scene was renamed, emptied or never imported, so a
        // patch has no hierarchy to edit. A rebuild creates the root the scene is missing.
        if (heartbeat["hasMapForgeWorld"] is not JsonNode hasRoot || !hasRoot.GetValue<bool>())
            return "Unity 当前打开的场景「" + map + "」里没有 " + RootName + "，无法增量更新；本次自动改为完整重建。";
        if (Int(heartbeat["objects"]) > 0) return null;
        return "Unity 当前打开的场景「" + map + "」里的对象没有 MapForge 标识，无法增量更新；本次自动改为完整重建，之后即可增量。";
    }

    /// <summary>
    /// Turns an incremental change into a rebuild when the target scene cannot be patched.
    /// Preview and Send both run this, so the mode the dialog shows is the mode that is sent.
    /// </summary>
    private static void ApplySceneBlocker(Change change, string project)
    {
        if (change.Mode != "increment") return;
        var reason = IncrementBlockReason(project, change.Map);
        if (reason is null) return;
        change.RebuildReason = reason;
        change.Mode = "full";
    }

    private static JsonObject? PreviousDocument(string project)
    {
        var baseline = ReadObject(BaselinePath(project));
        return baseline?["document"] as JsonObject;
    }

    /// <summary>
    /// Revision counter kept next to the mail folder. It is the only state that has to
    /// survive a MapForge restart, because Unity remembers the revision it applied.
    /// </summary>
    private static int NextRevision(string project)
    {
        int previous = 0;
        try { if (File.Exists(RevisionPath(project))) int.TryParse(File.ReadAllText(RevisionPath(project)).Trim(), out previous); }
        catch (Exception) { }
        int next = Math.Max(previous, Int(ReadObject(PendingPath(project))?["revision"])) + 1;
        File.WriteAllText(RevisionPath(project), next.ToString(), Utf8NoBom);
        return next;
    }

    // ------------------------------------------------------------------- change set

    private sealed class Change
    {
        public string Mode = "full";
        public int ObjectCount;
        public string Map = "UNTITLED_WORLD";
        public JsonObject Current = new();
        public Dictionary<string, JsonObject> CurrentObjects = new(StringComparer.Ordinal);
        public List<string> Created = new();
        public List<string> Updated = new();
        public List<string> Deleted = new();
        public bool UnityChanged;
        public string? RebuildReason;

        /// <summary>Browser-facing summary, shared by preview and send.</summary>
        public JsonObject Report(JsonObject current)
        {
            return new JsonObject
            {
                ["map"] = Map,
                ["mode"] = Mode,
                ["objects"] = ObjectCount,
                ["created"] = Created.Count,
                ["updated"] = Updated.Count,
                ["deleted"] = Deleted.Count,
                ["unityChanged"] = UnityChanged,
                ["rebuildReason"] = RebuildReason,
                ["changes"] = new JsonObject
                {
                    ["created"] = List(Created),
                    ["updated"] = List(Updated),
                    ["deleted"] = List(Deleted),
                },
            };
        }
    }

    private static Change BuildChange(JsonObject current, JsonObject? previous, bool forceFull)
    {
        var change = new Change
        {
            Current = current,
            Map = Text(current["name"]) ?? "UNTITLED_WORLD",
            CurrentObjects = IndexObjects(current["objects"]),
        };
        change.ObjectCount = change.CurrentObjects.Count;
        if (previous is null)
        {
            change.RebuildReason = "MapForge 没有基线（首次发送，或刚清除过基线）。";
            return change;
        }
        var previousObjects = IndexObjects(previous["objects"]);
        // The object array order is the hierarchy order, so created/updated keep the
        // document order the editor shows and deleted keeps the previous document order.
        foreach (var id in change.CurrentObjects.Keys)
        {
            if (!previousObjects.TryGetValue(id, out var before)) change.Created.Add(id);
            else if (Canonical(before) != Canonical(change.CurrentObjects[id])) change.Updated.Add(id);
        }
        foreach (var id in previousObjects.Keys)
            if (!change.CurrentObjects.ContainsKey(id)) change.Deleted.Add(id);

        // Name, gameplay and roadsideSteps describe the whole scene rather than one
        // object: the importer builds those structures in one pass, so a change there
        // means a rebuild instead of an in-place edit.
        var reasons = new List<string>();
        if (Canonical(previous["name"]) != Canonical(current["name"])) reasons.Add("地图名称变了（场景文件按名称命名）");
        if (Canonical(previous["gameplay"]) != Canonical(current["gameplay"])) reasons.Add("gameplay 路径/核心配置变了");
        if (Canonical(previous["roadsideSteps"]) != Canonical(current["roadsideSteps"])) reasons.Add("roadsideSteps 变了");
        // The scene-level Unity block builds structures that span the whole map (prefab
        // library, WaveManager, NavMesh surface), so it is rebuilt rather than patched.
        change.UnityChanged = Canonical(previous["unity"]) != Canonical(current["unity"]);
        if (change.UnityChanged) reasons.Add("场景级 Unity 映射变了（Prefab 库 / 波次 / 烘焙设置）");

        int changed = change.Created.Count + change.Updated.Count + change.Deleted.Count;
        int total = Math.Max(1, previousObjects.Count + change.CurrentObjects.Count);
        if (forceFull) reasons.Add("请求了完全重建");
        else if (changed * 100 >= total * FullRebuildPercent) reasons.Add($"{changed} 个对象变化超过 {FullRebuildPercent}%，整体重写更省事");
        change.RebuildReason = reasons.Count == 0 ? null : string.Join("；", reasons);
        change.Mode = change.RebuildReason is null ? "increment" : "full";
        return change;
    }

    private static JsonObject BuildPatch(string project, JsonObject current, Change change, int revision)
    {
        var summary = new JsonObject { ["created"] = change.Created.Count, ["updated"] = change.Updated.Count, ["deleted"] = change.Deleted.Count };
        var patch = new JsonObject
        {
            ["protocol"] = Protocol,
            ["editor"] = "MapForge",
            ["mode"] = change.Mode,
            ["map"] = change.Map,
            ["revision"] = revision,
            ["baseRevision"] = revision - 1,
            ["sentAtUtc"] = DateTimeOffset.UtcNow.ToString("O"),
            ["summary"] = summary,
            ["counts"] = new JsonObject { ["objects"] = change.ObjectCount },
            ["changes"] = new JsonObject
            {
                ["created"] = List(change.Created),
                ["updated"] = List(change.Updated),
                ["deleted"] = List(change.Deleted),
            },
            ["rebuildReason"] = change.RebuildReason,
            ["unityChanged"] = change.UnityChanged,
            // The scene-level mapping always travels: it is small and it keeps the
            // editor's prefab library, waves and bake options in step either way.
            ["unity"] = current["unity"]?.DeepClone() ?? new JsonObject(),
        };
        if (change.Mode == "increment")
        {
            // An array, not an object map: Unity's JsonUtility cannot deserialize a
            // Dictionary, and the document order is also the hierarchy order, so a
            // parent is always applied before its children.
            var objects = new JsonArray();
            foreach (var node in (JsonArray?)current["objects"] ?? new JsonArray())
            {
                var id = Text(node?["id"]);
                if (id is null || (!change.Created.Contains(id) && !change.Updated.Contains(id))) continue;
                objects.Add(node!.DeepClone());
            }
            patch["objects"] = objects;
        }
        // A full revision carries the whole world file as JSON text. Unity writes it to
        // Assets/MapForgeSync/sync-world.json and re-imports it verbatim, so a full rebuild
        // runs exactly the same import path as a manual import instead of a second,
        // hand-maintained copy of the importer.
        else patch["world"] = current.ToJsonString();
        return patch;
    }

    private static Dictionary<string, JsonObject> IndexObjects(JsonNode? objects)
    {
        var index = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        if (objects is not JsonArray array) return index;
        foreach (var item in array)
        {
            if (item is not JsonObject node) continue;
            var id = Text(node["id"]);
            if (!string.IsNullOrWhiteSpace(id)) index[id!] = node;
        }
        return index;
    }

    // --------------------------------------------------------------------- helpers

    /// <summary>Order-independent text for a JSON value, used to spot real edits.</summary>
    private static string Canonical(JsonNode? node)
    {
        var builder = new StringBuilder();
        AppendCanonical(builder, node);
        return builder.ToString();
    }

    private static void AppendCanonical(StringBuilder builder, JsonNode? node)
    {
        switch (node)
        {
            case null:
                builder.Append("null");
                break;
            case JsonObject item:
                builder.Append('{');
                bool first = true;
                foreach (var pair in item.OrderBy(entry => entry.Key, StringComparer.Ordinal))
                {
                    if (!first) builder.Append(',');
                    first = false;
                    builder.Append(JsonSerializer.Serialize(pair.Key)).Append(':');
                    AppendCanonical(builder, pair.Value);
                }
                builder.Append('}');
                break;
            case JsonArray array:
                builder.Append('[');
                for (int i = 0; i < array.Count; i++)
                {
                    if (i > 0) builder.Append(',');
                    AppendCanonical(builder, array[i]);
                }
                builder.Append(']');
                break;
            default:
                builder.Append(node.ToJsonString());
                break;
        }
    }

    private static JsonArray List(IEnumerable<string> values)
    {
        var array = new JsonArray();
        foreach (var value in values) array.Add(value);
        return array;
    }

    private static string? Text(JsonNode? node)
    {
        try { return node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null; }
        catch (Exception) { return null; }
    }

    private static int Int(JsonNode? node)
    {
        try { return node is JsonValue value && value.TryGetValue<int>(out var number) ? number : 0; }
        catch (Exception) { return 0; }
    }

    private static JsonNode? Parse(string text)
    {
        try { return JsonNode.Parse(text); }
        catch (Exception) { return null; }
    }

    /// <summary>Reads a JSON object; a missing, empty or half-written file counts as absent.</summary>
    private static JsonObject? ReadObject(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var text = File.ReadAllText(path);
            return string.IsNullOrWhiteSpace(text) ? null : Parse(text) as JsonObject;
        }
        catch (Exception) { return null; }
    }

    /// <summary>
    /// Writes through a temporary file so a Unity poll can never read half a revision.
    /// </summary>
    private static void WriteJson(string path, JsonNode node)
    {
        var folder = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, node.ToJsonString(Indented), Utf8NoBom);
        File.Move(temporary, path, true);
    }

    private static JsonObject Failure(string message) => new() { ["ok"] = false, ["error"] = message };

    /// <summary>Rejection body for map content the endpoint refused before it reached the change set.</summary>
    public static JsonObject Invalid(string message) => Failure(message);
}