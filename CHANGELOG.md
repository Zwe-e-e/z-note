# Z Note release history

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
