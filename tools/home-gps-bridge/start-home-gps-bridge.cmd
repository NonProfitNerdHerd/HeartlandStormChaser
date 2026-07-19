@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found on PATH. Install Node.js 20 or newer, then retry.
  exit /b 1
)

if not exist "%~dp0.env" (
  echo ERROR: Missing .env file.
  echo Copy .env.example to .env and set GPS_API_URL and GPS_API_TOKEN.
  exit /b 1
)

REM Token is loaded from .env via --env-file — never passed on the command line.
node --env-file="%~dp0.env" "%~dp0src\index.js"
set EXITCODE=%ERRORLEVEL%
exit /b %EXITCODE%
