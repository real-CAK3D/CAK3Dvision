# Builds cak3dvision.ico and cak3dvision-stop.ico from public/icon-512.png.
Add-Type -AssemblyName System.Drawing
$dir = $PSScriptRoot
$src = [System.Drawing.Image]::FromFile((Join-Path (Split-Path -Parent $dir) 'public\icons\icon-512.png'))

function New-Frame([int]$size, [bool]$stop) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'
    $g.DrawImage($src, 0, 0, $size, $size)
    if ($stop) {
        $d = [int]($size * 0.5); $x = $size - $d
        $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 214, 69, 69))), $x, $x, $d, $d)
        $s = [int]($d * 0.42); $o = $x + [int](($d - $s) / 2)
        $g.FillRectangle([System.Drawing.Brushes]::White, $o, $o, $s, $s)
    }
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    return ,$ms.ToArray()
}

function Write-Ico([string]$path, [bool]$stop) {
    $sizes = 256, 64, 48, 32, 16
    $frames = New-Object 'System.Collections.Generic.List[byte[]]'
    foreach ($s in $sizes) { $frames.Add([byte[]](New-Frame $s $stop)) }
    $fs = [System.IO.File]::Create($path); $w = New-Object System.IO.BinaryWriter $fs
    $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $s = $sizes[$i]; $b = if ($s -ge 256) { 0 } else { $s }
        $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
        $w.Write([uint16]1); $w.Write([uint16]32)
        $w.Write([uint32]$frames[$i].Length); $w.Write([uint32]$offset)
        $offset += $frames[$i].Length
    }
    foreach ($f in $frames) { $w.Write($f) }
    $w.Close()
}

Write-Ico (Join-Path $dir 'cak3dvision.ico') $false
Write-Ico (Join-Path $dir 'cak3dvision-stop.ico') $true
$src.Dispose()
