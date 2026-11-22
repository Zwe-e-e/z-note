# Z Note

A portable notebook you download to your PC and open in your own browser. Notes, tasks, boards, screen snips, themes, local folder saving and Keep Awake are included.

**[Download page](https://zwewh.github.io/z-note/)** · **[Download Z Note Portable ZIP](https://zwewh.github.io/z-note/downloads/Z-Note-Portable.zip)**

## Download and start

1. Download **Z-Note-Portable.zip** and choose **Extract All**. Do not run the app from inside the ZIP.
2. Save the extracted **Z Note** folder wherever you want on your PC.
3. On Windows, double-click **Open Z Note.cmd**. It opens your own Chrome or Edge browser in a dedicated window and enables background Keep Awake. You can also open **Z Note.html** directly, with visible-window Keep Awake only.
4. In the first-run dialog, click **Choose source folder** and select that extracted **Z Note** folder. Allow the browser to save files. The app creates a **Z Note notebook** subfolder for your pages and pictures.

No installer, account or development tools are needed. The extracted app works offline. Keep the `app` folder beside `Z Note.html`. The Windows launcher uses the .NET Framework included with Windows 10/11.

```text
Z Note/
  Open Z Note.cmd      ← open this on Windows for background Keep Awake
  Z Note.html          ← direct browser entry (visible-window Keep Awake)
  START HERE.txt
  app/
  Z Note notebook/     ← created after you choose your source folder
```

Each person gets their own notebook. The shared download contains application files and generic starter examples only.

## Folder saving and backups

Choose a folder when setting up so your notes are saved as files as well as in browser storage. If the browser asks for permission again later, use **Allow** to reconnect it.

To open an existing notebook or move it to another PC, copy the whole folder and select the parent that contains **Z Note notebook**. If setup has already been completed, use **Style & data → Sync & backup → Choose the sync folder**. Wait until syncing finishes before copying the notebook folder.

A folder in OneDrive or another desktop sync service can carry the files between your computers. Z Note itself does not provide cloud accounts or real-time collaboration; if the same page is edited on two computers before syncing, the newer change wins.

You can choose browser storage instead. Those notes belong to that browser profile and are not automatically included when you copy the app folder. Clearing browser data can remove them. Download a backup from **Style & data → Sync & backup** and restore it on the other PC.

The local app and the previously hosted app use separate browser storage. To transfer notes from the hosted version, download a backup there and restore it in your local copy, or reconnect the same notebook folder.

## Updating

Download and extract a fresh copy into a new folder. Keep your existing **Z Note notebook** folder and backups. Open the new app and reconnect the parent of your existing notebook through setup or **Style & data → Sync & backup**. Do not replace your saved notebook with a fresh copy of the application.

## Browser features

Use desktop Chrome or Edge for direct folder access. Other browsers can use browser storage and downloadable backups where supported. Screen capture and folder access require permission.

## Keep Awake

On Windows, open **Open Z Note.cmd**, then click **Keep Awake** beside **Snip**. **Awake on** means Windows is keeping the display and computer awake even when Z Note is minimized or covered by another app. Click again to stop. Closing or reloading that Z Note window releases the request; each new session starts off. It does not override manual sleep, locking, lid-close actions or Windows policy.

Opening the HTML directly or using the hosted app provides browser-only mode: **Awake: visible**. That mode pauses when hidden. To get background support, download the current ZIP and reopen through the Windows launcher.

The launcher starts `app/native/ZNoteHost.exe`, a small helper whose source is in this repository. It opens the same local HTML file and talks only to that window over an authenticated connection on your own PC. It does not change power settings or move the mouse. If the helper disconnects, the button switches off; reopen using the launcher. The helper exits shortly after its Z Note windows close.

The app includes no analytics or external service integrations, and does not upload notebook contents to GitHub. GitHub Pages hosts the download page and the public application files.

## Development

The app uses plain HTML, CSS and JavaScript. `Z Note.html` is the local app entry point. `index.html` is the public download page.

Run the dependency-free checks with Node.js:

```sh
node --test tests/awake.test.cjs
node --test tests/native-bridge.test.cjs tests/awake-native-integration.test.cjs
node --test tests/setup.test.cjs
```

To build and test the Windows helper, then rebuild the portable ZIP in PowerShell:

```powershell
powershell -NoProfile -File scripts/build-native.ps1
powershell -NoProfile -File tests/test-native.ps1
node --test tests/native-awake.test.cjs
powershell -NoProfile -File scripts/package-portable.ps1
```

The packaging script includes only the app, launcher and quick guide, and verifies the archive contents. Personal notebooks, exported backups and credentials must never be published. `.gitignore` excludes standard notebook and backup paths; only the curated portable ZIP is allowed.

GitHub Pages publishes the `main` branch, repository root. Rebuild the ZIP whenever application files change so the download matches the source.
