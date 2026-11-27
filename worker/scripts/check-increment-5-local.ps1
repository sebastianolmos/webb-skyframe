param([string]$BaseUrl = "http://127.0.0.1:8787")

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$manifestFile = Get-ChildItem -LiteralPath (Join-Path $repoRoot "docs\evidence\increment-5\catalog\manifests") -Filter "*.json" -File | Select-Object -First 1
if (-not $manifestFile) { throw "Prepared increment-5 catalog manifest not found. Run scripts/prepare-increment-5-catalog.py first." }
$manifest = Get-Content -LiteralPath $manifestFile.FullName -Raw | ConvertFrom-Json

function Request-Web([string]$Uri, [hashtable]$Headers = @{}) {
    try {
        return Invoke-WebRequest -Uri $Uri -Headers $Headers -UseBasicParsing
    } catch {
        if ($_.Exception.Response) { return $_.Exception.Response }
        throw
    }
}

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -ne $Expected) { throw "$Message (expected '$Expected', got '$Actual')" }
}

$corsHeaders = @{ Origin = "https://solmos.dev" }
$currentBefore = Request-Web "$BaseUrl/github/current.svg"
$apiResponse = Request-Web "$BaseUrl/api/random" $corsHeaders
Assert-Equal ([int]$apiResponse.StatusCode) 200 "Selection route failed"
Assert-Equal $apiResponse.Headers["Access-Control-Allow-Origin"] "https://solmos.dev" "Allowed CORS origin missing"
Assert-Equal $apiResponse.Headers["Cache-Control"] "no-store" "Selection response must not be cached"
$selection = $apiResponse.Content | ConvertFrom-Json
if (-not $selection.id -or -not $selection.imageUrl -or -not $selection.alt) { throw "Selection response is missing id, imageUrl or alt." }

$different = Request-Web "$BaseUrl/api/random?exclude=$($selection.id)" $corsHeaders
$differentSelection = $different.Content | ConvertFrom-Json
if ($differentSelection.id -eq $selection.id) { throw "Selection repeated the excluded ID despite multiple catalog entries." }

$invalidExclude = Request-Web "$BaseUrl/api/random?exclude=%3Cbad%3E" $corsHeaders
Assert-Equal ([int]$invalidExclude.StatusCode) 400 "Invalid exclude value was not rejected"
$blockedOrigin = Request-Web "$BaseUrl/api/random" @{ Origin = "https://evil.example" }
Assert-Equal ([int]$blockedOrigin.StatusCode) 403 "Unconfigured browser origin was not rejected"

$rendered = @()
foreach ($entry in $manifest.entries) {
    $url = "$BaseUrl/cards/$($entry.cardVersion)/$($entry.id).svg"
    $card = Request-Web $url
    Assert-Equal ([int]$card.StatusCode) 200 "Versioned card failed for $($entry.id)"
    if ($card.Headers["Content-Type"] -notlike "image/svg+xml*") { throw "Wrong card MIME for $($entry.id)." }
    if ($card.Headers["Cache-Control"] -notlike "*max-age=86400*") { throw "Versioned card cache policy missing for $($entry.id)." }
    if (-not $card.Content.Contains("data:image/png;base64,")) { throw "Card is missing its embedded photo: $($entry.id)." }
    $rendered += [pscustomobject]@{ id = $entry.id; bytes = $card.RawContentLength }
}

$unknown = Request-Web "$BaseUrl/cards/$('0' * 64)/$($selection.id).svg"
Assert-Equal ([int]$unknown.StatusCode) 404 "Unknown card version should return 404"
$currentAfterApi = Request-Web "$BaseUrl/github/current.svg"
Assert-Equal $currentAfterApi.Headers["ETag"] $currentBefore.Headers["ETag"] "Portfolio selection changed shared GitHub state"

$nextRequest = [System.Net.HttpWebRequest]::Create("$BaseUrl/github/next")
$nextRequest.AllowAutoRedirect = $false
$nextResponse = $nextRequest.GetResponse()
try {
    $nextStatus = [int]$nextResponse.StatusCode
    $nextLocation = $nextResponse.Headers["Location"]
    Assert-Equal $nextStatus 302 "GitHub Next did not redirect"
    Assert-Equal $nextLocation "https://github.com/sebastianolmos" "GitHub Next redirected to an unexpected destination"
} finally {
    $nextResponse.Dispose()
}
$currentAfterNext = Request-Web "$BaseUrl/github/current.svg"
if (-not $currentAfterNext.Content.Contains("calibrated full-frame image")) {
    throw "GitHub Next did not publish a real catalog card."
}

[pscustomobject]@{
    result = "PASS"
    catalogEntries = $rendered.Count
    renderedCards = $rendered
    selectionId = $selection.id
    excludeAvoidedRepeat = $differentSelection.id -ne $selection.id
    allowedCorsOrigin = $apiResponse.Headers["Access-Control-Allow-Origin"]
    invalidExcludeStatus = [int]$invalidExclude.StatusCode
    blockedOriginStatus = [int]$blockedOrigin.StatusCode
    unknownVersionStatus = [int]$unknown.StatusCode
    apiLeftGithubCurrentUnchanged = $currentAfterApi.Headers["ETag"] -eq $currentBefore.Headers["ETag"]
    githubNextStatus = $nextStatus
    githubNextLocation = $nextLocation
    githubCurrentIsRealCard = $true
} | ConvertTo-Json -Depth 4
