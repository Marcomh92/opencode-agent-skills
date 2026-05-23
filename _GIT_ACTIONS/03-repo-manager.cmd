@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0\.."
echo.
echo ========================================
echo      GIT REPOSITORY MANAGER
echo ========================================
echo.
echo Recent commits:
git log --oneline -10 2>nul || echo [No commits yet]
echo.
echo Options:
echo   [1] Revert a specific commit (creates new "undo" commit)
echo   [2] Checkout previous commit (detached HEAD - read only)
echo   [3] Switch back to main branch
echo   [4] Hard reset to a commit (DESTRUCTIVE - use with caution!)
echo   [5] Pull latest changes from remote (GitHub)
echo.

choice /c 12345 /n /m "Choose option (1-5): "

:: Must check from highest to lowest
if errorlevel 5 goto :option5
if errorlevel 4 goto :option4
if errorlevel 3 goto :option3
if errorlevel 2 goto :option2
if errorlevel 1 goto :option1

goto :end

:option1
echo.
echo DISCLAIMER:
echo   This will revert ONLY the selected commit (not all commits up to it).
echo   It creates a NEW commit that undoes just that specific commit.
echo   All other commits remain intact.
echo.
set /p hash="Enter commit hash to revert: "
echo.
git revert --no-edit !hash!

if errorlevel 1 (
    echo.
    echo [WARNING] Revert encountered an issue (likely a merge conflict).
    echo.
    echo Conflicted files:
    git diff --name-only --diff-filter=U
    echo.
    echo Options:
    echo   [a] Abort the revert and return to previous state
    echo   [c] Continue (after you've manually resolved conflicts)
    echo   [s] Skip this commit and continue
    echo   [i] Show detailed instructions for resolving conflicts
    echo.
    choice /c acsi /n /m "Choose option (a/c/s/i): "
    
    if errorlevel 4 goto :instructions
    if errorlevel 3 goto :skip
    if errorlevel 2 goto :continue_revert
    if errorlevel 1 goto :abort_revert
)

echo [SUCCESS] Commit reverted successfully.
goto :end

:abort_revert
git revert --abort
if errorlevel 1 (
    echo [ERROR] Failed to abort revert.
) else (
    echo [INFO] Revert aborted. Returned to previous state.
)
goto :end

:continue_revert
git add .
git revert --continue --no-edit
if errorlevel 1 (
    echo [ERROR] Failed to continue revert.
) else (
    echo [INFO] Revert continued and completed.
)
goto :end

:skip
git revert --skip
if errorlevel 1 (
    echo [ERROR] Failed to skip commit.
) else (
    echo [INFO] Commit skipped.
)
goto :end

:instructions
echo.
echo ========================================
echo      HOW TO RESOLVE CONFLICTS
echo ========================================
echo.
echo 1. Open the conflicted files in a text editor.
echo 2. Look for conflict markers:
echo    ^<^<^<^<^<^<^< HEAD
echo    (your current changes)
echo    =======
echo    (changes being reverted)
echo    ^>^>^>^>^>^>^> (hash)
echo 3. Edit the file to keep the correct content.
echo 4. Remove all conflict markers.
echo 5. Save the file.
echo 6. Run: git add .
echo 7. Run: git revert --continue
echo.
echo After resolving, run this script again and choose 'c' to continue.
goto :end

:option2
set /p hash="Enter commit hash to checkout: "
echo.
git checkout !hash!
if errorlevel 1 (
    echo [ERROR] Checkout failed.
) else (
    echo.
    echo You are now in 'detached HEAD' state. To return to main, run option 3.
)
goto :end

:option3
git checkout main
if errorlevel 1 (
    echo [ERROR] Failed to switch to main branch.
) else (
    echo [SUCCESS] Switched to main branch.
)
goto :end

:option4
echo WARNING: This will discard all uncommitted changes!
choice /c yn /n /m "Type 'y' to confirm: "
if errorlevel 2 goto :cancelled

set /p hash="Enter commit hash to reset to: "
echo.
git reset --hard !hash!
if errorlevel 1 (
    echo [ERROR] Reset failed.
) else (
    echo [SUCCESS] Hard reset completed.
)
goto :end

:option5
echo.
echo Pulling latest changes from remote...
git pull origin main

if errorlevel 1 (
    echo.
    echo [ERROR] Pull failed.
    echo.
    echo This usually happens when local files would be overwritten.
    echo.
    echo Options:
    echo   [f] Force overwrite local files with remote version (DESTRUCTIVE)
    echo   [s] Stash local changes, then pull
    echo   [c] Cancel and fix manually
    echo.
    choice /c fsc /n /m "Choose option (f/s/c): "
    
    if errorlevel 3 goto :end
    if errorlevel 2 goto :stash_and_pull
    if errorlevel 1 goto :force_pull
)

echo.
echo [SUCCESS] Successfully pulled latest changes!
echo.
git log --oneline -5
goto :end

:force_pull
echo.
echo WARNING: This will OVERWRITE all tracked local files with remote version!
echo Any local changes will be lost.
choice /c yn /n /m "Are you sure? (y/n): "
if errorlevel 2 goto :end

:: Check for untracked files using a temporary file approach
echo.
echo Checking for untracked files...
git ls-files --others --exclude-standard > "%temp%\untracked_check.txt" 2>nul

set "filesize=0"
for %%F in ("%temp%\untracked_check.txt") do set "filesize=%%~zF"
del "%temp%\untracked_check.txt" 2>nul

if "%filesize%"=="0" goto :force_pull_no_untracked

:: Untracked files exist
echo.
echo Untracked files found (may include old deleted scripts).
echo.
echo Options:
echo   [d] Delete them for a FULL SYNC
echo   [k] Keep them (partial sync)
echo.
choice /c dk /n /m "Choose (d/k): "
if errorlevel 2 goto :force_pull_keep
if errorlevel 1 goto :force_pull_delete

:force_pull_no_untracked
echo.
echo No untracked files found.
echo Fetching and resetting to match remote...
cmd /c "git fetch origin && git reset --hard origin/main"
if errorlevel 1 (
    echo [ERROR] Failed to sync with remote.
) else (
    echo.
    echo [SUCCESS] Repository fully synced with remote!
)
goto :force_pull_exit

:force_pull_delete
echo.
echo Fetching and resetting (with cleanup)...
cmd /c "git fetch origin && git reset --hard origin/main && git clean -fd"
if errorlevel 1 (
    echo [ERROR] Failed to sync with remote.
) else (
    echo.
    echo [SUCCESS] Full sync complete! All files match remote.
)
goto :force_pull_exit

:force_pull_keep
echo.
echo Fetching and resetting (keeping untracked files)...
cmd /c "git fetch origin && git reset --hard origin/main"
if errorlevel 1 (
    echo [ERROR] Failed to sync with remote.
) else (
    echo.
    echo [SUCCESS] Tracked files synced. Untracked files kept.
    echo To clean untracked files later: git clean -fd
)

:force_pull_exit
echo.
echo Press any key to exit...
pause >nul
exit /b

:stash_and_pull
echo.
echo Stashing local changes...
git stash

echo Pulling from remote...
git pull origin main

if errorlevel 1 (
    echo [ERROR] Pull still failed after stash.
    echo Restoring stashed changes...
    git stash pop
) else (
    echo.
    echo [SUCCESS] Pulled latest changes!
    echo.
    echo To restore your stashed changes, run: git stash pop
    echo.
    git log --oneline -5
)
goto :end

:cancelled
echo Cancelled.

:end
echo.
echo ========================================
echo Press any key to exit...
pause >nul
