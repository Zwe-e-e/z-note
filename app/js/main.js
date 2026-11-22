/* Z Note · start-up */
(function () {
  'use strict';
  const ZN = window.ZN;

  function fatal(e) {
    console.error('[Z Note] could not start', e);
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '';
    view.appendChild(ZN.util.h('div.page-wrap', ZN.util.h('div.sheet.listing',
      ZN.util.h('h1', 'Z Note could not start'),
      ZN.util.h('p.sub', String((e && e.message) || e)),
      ZN.util.h('button.btn.primary', { type: 'button', onclick: () => location.reload() }, 'Try again'))));
  }

  async function boot() {
    await ZN.store.init();
    if (ZN.settings) ZN.settings.applyStyle();
    const first = !ZN.store.settings.seeded && ZN.store.pages.size === 0;
    if (first) ZN.templates.seed();
    if (ZN.awake) ZN.awake.init();
    ZN.shell.init();
    if (ZN.sync) await ZN.sync.init();
    if (ZN.sourceFolder) await ZN.sourceFolder.init();
    if (ZN.setup) await ZN.setup.init();
    if (ZN.store.memoryOnly) {
      ZN.ui.toast('This browser is blocking storage, so nothing will be saved. Open Z Note in a normal (not private) window.', { error: true, ms: 12000 });
    }
  }

  window.addEventListener('error', e => console.error('[Z Note]', e.message, e.filename + ':' + e.lineno));
  boot().catch(fatal);
})();
