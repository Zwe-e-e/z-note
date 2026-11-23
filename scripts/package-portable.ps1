# Build a portable download from a reviewed, explicit file allowlist.
# Run from any directory: powershell -NoProfile -File scripts/package-portable.ps1
# Fixed ordering and ZIP timestamps make identical inputs reproducible on the
# same PowerShell/.NET runtime. No personal notebook or repository scan is used.
param([string]$NativeHostPath, [switch]$LegacyUpdater)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$outputDirectory = Join-Path $projectRoot 'downloads'
$version = [IO.File]::ReadAllText((Join-Path $projectRoot 'VERSION.txt')).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'VERSION.txt must contain an app release version such as 2.2.0.' }
# v2.4.2 helpers require their original archive layout. The versioned release
# asset supports that updater transition; the full Pages download also has
# the new icon launcher. Both contain exactly the same core application.
$archiveName = if ($LegacyUpdater) { 'Z-Note-v' + $version + '-Portable.zip' } else { 'Z-Note-Portable.zip' }
$outputPath = Join-Path $outputDirectory $archiveName

# Embed the release version for offline file:// use; VERSION.txt is the source
# of truth. The app never needs to fetch a file or contact a server for it.
$versionScript = "/* Generated from VERSION.txt by scripts/package-portable.ps1. */`nwindow.ZN.version = '$version';`n"
[IO.File]::WriteAllText((Join-Path $projectRoot 'app/js/version.js'), $versionScript, [Text.UTF8Encoding]::new($false))

# Add new runtime assets explicitly here after review. Never package app data,
# backup exports, development configuration, or files selected by a wildcard.
[string[]]$files = @(
    'VERSION.txt'
    'CHANGELOG.md'
    'Z Note.html'
    'Z Note.exe'
    'Open Z Note.cmd'
    'START HERE.txt'
    'app/css/board.css'
    'app/css/note.css'
    'app/css/shell.css'
    'app/css/snip.css'
    'app/css/theme.css'
    'app/css/todo.css'
    'app/img/icon.ico'
    'app/img/icon.png'
    'app/js/awake-native.js'
    'app/js/awake.js'
    'app/js/board.js'
    'app/js/db.js'
    'app/js/home.js'
    'app/js/icons.js'
    'app/js/main.js'
    'app/js/note.js'
    'app/js/search.js'
    'app/js/settings.js'
    'app/js/setup.js'
    'app/js/shell.js'
    'app/js/snip.js'
    'app/js/source-folder.js'
    'app/js/store.js'
    'app/js/sync.js'
    'app/js/templates.js'
    'app/js/todo.js'
    'app/js/ui.js'
    'app/js/updates.js'
    'app/js/update-native.js'
    'app/js/util.js'
    'app/js/version.js'
    'app/native/ZNoteHost.exe'
)
if ($LegacyUpdater) { $files = @($files | Where-Object { $_ -ne 'Z Note.exe' }) }
[Array]::Sort($files, [StringComparer]::Ordinal)
$allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$sourcePaths = @{}
foreach ($relative in $files) {
    if (-not $allowed.Add($relative)) { throw "Duplicate package path: $relative" }
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    if (-not $sourcePath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Package path escapes project: $relative"
    }
    # A running older helper can keep its executable locked. Package a reviewed
    # staged build without closing any live notebook or replacing that process.
    if ($relative -eq 'app/native/ZNoteHost.exe' -and $NativeHostPath) {
        $sourcePath = [IO.Path]::GetFullPath($NativeHostPath)
    }
    if (-not [IO.File]::Exists($sourcePath)) { throw "Missing required package file: $relative" }
    $sourcePaths[$relative] = $sourcePath
}

# Verify the actual app HTML refers only to assets that will be in this ZIP.
$html = [IO.File]::ReadAllText((Join-Path $projectRoot 'Z Note.html'))
$assetPattern = '(?:src|href)\s*=\s*["'']([^"'']+)["'']'
$assetCount = 0
foreach ($match in [regex]::Matches($html, $assetPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
    $asset = $match.Groups[1].Value
    if ($asset.StartsWith('#') -or $asset -match '^[a-z][a-z0-9+.-]*:') { continue }
    $asset = [Uri]::UnescapeDataString(($asset -split '[?#]', 2)[0]).Replace('\', '/')
    if (-not $allowed.Contains($asset)) { throw "HTML asset is not in package allowlist: $asset" }
    $assetCount++
}

[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$stagingPath = Join-Path $outputDirectory ('Z-Note-Portable.' + [Guid]::NewGuid().ToString('N') + '.tmp')
$fixedTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
try {
    $zipStream = [IO.File]::Open($stagingPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $archive = [IO.Compression.ZipArchive]::new($zipStream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($relative in $files) {
                $entry = $archive.CreateEntry('Z Note/' + $relative, [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $fixedTime
                $entry.ExternalAttributes = 0
                $sourceStream = [IO.File]::OpenRead($sourcePaths[$relative])
                try {
                    $entryStream = $entry.Open()
                    try { $sourceStream.CopyTo($entryStream) } finally { $entryStream.Dispose() }
                } finally { $sourceStream.Dispose() }
            }
        } finally { $archive.Dispose() }
    } finally { $zipStream.Dispose() }

    # Check before replacing the previous download. Every entry must match the
    # allowlist and share the single top-level "Z Note" directory.
    $check = [IO.Compression.ZipFile]::OpenRead($stagingPath)
    try {
        if ($check.Entries.Count -ne $files.Count) { throw 'Unexpected ZIP entry count.' }
        foreach ($entry in $check.Entries) {
            if (-not $entry.FullName.StartsWith('Z Note/', [StringComparison]::Ordinal) -or
                -not $allowed.Contains($entry.FullName.Substring(7))) {
                throw "Unexpected ZIP entry: $($entry.FullName)"
            }
        }
    } finally { $check.Dispose() }
    Move-Item -LiteralPath $stagingPath -Destination $outputPath -Force
} finally {
    if ([IO.File]::Exists($stagingPath)) { Remove-Item -LiteralPath $stagingPath }
}

$result = Get-Item -LiteralPath $outputPath
[pscustomobject]@{
    Version = $version
    Format = if ($LegacyUpdater) { 'legacy-updater' } else { 'full-portable' }
    Archive = $result.FullName
    Files = $files.Count
    HtmlAssetsVerified = $assetCount
    Bytes = $result.Length
    SHA256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json
