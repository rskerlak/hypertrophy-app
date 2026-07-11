@echo off
chcp 65001 >nul
title Reconstruir MyoNoesis
cd /d "%~dp0"

echo Reconstruyendo la app.
echo Usa esto despues de editar rules.config.json (los valores se compilan en el build).
echo.

call npm run build
if errorlevel 1 (
  echo [ERROR] Fallo la reconstruccion.
  pause
  exit /b 1
)

echo.
echo Listo. Ya podes abrir la app con "Abrir MyoNoesis.bat".
pause
