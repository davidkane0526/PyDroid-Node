@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul 2>&1

rem PyDroid Build GUI launcher. Double-click this CMD; PowerShell is internal only.
for %%I in ("%~dp0.") do set "ROOT=%%~fI"
set "SCRIPT=%ROOT%\tools\build-pydroid-gui.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%ROOT%\build-pydroid-gui.ps1"

set "LOGROOT=%LOCALAPPDATA%\PyDroidBuild\logs"
if not exist "%LOGROOT%" mkdir "%LOGROOT%" >nul 2>&1
set "LAUNCH_LOG=%LOGROOT%\launcher-last.log"

if not exist "%SCRIPT%" (
  >"%LAUNCH_LOG%" echo [ERROR] Cannot find build-pydroid-gui.ps1
  echo [ERROR] Cannot find build-pydroid-gui.ps1
  echo Expected under "%ROOT%\tools" or "%ROOT%".
  echo Log: "%LAUNCH_LOG%"
  pause
  exit /b 2
)

set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PSEXE%" set "PSEXE="
if not defined PSEXE for /f "delims=" %%P in ('where pwsh.exe 2^>nul') do if not defined PSEXE set "PSEXE=%%P"
if not defined PSEXE for /f "delims=" %%P in ('where powershell.exe 2^>nul') do if not defined PSEXE set "PSEXE=%%P"

if not defined PSEXE (
  >"%LAUNCH_LOG%" echo [ERROR] Windows PowerShell / PowerShell 7 was not found.
  echo [ERROR] Windows PowerShell / PowerShell 7 was not found.
  echo Log: "%LAUNCH_LOG%"
  pause
  exit /b 3
)

pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  >"%LAUNCH_LOG%" echo [ERROR] Cannot enter directory: "%ROOT%"
  echo [ERROR] Cannot enter directory: "%ROOT%"
  echo Log: "%LAUNCH_LOG%"
  pause
  exit /b 4
)

>"%LAUNCH_LOG%" echo PyDroid Build GUI launcher
>>"%LAUNCH_LOG%" echo Root: %ROOT%
>>"%LAUNCH_LOG%" echo PowerShell: %PSEXE%
>>"%LAUNCH_LOG%" echo Started: %DATE% %TIME%
>>"%LAUNCH_LOG%" echo.

if exist "%ROOT%\package.json" (
  "%PSEXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%SCRIPT%" -ProjectRoot "%ROOT%" >>"%LAUNCH_LOG%" 2>&1
) else (
  "%PSEXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%SCRIPT%" >>"%LAUNCH_LOG%" 2>&1
)
set "RC=%ERRORLEVEL%"

popd >nul 2>&1
if not "%RC%"=="0" (
  echo.
  echo [ERROR] PyDroid Build GUI failed to start or crashed. Exit code: %RC%
  echo [ERROR] Diagnostic log: "%LAUNCH_LOG%"
  echo.
  type "%LAUNCH_LOG%"
  echo.
  pause
)

endlocal & exit /b %RC%
