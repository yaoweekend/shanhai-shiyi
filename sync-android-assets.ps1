$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$target = Join-Path $root 'android\app\src\main\assets'

New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'index.html'), (Join-Path $root 'manifest.webmanifest') -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $root 'src'), (Join-Path $root 'assets') -Destination $target -Recurse -Force

Write-Host 'Game assets synced to Android project.'
