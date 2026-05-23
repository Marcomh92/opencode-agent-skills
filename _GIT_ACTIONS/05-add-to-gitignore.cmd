@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0\.."
set "target_dir=%cd%"
echo.
echo ========================================
echo      ADD TO .gitignore
echo ========================================
echo.
echo Target folder: %target_dir%
echo.

:: Check if .gitignore exists
if not exist ".gitignore" (
    echo [INFO] No .gitignore file found. Creating one...
    type nul > .gitignore
    echo.
)

:: Check if last line is empty; if not, add a blank line
set "last_line=empty"
set "line_count=0"
for /f "tokens=1,* delims=:" %%a in ('type ".gitignore" ^| findstr /n "^"') do (
    set "last_line=%%b"
    set /a line_count+=1
)

if !line_count! gtr 0 (
    if not "!last_line!"=="" (
        echo. >> .gitignore
    )
)

echo Enter files/folders to add to .gitignore (one per line).
echo Press Enter on an empty line when done.
echo Examples: node_modules/, *.log, secrets.txt, savegamesBackup/
echo.

set "entry_count=0"

:gitignore_loop
:: CRITICAL: Clear the entry variable first!
:: set /p does NOT clear the variable on empty input
set "entry="
set /p "entry=Entry to ignore: "

:: Check if empty (user pressed Enter without typing)
if "!entry!"=="" (
    goto :gitignore_finalize
)

:: Check if entry already exists in .gitignore
findstr /x /c:"!entry!" ".gitignore" >nul 2>&1
if !errorlevel! equ 0 (
    echo   [SKIPPED] Already exists: !entry!
    goto :gitignore_loop
)

:: Append entry to file immediately (avoids empty variable issues)
echo !entry! >> .gitignore
set /a entry_count+=1
echo   Added: !entry!
goto :gitignore_loop

:gitignore_finalize
if !entry_count! equ 0 (
    echo.
    echo [INFO] No entries provided. No changes made.
    goto :end
)

echo.
echo [SUCCESS] !entry_count! entries added to .gitignore.

:: Stage and commit changes
git add .gitignore

git diff --cached --quiet
if !errorlevel! neq 0 (
    git commit -m "Update .gitignore - add %entry_count% entries"
    echo [INFO] Changes committed.
) else (
    echo [INFO] No changes to commit.
    goto :check_push
)

:check_push
:: Check if connected to remote
set "has_remote=no"
git remote get-url origin >nul 2>&1
if !errorlevel! equ 0 set "has_remote=yes"

if "!has_remote!"=="yes" (
    echo.
    set /p "push_choice=Push to GitHub? (y/n): "
    if /i "!push_choice!"=="y" (
        echo.
        echo Pushing to remote...
        git push
        if !errorlevel! equ 0 (
            echo [SUCCESS] Pushed to remote repository.
        ) else (
            echo [WARNING] Push failed. You may need to authenticate.
        )
    ) else (
        echo [INFO] Push skipped.
    )
)

:end
echo.
echo ========================================
echo Press any key to exit...
pause >nul
