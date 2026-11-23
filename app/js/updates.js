/* Z Note · explicit release checks and notebook-preserving app updates */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h;
  const REPO = 'https://github.com/ZweWH/z-note';
  const API = 'https://api.github.com/repos/ZweWH/z-note/releases/latest';
  const LATEST = REPO + '/releases/latest';
  let pending = null;
  let installing = false;

  function parts(value) {
    if (typeof value !== 'string' || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
    const p = value.replace(/^v/, '').split('.').map(Number);
    return p.every(Number.isSafeInteger) ? p : null;
  }
  function compareVersions(a, b) {
    const x = parts(a), y = parts(b);
    if (!x || !y) throw new Error('The version number could not be read.');
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
  }
  function parseRelease(data) {
    if (!data || data.draft !== false || data.prerelease !== false || !parts(data.tag_name)) {
      throw new Error('GitHub did not return a valid stable release.');
    }
    const version = data.tag_name.replace(/^v/, '');
    const releaseURL = REPO + '/releases/tag/' + data.tag_name;
    const names = ['Z-Note-v' + version + '-Portable.zip', 'Z-Note-Portable.zip'];
    const assets = Array.isArray(data.assets) ? data.assets : [];
    // Only the expected portable package on this repository can become a link.
    // Never render release Markdown/HTML or execute a downloaded file.
    const asset = assets.find(a => a && names.includes(a.name) && a.state === 'uploaded' &&
      Number.isSafeInteger(a.size) && a.size > 0 &&
      a.browser_download_url === REPO + '/releases/download/' + data.tag_name + '/' + a.name);
    return { version, releaseURL, downloadURL: asset ? asset.browser_download_url : null };
  }
  function checkLatest() {
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(API, {
          method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
          referrerPolicy: 'no-referrer', signal: controller.signal,
          headers: { Accept: 'application/vnd.github+json' }
        });
        if (response.status === 403 || response.status === 429) {
          throw new Error('GitHub is limiting update checks. Try again later or open the releases page.');
        }
        if (response.status === 404) throw new Error('No published release was found. Try again later.');
        if (!response.ok) throw new Error('GitHub could not check for updates. Try again later.');
        return parseRelease(await response.json());
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('The update check timed out. Check your connection and try again.');
        if (e instanceof TypeError) throw new Error('Could not connect to GitHub. Check your internet connection and try again.');
        throw e;
      } finally { clearTimeout(timer); }
    })().finally(() => { pending = null; });
    return pending;
  }

  const link = (label, href, primary) => h('a.btn' + (primary ? '.primary' : '.quiet'), {
    href, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer'
  }, label);

  async function installAutomatically(release) {
    if (installing) return;
    installing = true;
    const S = ZN.store, native = ZN.updateNative;
    const frozen = Array.from(document.querySelectorAll('#app, .modal')).map(el => ({ el, inert: el.inert }));
    frozen.forEach(item => { item.el.inert = true; });
    const status = h('p.update-status', { role: 'status', 'aria-live': 'polite' }, 'Preparing your notebook…');
    const backup = h('p.set-note');
    const actions = h('div.set-actions');
    const modal = ZN.ui.modal({ title: 'Installing v' + release.version, width: 600, dismissable: false,
      body: [h('p.set-note', 'Z Note will save a recovery backup, verify the download, and update the app in its current location. Keep this window open until it finishes.'), status, backup, actions] });
    const beforeUnload = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    // Inert elements do not stop document-level editor shortcuts.
    const blockEditing = e => {
      if (e.type !== 'keydown' && e.type !== 'hashchange') e.preventDefault();
      e.stopImmediatePropagation();
    };
    const editEvents = ['keydown', 'cut', 'paste', 'drop', 'hashchange'];
    editEvents.forEach(type => window.addEventListener(type, blockEditing, true));
    const unlockEvents = () => editEvents.forEach(type => window.removeEventListener(type, blockEditing, true));
    let paused = false, installed = false, readyToReload = false, uncertain = false;
    try {
      if (!native || !native.available) throw new Error('Open Z Note with Z Note.exe (or Open Z Note.cmd) to install automatically.');
      if (S.memoryOnly) throw new Error('This is a temporary session. Download a backup and reopen Z Note with browser storage enabled before updating.');
      if (await S.otherWindowsOpen()) throw new Error('Close the other Z Note windows, then try again. This window and its notes can stay open.');
      await native.connect();
      if (ZN.sync && ZN.sync.pause) { await ZN.sync.pause(); paused = true; }
      const view = ZN.shell && ZN.shell.view();
      if (view && view.prepareExport) await view.prepareExport();
      await S.checkpoint();
      const data = await ZN.settings.exportAll();
      const result = await native.install(data, release.version, progress => {
        status.textContent = progress.message || (progress.stage === 'backup-saved' ? 'Backup saved. Preparing the update…' : 'Saving your recovery backup…');
        if (progress.backupPath) backup.textContent = 'Recovery backup: ' + progress.backupPath;
      });
      installed = true;
      // Complete any image/import work that was already running when editing
      // was frozen. Never reload over a failed final notebook save.
      await S.checkpoint();
      readyToReload = true;
      status.textContent = 'Installed v' + result.version + '. Reopening your notebook…';
      if (result.backupPath) backup.textContent = 'Recovery backup: ' + result.backupPath;
      // The helper never changes the HTML path, browser profile or IndexedDB.
      // Reload only after the native transaction has confirmed completion.
      window.removeEventListener('beforeunload', beforeUnload);
      unlockEvents();
      actions.append(h('button.btn.primary', { type: 'button', onclick: () => window.location.reload() }, 'Reload Z Note'));
      window.location.reload();
    } catch (e) {
      uncertain = !!(e && (e.uncertain || e.reopenRequired));
      status.textContent = installed ? (readyToReload ? 'The update is installed. Click Reload Z Note to reopen your notebook.' :
        'The app update is installed, but your latest notes could not be saved: ' + ((e && e.message) || 'Please try saving again.') + ' Keep this window open until your notes are saved.') :
        (uncertain ? 'The update result could not be confirmed: ' : 'Update did not finish: ') + ((e && e.message) || 'Please try again.');
      const state = native && native.state ? native.state() : {};
      if (state.backupPath) backup.textContent = 'Your recovery backup is saved at: ' + state.backupPath;
      if (uncertain) actions.append(h('p.set-note', 'Editing and folder sync are paused to protect your notes. Close this window and reopen Z Note.exe (or Open Z Note.cmd) so the launcher can finish recovery. Do not copy or replace app files while it is working.'));
      else if (!readyToReload) actions.append(h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Back to my notes'));
    } finally {
      if (!readyToReload && !uncertain) {
        window.removeEventListener('beforeunload', beforeUnload);
        unlockEvents();
        frozen.forEach(item => { item.el.inert = item.inert; });
        if (paused && ZN.sync.resume) ZN.sync.resume();
        installing = false;
      }
    }
  }

  function pane(checkNow) {
    let release = null, checking = false, backupStarted = false, saving = false;
    const status = h('p.update-status', { role: 'status', 'aria-live': 'polite' }, 'Check when you want to look for a new release.');
    const details = h('div.update-details');
    const downloadArea = h('div.set-actions');
    const backupStatus = h('p.set-note', { role: 'status', 'aria-live': 'polite' });
    const automaticStatus = h('p.set-note', { role: 'status', 'aria-live': 'polite' });
    const automaticButton = h('button.btn.primary', { type: 'button', disabled: true, onclick: () => {
      if (release && !automaticButton.disabled) return installAutomatically(release);
    } }, 'Install update automatically');
    const automatic = h('div.set-group', { hidden: true }, h('h3', 'Automatic update'),
      h('p.set-note', 'A recovery backup is saved automatically. Your notes, source-folder connection and app location are kept. Close other Z Note windows before installing.'),
      automaticStatus, h('div.set-actions', automaticButton));
    const confirmed = h('input', { type: 'checkbox', disabled: true });
    const confirmLabel = h('label.update-confirm', confirmed, h('span', 'I have saved the backup file and can find it on my PC.'));
    const save = h('button.btn', { type: 'button', onclick: saveBackup }, ZN.icon('download', 15), 'Download a backup first');
    const steps = h('ol.update-steps',
      h('li', 'Save your backup, then download the update ZIP below. Keep the backup until you have checked your notes in the updated app.'),
      h('li', 'Close every Z Note window. Extract the ZIP into a separate temporary folder, then copy its app files into your original Z Note folder. Keep your existing “Z Note notebook” folder and backup files.'),
      h('li', 'Reopen the app from the same location with the same browser profile. If your notes are missing, reconnect the folder containing “Z Note notebook”, or use Style & data → Sync & backup → Restore from a file → Add to my notebook.'));
    const guide = h('div.set-group.update-guide', { hidden: true }, h('h3', 'Update without losing your notes'),
      h('p.set-note', 'Z Note downloads the new app; it cannot replace files on your PC. Your notebook and backup stay separate from the update.'),
      steps, h('div.set-actions', save), backupStatus, confirmLabel, downloadArea,
      h('p.set-note', 'Using the website? After saving a backup, refresh the same page in the same browser profile. The downloaded app has separate browser storage; reconnect your notebook folder or restore the backup when switching.'));
    const check = h('button.btn', { type: 'button', onclick: runCheck }, ZN.icon('download', 15), 'Check for updates');

    function renderDownload() {
      U.clear(downloadArea);
      if (release && release.downloadURL && backupStarted && confirmed.checked && !saving) {
        downloadArea.append(link('Download v' + release.version + ' ZIP', release.downloadURL, true));
      } else {
        downloadArea.append(h('button.btn.primary', { type: 'button', disabled: true }, 'Download update ZIP'));
      }
    }
    confirmed.addEventListener('change', renderDownload);
    async function saveBackup() {
      if (saving) return;
      saving = true; backupStarted = false;
      confirmed.checked = false; confirmed.disabled = true; save.disabled = true;
      backupStatus.textContent = 'Preparing all pages and pictures…';
      renderDownload();
      try {
        const filename = await ZN.settings.download();
        backupStarted = true;
        confirmed.disabled = false;
        backupStatus.textContent = 'Download started: ' + filename + '. Wait for it to finish, then confirm below. If your browser blocked it, allow the download and try again.';
      } catch (e) {
        backupStatus.textContent = 'Backup failed: ' + ((e && e.message) || 'Please try again.') + ' Keep this app open and try again before updating.';
      } finally { saving = false; save.disabled = false; renderDownload(); }
    }
    async function runCheck() {
      if (checking) return;
      checking = true; check.disabled = true;
      automatic.hidden = true; automaticButton.disabled = true;
      backupStarted = false; confirmed.checked = false; confirmed.disabled = true;
      release = null; guide.hidden = true; U.clear(details);
      status.textContent = 'Checking GitHub for the latest release…';
      try {
        const found = await checkLatest();
        const order = compareVersions(found.version, ZN.version);
        release = found;
        if (order > 0) {
          status.textContent = 'Update available: v' + found.version + '. You are using v' + ZN.version + '.';
          guide.hidden = !found.downloadURL;
          if (!found.downloadURL) details.append(h('p.set-note', 'The portable download is not ready yet. Please check again later.'));
          if (found.downloadURL && ZN.updateNative && ZN.updateNative.available) {
            automatic.hidden = false;
            automaticStatus.textContent = 'Connecting to the Windows launcher…';
            try {
              const capability = await ZN.updateNative.connect();
              if (!capability.supported) throw new Error('The current launcher does not support automatic updates.');
              if (ZN.store.memoryOnly) throw new Error('Automatic updates need browser storage. Save a backup before leaving this temporary session.');
              if (capability.installAttempted) throw new Error('An installation has already been attempted. Close this window and reopen Z Note.exe (or Open Z Note.cmd) before checking again.');
              automaticButton.disabled = false;
              guide.hidden = true;
              automaticStatus.textContent = 'Ready to save your backup and install v' + found.version + '.';
            } catch (e) {
              automaticStatus.textContent = ((e && e.message) || 'The Windows launcher could not connect.') + ' You can use the backup and ZIP steps below.';
            }
          }
        } else if (order === 0) {
          status.textContent = 'You’re up to date — v' + ZN.version + ' is the latest release.';
        } else {
          status.textContent = 'You are using v' + ZN.version + ', ahead of the latest published release (v' + found.version + '). No update is needed.';
        }
        details.append(link('View release notes', found.releaseURL));
        renderDownload();
      } catch (e) {
        status.textContent = (e && e.message) || 'Could not check for updates. Please try again.';
        details.append(h('p.set-note', 'Your notes have not been changed. You can keep using Z Note offline.'));
      } finally { checking = false; check.disabled = false; }
    }
    const body = h('div.settings.updates',
      h('p.set-note', h('b', 'Installed version: v' + ZN.version)),
      h('p.set-note', 'Checks the public Z Note release on GitHub only when you press the button. Your notes, pictures and folder path are not sent.'),
      h('div.set-actions', check, link('Open releases page', LATEST)), status, details, automatic, guide,
      h('p.set-note', 'For automatic installation on Windows, open Z Note using Z Note.exe (or Open Z Note.cmd). A copy opened directly in a browser uses the backup and ZIP steps.'));
    if (checkNow) runCheck();
    return body;
  }
  function open() { ZN.settings.open('updates', true); }
  ZN.updates = { compareVersions, parseRelease, checkLatest, pane, open, installAutomatically };
})();
