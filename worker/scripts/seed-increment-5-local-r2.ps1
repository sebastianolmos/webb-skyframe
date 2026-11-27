param(
    [string]$CatalogDirectory = "..\docs\evidence\increment-5\catalog"
)

$ErrorActionPreference = "Stop"
$workerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $workerRoot "..")).Path
$catalogRoot = (Resolve-Path (Join-Path $workerRoot $CatalogDirectory)).Path

if (-not $catalogRoot.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Catalog source must stay inside this repository: $catalogRoot"
}
$objectRoot = Join-Path $catalogRoot "objects"
$manifestRoot = Join-Path $catalogRoot "manifests"
$pointerPath = Join-Path $catalogRoot "published.json"
if (-not (Test-Path -LiteralPath $objectRoot -PathType Container) -or
    -not (Test-Path -LiteralPath $manifestRoot -PathType Container) -or
    -not (Test-Path -LiteralPath $pointerPath -PathType Leaf)) {
    throw "The prepared increment-5 catalog package is incomplete. Run scripts/prepare-increment-5-catalog.py first."
}

Set-Location $workerRoot
$wrangler = Join-Path $workerRoot "node_modules\.bin\wrangler.cmd"
if (-not (Test-Path -LiteralPath $wrangler -PathType Leaf)) {
    throw "Wrangler is not installed. Run npm install from worker/ first."
}
$bucket = "webb-skyframe-bucket"
$uploaded = 0

function Put-LocalObject([string]$key, [string]$path, [string]$contentType) {
    & $wrangler r2 object put "$bucket/$key" --local --file $path --content-type $contentType
    if ($LASTEXITCODE -ne 0) { throw "Wrangler could not write local R2 object: $key" }
}

# Immutable dependencies first.
Get-ChildItem -LiteralPath $objectRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    $key = $_.FullName.Substring($objectRoot.Length).TrimStart("\", "/").Replace("\", "/")
    $contentType = if ($_.Extension -eq ".png") { "image/png" } else { "application/json; charset=utf-8" }
    Put-LocalObject $key $_.FullName $contentType
    $script:uploaded++
}

# Publish the immutable generation manifest after all dependencies.
$manifests = @(Get-ChildItem -LiteralPath $manifestRoot -File -Filter "*.json")
if ($manifests.Count -ne 1) { throw "Expected exactly one prepared catalog manifest; found $($manifests.Count)." }
$manifest = $manifests[0]
Put-LocalObject "catalog/$($manifest.Name)" $manifest.FullName "application/json; charset=utf-8"
$uploaded++

# The mutable pointer is the final write, matching the production publication order.
Put-LocalObject "catalog/published.json" $pointerPath "application/json; charset=utf-8"
$uploaded++
Write-Output "Loaded $uploaded objects into Wrangler's local R2 bucket '$bucket'. No remote bucket was used."
