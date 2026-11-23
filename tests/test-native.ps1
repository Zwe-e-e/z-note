$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe' }
$temporaryExe = Join-Path ([IO.Path]::GetTempPath()) ('ZNoteNativeTests-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    & $compiler /nologo /target:exe /main:NativeAwakeTests /checked+ /warn:4 /warnaserror+ "/out:$temporaryExe" /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $projectRoot 'app/native/ZNoteHost.cs') (Join-Path $projectRoot 'app/native/ZNoteUpdate.cs') (Join-Path $PSScriptRoot 'NativeAwakeTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Native test compilation failed.' }
    & $temporaryExe
    if ($LASTEXITCODE -ne 0) { throw 'Native power/lifecycle tests failed.' }
} finally {
    if (Test-Path -LiteralPath $temporaryExe) { Remove-Item -LiteralPath $temporaryExe }
}
