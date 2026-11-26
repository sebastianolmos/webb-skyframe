$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$sourcePath = Join-Path $repositoryRoot 'jw09438007001_03103_00002_nrca3_cal.png'
$targetPath = Join-Path $PSScriptRoot '..\src\fixtures\sample-photo.bin'
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
$targetBitmap = $null
$graphics = $null

try {
    if ($sourceImage.Width -ne 2048 -or $sourceImage.Height -ne 2048) {
        throw "Expected a 2048x2048 source PNG; found $($sourceImage.Width)x$($sourceImage.Height)."
    }

    $targetBitmap = [System.Drawing.Bitmap]::new(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($targetBitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($sourceImage, [System.Drawing.Rectangle]::new(0, 0, 1024, 1024))
    $targetBitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    if ($graphics) { $graphics.Dispose() }
    if ($targetBitmap) { $targetBitmap.Dispose() }
    $sourceImage.Dispose()
}

$resultImage = [System.Drawing.Image]::FromFile($targetPath)
try {
    if ($resultImage.Width -ne 1024 -or $resultImage.Height -ne 1024) {
        throw "Generated PNG has unexpected dimensions: $($resultImage.Width)x$($resultImage.Height)."
    }
    Write-Output "Generated 1024x1024 PNG fixture: $targetPath"
}
finally {
    $resultImage.Dispose()
}
