@echo off
chcp 65001 >nul
title Password Manager
cd /d "%~dp0"
echo ================================
echo   Password Manager
echo   http://localhost:3001
echo ================================
start http://localhost:3001
node server\index.cjs
pause
