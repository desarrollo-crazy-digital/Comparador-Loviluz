@echo off
setlocal

REM Formats comisiones.json to avoid noisy diffs (Windows-friendly hook).
REM Runs only when comisiones.json is staged.

git diff --cached --name-only --diff-filter=ACMR | findstr /R /C:"^comisiones\\.json$" >nul
if errorlevel 1 exit /b 0

where python >nul 2>nul
if %errorlevel%==0 (
  python tools\\format_comisiones.py comisiones.json
  if errorlevel 1 exit /b 1
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -3 tools\\format_comisiones.py comisiones.json
    if errorlevel 1 exit /b 1
  ) else (
    echo pre-commit: Python 3 not found; cannot format comisiones.json 1>&2
    exit /b 1
  )
)

git add comisiones.json
exit /b %errorlevel%
