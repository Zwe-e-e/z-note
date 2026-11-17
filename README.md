# Z Note

A browser notebook for notes, to-do lists, visual boards and screen snips.

**[Open Z Note](https://zwewh.github.io/z-note/)**

## First-time setup

1. Open Z Note in a desktop browser. Chrome or Edge supports choosing a local folder.
2. In the welcome dialog, choose a **source folder** on your computer. Z Note creates a **Z Note notebook** subfolder there, containing your pages and images.
3. To open a notebook you already use, select the parent folder that contains **Z Note notebook**. Z Note loads that notebook and keeps it in sync.

You can also choose browser storage. Your notes then stay in that browser profile; clearing site data can remove them. Use **Style & data → Sync & backup** to choose a folder later or download a backup.

Your browser may ask you to allow access to your folder again when you return. A folder in OneDrive or another desktop sync service can carry the files between your own computers. Z Note itself does not provide cloud accounts or real-time collaboration; if the same page is edited on two computers before syncing, the newer change wins.

## Features

- Notebooks, rich-text notes, favourites and search
- Tasks with due dates and visual boards
- Screen snips and pasted images
- Paper, ink and typography themes
- Local folder sync and downloadable backups
- **Keep Awake** beside Snip: keeps the screen on while the app is visible, pauses when hidden, and starts off after reopening

## Your data

The public repository contains application code and generic starter examples. Visitors have their own notebooks in browser storage and, when selected, their own local folders. Z Note does not upload notebook contents to GitHub or an application server.

The website and a downloaded local copy use separate browser storage. To move your existing notes to the website, choose the same notebook folder or restore a backup from **Style & data → Sync & backup**. Do not clear your original browser data until you have checked the new copy.

GitHub serves the website and may process ordinary request information. The application includes no analytics or external service integrations. Folder access and screen capture depend on browser support and permission. Keep Awake can be refused or stopped by browser or battery-saving settings.

## Run a local copy

Download the repository ZIP and extract it. Open **Z Note.html**, or run **Open Z Note.cmd** on Windows to open a dedicated Chrome/Edge window. Keep the `app` folder beside the HTML file.

The hosted version needs an internet connection to load. For offline use, keep a downloaded copy. A local folder holds notebook data; it does not download the app for offline use.

## Development and publication

This is a static HTML/CSS/JavaScript app with no build dependency. `Z Note.html` is the application entry point; `index.html` redirects to it for GitHub Pages. Hash routes work on static hosting.

Run the dependency-free lifecycle checks with Node.js:

```sh
node --test tests/awake.test.cjs
node --test tests/setup.test.cjs
```

Browser tests in `tests/` require Playwright and a local Chrome installation. They use separate test browser storage.

GitHub Pages publishes from the `main` branch, repository root. `.nojekyll` keeps this a plain static site. Do not commit personal notebook folders, exported backups, credentials or browser profiles. The `.gitignore` excludes the standard notebook and backup paths.
