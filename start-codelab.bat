@echo off
title CodeLab server
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install Node.js 22.13 or newer from https://nodejs.org and try again. & pause & exit /b 1)
echo Starting CodeLab... Keep this window open while people use the site.
echo Open http://localhost:8080 in your browser. Press Ctrl+C to stop.
echo.
node server.js
echo.
echo CodeLab has stopped.
pause
