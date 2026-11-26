# Z Note release history

## v2.6.3 — 2026-11-26

- Resolve the portable app beside the actual running **Z Note.exe**, independently of a shortcut's working directory.
- Show specific missing-page, missing-helper and access errors, including the full application, page and Windows-helper paths. Detect files occupying required folder paths instead of treating them as a missing helper.
- If the page exists and only the helper is genuinely missing, explain that background Keep Awake and automatic installation are unavailable, then open the same local page in browser mode. Preserve the normal helper route when it is present; access, invalid-file and helper startup errors do not trigger this fallback.
- Include the updated icon launcher in both the full portable download and automatic-update package. Existing v2.5.0 and later helpers can install the complete package, including **Z Note.exe**. Keep notes, browser storage, notebook files and this PC's source-folder metadata unchanged.

The reported launcher failure on another PC could not be reproduced. This release improves path resolution and diagnostics; it does not claim to resolve every Windows permission or extraction problem. If the icon still cannot open, try **Open Z Note.cmd** from the same app folder and retain the exact error and full paths.

## v2.6.2 — 2026-11-26

- Let failed automatic updates return to notes when the Windows helper confirms that application files were unchanged or successfully rolled back. Keep recovery protection and a close action when the result is uncertain.
- Copy updater recovery files durably without inheriting read-only attributes. Detect read-only application files before installation, show an actionable error, and preserve the original app and recovery backup.
- Validate complete, unique recovery records and all original backup files before restoring application files. Keep editing protected if recovery cannot be verified, and avoid rewriting files already restored to their verified original contents.
- Offer **Locate notebook on this PC…** directly from the folder-permission banner, so a notebook can be reconnected when its local OneDrive path differs.
- Make Ctrl/Command + mouse-wheel zoom on boards finer, with about 5% per wheel step instead of 18%. Reduce trackpad sensitivity, limit large wheel jumps, and allow smooth zoom through 100%.

An already-open older app window cannot gain these fixes until it loads the updated files. If its update dialog is stuck after an error, close with the Windows title-bar X or Alt+F4, then reopen the same launcher once for recovery. Preserve the automatic backup; see the README update guide before opening a separate new copy.

## v2.6.1 — 2026-11-26

- Offer categories already used on active expense pages in the Category dropdown, including expenses outside the selected period. Keep custom category entry and existing expense labels unchanged.
- Add **Weekly**, **Monthly**, **Yearly**, and **Project** periods to Budget & expenses. Weeks run Monday–Sunday; projects use saved start and end dates, both included. Totals, category pie charts, and expense lists use the selected period.
- Keep separate budgets for each week, year, and project date range while preserving existing monthly budgets, expenses, and receipts. Remember the page's period mode and project dates, include them in sync and backups, and support Undo/Redo for period and budget changes.
- Detect when a browser window is still running an older version than the files on disk. Offer a saved reload instead of trying to install the same release again.
- Let the Windows helper acknowledge an already-installed version safely, including for older app windows, after validating the recovery backup and completing any pending recovery.
- Recover from the older helper's “already current” response with **Reload installed version** or **Back to my notes**. Keep a **Close Z Note** action available for genuinely unconfirmed updates, with a final save before closing and guidance if the browser requires its window-close button.
- Keep editing and sync protected when a final save fails, and provide **Retry save and reload**.
- Wrap long recovery-backup paths inside the update dialog.
- Show the full saved source-folder path without truncating it in the sidebar, and use the same **Folder on this PC** panel in Source folder and Sync & backup. Add **Copy sync instructions**, including a location inside OneDrive when recognizable, to help find the same notebook on another PC. Refresh the sidebar as soon as its folder connection is restored.

Use v2.6.1 on each PC for the new period controls and category suggestions. v2.6.0 retains the added period settings but displays monthly reports only. Existing expenses, receipt files and monthly budgets are preserved.

## v2.6.0 — 2026-11-25

- Add an optional **Budget & expenses** page inside any notebook. Create, move, duplicate, trash and restore it like other pages.
- Track expenses by date, description, category and amount, with notes and a separate budget for each month. Show monthly spending, remaining funds and a category pie chart. New pages use SGD; currency can be changed per page without converting amounts.
- Attach multiple PDF, PNG, JPG or WebP receipts and invoices to each expense, up to 10 MB per file. Include receipt files in backups and notebook folder sync.
- Preserve an open expense draft when another PC sends a newer page through Sync. Prevent stale saves from overwriting it and keep receipt saves together with their expense references.
- Validate complete backups and incoming receipts before restoring, and preserve shared receipts when duplicate pages still use them.
- Add **Ctrl+Z** undo and **Ctrl+Y / Ctrl+Shift+Z** redo for saved budget changes and task actions, including priority changes and moves between lists. Keep native text undo while typing. History belongs to the current open page and is cleared when it is reopened or replaced by sync.
- Keep the connected notebook folder path visible directly in **Sync & backup**, including when syncing is paused. Add **Copy path** and an inline full-path field that remembers the selected folder's display path on this PC.
- Add the owner's PayLah QR to **Donate** as a Singapore-dollar option alongside PayPal USD donations, with an original-image download. The same dialog is used by the app and download page.

Update every PC to v2.6.0 or later before sharing notebooks with budget pages or restoring their backups. Earlier versions do not understand this page type; older backup restore can omit budget pages and receipt files. The Windows helper and existing note/task data are unchanged.

## v2.5.1 — 2026-11-23

- Add the MIT license and third-party credits. Include the full license in the portable quick guide while preserving compatibility with existing automatic updaters.
- Add **Donate** below **Check for updates** and on the download page, with optional $1, $3 and $5 USD contributions through PayPal. All features remain free; notes and source-folder settings are unchanged.

The notebook format and Windows helper are unchanged. Existing v2.5.0 installations can install this release through **Check for updates → Install update automatically** when opened with the Windows launcher.

## v2.5.0 — 2026-11-23

- Open the portable folder with **Z Note.exe**, which has the Z icon and works after moving the whole folder to another PC. It starts the existing Windows helper for background Keep Awake and automatic updates without a command window.
- Snap dragged board sticky notes to nearby notes' edges or centres, with temporary alignment guides. Hold Ctrl (Command on Mac) to move freely; selected groups keep their spacing, and each drag remains one undo step.
- Switch between **1 column** and **3 columns** on individual to-do lists and the main Tasks page. Start with the existing single-column view and remember the user's choice.
- Show tasks from every list and note together on the main Tasks page, grouped into **A · High**, **B · Medium**, and **C · Low**, with their source shown on each card.
- Drag tasks between priorities, or use the priority selector. Changes on the main Tasks page update the original task while keeping it in its source list. Individual lists also support reordering.
- Leave existing tasks unchanged until the user edits them. Switching views does not change task content, order, dates or stored priorities; existing flags appear as High and unassigned tasks appear as Medium in the three-column view.
- Add tasks directly to a chosen priority; keep completed tasks together below the columns.
- Move the public repository to **Zwe-e-e/z-note** and the download page to **zwe-e-e.github.io/z-note**. Installed v2.4.2 and earlier versions need one manual update from the new release; v2.5.0 uses the new repository for future automatic updates.

The notebook format and source-folder settings remain compatible. Existing task content and stored priorities are preserved until the user changes them. To migrate an older installation, back up first, close Z Note and copy the update ZIP's application files into the existing app folder, replacing program files while keeping the notebook folder and backups. Do not delete the original folder. The update ZIP keeps the existing launcher; the full portable download includes the new Z-icon launcher.

## v2.4.2 — 2026-11-23

- Load an existing notebook's pages and pictures together before showing them. If a file is missing, still downloading, or cannot be saved, keep the previous notebook and folder connection available and explain the problem.
- Refresh visible pictures when changes arrive through Sync, including pictures that previously appeared missing.
- Save updated photo bytes even when the edited picture has the same file size. Recheck pictures when a cloud service delivers the image file after its metadata.
- Preserve local edits made while a folder is opening. Opening an existing notebook reads it first, then schedules normal two-way sync after the import succeeds.

The notebook format, Windows helper and source-folder settings remain compatible. To use the same notes on another PC, connect both PCs to the same notebook folder and let OneDrive finish transferring its files.

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
