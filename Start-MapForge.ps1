param(
    [int]$Port = 5090
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectFile = Join-Path $projectRoot 'MapEditor.csproj'
$url = "http://localhost:$Port"
$healthUrl = "$url/api/health"

function Test-MapForge {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

try {
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        throw '.NET SDK was not found in PATH. Please install .NET SDK 10.'
    }
    if (-not (Test-Path -LiteralPath $projectFile)) {
        throw "Project file not found: $projectFile"
    }

    # Reuse an already running instance when possible.
    if (Test-MapForge) {
        Start-Process $url
        exit 0
    }

    $server = Start-Process -FilePath 'dotnet' -ArgumentList @(
        'run', '--project', $projectFile, '--no-launch-profile', '--urls', $url
    ) -WorkingDirectory $projectRoot -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        if ($server.HasExited) {
            throw "MapForge failed to start (exit code $($server.ExitCode))."
        }
        if (Test-MapForge) {
            $ready = $true
            break
        }
    }
    if (-not $ready) {
        throw "MapForge did not start within 30 seconds. Check whether port $Port is in use."
    }

    Start-Process $url
    Write-Host "MapForge started: $url"
} catch {
    [Console]::Error.WriteLine("Startup failed: $($_.Exception.Message)")
    Read-Host 'Press Enter to close this window'
    exit 1
}
