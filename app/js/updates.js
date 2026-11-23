/* Z Note · explicit release checks and a backup-first portable update guide */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h;
  const REPO = 'https://github.com/ZweWH/z-note';
  const API = 'https://api.github.com/repos/ZweWH/z-note/releases/latest';
  const LATEST = REPO + '/releases/latest';
  let pending = null;

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

  function pane(checkNow) {
    let release = null, checking = false, backupStarted = false, saving = false;
    const status = h('p.update-status', { role: 'status', 'aria-live': 'polite' }, 'Check when you want to look for a new release.');
    const details = h('div.update-details');
    const downloadArea = h('div.set-actions');
    const backupStatus = h('p.set-note', { role: 'status', 'aria-live': 'polite' });
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
      h('div.set-actions', check, link('Open releases page', LATEST)), status, details, guide);
    if (checkNow) runCheck();
    return body;
  }
  function open() { ZN.settings.open('updates', true); }
  ZN.updates = { compareVersions, parseRelease, checkLatest, pane, open };
})();
