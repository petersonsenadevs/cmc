Add-Type -AssemblyName System.Drawing

$culture = [System.Globalization.CultureInfo]::InvariantCulture

function Format-Number([float] $value) {
    return $value.ToString('0.##', $culture)
}

function Convert-GraphicsPathToSvg([System.Drawing.Drawing2D.GraphicsPath] $graphicsPath) {
    $points = $graphicsPath.PathPoints
    $types = $graphicsPath.PathTypes
    $parts = [System.Collections.Generic.List[string]]::new()
    $i = 0

    while ($i -lt $points.Count) {
        $rawType = [int] $types[$i]
        $type = $rawType -band 0x07
        $closed = ($rawType -band 0x80) -ne 0

        if ($type -eq 0) {
            $parts.Add(('M{0} {1}' -f (Format-Number $points[$i].X), (Format-Number $points[$i].Y)))
            $i += 1
            continue
        }

        if ($type -eq 1) {
            $parts.Add(('L{0} {1}' -f (Format-Number $points[$i].X), (Format-Number $points[$i].Y)))
            if ($closed) { $parts.Add('Z') }
            $i += 1
            continue
        }

        if ($type -eq 3 -and ($i + 2) -lt $points.Count) {
            $endType = [int] $types[$i + 2]
            $parts.Add(('C{0} {1} {2} {3} {4} {5}' -f
                (Format-Number $points[$i].X), (Format-Number $points[$i].Y),
                (Format-Number $points[$i + 1].X), (Format-Number $points[$i + 1].Y),
                (Format-Number $points[$i + 2].X), (Format-Number $points[$i + 2].Y)))
            if (($endType -band 0x80) -ne 0) { $parts.Add('Z') }
            $i += 3
            continue
        }

        throw "Unsupported GraphicsPath point type $type at index $i"
    }

    return $parts -join ''
}

function Get-OutlinedTextPath(
    [string] $text,
    [float] $x,
    [float] $y,
    [float] $size
) {
    $family = [System.Drawing.FontFamily]::new('Arial Rounded MT Bold')
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $format = [System.Drawing.StringFormat]::GenericTypographic
    $path.AddString(
        $text,
        $family,
        [int] [System.Drawing.FontStyle]::Regular,
        $size,
        [System.Drawing.PointF]::new($x, $y),
        $format
    )
    $svgPath = Convert-GraphicsPathToSvg $path
    $path.Dispose()
    $family.Dispose()
    return $svgPath
}

$titlePath = Get-OutlinedTextPath 'Claude Message Control' 540 132 55
$bylinePath = Get-OutlinedTextPath 'by r3v3rs3' 542 218 29
$outputDirectory = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

function Write-Logo([string] $fileName, [string] $textColor, [string] $description) {
    $svg = @"
<?xml version="1.0" encoding="UTF-8"?>
<!-- CMC identity — Peterson Sena (r3v3rs3), 2026 -->
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400" role="img" aria-labelledby="title desc">
  <title id="title">cmc — Claude Message Control</title>
  <desc id="desc">$description</desc>
  <g fill="none" stroke="#7C5CFF" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
    <path d="M160 126C104 102 60 137 60 200S104 298 160 274"/>
    <path d="M200 275V169C200 134 218 115 245 115S287 135 287 169V275"/>
    <path d="M287 169C287 134 303 115 330 115S365 135 365 169V275"/>
    <path d="M500 126C445 102 410 137 410 200S445 298 500 274"/>
    <path d="M245 115L220 77M330 115L355 77" stroke-width="20"/>
    <path d="M257 180V230M328 180V230" stroke-width="18"/>
  </g>
  <circle cx="220" cy="77" r="16" fill="#F5A524"/>
  <circle cx="355" cy="77" r="16" fill="#2BB673"/>
  <path d="$titlePath" fill="$textColor"/>
  <path d="$bylinePath" fill="$textColor"/>
</svg>
"@
    [System.IO.File]::WriteAllText(
        (Join-Path $outputDirectory $fileName),
        $svg.TrimStart(),
        [System.Text.UTF8Encoding]::new($false)
    )
}

Write-Logo 'logo-light.svg' '#17171F' 'Logotipo final para fondo claro, con texto oscuro convertido a contornos.'
Write-Logo 'logo-dark.svg' '#F7F7FA' 'Logotipo final para fondo oscuro, con texto claro convertido a contornos.'
