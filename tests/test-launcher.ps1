param([string]$LauncherPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe' }
if (-not $LauncherPath) { $LauncherPath = Join-Path $projectRoot 'Z Note.exe' }
$LauncherPath = [IO.Path]::GetFullPath($LauncherPath)
if (-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) { throw 'Build the launcher or supply -LauncherPath with a staged executable.' }
$fixtureParent = [IO.Path]::GetFullPath((Join-Path $projectRoot '.public-release'))
[IO.Directory]::CreateDirectory($fixtureParent) | Out-Null
if ((Get-Item -LiteralPath $fixtureParent -Force).LinkType) { throw 'Launcher test fixture parent must not be a symbolic link or junction.' }
$fixtureName = 'launcher-test-' + [Guid]::NewGuid().ToString('N')
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $fixtureParent $fixtureName))
if (Test-Path -LiteralPath $fixtureRoot) { throw 'Launcher test fixture directory already exists.' }
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
$temporaryExe = Join-Path $fixtureRoot 'ZNoteLauncherTests.exe'
try {
    Write-Output ('Portable launcher test fixtures: ' + $fixtureRoot)
    & $compiler /nologo /target:exe /main:NativeLauncherTests /checked+ /warn:4 /warnaserror+ "/out:$temporaryExe" /reference:System.dll /reference:System.Windows.Forms.dll (Join-Path $projectRoot 'app/native/ZNoteLauncher.cs') (Join-Path $PSScriptRoot 'NativeLauncherTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Portable launcher test compilation failed.' }
    & $temporaryExe $LauncherPath --test-root $fixtureRoot
    if ($LASTEXITCODE -ne 0) { throw 'Portable launcher tests failed.' }
} finally {
    # Delete only this run's generated directory, never the supplied launcher path.
    $cleanupRoot = [IO.Path]::GetFullPath($fixtureRoot)
    if ([IO.Path]::GetDirectoryName($cleanupRoot) -ne $fixtureParent -or [IO.Path]::GetFileName($cleanupRoot) -ne $fixtureName) { throw 'Launcher test cleanup path is outside its generated fixture directory.' }
    if (Test-Path -LiteralPath $cleanupRoot) {
        if ((Get-Item -LiteralPath $cleanupRoot -Force).LinkType) { throw 'Launcher test cleanup refused a symbolic link or junction.' }
        Remove-Item -LiteralPath $cleanupRoot -Recurse -Force
    }
}
