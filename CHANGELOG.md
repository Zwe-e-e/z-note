# Z Note release history

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
