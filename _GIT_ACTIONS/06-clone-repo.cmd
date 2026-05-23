@echo off

cd /d "%~dp0\.."
set "target_dir=%cd%"
echo.
echo ========================================
echo      CLONE REPOSITORY
echo ========================================
echo.

set /p "repo_url=Enter GitHub repository URL: "

if "%repo_url%"=="" (
    echo [ERROR] No URL provided.
    goto :end
)

:: Extract repo name
set "repo_name="
for /f "tokens=4 delims=/" %%a in ("%repo_url%") do set "repo_name=%%a"
set "repo_name=%repo_name:.git=%"

echo.
echo Repository: %repo_name%
echo.
echo Where to clone?
echo   1 = Into subfolder: %repo_name%
echo   2 = Into current folder
echo.
set /p "opt=Choose (1-2): "

if "%opt%"=="1" goto :do_subfolder
if "%opt%"=="2" goto :do_current

echo [ERROR] Invalid option.
goto :end

:do_current
echo.
echo [INFO] Setting up repository in current folder...

:: Step 1: Check if already a git repo
set "already_git=0"
if exist ".git\" set "already_git=1"

if "%already_git%"=="1" (
    echo.
    echo [WARNING] This folder is already a Git repository.
    set /p "cont=Continue anyway? (y/n): "
    if /i not "%cont%"=="y" goto :cancelled
)

:: Step 2: Create temp folder and clone
set "temp_dir=%target_dir%\_TEMP_CLONE_%random%"
echo.
echo Creating temp folder: %temp_dir%
mkdir "%temp_dir%"

echo Cloning to temp folder...
git clone "%repo_url%" "%temp_dir%"

if errorlevel 1 (
    echo [ERROR] Clone failed.
    rmdir /s /q "%temp_dir%"
    goto :end
)

echo.
echo [SUCCESS] Cloned to temp folder.

:: Step 3: Copy files from temp to current folder (excluding _GIT_ACTIONS)
echo.
echo Copying files to current folder...

:: Copy root files
for %%F in ("%temp_dir%\*") do (
    echo   File: %%~nxF
    copy /y "%%F" "%target_dir%\" >nul
)

:: Copy folders (except _GIT_ACTIONS)
for /d %%D in ("%temp_dir%\*") do (
    if /i not "%%~nD"=="_GIT_ACTIONS" (
        echo   Folder: %%~nD
        if exist "%target_dir%\%%~nD\" (
            xcopy /e /y /q "%%D\*" "%target_dir%\%%~nD\"
        ) else (
            xcopy /e /i /q "%%D" "%target_dir%\%%~nD\"
        )
    )
)

:: Step 4: Handle _GIT_ACTIONS folder specially
set "need_merge=0"
if exist "%temp_dir%\_GIT_ACTIONS\" (
    if exist "%target_dir%\_GIT_ACTIONS\" (
        set "need_merge=1"
    )
)

if "%need_merge%"=="1" (
    echo.
    echo Both local and remote have _GIT_ACTIONS scripts.
    echo Your current scripts will be preserved.
    echo.
    echo Options:
    echo   k = Keep remote version (replace yours)
    echo   r = Keep your version (ignore remote)
    echo   b = Keep both (yours renamed to _GIT_ACTIONS_OLD)
    echo.
    set /p "merge=Choose (k/r/b): "
    
    if /i "%merge%"=="k" goto :merge_keep_remote
    if /i "%merge%"=="r" goto :merge_keep_local
    if /i "%merge%"=="b" goto :merge_keep_both
    
    echo Invalid choice. Keeping your local version.
    goto :merge_keep_local
)

:: Remote has _GIT_ACTIONS but local doesn't
if exist "%temp_dir%\_GIT_ACTIONS\" (
    echo.
    echo Copying _GIT_ACTIONS from remote...
    xcopy /e /i /q "%temp_dir%\_GIT_ACTIONS" "%target_dir%\_GIT_ACTIONS\"
)

goto :merge_done

:merge_keep_remote
echo Replacing local _GIT_ACTIONS with remote version...
rmdir /s /q "%target_dir%\_GIT_ACTIONS"
xcopy /e /i /q "%temp_dir%\_GIT_ACTIONS" "%target_dir%\_GIT_ACTIONS\"
echo Done.
goto :merge_done

:merge_keep_local
echo Keeping your local _GIT_ACTIONS.
goto :merge_done

:merge_keep_both
echo Renaming local to _GIT_ACTIONS_OLD and copying remote...
ren "%target_dir%\_GIT_ACTIONS" "_GIT_ACTIONS_OLD"
xcopy /e /i /q "%temp_dir%\_GIT_ACTIONS" "%target_dir%\_GIT_ACTIONS\"
echo Done.
goto :merge_done

:merge_done
:: Step 5: Clean up temp folder
echo.
echo Cleaning up temp folder...
rmdir /s /q "%temp_dir%"

:: Step 6: Initialize git if not already done
if "%already_git%"=="0" (
    echo.
    echo Initializing git...
    git init
    git remote add origin "%repo_url%"
    git branch -M main
)

:: Step 7: Force sync to ensure everything matches remote exactly
echo.
echo Syncing with remote (force reset to match origin/main)...
cmd /c "git fetch origin && git reset --hard origin/main"

if errorlevel 1 (
    echo [WARNING] Force sync failed. Repository may not be fully synced.
) else (
    echo [SUCCESS] Repository is now in sync with remote!
)

echo.
echo [SUCCESS] Repository set up in current folder!
goto :end

:do_subfolder
set "dest=%target_dir%\%repo_name%"

if exist "%dest%\" (
    echo.
    echo [WARNING] Folder '%repo_name%' already exists.
    echo   o = Open it (do nothing)
    echo   d = Delete and re-clone
    echo   c = Cancel
    set /p "subopt=Choose (o/d/c): "
    
    if /i "%subopt%"=="o" goto :end
    if /i "%subopt%"=="d" (
        rmdir /s /q "%dest%"
    ) else (
        goto :cancelled
    )
)

echo.
echo Cloning into %repo_name%...
git clone "%repo_url%" "%dest%"

if errorlevel 1 (
    echo [ERROR] Clone failed.
    goto :end
)

echo [SUCCESS] Cloned to: %dest%

:: Ensure the cloned repo is in sync with remote (in case of partial clone issues)
echo.
echo Syncing with remote (force reset to match origin/main)...
cd /d "%dest%"
cmd /c "git fetch origin && git reset --hard origin/main"
cd /d "%target_dir%"

if errorlevel 1 (
    echo [WARNING] Force sync failed. Repository may not be fully synced.
) else (
    echo [SUCCESS] Repository is now in sync with remote!
)

goto :end

:cancelled
echo.
echo Cancelled. No changes made.

:end
echo.
echo ========================================
echo Press any key to exit...
pause >nul
