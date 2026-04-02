@echo off
echo.
echo  ╔════════════════════════════════════════════╗
echo  ║     AlgoTrade — 24/7 Startup Script        ║
echo  ╚════════════════════════════════════════════╝
echo.

:: Check PM2 installed
where pm2 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [SETUP] Installing PM2...
    npm install -g pm2
    echo [OK] PM2 installed
)

:: Build Next.js production bundle (only if not built yet)
if not exist ".next\BUILD_ID" (
    echo [BUILD] Building Next.js production...
    npm run build
    echo [OK] Build complete
)

:: Create logs directory
if not exist "logs" mkdir logs

:: Start all processes
echo [START] Starting all processes with PM2...
pm2 start ecosystem.config.js

:: Save process list so it survives reboot
pm2 save

echo.
echo  ╔════════════════════════════════════════════╗
echo  ║  ✓ AlgoTrade is running 24/7!             ║
echo  ║                                            ║
echo  ║  Dashboard:  http://localhost:3000         ║
echo  ║                                            ║
echo  ║  Commands:                                 ║
echo  ║    pm2 status       — show all processes   ║
echo  ║    pm2 logs         — live log stream      ║
echo  ║    pm2 monit        — visual dashboard     ║
echo  ║    pm2 stop all     — stop everything      ║
echo  ║    pm2 restart all  — restart              ║
echo  ╚════════════════════════════════════════════╝
echo.

:: Open PM2 monitor
pm2 monit
