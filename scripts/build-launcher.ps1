# Build the portable Z-icon entry point using the compiler included with Windows.
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
$output = if ($OutputPath) { [IO.Path]::GetFullPath($OutputPath) } else { Join-Path $projectRoot 'Z Note.exe' }
[IO.Directory]::CreateDirectory((Split-Path -Parent $output)) | Out-Null
$icon = Join-Path $projectRoot 'app/img/icon.ico'
$source = Join-Path $projectRoot 'app/native/ZNoteLauncher.cs'
$version = [IO.File]::ReadAllText((Join-Path $projectRoot 'VERSION.txt')).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$' -or @($version.Split('.') | Where-Object { [long]$_ -gt 65534 }).Count) {
    throw 'VERSION.txt must contain three numeric version components from 0 to 65534.'
}
$versionAttributes = @"
using System.Reflection;
[assembly: AssemblyTitle("Z Note portable launcher")]
[assembly: AssemblyDescription("Open the portable Z Note app with background Keep Awake and automatic updates")]
[assembly: AssemblyProduct("Z Note")]
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
[assembly: AssemblyInformationalVersion("$version")]
"@
$versionSource = Join-Path ([IO.Path]::GetTempPath()) ('ZNoteLauncherVersion-' + [Guid]::NewGuid().ToString('N') + '.cs')
try {
    [IO.File]::WriteAllText($versionSource, $versionAttributes, [Text.UTF8Encoding]::new($false))
    & $compiler /nologo /target:winexe /platform:anycpu /optimize+ /checked+ /warn:4 /warnaserror+ "/out:$output" "/win32icon:$icon" /reference:System.dll /reference:System.Windows.Forms.dll $source $versionSource
    if ($LASTEXITCODE -ne 0) { throw 'The portable Z Note launcher build failed.' }
} finally {
    if (Test-Path -LiteralPath $versionSource) { Remove-Item -LiteralPath $versionSource }
}
Get-Item -LiteralPath $output | Select-Object FullName, Length
