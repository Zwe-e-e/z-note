/* Z Note · choose where the notebook lives on this browser's first visit */
(function () {
  'use strict';
  const ZN = window.ZN, h = ZN.util.h, S = ZN.store, db = ZN.db, ui = ZN.ui;
  const VERSION = 1;
  let dialog = null, completed = false;

  async function remember(mode) {
    // Keep this browser's choice out of exported notebook settings. A restored
    // backup on a different browser still needs its own folder permission.
    if (!S.memoryOnly) await db.put('meta', { version: VERSION, mode }, 'setup');
    completed = true;
  }

  function open() {
    if (dialog) { dialog.el.querySelector('button').focus(); return dialog; }
    const canUseFolder = !!(ZN.sync && ZN.sync.supported && !S.memoryOnly);
    const status = h('p.setup-status', { role: 'status', 'aria-live': 'polite' });
    const controls = h('div.setup-actions');
    let busy = false;
    const app = document.getElementById('app');
    const wasInert = app ? app.inert : false;
    if (app) app.inert = true;

    function setBusy(value) {
      busy = value;
      controls.querySelectorAll('button').forEach(b => { b.disabled = value; });
      if (dialog) dialog.el.setAttribute('aria-busy', String(value));
    }

    async function chooseFolder() {
      if (busy) return;
      setBusy(true);
      status.textContent = 'Choose a folder in the browser’s folder picker…';
      try {
        // Call immediately from this click, before awaiting any other work.
        const ok = await ZN.sync.link();
        if (!ok) {
          status.textContent = ZN.sync.state === 'error'
            ? 'The folder was selected, but the first save did not finish. Check the folder and try again.'
            : ZN.sync.state === 'locked'
              ? 'Folder access was not allowed. Try again and allow Z Note to save files.'
              : 'Setup was not completed. Choose a folder again, or use browser storage.';
          return;
        }
        // A successful attach already persists its folder handle. If this
        // secondary preference cannot be saved, the handle still skips setup.
        try { await remember('folder'); } catch (e) { console.warn('[Z Note] setup preference', e); }
        dialog.close();
        ui.toast('Your source folder is ready. Z Note will keep your notebook in “' + ZN.sync.dir.name + '” / Z Note notebook.');
      } catch (e) {
        status.textContent = e && e.name === 'AbortError'
          ? 'No folder selected. You can try again or use browser storage.'
          : 'Could not connect the folder: ' + ((e && e.message) || String(e));
      } finally {
        setBusy(false);
      }
    }

    async function browserOnly() {
      if (busy) return;
      setBusy(true);
      try {
        // An interrupted first sync can have saved a handle. An explicit
        // browser-only choice must also stop that pending folder connection.
        if (ZN.sync && ZN.sync.dir) await ZN.sync.unlink();
        await remember('browser');
        dialog.close();
        ui.toast(S.memoryOnly
          ? 'Temporary session only. Download a backup before closing Z Note.'
          : 'Using this browser’s storage. You can connect a folder in Style & data → Sync & backup.');
      } catch (e) {
        status.textContent = 'Could not save this choice. Check browser storage permissions and try again.';
      } finally {
        setBusy(false);
      }
    }

    if (canUseFolder) controls.append(h('button.btn.primary', {
      type: 'button', autofocus: true, onclick: chooseFolder
    }, ZN.icon('folder', 17), 'Choose source folder'));
    controls.append(h('button.btn' + (canUseFolder ? '.quiet' : '.primary'), {
      type: 'button', autofocus: !canUseFolder, onclick: browserOnly
    }, S.memoryOnly ? 'Continue for this session' : 'Use browser storage'));

    dialog = ui.modal({
      title: 'Set up Z Note', width: 560, className: 'setup-dialog', dismissable: false,
      body: [
        h('p.modal-text.setup-intro', 'A home for your notes, ideas and plans.'),
        canUseFolder ? h('div.setup-folder',
          h('div.setup-folder-title', ZN.icon('folder', 24), h('strong', 'Z Note notebook')),
          h('p', 'Choose a location on your device. Z Note creates this source folder inside it and saves your pages and pictures there.'),
          h('p', 'Already have a Z Note notebook? Choose the folder that contains it to reconnect.')) : null,
        S.memoryOnly
          ? h('p.modal-text', 'This browser is blocking saved storage. Open Z Note in a normal browser window to set up a source folder. If you continue here, download a backup before closing: this session’s notes will not be kept.')
          : canUseFolder
            ? h('p.modal-text', 'Your notebook stays in this browser and the folder you choose. A folder inside OneDrive or another desktop sync service can also keep your devices in sync.')
            : h('p.modal-text', 'This browser cannot save directly to a folder. You can use browser storage and download backup files, or open Z Note in desktop Chrome or Edge to choose a source folder.'),
        !S.memoryOnly ? h('p.setup-hint', 'Browser storage belongs to this browser on this device. Clearing site data removes it, so keep a folder copy or download backups in Style & data → Sync & backup.') : null,
        status, controls,
        h('p.setup-later', 'You can manage your source folder later in Style & data → Sync & backup.')
      ],
      onClose: () => {
        if (app) app.inert = wasInert;
        document.removeEventListener('keydown', trapFocus, true);
        dialog = null;
      }
    });
    dialog.el.setAttribute('aria-labelledby', 'zn-setup-title');
    dialog.el.querySelector('.modal-title').id = 'zn-setup-title';

    function trapFocus(e) {
      if (e.key !== 'Tab' || !dialog) return;
      // Folder adoption can open another modal; let that dialog own focus.
      const modals = document.querySelectorAll('.modal');
      if (modals[modals.length - 1] !== dialog.el) return;
      const buttons = Array.from(dialog.el.querySelectorAll('button:not(:disabled)'));
      if (!buttons.length) { e.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', trapFocus, true);
    return dialog;
  }

  async function init() {
    if (completed || (ZN.sync && ZN.sync.dir)) return;
    if (!S.memoryOnly) {
      try {
        const saved = await db.get('meta', 'setup');
        if (saved && saved.version >= VERSION) { completed = true; return; }
      } catch (e) { console.warn('[Z Note] setup preference', e); }
    }
    open();
  }

  ZN.setup = { init, open };
})();
