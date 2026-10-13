<#
  Shanhai Shiyi / sprite pipeline (batch 1 + 2, reusable for later batches)
  ========================================================================

  Usage (from anywhere, Windows PowerShell 5.1 or pwsh both work):
      & .\tools\sprites\build.ps1

  It does three things:
    1. Headless-Edge screenshot of tools/sprites/sheet.html -> tools/sprites/_sheet.png (transparent bg)
    2. python tools/sprites/slice.py -> slice into assets/sprites/ + full self-check + contact sheets
    3. Print the verdict (non-zero exit code means at least one slot failed)

  Adding a batch = add the slot to the SPRITES array in sheet.html AND to SLOTS in
  slice.py, then just re-run this script: the Edge window size is derived from
  slice.py (COLS*CELL x rows*CELL), so it never has to be edited by hand again.

  NOTE: this file is deliberately ASCII-only. Windows PowerShell 5.1 reads .ps1
  as ANSI unless it has a UTF-8 BOM, which would garble/break non-ASCII literals.
  Chinese comments live in sheet.html and slice.py instead.

  Edge writes noise like "ERROR:...QQBrowser..." to stderr. That is normal.
  The only two things that decide success: a PNG was produced, and slice.py passes.
#>
$ErrorActionPreference = 'Stop'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path      # tools\sprites
$Root = (Resolve-Path (Join-Path $Here '..\..')).Path        # shanhai\
$Sheet = Join-Path $Here '_sheet.png'
$Html  = Join-Path $Here 'sheet.html'
$Edge  = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

if (-not (Test-Path $Edge)) { throw "Edge not found: $Edge (edit the `$Edge constant in this script)" }
if (Test-Path $Sheet) { Remove-Item $Sheet -Force }

# --- grid size: single source of truth is slice.py (SLOTS + CELL/COLS) ---------
$env:PYTHONIOENCODING = 'utf-8'
Push-Location $Here
try {
    $dims = (& python -c "import slice; print('%d,%d' % (slice.COLS*slice.CELL, ((len(slice.SLOTS)+slice.COLS-1)//slice.COLS)*slice.CELL))" | Select-Object -Last 1)
} finally {
    Pop-Location
}
$dims = "$dims".Trim()
if ($dims -notmatch '^\d+,\d+$') { throw "cannot derive the grid size from slice.py (got '$dims')" }

# file:/// URL needs forward slashes
$Url = 'file:///' + ($Html -replace '\\', '/')

Write-Host "[1/3] headless Edge screenshot -> $Sheet  (window $dims)"
Start-Process -FilePath $Edge -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--default-background-color=00000000',            # required, otherwise the background is not transparent
    ('--window-size=' + $dims),                       # must equal COLS*CELL, ROWS*CELL
    ("--screenshot=" + '"' + $Sheet + '"'),
    $Url
) -PassThru -Wait -NoNewWindow | Out-Null
if (-not (Test-Path $Sheet)) { throw "screenshot failed, no output at $Sheet" }
$len = (Get-Item $Sheet).Length
Write-Host ("      ok: {0:N0} bytes" -f $len)

Write-Host '[2/3] slice + self-check'
Push-Location $Root
try {
    python (Join-Path $Here 'slice.py')
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

Write-Host '[3/3] done'
exit $code
