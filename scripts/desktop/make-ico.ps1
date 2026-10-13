Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot "..\..\icon\icon.png"
$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$sizes = @(256, 128, 64, 48, 32, 16)
$images = @()

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()

    $images += [PSCustomObject]@{
        Size = if ($s -eq 256) { 0 } else { $s }
        Bytes = $bytes
    }
}
$src.Dispose()

$icoStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($icoStream)

$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$images.Count)

$offset = 6 + (16 * $images.Count)

foreach ($img in $images) {
    $writer.Write([Byte]$img.Size)
    $writer.Write([Byte]$img.Size)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$img.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $img.Bytes.Length
}

foreach ($img in $images) {
    $writer.Write($img.Bytes)
}

$writer.Flush()
$out1 = Join-Path $PSScriptRoot "..\..\icon\icon.ico"
[System.IO.File]::WriteAllBytes($out1, $icoStream.ToArray())
$writer.Dispose()
$icoStream.Dispose()
Write-Host "Generated icon.ico successfully!"
