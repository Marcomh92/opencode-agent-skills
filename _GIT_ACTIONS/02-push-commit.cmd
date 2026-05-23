@echo off
cd /d "%~dp0\.."
echo.
echo ========================================
echo      PUSH COMMIT TO REMOTE
echo ========================================
echo.
echo Current status:
git status --short
echo.
set /p msg="Enter commit message: "
echo.
git add .
git commit -m "%msg%"
git push
echo.
echo Press any key to exit...
pause >nul
