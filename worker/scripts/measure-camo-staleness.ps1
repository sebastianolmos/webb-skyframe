param(
    [string]$WorkerBaseUrl = 'https://webb-skyframe-github-card.sebastianolmos.workers.dev',
    [string]$CamoUrl = 'https://camo.githubusercontent.com/7f2fae7ffc619efce9bb4e7cef29ba817fa210608a9ffd84d51d01d0ffaa29ba/68747470733a2f2f776562622d736b796672616d652d6769746875622d636172642e73656261737469616e6f6c6d6f732e776f726b6572732e6465762f6769746875622f63757272656e742e737667',
    [ValidateRange(1, 30)]
    [int]$PollSeconds = 5,
    [ValidateRange(10, 600)]
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$WorkerBaseUrl = $WorkerBaseUrl.TrimEnd('/')
$runId = [Guid]::NewGuid().ToString('N')
$originPath = Join-Path $env:TEMP "webb-origin-$runId.svg"
$camoPath = Join-Path $env:TEMP "webb-camo-$runId.svg"
$originHeadersPath = Join-Path $env:TEMP "webb-origin-$runId.headers"
$camoHeadersPath = Join-Path $env:TEMP "webb-camo-$runId.headers"

Write-Output 'Publishing one new shared fixture through /github/next...'
$startedAt = [DateTimeOffset]::UtcNow
$nextCode = (& curl.exe -sS -o NUL -w '%{http_code}' "$WorkerBaseUrl/github/next").Trim()
if ($LASTEXITCODE -ne 0) { throw 'curl failed while calling /github/next.' }
if ($nextCode -ne '302') { throw "/github/next returned HTTP $nextCode; expected 302." }

$originCode = (& curl.exe -sS -D $originHeadersPath -o $originPath -w '%{http_code}' "$WorkerBaseUrl/github/current.svg").Trim()
if ($LASTEXITCODE -ne 0 -or $originCode -ne '200') { throw "Could not capture the current origin SVG (HTTP $originCode)." }
$expectedHash = (Get-FileHash -LiteralPath $originPath -Algorithm SHA256).Hash
Write-Output "Captured origin SVG: $((Get-Item -LiteralPath $originPath).Length) bytes; waiting for Camo to serve the same content."

$attemptLimit = [math]::Ceiling($TimeoutSeconds / $PollSeconds)
for ($attempt = 0; $attempt -le $attemptLimit; $attempt++) {
    $camoCode = (& curl.exe -sS -D $camoHeadersPath -o $camoPath -w '%{http_code}' "$CamoUrl").Trim()
    if ($LASTEXITCODE -ne 0) { throw 'curl failed while requesting the Camo URL.' }

    $elapsed = [math]::Round(([DateTimeOffset]::UtcNow - $startedAt).TotalSeconds, 1)
    $headerLines = Get-Content -LiteralPath $camoHeadersPath
    $ageLine = ($headerLines | Select-String -Pattern '^Age:' | Select-Object -Last 1).Line
    $cacheLine = ($headerLines | Select-String -Pattern '^X-Cache:' | Select-Object -Last 1).Line
    if (-not $ageLine) { $ageLine = 'Age: unavailable' }
    if (-not $cacheLine) { $cacheLine = 'X-Cache: unavailable' }

    $actualHash = if ($camoCode -eq '200' -and (Test-Path -LiteralPath $camoPath)) {
        (Get-FileHash -LiteralPath $camoPath -Algorithm SHA256).Hash
    } else { '' }

    Write-Output ("{0,6:N1}s | HTTP {1} | {2} | {3}" -f $elapsed, $camoCode, $ageLine, $cacheLine)
    if ($actualHash -and $actualHash -eq $expectedHash) {
        Write-Output "Camo has the new card. Measured click-to-Camo time: $elapsed seconds."
        Write-Output "Temporary comparison files: $originPath and $camoPath"
        exit 0
    }

    if ($attempt -lt $attemptLimit) { Start-Sleep -Seconds $PollSeconds }
}

Write-Output "Camo did not match the new origin card within $TimeoutSeconds seconds."
Write-Output "Temporary comparison files: $originPath and $camoPath"
exit 2
