@echo off
rem Opens Z Note in its own window, from wherever this folder is (OneDrive, a USB drive, anywhere).
rem It looks for Chrome first, then Edge. Use this same file on every PC.
setlocal DisableDelayedExpansion
set "PAGE=%~dp0Z Note.html"
if not exist "%PAGE%" (
  echo Z Note.html was not found next to this file.
  pause
  exit /b 1
)
set "BROWSER="
for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do if not defined BROWSER if exist %%B set "BROWSER=%%~B"
setlocal EnableDelayedExpansion
set "URL=!PAGE:\=/!"
set "URL=!URL: =%%20!"
if defined ZNOTE_DRYRUN (
  echo "!BROWSER!" --app="file:///!URL!"
  exit /b 0
)
if not defined BROWSER (
  start "" "!PAGE!"
) else (
  start "" "!BROWSER!" --app="file:///!URL!"
)
