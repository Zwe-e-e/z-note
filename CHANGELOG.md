# Z Note release history

## v2.4.1 — 2026-11-23

- Replace the circular-arrow control beside Keep Awake with a visible **Sync** button.
- Show **Syncing…** while folder sync runs and prevent repeated clicks during syncing or app updates.
- Verify that Windows Keep Awake remains enabled when the app is hidden, minimized or covered. Open **Open Z Note.cmd** and enable **Awake on**; browser-only mode still requires a visible window.

The Windows helper, notebook format and source-folder settings are unchanged.

## v2.4.0 — 2026-11-23

- Add **Install update automatically** when Z Note is opened with the Windows launcher. Save a recovery backup first, show its local path, verify the official release download, update the app in its existing location, and reload after installation is confirmed.
- Keep notes, pictures, source-folder settings and browser storage during updates. Pause editing and folder sync while installing; if the result cannot be confirmed, keep the notebook protected and ask the user to reopen the launcher for recovery.
- Keep the backup-first manual update route for direct browser copies and older launchers. Upgrading from v2.3.0 or earlier requires one manual update to install the new launcher; future versions can use the automatic button.
- Add **Open existing notebook…** to setup, Source folder and Sync & backup. Select **Z Note notebook** itself or its parent folder to reconnect notes without creating a nested notebook folder.
- Add **Sync now** and guidance for using the same OneDrive or shared folder on another PC. Wait for folder transfers to finish before switching PCs; a copied folder alone does not synchronize later edits.

The notebook and JSON backup formats remain unchanged. Each PC still needs its own browser permission to access the notebook folder.

## v2.3.0 — 2026-11-23

- Add **Check for updates** to the sidebar and an **Updates** tab in Style & data.
- Compare the installed version with the latest stable public GitHub release, with clear update-available, up-to-date, offline and error messages. Checks are manual and do not upload notes, pictures or source-folder paths.
- Guide updates through a backup download and confirmation that the backup was saved before enabling the update ZIP download. Links stay within the official Z Note release and download locations.
- Explain how to replace app files while keeping the original notebook folder, or reconnect a notebook and restore a backup when changing locations. The app does not automatically install files, reload, or clear stored notes.
- Include pending board edits in backup exports and stop backup creation if stored pictures cannot be read, instead of silently exporting an incomplete backup.

The notebook and backup formats and the Windows helper are unchanged from v2.2.1.

## v2.2.1 — 2026-11-23

- Show the installed version at the bottom of the app sidebar and in the Style & data title.
- Embed the version from `VERSION.txt` when packaging so the display works offline and matches the portable download.

The notebook format and Windows helper are unchanged from v2.2.0.

## v2.2.0 — 2026-11-23

This release packages the recent portable-app improvements as the first tagged public GitHub release.

- Windows background Keep Awake: open `Open Z Note.cmd` and enable Keep Awake to keep the display and computer awake when Z Note is minimized or covered. Turning it off, closing the window, or losing the helper connection releases the request.
- Browser-only Keep Awake is clearly labelled `Awake: visible`; background support requires the Windows launcher.
- First-run source-folder setup creates or reconnects `Z Note notebook`, with browser-storage and temporary-session options where appropriate.
- A persistent Source folder control shows the notebook location, with copy, locate, and backup-management actions. An optional full-path display label is stored only in that browser and bound to the selected folder.
- Download-first GitHub Pages site and a curated portable ZIP containing only application files and generic starter examples.

Validation: 86 JavaScript checks, 9 native loopback tests, and 14 native power/thread assertions passed for the included changes. The source-folder control was also checked in the browser.

Upgrade: keep a backup and your existing `Z Note notebook` folder. Extract the new app, then reconnect the parent of your notebook folder or restore your backup. The hosted app and local app have separate browser storage.

The app release version is independent of the notebook, setup, backup, and native-protocol schema versions.
