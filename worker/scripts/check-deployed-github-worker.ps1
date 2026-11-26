param(
    [string]$WorkerBaseUrl = 'https://webb-skyframe-github-card.sebastianolmos.workers.dev'
)

$ErrorActionPreference = 'Stop'
$WorkerBaseUrl = $WorkerBaseUrl.TrimEnd('/')
$runId = [Guid]::NewGuid().ToString('N')
$currentBody = Join-Path $env:TEMP "webb-current-$runId.svg"
$headersPath = Join-Path $env:TEMP "webb-response-$runId.headers"
$validatorPath = Join-Path $env:TEMP "webb-validator-$runId.headers"
$parallelJobs = @()
$parallelTempPaths = @()

function Invoke-Get([string]$Url, [string]$BodyPath, [string[]]$ExtraArgs = @()) {
    $code = (& curl.exe -sS -D $headersPath -o $BodyPath -w '%{http_code}' @ExtraArgs $Url).Trim()
    if ($LASTEXITCODE -ne 0) { throw "curl failed for $Url." }
    return [pscustomobject]@{
        Code = $code
        Headers = Get-Content -LiteralPath $headersPath
    }
}

try {
    $firstNext = Invoke-Get "$WorkerBaseUrl/github/next" 'NUL'
    if ($firstNext.Code -ne '302') { throw "/github/next returned HTTP $($firstNext.Code), expected 302." }
    if (-not ($firstNext.Headers | Where-Object { $_ -match '^Location:\s*https://github\.com/sebastianolmos\s*$' })) {
        throw '/github/next did not redirect to the sebastianolmos profile.'
    }
    if (-not ($firstNext.Headers | Where-Object { $_ -match '^Cache-Control:\s*no-store\s*$' })) {
        throw '/github/next did not mark its redirect no-store.'
    }

    $firstRead = Invoke-Get "$WorkerBaseUrl/github/current.svg" $currentBody
    if ($firstRead.Code -ne '200') { throw "/github/current.svg returned HTTP $($firstRead.Code), expected 200." }
    if (-not ($firstRead.Headers | Where-Object { $_ -match '^Content-Type:\s*image/svg\+xml' })) {
        throw 'The current card response is not image/svg+xml.'
    }
    $etagLine = $firstRead.Headers | Where-Object { $_ -match '^ETag:\s*.+$' } | Select-Object -Last 1
    if (-not $etagLine) { throw 'The current card response has no ETag.' }
    $etag = ($etagLine -replace '^ETag:\s*', '').Trim()
    $svg = [IO.File]::ReadAllText($currentBody)
    if ($svg -notmatch '(?s)^<svg\b.*</svg>\s*$') { throw 'The current response is not a complete SVG document.' }

    Set-Content -LiteralPath $validatorPath -Value "If-None-Match: $etag" -Encoding ascii
    $conditional = Invoke-Get "$WorkerBaseUrl/github/current.svg" 'NUL' @('-H', "@$validatorPath")
    if ($conditional.Code -ne '304') { throw "If-None-Match returned HTTP $($conditional.Code), expected 304." }
    $unchangedRead = Invoke-Get "$WorkerBaseUrl/github/current.svg" $currentBody
    $unchangedEtagLine = $unchangedRead.Headers | Where-Object { $_ -match '^ETag:\s*.+$' } | Select-Object -Last 1
    if ($unchangedRead.Code -ne '200' -or $unchangedEtagLine -ne $etagLine) {
        throw 'A read changed the current card or its ETag.'
    }

    $secondNext = Invoke-Get "$WorkerBaseUrl/github/next" 'NUL'
    if ($secondNext.Code -ne '302') { throw "Second /github/next returned HTTP $($secondNext.Code), expected 302." }
    $secondRead = Invoke-Get "$WorkerBaseUrl/github/current.svg" $currentBody
    $secondEtagLine = $secondRead.Headers | Where-Object { $_ -match '^ETag:\s*.+$' } | Select-Object -Last 1
    if ($secondRead.Code -ne '200' -or -not $secondEtagLine -or $secondEtagLine -eq $etagLine) {
        throw 'The second publication did not replace the current card with a different version.'
    }

    for ($index = 1; $index -le 4; $index++) {
        $nextHeadersPath = Join-Path $env:TEMP "webb-parallel-next-$runId-$index.headers"
        $readBodyPath = Join-Path $env:TEMP "webb-parallel-read-$runId-$index.svg"
        $readHeadersPath = Join-Path $env:TEMP "webb-parallel-read-$runId-$index.headers"
        $parallelTempPaths += @($nextHeadersPath, $readBodyPath, $readHeadersPath)

        $parallelJobs += Start-Job -ArgumentList "$WorkerBaseUrl/github/next", 'NUL', $nextHeadersPath, 'next' -ScriptBlock {
            param($Url, $BodyPath, $ResponseHeadersPath, $Kind)
            $status = (& curl.exe -sS -D $ResponseHeadersPath -o $BodyPath -w '%{http_code}' $Url).Trim()
            if ($LASTEXITCODE -ne 0) { throw "curl failed for $Url." }
            [pscustomobject]@{ Kind = $Kind; Code = $status }
        }
        $parallelJobs += Start-Job -ArgumentList "$WorkerBaseUrl/github/current.svg", $readBodyPath, $readHeadersPath, 'read' -ScriptBlock {
            param($Url, $BodyPath, $ResponseHeadersPath, $Kind)
            $status = (& curl.exe -sS -D $ResponseHeadersPath -o $BodyPath -w '%{http_code}' $Url).Trim()
            if ($LASTEXITCODE -ne 0) { throw "curl failed for $Url." }
            [pscustomobject]@{ Kind = $Kind; Code = $status; BodyPath = $BodyPath; HeadersPath = $ResponseHeadersPath }
        }
    }

    $parallelResults = @($parallelJobs | Wait-Job | Receive-Job)
    if ($parallelResults.Count -ne 8) { throw "Expected 8 concurrent responses, got $($parallelResults.Count)." }
    foreach ($result in $parallelResults) {
        if ($result.Kind -eq 'next' -and $result.Code -ne '302') {
            throw "Concurrent /github/next returned HTTP $($result.Code), expected 302."
        }
        if ($result.Kind -eq 'read') {
            if ($result.Code -ne '200') { throw "Concurrent /github/current.svg returned HTTP $($result.Code), expected 200." }
            $contentType = Get-Content -LiteralPath $result.HeadersPath | Where-Object { $_ -match '^Content-Type:\s*image/svg\+xml' }
            $readSvg = [IO.File]::ReadAllText($result.BodyPath)
            if (-not $contentType -or $readSvg -notmatch '(?s)^<svg\b.*</svg>\s*$') {
                throw 'A concurrent current-card read was not a complete SVG response.'
            }
        }
    }
    $finalRead = Invoke-Get "$WorkerBaseUrl/github/current.svg" $currentBody
    $finalSvg = [IO.File]::ReadAllText($currentBody)
    if ($finalRead.Code -ne '200' -or $finalSvg -notmatch '(?s)^<svg\b.*</svg>\s*$') {
        throw 'The current card after overlapping publications is not a complete SVG.'
    }

    Write-Output 'PASS: /github/next redirects with HTTP 302, the expected Location and Cache-Control: no-store.'
    Write-Output 'PASS: /github/current.svg returns HTTP 200, image/svg+xml, a complete SVG and an ETag.'
    Write-Output 'PASS: If-None-Match returns HTTP 304; a read-only request preserves the ETag.'
    Write-Output 'PASS: a second /github/next publishes a different card version.'
    Write-Output 'PASS: four overlapping Next requests and four current-card reads returned only expected redirects and complete SVG documents.'
    Write-Output "Observed current-card size: $((Get-Item -LiteralPath $currentBody).Length) bytes."
}
finally {
    if ($parallelJobs.Count -gt 0) {
        $parallelJobs | Stop-Job -ErrorAction SilentlyContinue
        $parallelJobs | Remove-Job -Force -ErrorAction SilentlyContinue
    }
    if ($parallelTempPaths.Count -gt 0) {
        Remove-Item -LiteralPath $parallelTempPaths -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $currentBody, $headersPath, $validatorPath -Force -ErrorAction SilentlyContinue
}
