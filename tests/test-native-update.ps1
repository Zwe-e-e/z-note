param([switch]$PreparationAndOutcomes)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe' }
$testExe = Join-Path ([IO.Path]::GetTempPath()) ('ZNoteUpdateTests-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    & $compiler /nologo /target:exe /main:NativeUpdateTests /checked+ /warn:4 /warnaserror+ "/out:$testExe" /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $projectRoot 'app/native/ZNoteUpdate.cs') (Join-Path $PSScriptRoot 'NativeUpdateTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Native updater test compilation failed.' }
    if ($PreparationAndOutcomes) { & $testExe --preparation-and-outcomes } else { & $testExe }
    if ($LASTEXITCODE -ne 0) { throw 'Native updater tests failed.' }
} finally {
    if (Test-Path -LiteralPath $testExe) { Remove-Item -LiteralPath $testExe }
}
