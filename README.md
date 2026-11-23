# Z Note

**Current release: [v2.4.0](https://github.com/ZweWH/z-note/releases/tag/v2.4.0)** · Released 23 November 2026 · [Release history](CHANGELOG.md)

Your installed version appears at the bottom of the app sidebar and in the **Style & data** title. Use **Check for updates** in the sidebar, or **Style & data → Updates**, to check for a newer release.

A portable notebook you download to your PC and open in your own browser. Notes, tasks, boards, screen snips, themes, local folder saving and Keep Awake are included.

**[Download page](https://zwewh.github.io/z-note/)** · **[Download Z Note Portable ZIP](https://zwewh.github.io/z-note/downloads/Z-Note-Portable.zip)**

## Download and start

1. Download **Z-Note-Portable.zip** and choose **Extract All**. Do not run the app from inside the ZIP.
2. Save the extracted **Z Note** folder wherever you want on your PC.
3. On Windows, double-click **Open Z Note.cmd**. It opens your own Chrome or Edge browser in a dedicated window and enables background Keep Awake and automatic app updates. You can also open **Z Note.html** directly, with visible-window Keep Awake and manual app updates.
4. In the first-run dialog, click **Choose source folder** and select that extracted **Z Note** folder. Allow the browser to save files. The app creates a **Z Note notebook** subfolder for your pages and pictures. To reconnect notes from another PC, use **Open existing notebook…** and select **Z Note notebook** itself or its parent folder.

No installer, account or development tools are needed. The extracted app works offline. Keep the `app` folder beside `Z Note.html`. The Windows launcher uses the .NET Framework included with Windows 10/11.

```text
Z Note/
  Open Z Note.cmd      ← Windows: background Keep Awake and automatic updates
  Z Note.html          ← direct browser entry (visible-window Keep Awake)
  START HERE.txt
  app/
  Z Note notebook/     ← created after you choose your source folder
```

Each person gets their own notebook. The shared download contains application files and generic starter examples only.

## Folder saving and backups

Choose a folder when setting up so your notes are saved as files as well as in browser storage. If the browser asks for permission again later, use **Allow** to reconnect it.

The sidebar shows **Source folder** and the notebook location. Click it to copy the location, locate the connected folder, sync now, or open an existing notebook. Browsers expose the folder name rather than its full Windows path. You can paste the selected folder's full path from File Explorer into the details dialog; this optional display label stays in that browser and does not change where notes are saved.

To open an existing notebook, use **Open existing notebook…** in setup, the Source folder dialog, or **Style & data → Sync & backup**. Select **Z Note notebook** itself or the folder containing it. Z Note reconnects to its pages and pictures. If this browser already contains your own notes, the app asks how to combine them with the folder's notebook.

A folder in OneDrive or a shared network folder can carry changes between your computers:

1. Connect each PC to the same notebook using **Open existing notebook…**. Allow folder access in each browser.
2. Before switching PCs, press **Sync now** in Source folder or **Style & data → Sync & backup**. If using OneDrive or another sync service, wait for it to finish uploading.
3. On the other PC, wait for the files to finish downloading, then press **Sync now** in Z Note.

A one-time folder copy moves the notebook but does not carry later changes. Z Note does not provide its own cloud account or real-time collaboration. Work on one PC at a time; if the same page is edited on two PCs before syncing, the newer change wins.

You can choose browser storage instead. Those notes belong to that browser profile and are not automatically included when you copy the app folder. Clearing browser data can remove them. Download a backup from **Style & data → Sync & backup** and restore it on the other PC.

The local app and the previously hosted app use separate browser storage. To transfer notes from the hosted version, download a backup there and restore it in your local copy, or reconnect the same notebook folder.

## Updating

Click **Check for updates** in the sidebar, or open **Style & data → Updates**. The check contacts the public Z Note GitHub repository only when you request it. It compares your installed version with the latest stable release and shows whether an update is available. If you are offline or GitHub cannot be reached, retry later or open the official releases page.

With **v2.4.0 or later**, open Z Note through **Open Z Note.cmd** on Windows. When a newer version is available, click **Install update automatically**. Close other Z Note windows and keep this window open until the update finishes. Z Note saves a recovery backup on your PC, shows its full path, verifies the official download, replaces the app files in the same location, and reloads. Your notes, pictures, source-folder connection and display settings stay in place. No manual ZIP replacement or saved-backup checkbox is needed for this route.

Automatic installation requires working browser storage and the Windows launcher. If the update result cannot be confirmed, follow the on-screen instruction to close and reopen **Open Z Note.cmd** so recovery can finish. Keep the recovery backup until you have checked your notebook.

**Upgrading from v2.3.0 or earlier requires one manual update to v2.4.0.** This adds the new Windows launcher; future releases can install from the button. The manual steps also remain available when opening the HTML directly or when the launcher cannot connect:

1. Click **Download a backup first** and confirm the JSON file has finished saving on your PC. Only then tick the backup confirmation and download the update ZIP.
2. Close all Z Note windows. Extract the ZIP into a separate temporary folder.
3. Copy the new application files into your original **Z Note** app folder, replacing the matching app files. Keep your existing **Z Note notebook** folder and all backups; do not delete the original folder to install the update.
4. Reopen Z Note from the same location with the same browser profile. Check that your pages and pictures are present before removing any old copies or backups.

Keeping the same app location and browser profile retains browser notes and folder settings. If you choose a new app location or another PC, use **Open existing notebook…** to reconnect **Z Note notebook** or its parent. For notes kept only in browser storage, restore the saved JSON backup through **Restore from a file… → Add to my notebook**. Browser storage and folder permissions do not travel with a copied application folder.

For the hosted web app, save a backup first, then refresh the page in the same browser profile to load website updates. Moving between the hosted app and the downloaded app uses separate browser storage, so reconnect your notebook folder or restore the backup. Checking for updates alone does not install anything or reload the app.

## Browser features

Use desktop Chrome or Edge for direct folder access. Other browsers can use browser storage and downloadable backups where supported. Screen capture and folder access require permission.

## Keep Awake

On Windows, open **Open Z Note.cmd**, then click **Keep Awake** beside **Snip**. **Awake on** means Windows is keeping the display and computer awake even when Z Note is minimized or covered by another app. Click again to stop. Closing or reloading that Z Note window releases the request; each new session starts off. It does not override manual sleep, locking, lid-close actions or Windows policy.

Opening the HTML directly or using the hosted app provides browser-only mode: **Awake: visible**. That mode pauses when hidden. To get background support, download the current ZIP and reopen through the Windows launcher.

The launcher starts `app/native/ZNoteHost.exe`, a small helper whose source is in this repository. It opens the same local HTML file and talks only to that window over an authenticated connection on your own PC. It does not change power settings or move the mouse. If the helper disconnects, the button switches off; reopen using the launcher. The helper exits shortly after its Z Note windows close.

The app includes no analytics and does not upload notebook contents to GitHub. A manual update check retrieves public release information from GitHub; it does not send your notes, pictures, or source-folder path. GitHub Pages hosts the download page and the public application files.

## Development

The app uses plain HTML, CSS and JavaScript. `Z Note.html` is the local app entry point. `index.html` is the public download page.

Run the dependency-free checks with Node.js:

```sh
node --test tests/awake.test.cjs
node --test tests/native-bridge.test.cjs tests/awake-native-integration.test.cjs
node --test tests/setup.test.cjs
node --test tests/source-folder.test.cjs
node --test tests/updates.test.cjs tests/update-native.test.cjs tests/backup.test.cjs
node --test tests/sync.test.cjs tests/checkpoint.test.cjs tests/auto-update.test.cjs
```

To build and test the Windows helper, then rebuild the portable ZIP in PowerShell:

```powershell
powershell -NoProfile -File scripts/build-native.ps1
powershell -NoProfile -File tests/test-native.ps1
powershell -NoProfile -File tests/test-native-update.ps1
node --test tests/native-awake.test.cjs
powershell -NoProfile -File scripts/package-portable.ps1
```

The packaging script includes only the app, launcher and quick guide, and verifies the archive contents. Personal notebooks, exported backups and credentials must never be published. `.gitignore` excludes standard notebook and backup paths; only the curated portable ZIP is allowed.

GitHub Pages publishes the `main` branch, repository root. Rebuild the ZIP whenever application files change so the download matches the source.
