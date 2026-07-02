@echo off
chcp 65001 >nul
title Hipertrofia
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js/npm.
  echo Instalalo desde https://nodejs.org y volve a ejecutar este archivo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias por primera vez. Esto puede tardar unos minutos...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Fallo la instalacion de dependencias.
    pause
    exit /b 1
  )
)

if not exist "out\index.html" (
  echo Generando la app por primera vez...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Fallo la generacion de la app.
    pause
    exit /b 1
  )
)

echo.
echo ==============================================
echo   Hipertrofia abierta en http://localhost:3000
echo   Cerra esta ventana para detener la app.
echo ==============================================
echo.

REM Abre el navegador tras un breve retraso, sin bloquear el servidor.
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:3000"

call npm run serve
