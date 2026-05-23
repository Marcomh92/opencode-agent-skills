@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0\.."
set "target_dir=%cd%"
echo.
echo ========================================
echo      GIT INITIALIZER
echo ========================================
echo.
echo Target folder: %target_dir%
echo.

set "remote_url="

:: Check if already a git repository
if exist ".git\" (
    echo [INFO] This folder is already a Git repository.
    
    :: Check if connected to remote
    git remote get-url origin >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "tokens=*" %%a in ('git remote get-url origin 2^>nul') do (
            echo [INFO] Already connected to GitHub: %%a
            echo.
            echo No action needed. This repository is all set up!
            goto :gitignore_setup
        )
        echo [INFO] No remote repository connected.
        goto :prompt_remote
    ) else (
        echo [INFO] No remote repository connected.
        goto :prompt_remote
    )
) else (
    echo [INFO] This folder is not yet a Git repository.
    echo.
    
    :: Initialize git
    git init
    echo.
    echo Git repository initialized locally.
    
    :: Ask for GitHub URL
    goto :prompt_remote
)

:prompt_remote
set /p "remote_url=Enter GitHub repository URL (leave empty for local only): "

if "!remote_url!"=="" (
    echo.
    echo Continuing with local repository only...
) else (
    echo.
    echo Adding remote origin: !remote_url!
    git remote add origin "!remote_url!"
    
    :: Rename branch to main if needed
    git branch -M main
    
    echo Remote repository connected!
)

:gitignore_setup
echo.
echo ========================================
echo      .gitignore SETUP
echo ========================================
echo.
echo Enter files/folders to ignore (one per line).
echo Press Enter on an empty line when done.
echo Examples: node_modules/, *.log, secrets.txt
echo.

set "gitignore_file=.gitignore"
set "entry_count=0"

:: Create empty .gitignore if it doesn't exist
if not exist "!gitignore_file!" (
    type nul > "!gitignore_file!"
)

:: Check if last line is empty; if not, add a blank line
set "last_line=empty"
set "line_count=0"
for /f "tokens=1,* delims=:" %%a in ('type "!gitignore_file!" ^| findstr /n "^"') do (
    set "last_line=%%b"
    set /a line_count+=1
)

if !line_count! gtr 0 (
    if not "!last_line!"=="" (
        echo. >> "!gitignore_file!"
    )
)

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
findstr /x /c:"!entry!" "!gitignore_file!" >nul 2>&1
if !errorlevel! equ 0 (
    echo   [SKIPPED] Already exists: !entry!
    goto :gitignore_loop
)

:: Append entry to file immediately (avoids empty variable issues)
echo !entry! >> "!gitignore_file!"
set /a entry_count+=1
echo   Added: !entry!
goto :gitignore_loop

:gitignore_finalize
if !entry_count! equ 0 (
    echo [INFO] No entries added. .gitignore file is empty.
) else (
    echo [INFO] Added !entry_count! entries to .gitignore.
)

:: Stage and commit .gitignore
git add "!gitignore_file!"

git diff --cached --quiet
if !errorlevel! neq 0 (
    git commit -m "Add .gitignore"
    echo [INFO] .gitignore committed.
) else (
    echo [INFO] No changes to .gitignore to commit.
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
        git push -u origin main 2>nul
        if !errorlevel! neq 0 (
            echo [WARNING] Push failed. You may need to authenticate first.
        ) else (
            echo [SUCCESS] Repository pushed to GitHub!
        )
    ) else (
        echo [INFO] Push skipped.
    )
)

echo.
echo ========================================
echo      SETUP COMPLETE
echo ========================================
echo.
echo Press any key to exit...
pause >nul
