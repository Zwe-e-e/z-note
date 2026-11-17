# Build a portable download from a reviewed, explicit file allowlist.
# Run from any directory: powershell -NoProfile -File scripts/package-portable.ps1
# Fixed ordering and ZIP timestamps make identical inputs reproducible on the
# same PowerShell/.NET runtime. No personal notebook or repository scan is used.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$outputDirectory = Join-Path $projectRoot 'downloads'
$outputPath = Join-Path $outputDirectory 'Z-Note-Portable.zip'

# Add new runtime assets explicitly here after review. Never package app data,
# backup exports, development configuration, or files selected by a wildcard.
[string[]]$files = @(
    'Z Note.html'
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
    'app/js/store.js'
    'app/js/sync.js'
    'app/js/templates.js'
    'app/js/todo.js'
    'app/js/ui.js'
    'app/js/util.js'
)
[Array]::Sort($files, [StringComparer]::Ordinal)
$allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($relative in $files) {
    if (-not $allowed.Add($relative)) { throw "Duplicate package path: $relative" }
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    if (-not $sourcePath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Package path escapes project: $relative"
    }
    if (-not [IO.File]::Exists($sourcePath)) { throw "Missing required package file: $relative" }
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
                $sourceStream = [IO.File]::OpenRead((Join-Path $projectRoot $relative))
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
    Archive = $result.FullName
    Files = $files.Count
    HtmlAssetsVerified = $assetCount
    Bytes = $result.Length
    SHA256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json
