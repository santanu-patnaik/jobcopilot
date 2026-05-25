@echo off
REM JobPilot — Windows Task Scheduler Setup
REM Run this ONCE as Administrator to register the nightly scan

SET TASK_NAME=JobPilot_NightlyScan
SET SCRIPT_DIR=%~dp0
SET NODE_SCRIPT=%SCRIPT_DIR%scanner.js
SET RUN_TIME=02:00

echo.
echo ============================================
echo  JobPilot — Task Scheduler Setup
echo ============================================
echo.
echo This will schedule JobPilot to run nightly at %RUN_TIME%
echo and wake your PC from sleep to do so.
echo.
echo Script: %NODE_SCRIPT%
echo.

REM Check Node.js is installed
where node >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo ERROR: Node.js not found. Please install from https://nodejs.org
  pause
  exit /b 1
)

FOR /F "tokens=*" %%i IN ('where node') DO SET NODE_PATH=%%i
echo Found Node.js at: %NODE_PATH%
echo.

REM Delete existing task if present
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

REM Create the scheduled task
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "\"%NODE_PATH%\" \"%NODE_SCRIPT%\"" ^
  /sc daily ^
  /st %RUN_TIME% ^
  /ru SYSTEM ^
  /rl HIGHEST ^
  /f

IF %ERRORLEVEL% NEQ 0 (
  echo ERROR: Failed to create scheduled task.
  echo Make sure you are running this as Administrator.
  pause
  exit /b 1
)

REM Enable wake from sleep
powercfg /waketimers enable >nul 2>&1

REM Set task to wake the computer
schtasks /change /tn "%TASK_NAME%" /waketorun

echo.
echo ============================================
echo  SUCCESS — Task scheduled for %RUN_TIME% nightly
echo  Your PC will wake from sleep to run the scan
echo  and return to sleep when done.
echo ============================================
echo.
echo To test immediately, run:
echo   node "%NODE_SCRIPT%"
echo.
echo To remove the schedule, run:
echo   schtasks /delete /tn "%TASK_NAME%" /f
echo.
pause
