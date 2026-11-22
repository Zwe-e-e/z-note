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
rem The helper opens the same local HTML, keeping existing browser storage.
set "AWAKEHOST=%~dp0app\native\ZNoteHost.exe"
if exist "%AWAKEHOST%" (
  if defined ZNOTE_DRYRUN (
    echo "%AWAKEHOST%" --page "%PAGE%"
    exit /b 0
  )
  start "" "%AWAKEHOST%" --page "%PAGE%"
  exit /b 0
)
echo Windows Keep Awake helper is missing. Opening in visible-window mode.
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
rem Encode URL delimiters before spaces so portable folders with # or %% work.
set "URL=!URL:%%=%%25!"
set "URL=!URL:#=%%23!"
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
