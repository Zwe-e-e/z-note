# Z Note

**Current release: [v2.6.1](https://github.com/Zwe-e-e/z-note/releases/tag/v2.6.1)** · Released 26 November 2026 · [Release history](CHANGELOG.md)

**New in v2.6.1:** Weekly, monthly, yearly and custom project expense periods; category suggestions from saved expenses; full source-folder paths and copyable sync instructions; and recovery actions for a stuck automatic-update dialog. Existing notes, receipts, monthly budgets and source-folder settings are preserved.

In **Budget & expenses**, choose a **Period**: Monthly, Weekly, Yearly or Project. Weeks run Monday–Sunday; yearly reports cover January–December. Project saves a custom start and end date, both included. Use one budget page per project and name it accordingly. The expense list, category chart and totals all use that range. Each week, month, year and project range has its own optional budget; amounts are not added together across period types. Changing project dates keeps the previous budget saved for its original range. Expenses and receipts outside the displayed range remain stored. Period mode and project dates are remembered, synced, backed up and undoable. Existing pages remain monthly until changed; v2.6.0 copies preserve the new fields but only show monthly reports.

**Included since v2.6.0:** Optional Budget & expenses pages with summaries, pie charts and receipt attachments; undo and redo for tasks and budgets; a visible connected-folder path in Sync & backup; and PayLah donations for Singapore. Z Note remains free and open source under the MIT license.

Includes A/B/C task priorities with a remembered one- or three-column view, tasks from every list together, sticky-note alignment guides, and the blue Z-icon portable launcher. Existing task content and stored priorities remain unchanged until you edit them.

Your installed version appears at the bottom of the app sidebar and in the **Style & data** title. Use **Check for updates** in the sidebar, or **Style & data → Updates**, to check for a newer release.

A portable notebook you download to your PC and open in your own browser. Notes, tasks, boards, screen snips, themes, local folder saving and Keep Awake are included.

**[Download page](https://zwe-e-e.github.io/z-note/)** · **[Download Z Note v2.6.1 Portable ZIP](https://zwe-e-e.github.io/z-note/downloads/Z-Note-v2.6.1-With-Icon.zip)**

## Download and start

1. Download **Z-Note-v2.6.1-With-Icon.zip** and choose **Extract All**. Do not run the app from inside the ZIP.
2. Save the extracted **Z Note** folder wherever you want on your PC.
3. On Windows, double-click **Z Note.exe** (the blue Z icon). It opens your own Chrome or Edge browser in a dedicated window and enables background Keep Awake and automatic app updates. **Open Z Note.cmd** remains an alternative. You can also open **Z Note.html** directly, with visible-window Keep Awake and manual app updates.
4. In the first-run dialog, click **Choose source folder** and select that extracted **Z Note** folder. Allow the browser to save files. The app creates a **Z Note notebook** subfolder for your pages and pictures. To reconnect notes from another PC, use **Open existing notebook…** and select **Z Note notebook** itself or its parent folder.

No installer, account or development tools are needed. The extracted app works offline. Keep the `app` folder beside `Z Note.html`. The Windows launcher uses the .NET Framework included with Windows 10/11.

```text
Z Note/
  Z Note.exe           ← blue Z icon: start here on Windows
  Open Z Note.cmd      ← alternative Windows launcher
  Z Note.html          ← direct browser entry (visible-window Keep Awake)
  START HERE.txt
  app/
  Z Note notebook/     ← created after you choose your source folder
```

Each person gets their own notebook. The shared download contains application files and generic starter examples only.

Keep **Z Note.exe**, **Z Note.html** and the **app** folder together. The icon launcher finds the app beside itself, so the whole folder can move to another drive or PC. To add a desktop icon on that PC, right-click **Z Note.exe** and choose **Show more options → Send to → Desktop (create shortcut)**. A desktop shortcut belongs to that PC; the portable ZIP uses the launcher itself.

## Budget & expenses

Open any notebook and click **New budget & expenses**, or choose **New → Budget & expenses**. This creates a separate page; existing notes and tasks stay as they are. Rename, move, duplicate or remove it through the usual page controls. Removed pages can be restored from Trash.

Choose a period, set its budget, and add expenses with a date, description, category, amount and optional notes. The page shows spending within that period, remaining budget (or overspending), and a category pie chart. New pages start in **Monthly** mode and use **SGD**. Changing the page currency changes the labels without converting existing values.

The **Category** dropdown suggests categories already used on active expense pages, across all dates, alongside the default choices. Start typing to find one, or enter a new category. Leaving it blank saves the expense as **Other**. Suggestions do not rename or merge existing expense categories.

Attach one or more **PDF, PNG, JPG or WebP** receipts or invoices to each expense, up to **10 MB per file**. Click a receipt name to download it. Receipts are saved with the notebook and included in backups and folder sync; they do not appear in the Snips gallery. Save or cancel any open expense editor before making a backup.

Use **Ctrl+Z** to undo saved budget changes, or **Ctrl+Y / Ctrl+Shift+Z** to redo. The same shortcuts work for task actions on lists and the main Tasks page, including completion, priorities and moves between lists. On Mac, use Command instead of Ctrl. While typing in a field, undo applies to that text. Page history lasts for the current open view and resets when you reopen it or sync replaces its data; it is not a substitute for backups.

**Use v2.6.1 on each PC for the new period controls and saved-category suggestions.** Budget pages and receipts require **v2.6.0 or later** before syncing or restoring a backup; earlier versions cannot read these pages, and their backup importer can omit them. Keep a backup when upgrading. Large receipt collections also make backups larger; if the Windows updater's recovery-backup limit is reached, it offers the manual update route.

## Folder saving and backups

Choose a folder when setting up so your notes are saved as files as well as in browser storage. If the browser asks for permission again later, use **Allow** to reconnect it.

The sidebar shows **Source folder** and the notebook location, wrapping a saved full path without truncating it. Click it to copy the location, locate the connected folder, sync now, or open an existing notebook. Browsers expose the folder name rather than its full Windows path. Paste the selected folder's full path from File Explorer into **Folder on this PC** and click **Save full path**; this display label stays in that browser and does not change where notes are saved.

**Style & data → Sync & backup** also keeps the connected notebook path visible above the sync controls. If its full path has not been saved yet, paste the selected folder's path into the inline field and click **Save full path**. It stays visible on subsequent visits, even while folder access is paused. Use **Copy path** to copy it, or **Edit path** after moving or renaming the folder. This is a saved display path, not a path the browser can discover or verify automatically.

**Copy sync instructions** copies the full notebook path and steps for another PC. When the saved path contains a OneDrive folder, the panel also shows its account name and the notebook's location inside it. Find that relative location under the same account on the other PC; drive letters and user folders may differ. Use **Open existing notebook** there and grant access to that folder. Sync the first PC and wait for the folder service before syncing the other PC. A saved path is local to its connected folder and is never applied automatically to a different PC or folder.

To open an existing notebook, use **Open existing notebook…** in setup, the Source folder dialog, or **Style & data → Sync & backup**. Select **Z Note notebook** itself or the folder containing it. Z Note loads its pages and pictures together. If files are incomplete or still downloading, it explains the problem and keeps the previous notebook connection. If this browser already contains your own notes, the app asks how to combine them with the folder's notebook.

Check **Source folder → Locate folder** on the original PC to confirm the actual folder in use. A different folder with the same name may contain an older notebook. Press **Sync**, wait for it to finish, then wait for OneDrive before opening that same notebook on another PC.

A folder in OneDrive or a shared network folder can carry changes between your computers:

1. Connect each PC to the same notebook using **Open existing notebook…**. Allow folder access in each browser.
2. Before switching PCs, press **Sync now** in Source folder or **Style & data → Sync & backup**. If using OneDrive or another sync service, wait for it to finish uploading.
3. On the other PC, wait for the files to finish downloading, then press **Sync now** in Z Note.

A one-time folder copy moves the notebook but does not carry later changes. Z Note does not provide its own cloud account or real-time collaboration. Work on one PC at a time; if the same page is edited on two PCs before syncing, the newer change wins.

You can choose browser storage instead. Those notes belong to that browser profile and are not automatically included when you copy the app folder. Clearing browser data can remove them. Download a backup from **Style & data → Sync & backup** and restore it on the other PC.

The local app and the previously hosted app use separate browser storage. To transfer notes from the hosted version, download a backup there and restore it in your local copy, or reconnect the same notebook folder.

## Updating

Click **Check for updates** in the sidebar, or open **Style & data → Updates**. The check contacts the public Z Note GitHub repository only when you request it. It compares your installed version with the latest stable release and shows whether an update is available. If you are offline or GitHub cannot be reached, retry later or open the official releases page.

**One-time update from v2.4.2 or earlier:** Z Note has moved to **Zwe-e-e/z-note** on GitHub. Already-installed older versions cannot install from the new address automatically. Use the [v2.5.0 update ZIP](https://github.com/Zwe-e-e/z-note/releases/download/v2.5.0/Z-Note-v2.5.0-Portable.zip) from the new release:

1. Save a backup from **Style & data → Sync & backup** and confirm the JSON file has finished saving.
2. Download the update ZIP, close all Z Note windows, and extract it into a separate temporary folder.
3. Copy the application files from its **Z Note** folder into your original **Z Note** app folder, replacing matching program files. Keep **Z Note notebook** and all backups. Do not delete the original folder.
4. Reopen through your existing shortcut or **Open Z Note.cmd**, using the same location and browser profile. Check that your notes and source-folder settings are present.

This migration ZIP keeps the existing launcher. For a new installation with the blue **Z Note.exe** icon and current features, use the full [v2.6.1 portable download](https://zwe-e-e.github.io/z-note/downloads/Z-Note-v2.6.1-With-Icon.zip). Use the [new download page](https://zwe-e-e.github.io/z-note/); the old GitHub Pages address does not redirect.

**From v2.5.0 onward**, open **Z Note.exe** or **Open Z Note.cmd** on Windows and use **Check for updates → Install update automatically** for later releases from the new repository. Close other Z Note windows and keep this window open while it works. Z Note saves a recovery backup, shows its path, verifies the download, updates application files in place, and reloads. Your notes, pictures, source-folder connection and display settings stay in place.

Automatic installation requires working browser storage and the Windows launcher. If the result cannot be confirmed, follow the instruction to close and reopen the launcher so recovery can finish. Keep the recovery backup until you have checked your notebook. The manual copy steps above also remain available when opening the HTML directly or when the launcher cannot connect.

In v2.6.1, if the files are already updated while an older app window is still open, use **Reload installed version** to save your notes and load those files. The update dialog also offers a safe return to notes or close/recovery action when an installation cannot continue.

Keeping the same app location and browser profile retains browser notes and folder settings. If you choose a new app location or another PC, use **Open existing notebook…** to reconnect **Z Note notebook** or its parent. For notes kept only in browser storage, restore the saved JSON backup through **Restore from a file… → Add to my notebook**. Browser storage and folder permissions do not travel with a copied application folder.

For the hosted web app, save a backup first, then refresh the page in the same browser profile to load website updates. Moving between the hosted app and the downloaded app uses separate browser storage, so reconnect your notebook folder or restore the backup. Checking for updates alone does not install anything or reload the app.

## Browser features

Use desktop Chrome or Edge for direct folder access. Other browsers can use browser storage and downloadable backups where supported. Screen capture and folder access require permission.

## Keep Awake

On Windows, open **Z Note.exe** (or **Open Z Note.cmd**), then click **Keep Awake** beside **Snip**. **Awake on** means Windows is keeping the display and computer awake even when Z Note is minimized or covered by another app. Click again to stop. Closing or reloading that Z Note window releases the request; each new session starts off. It does not override manual sleep, locking, lid-close actions or Windows policy.

Opening the HTML directly or using the hosted app provides browser-only mode: **Awake: visible**. That mode pauses when hidden. To get background support, download the current ZIP and reopen through the Windows launcher.

The launcher starts `app/native/ZNoteHost.exe`, a small helper whose source is in this repository. It opens the same local HTML file and talks only to that window over an authenticated connection on your own PC. It does not change power settings or move the mouse. If the helper disconnects, the button switches off; reopen using the launcher. The helper exits shortly after its Z Note windows close.

The app includes no analytics and does not upload notebook contents to GitHub. A manual update check retrieves public release information from GitHub; it does not send your notes, pictures, or source-folder path. GitHub Pages hosts the download page and the public application files.

## License and support

Z Note is free and open source under the [MIT License](LICENSE). You may use, modify and share it, including for commercial purposes, provided you keep the copyright and license notice. MIT also permits others to sell copies or include the code in other products.

Donations are optional support for development. They do not unlock features or change the license; all Z Note features are available without donating.

In the Donate dialog, choose **PayLah! · Singapore (SGD)** to scan the owner's QR or save its original image. Review the recipient and amount in PayLah before confirming. **PayPal · USD** keeps the $1, $3 and $5 choices. The app and download page share this dialog; payments are completed in the chosen service.

See [third-party components and credits](THIRD_PARTY_NOTICES.md) for the Mulberry32 algorithm, development tools and installed platform dependencies. The portable package includes the full MIT License and algorithm credit in `START HERE.txt`.

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
node --test tests/db-sync.test.cjs tests/store-sync.test.cjs
node --test tests/todo-priority.test.cjs tests/main-tasks.test.cjs tests/drag-columns.test.cjs
node --test tests/board-snap.test.cjs tests/board-snap-gesture.test.cjs
node --test tests/budget*.test.cjs
```

To build and test the Windows helper, then rebuild the portable ZIP in PowerShell:

```powershell
powershell -NoProfile -File scripts/build-native.ps1
powershell -NoProfile -File scripts/build-launcher.ps1
powershell -NoProfile -File tests/test-launcher.ps1
powershell -NoProfile -File tests/test-native.ps1
powershell -NoProfile -File tests/test-native-update.ps1
node --test tests/native-awake.test.cjs
powershell -NoProfile -File scripts/package-portable.ps1
powershell -NoProfile -File scripts/package-portable.ps1 -LegacyUpdater
powershell -NoProfile -File tests/test-package.ps1
```

The packaging script includes only the app, launcher and quick guide, and verifies the archive contents. Personal notebooks, exported backups and credentials must never be published. `.gitignore` excludes standard notebook and backup paths; only the curated portable ZIP is allowed.

For v2.6.1, build the full 38-file `downloads/Z-Note-Portable.zip`, then publish an identical versioned copy as `downloads/Z-Note-v2.6.1-With-Icon.zip` for the download page. `-LegacyUpdater` builds the 37-file `downloads/Z-Note-v2.6.1-Portable.zip` for existing automatic updaters; it preserves the installed launcher. Attach both versioned ZIPs and their `SHA256SUMS` file to the GitHub release. The helper includes the v2.6.1 update-recovery fix, and the full download includes a launcher with the current version. Keep the earlier v2.5.0 migration release available for installed v2.4.2 and older clients, which cannot automatically follow the repository-owner change.

GitHub Pages publishes the `main` branch, repository root. Rebuild the ZIP whenever application files change so the download matches the source.
