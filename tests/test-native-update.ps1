param([switch]$PreparationAndOutcomes)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe' }
$fixtureParent = [IO.Path]::GetFullPath((Join-Path $projectRoot '.public-release'))
[IO.Directory]::CreateDirectory($fixtureParent) | Out-Null
if ((Get-Item -LiteralPath $fixtureParent -Force).LinkType) { throw 'Native test fixture parent must not be a symbolic link or junction.' }
$fixtureName = 'native-test-' + [Guid]::NewGuid().ToString('N')
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $fixtureParent $fixtureName))
if (Test-Path -LiteralPath $fixtureRoot) { throw 'Native test fixture directory already exists.' }
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
$testExe = Join-Path $fixtureRoot 'ZNoteUpdateTests.exe'
try {
    Write-Output ('Native updater test fixtures: ' + $fixtureRoot)
    & $compiler /nologo /target:exe /main:NativeUpdateTests /checked+ /warn:4 /warnaserror+ "/out:$testExe" /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $projectRoot 'app/native/ZNoteUpdate.cs') (Join-Path $PSScriptRoot 'NativeUpdateTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Native updater test compilation failed.' }
    if ($PreparationAndOutcomes) { & $testExe --test-root $fixtureRoot --preparation-and-outcomes } else { & $testExe --test-root $fixtureRoot }
    if ($LASTEXITCODE -ne 0) { throw 'Native updater tests failed.' }
} finally {
    # Delete only this run's generated directory, never a caller-supplied path.
    $cleanupRoot = [IO.Path]::GetFullPath($fixtureRoot)
    if ([IO.Path]::GetDirectoryName($cleanupRoot) -ne $fixtureParent -or [IO.Path]::GetFileName($cleanupRoot) -ne $fixtureName) { throw 'Native test cleanup path is outside its generated fixture directory.' }
    if (Test-Path -LiteralPath $cleanupRoot) {
        if ((Get-Item -LiteralPath $cleanupRoot -Force).LinkType) { throw 'Native test cleanup refused a symbolic link or junction.' }
        Remove-Item -LiteralPath $cleanupRoot -Recurse -Force
    }
}
