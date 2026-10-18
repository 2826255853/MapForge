using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);
var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "ready", engine = "MapForge" }));
app.MapPost("/api/maps/validate", (JsonElement map) =>
{
    var error = MapValidation.Validate(map);
    return error is null
        ? Results.Ok(new { valid = true, objectCount = map.GetProperty("objects").GetArrayLength() })
        : Results.BadRequest(new { valid = false, error });
});

// One-click hand-off to the Unity editor. MapForge writes a revision into the Unity
// project's MapForgeSync/mail folder; Assets/Editor/MapForgeLiveSync.cs polls it,
// applies it in place when only some objects changed, and writes a result back.
app.MapGet("/api/unity/status", () => Results.Ok(MapForgeSync.Status()));

app.MapPost("/api/unity/target", (JsonElement body) =>
{
    // An empty or missing field means "go back to auto-detection".
    string? path = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("unityProject", out var value) && value.ValueKind == JsonValueKind.String
        ? value.GetString()
        : null;
    var (ok, result) = MapForgeSync.SetUnityProject(path);
    return ok ? Results.Ok(result) : Results.BadRequest(result);
});

app.MapPost("/api/unity/preview", (JsonElement map) =>
{
    var (code, body) = MapForgeSync.Preview(map);
    return code == 200 ? Results.Ok(body) : Results.BadRequest(body);
});

app.MapPost("/api/unity/send", (JsonElement body) =>
{
    if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("map", out var map) || map.ValueKind != JsonValueKind.Object)
        return Results.BadRequest(MapForgeSync.Invalid("请求体需要包含 map 对象。"));
    if (MapValidation.Validate(map) is string error)
        return Results.BadRequest(MapForgeSync.Invalid(error));
    bool forceFull = body.TryGetProperty("mode", out var mode) && mode.ValueKind == JsonValueKind.String && mode.GetString() == "full";
    var (code, result) = MapForgeSync.Send(map, forceFull);
    return code == 200 ? Results.Ok(result) : Results.BadRequest(result);
});

app.MapPost("/api/unity/reset", () =>
{
    var (code, result) = MapForgeSync.ResetBaseline();
    return code == 200 ? Results.Ok(result) : Results.BadRequest(result);
});

app.Run();