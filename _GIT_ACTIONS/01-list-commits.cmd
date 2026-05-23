@echo off
cd /d "%~dp0\.."
echo.
echo ========================================
echo      GIT COMMIT HISTORY
echo ========================================
echo.
git log --oneline --graph --all --decorate -20
echo.
echo Press any key to exit...
pause >nul
