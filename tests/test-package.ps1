# Read-only checks of the full portable ZIP and the canonical updater ZIP.
# v2.6.3+ includes the launcher in both; old migration releases used 37 files.
param([string]$NativeHostPath)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$version = [IO.File]::ReadAllText((Join-Path $projectRoot 'VERSION.txt')).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid VERSION.txt.' }

[string[]]$legacyFiles = @(
    'VERSION.txt', 'CHANGELOG.md', 'Z Note.html', 'Open Z Note.cmd', 'START HERE.txt',
    'app/css/board.css', 'app/css/note.css', 'app/css/shell.css', 'app/css/snip.css', 'app/css/theme.css', 'app/css/todo.css',
    'app/img/icon.ico', 'app/img/icon.png', 'app/js/awake-native.js', 'app/js/awake.js', 'app/js/board.js', 'app/js/db.js',
    'app/js/home.js', 'app/js/icons.js', 'app/js/main.js', 'app/js/note.js', 'app/js/search.js', 'app/js/settings.js',
    'app/js/setup.js', 'app/js/shell.js', 'app/js/snip.js', 'app/js/source-folder.js', 'app/js/store.js', 'app/js/sync.js',
    'app/js/templates.js', 'app/js/todo.js', 'app/js/ui.js', 'app/js/updates.js', 'app/js/update-native.js', 'app/js/util.js',
    'app/js/version.js', 'app/native/ZNoteHost.exe'
)

function StreamHash([IO.Stream]$stream) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function CheckArchive([string]$archivePath, [string[]]$expectedFiles, [bool]$hasLauncher) {
    $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($relative in $expectedFiles) { if (-not $expected.Add('Z Note/' + $relative)) { throw "Repeated expected path: $relative" } }
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        if ($archive.Entries.Count -ne $expected.Count) { throw "Unexpected entry count in $archivePath" }
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $archive.Entries) {
            if (-not $expected.Contains($entry.FullName) -or -not $seen.Add($entry.FullName)) {
                throw "Unexpected or duplicate ZIP entry: $($entry.FullName)"
            }
            if (($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw 'A ZIP entry is a symbolic link.' }
            $relative = $entry.FullName.Substring(7)
            $sourcePath = Join-Path $projectRoot $relative
            if ($relative -eq 'app/native/ZNoteHost.exe' -and $NativeHostPath) { $sourcePath = [IO.Path]::GetFullPath($NativeHostPath) }
            $sourceStream = [IO.File]::OpenRead($sourcePath)
            $archiveStream = $entry.Open()
            try {
                if ($entry.Length -ne $sourceStream.Length -or (StreamHash $archiveStream) -ne (StreamHash $sourceStream)) {
                    throw "Packaged bytes do not match reviewed source: $relative"
                }
            } finally { $archiveStream.Dispose(); $sourceStream.Dispose() }
        }
        foreach ($expectedName in $expected) { if (-not $seen.Contains($expectedName)) { throw "Missing ZIP entry: $expectedName" } }
        if (($null -ne $archive.GetEntry('Z Note/Z Note.exe')) -ne $hasLauncher) { throw 'Incorrect icon launcher inclusion.' }
        $versionReader = [IO.StreamReader]::new($archive.GetEntry('Z Note/VERSION.txt').Open())
        try { if ($versionReader.ReadToEnd().Trim() -ne $version) { throw 'ZIP version does not match VERSION.txt.' } }
        finally { $versionReader.Dispose() }
        $scriptReader = [IO.StreamReader]::new($archive.GetEntry('Z Note/app/js/version.js').Open())
        try { if (-not $scriptReader.ReadToEnd().Contains("window.ZN.version = '$version';")) { throw 'ZIP app version does not match VERSION.txt.' } }
        finally { $scriptReader.Dispose() }
        [pscustomobject]@{ Archive = [IO.Path]::GetFileName($archivePath); Version = $version; Files = $seen.Count; IconLauncher = $hasLauncher; Verified = $true }
    } finally { $archive.Dispose() }
}

CheckArchive (Join-Path $projectRoot 'downloads/Z-Note-Portable.zip') ($legacyFiles + @('Z Note.exe')) $true
$includesUpdatedLauncher = [version]$version -ge [version]'2.6.3'
$updaterFiles = if ($includesUpdatedLauncher) { $legacyFiles + @('Z Note.exe') } else { $legacyFiles }
CheckArchive (Join-Path $projectRoot ('downloads/Z-Note-v' + $version + '-Portable.zip')) $updaterFiles $includesUpdatedLauncher
if ($includesUpdatedLauncher) {
    $fullHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot 'downloads/Z-Note-Portable.zip') -Algorithm SHA256).Hash
    $updateHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot ('downloads/Z-Note-v' + $version + '-Portable.zip')) -Algorithm SHA256).Hash
    if ($fullHash -ne $updateHash) { throw 'The full download and updater ZIP must contain identical application bytes.' }
}
