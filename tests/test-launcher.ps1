$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe' }
$temporaryExe = Join-Path ([IO.Path]::GetTempPath()) ('ZNoteLauncherTests-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    & $compiler /nologo /target:exe /main:NativeLauncherTests /checked+ /warn:4 /warnaserror+ "/out:$temporaryExe" /reference:System.dll /reference:System.Windows.Forms.dll (Join-Path $projectRoot 'app/native/ZNoteLauncher.cs') (Join-Path $PSScriptRoot 'NativeLauncherTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Portable launcher test compilation failed.' }
    & $temporaryExe (Join-Path $projectRoot 'Z Note.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Portable launcher tests failed.' }
} finally {
    if (Test-Path -LiteralPath $temporaryExe) { Remove-Item -LiteralPath $temporaryExe }
}
