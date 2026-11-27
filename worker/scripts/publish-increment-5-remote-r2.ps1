param([string]$CatalogDirectory = "..\docs\evidence\increment-5\catalog")

$ErrorActionPreference = "Stop"
$workerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $workerRoot "..")).Path
$catalogRoot = (Resolve-Path (Join-Path $workerRoot $CatalogDirectory)).Path
if (-not $catalogRoot.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Catalog source must stay inside this repository: $catalogRoot"
}

$objectsRoot = Join-Path $catalogRoot "objects"
$manifestsRoot = Join-Path $catalogRoot "manifests"
$pointerPath = Join-Path $catalogRoot "published.json"
$pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
if ($pointer.schemaVersion -ne "published-pointer-1" -or
    $pointer.manifestKey -notmatch '^catalog/[a-f0-9]{64}\.json$' -or
    $pointer.manifestSha256 -ne ($pointer.manifestKey -replace '^catalog/|\.json$', '')) {
    throw "Prepared catalog pointer failed validation."
}

$manifestPath = Join-Path $manifestsRoot (($pointer.manifestKey -split '/')[-1])
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Catalog manifest missing: $manifestPath" }
if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pointer.manifestSha256) {
    throw "Local catalog manifest digest does not match its pointer."
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne "published-catalog-1" -or $manifest.generation -ne $pointer.generation -or $manifest.entries.Count -ne 6) {
    throw "Prepared catalog manifest must contain the expected six-entry generation."
}

Set-Location $workerRoot
$wrangler = Join-Path $workerRoot "node_modules\.bin\wrangler.cmd"
if (-not (Test-Path -LiteralPath $wrangler -PathType Leaf)) { throw "Wrangler is not installed. Run npm install from worker/." }
$bucket = "webb-skyframe-bucket"
$verificationPath = Join-Path $env:TEMP ("webb-skyframe-r2-check-" + [Guid]::NewGuid().ToString("N") + ".tmp")
$checkedObjects = 0
$uploadedBytes = 0L

function Upload-And-Verify([string]$key, [string]$sourcePath, [int64]$expectedBytes, [string]$expectedSha, [string]$contentType) {
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Source object is missing: $sourcePath" }
    $localItem = Get-Item -LiteralPath $sourcePath
    $localSha = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($localItem.Length -ne $expectedBytes -or $localSha -ne $expectedSha) { throw "Local object digest/size mismatch: $key" }

    & $wrangler r2 object put "$bucket/$key" --remote --file $sourcePath --content-type $contentType
    if ($LASTEXITCODE -ne 0) { throw "Remote R2 upload failed: $key" }

    if (Test-Path -LiteralPath $verificationPath) { Remove-Item -LiteralPath $verificationPath }
    & $wrangler r2 object get "$bucket/$key" --remote --file $verificationPath
    if ($LASTEXITCODE -ne 0) { throw "Remote R2 read-back failed: $key" }
    $remoteItem = Get-Item -LiteralPath $verificationPath
    $remoteSha = (Get-FileHash -LiteralPath $verificationPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($remoteItem.Length -ne $expectedBytes -or $remoteSha -ne $expectedSha) { throw "Remote R2 read-back digest/size mismatch: $key" }
    Remove-Item -LiteralPath $verificationPath
}

try {
    # Every entry's immutable dependency keys are content-addressed and read-checked first.
    foreach ($entry in $manifest.entries) {
        foreach ($kind in @("observation", "photo", "sky", "orbit")) {
            $key = [string]$entry.objectKeys.$kind
            $digest = $entry.digests.$kind
            if ($key -notmatch "^$kind/$([regex]::Escape($entry.id))/$($digest.sha256)/[A-Za-z0-9._-]{1,80}$") {
                throw "Invalid immutable object key in manifest: $key"
            }
            $sourcePath = Join-Path $objectsRoot ($key.Replace("/", "\"))
            $contentType = if ($kind -eq "photo") { "image/png" } else { "application/json; charset=utf-8" }
            Upload-And-Verify $key $sourcePath ([int64]$digest.bytes) ([string]$digest.sha256) $contentType
            $script:checkedObjects++
            $script:uploadedBytes += [int64]$digest.bytes
        }
    }

    # Upload and read-check the immutable generation before switching the pointer.
    $manifestLength = (Get-Item -LiteralPath $manifestPath).Length
    Upload-And-Verify $pointer.manifestKey $manifestPath $manifestLength $pointer.manifestSha256 "application/json; charset=utf-8"
    $script:checkedObjects++
    $script:uploadedBytes += $manifestLength

    # Pointer publication is the final write; read it back and verify exact bytes.
    $pointerBytes = (Get-Item -LiteralPath $pointerPath).Length
    $pointerSha = (Get-FileHash -LiteralPath $pointerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    & $wrangler r2 object put "$bucket/catalog/published.json" --remote --file $pointerPath --content-type "application/json; charset=utf-8"
    if ($LASTEXITCODE -ne 0) { throw "Remote catalog pointer publication failed." }
    if (Test-Path -LiteralPath $verificationPath) { Remove-Item -LiteralPath $verificationPath }
    & $wrangler r2 object get "$bucket/catalog/published.json" --remote --file $verificationPath
    if ($LASTEXITCODE -ne 0) { throw "Remote catalog pointer read-back failed." }
    if ((Get-Item -LiteralPath $verificationPath).Length -ne $pointerBytes -or
        (Get-FileHash -LiteralPath $verificationPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pointerSha) {
        throw "Remote catalog pointer read-back does not match the local pointer."
    }
    Remove-Item -LiteralPath $verificationPath

    [pscustomobject]@{
        result = "PASS"
        target = "remote R2 bucket $bucket"
        generation = $pointer.generation
        manifestKey = $pointer.manifestKey
        manifestSha256 = $pointer.manifestSha256
        entries = $manifest.entries.Count
        remoteObjectsReadChecked = $script:checkedObjects + 1
        readCheckedBytes = $script:uploadedBytes + $pointerBytes
        pointerPublishedLast = $true
    } | ConvertTo-Json -Depth 3
} finally {
    if (Test-Path -LiteralPath $verificationPath) {
        $resolvedTemp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\"
        $resolvedFile = [IO.Path]::GetFullPath($verificationPath)
        if (-not $resolvedFile.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove a verification file outside TEMP: $resolvedFile"
        }
        Remove-Item -LiteralPath $resolvedFile
    }
}
