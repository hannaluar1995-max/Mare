@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Publicar o Mare
echo.
echo === Publicar o Mare no Firebase ===
echo.
where node >nul 2>nul
if errorlevel 1 goto semnode
set /p PROJ=Cole o ID do projeto Firebase e tecle Enter: 
echo.
echo [1/3] Entrando na sua conta Google (vai abrir o navegador)...
call npx -y firebase-tools@latest login
echo.
echo [2/3] Preparando os avisos...
call npm --prefix functions install --no-audit --no-fund
echo.
echo [3/3] Publicando. Isso leva alguns minutos...
call npx -y firebase-tools@latest deploy --project %PROJ% --force
echo.
echo Se apareceu "Deploy complete", abra no celular: https://%PROJ%.web.app
echo Se apareceu erro de primeira vez, espere 5 minutos e rode este arquivo de novo.
pause
exit /b 0
:semnode
echo Falta instalar o Node.js. Baixe a versao LTS em https://nodejs.org , instale e rode este arquivo de novo.
pause
exit /b 1
