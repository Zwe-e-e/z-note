# Uses the compiler already installed with Windows/.NET Framework; no downloads.
param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$compilerPaths = @(
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe')
)
$compiler = $compilerPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'The Windows .NET Framework 4 compiler was not found.' }
$source = Join-Path $projectRoot 'app/native/ZNoteHost.cs'
$updaterSource = Join-Path $projectRoot 'app/native/ZNoteUpdate.cs'
$output = if ($OutputPath) { [IO.Path]::GetFullPath($OutputPath) } else { Join-Path $projectRoot 'app/native/ZNoteHost.exe' }
[IO.Directory]::CreateDirectory((Split-Path -Parent $output)) | Out-Null
$icon = Join-Path $projectRoot 'app/img/icon.ico'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /checked+ /warn:4 /warnaserror+ "/out:$output" "/win32icon:$icon" /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll $source $updaterSource
if ($LASTEXITCODE -ne 0) { throw 'The Z Note native host build failed.' }
Get-Item -LiteralPath $output | Select-Object FullName, Length
