Param(
  [string]$Path = "comisiones.json",
  [switch]$Check
)

$py = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $py) {
  $py = (Get-Command py -ErrorAction SilentlyContinue)
  if ($py) {
    $args = @("-3", "tools/format_comisiones.py", $Path)
    if ($Check) { $args += "--check" }
    & $py.Source @args
    exit $LASTEXITCODE
  }
  Write-Error "Python not found. Install Python 3 or ensure 'python'/'py' is on PATH."
  exit 1
}

$args = @("tools/format_comisiones.py", $Path)
if ($Check) { $args += "--check" }
& $py.Source @args
exit $LASTEXITCODE
