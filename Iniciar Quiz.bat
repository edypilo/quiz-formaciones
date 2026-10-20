@echo off
rem Doble clic para abrir el Quiz en Windows.
title Quiz de formaciones
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Falta Node.js, el programa que necesita esta aplicacion.
  echo   Se va a abrir su pagina de descarga: instala la version LTS
  echo   y despues vuelve a abrir este archivo.
  echo.
  start "" "https://nodejs.org/es/download"
  pause
  exit /b 1
)

node iniciar.js
echo.
pause
