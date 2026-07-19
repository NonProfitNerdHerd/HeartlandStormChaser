@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 20+ is required.
  exit /b 1
)

set "INSTALLED_ENV=%LOCALAPPDATA%\Heartland\WeatherFrontOBS\config\.env"
set "LOCAL_ENV=%~dp0..\.env"

if exist "%INSTALLED_ENV%" (
  node --env-file="%INSTALLED_ENV%" "%~dp0..\src\index.js"
) else if exist "%LOCAL_ENV%" (
  node --env-file="%LOCAL_ENV%" "%~dp0..\src\index.js"
) else (
  echo ERROR: Missing .env. Copy .env.example to .env or install to LOCALAPPDATA config.
  exit /b 1
)

exit /b %ERRORLEVEL%
