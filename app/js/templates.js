/* Z Note · starter notebook and page templates */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h;

  /* ---------- tiny builders ---------- */
  const B = (t, html, extra) => Object.assign({ id: U.uid(), t, html: html || '' }, extra || {});
  const T = (text, extra) => Object.assign({ id: U.uid(), text, done: false, due: null, pri: 0, created: Date.now(), doneAt: 0 }, extra || {});
  const day = n => U.ymd(U.addDays(new Date(), n));
  const today = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  /* board items — see board.js for the model */
  const sticky = (x, y, text, color, w, hgt) => ({ id: U.uid(), kind: 'sticky', x, y, w: w || 170, h: hgt || 170, text, color: color || 'yellow' });
  const label = (x, y, text, size, w) => ({ id: U.uid(), kind: 'text', x, y, w: w || 320, h: 40, text, size: size || 'l' });
  const frame = (x, y, w, hgt, title) => ({ id: U.uid(), kind: 'frame', x, y, w, h: hgt, title });
  const shape = (x, y, w, hgt, text, kind, fill) => ({ id: U.uid(), kind: 'shape', shape: kind || 'round', x, y, w, h: hgt, text, fill: fill || 'none', stroke: 'ink' });
  const link = (a, b, arrow) => ({ id: U.uid(), kind: 'line', a: { id: a.id }, b: { id: b.id }, arrow: arrow || 'end', x: 0, y: 0, w: 0, h: 0 });

  /* ---------- templates ---------- */
  const TEMPLATES = [
    {
      id: 'meeting', name: 'Meeting notes', icon: 'briefcase', type: 'note', about: 'Attendees, discussion and action items',
      build: () => ({
        title: 'Meeting — ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), icon: 'i:briefcase',
        content: { blocks: [
          B('callout', '<b>When:</b> ' + U.esc(today()) + ' &nbsp;·&nbsp; <b>Where:</b> '),
          B('h2', 'Attendees'), B('ul', ''),
          B('h2', 'Agenda'), B('ol', ''),
          B('h2', 'Discussion'), B('p', ''),
          B('h2', 'Decisions'), B('ul', ''),
          B('h2', 'Action items'), B('todo', '', { checked: false })
        ] }
      })
    },
    {
      id: 'project', name: 'Project plan', icon: 'target', type: 'note', about: 'Goal, scope, milestones and risks',
      build: () => ({
        title: 'Project plan', icon: 'i:target',
        content: { blocks: [
          B('h2', 'Goal'), B('p', ''),
          B('h2', 'Scope'), B('ul', '<b>In:</b> '), B('ul', '<b>Out:</b> '),
          B('h2', 'Milestones'), B('todo', 'Kick-off', { checked: false }), B('todo', 'First draft', { checked: false }), B('todo', 'Review', { checked: false }), B('todo', 'Hand-over', { checked: false }),
          B('h2', 'People'), B('ul', ''),
          B('h2', 'Risks & open questions'), B('ul', ''),
          B('h2', 'Links & references'), B('p', '')
        ] }
      })
    },
    {
      id: 'week', name: 'Weekly plan', icon: 'calendar', type: 'todo', about: 'A to-do list with this week’s dates filled in',
      build: () => ({
        title: 'Week of ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), icon: 'i:calendar',
        content: { tasks: [
          T('Top priority for this week', { pri: 1, due: day(0) }),
          T('Plan the week', { due: day(0) }),
          T('Mid-week check-in', { due: day(3) }),
          T('Weekly review — what went well, what to change', { due: day(6) })
        ] }
      })
    },
    {
      id: 'journal', name: 'Daily journal', icon: 'sun', type: 'note', about: 'Three short prompts for the day',
      build: () => ({
        title: today(), icon: 'i:sun',
        content: { blocks: [
          B('h3', 'Today I want to'), B('todo', '', { checked: false }),
          B('h3', 'On my mind'), B('p', ''),
          B('h3', 'Grateful for'), B('ul', ''),
          B('h3', 'Tomorrow'), B('p', '')
        ] }
      })
    },
    {
      id: 'study', name: 'Study notes', icon: 'cap', type: 'note', about: 'Cues, notes and a summary (Cornell style)',
      build: () => ({
        title: 'Study notes', icon: 'i:cap',
        content: { blocks: [
          B('callout', '<b>Topic:</b> &nbsp;·&nbsp; <b>Source:</b> '),
          B('h2', 'Key questions'), B('ul', ''),
          B('h2', 'Notes'), B('p', ''),
          B('quote', 'Tip: snip a diagram with Alt + S and it lands right here.'),
          B('h2', 'Summary in my own words'), B('p', '')
        ] }
      })
    },
    {
      id: 'reference', name: 'Reference clipping', icon: 'pin', type: 'note', about: 'A snip, where it came from, and why it matters',
      build: () => ({
        title: 'Reference', icon: 'i:pin',
        content: { blocks: [
          B('callout', '<b>Source:</b> &nbsp;·&nbsp; <b>Saved:</b> ' + U.esc(today())),
          B('h3', 'The clipping'), B('p', ''),
          B('h3', 'Why I kept it'), B('p', ''),
          B('h3', 'Where I can use it'), B('ul', '')
        ] }
      })
    },
    {
      id: 'brainstorm', name: 'Brainstorm', icon: 'bulb', type: 'board', about: 'A question in the middle, stickies around it',
      build: () => {
        const q = shape(-150, -60, 300, 120, 'What are we trying to solve?', 'round', 'yellow');
        const a = sticky(-470, -250, 'First thought', 'pink'), b = sticky(310, -250, 'Wild idea', 'blue');
        const c = sticky(-470, 110, 'What if…', 'green'), d = sticky(310, 110, 'Who can help?', 'orange');
        return {
          title: 'Brainstorm', icon: 'i:bulb',
          content: { items: [label(-150, -330, 'Brainstorm', 'xl', 300), q, a, b, c, d, link(q, a, 'none'), link(q, b, 'none'), link(q, c, 'none'), link(q, d, 'none')], view: null }
        };
      }
    },
    {
      id: 'kanban', name: 'Kanban board', icon: 'layout', type: 'board', about: 'To do, doing and done columns',
      build: () => ({
        title: 'Kanban', icon: 'i:layout',
        content: { items: [
          frame(-560, -260, 340, 560, 'To do'), frame(-170, -260, 340, 560, 'Doing'), frame(220, -260, 340, 560, 'Done'),
          sticky(-535, -205, 'Drag me to the next column', 'yellow', 150, 150),
          sticky(-365, -205, 'Double-click the canvas to add a sticky', 'pink', 150, 150),
          sticky(-145, -205, 'In progress', 'blue', 150, 150),
          sticky(245, -205, 'Finished!', 'green', 150, 150)
        ], view: null }
      })
    },
    {
      id: 'mindmap', name: 'Mind map', icon: 'board', type: 'board', about: 'A central topic with branches',
      build: () => {
        const c = shape(-120, -50, 240, 100, 'Main topic', 'ellipse', 'yellow');
        const n = [shape(-520, -210, 190, 70, 'Branch one', 'round'), shape(330, -210, 190, 70, 'Branch two', 'round'),
          shape(-520, 140, 190, 70, 'Branch three', 'round'), shape(330, 140, 190, 70, 'Branch four', 'round')];
        return { title: 'Mind map', icon: 'i:board', content: { items: [c].concat(n, n.map(x => link(c, x, 'none'))), view: null } };
      }
    }
  ];

  function fromTemplate(tplId, parentId) {
    const tpl = TEMPLATES.find(t => t.id === tplId);
    if (!tpl) return null;
    const made = tpl.build();
    return ZN.shell.newPage(tpl.type, parentId, made);
  }

  function pick(parentId) {
    let m = null;
    const grid = h('div.tpl-grid', TEMPLATES.map(t =>
      h('button.tpl', { type: 'button', onclick: () => { m.close(); fromTemplate(t.id, parentId); } },
        h('span.tpl-icon', ZN.icon(t.icon, 22)),
        h('b', t.name), h('span', t.about),
        h('em', ZN.TYPE_NAME[t.type]))));
    m = ZN.ui.modal({ title: 'Start from a template', width: 720, body: grid });
  }

  /* ---------- first-run notebook ---------- */
  function seed() {
    const S = ZN.store;
    const ideas = S.create({ type: 'notebook', title: 'Ideas', color: 'amber' });
    const work = S.create({ type: 'notebook', title: 'Work', color: 'blue' });
    const study = S.create({ type: 'notebook', title: 'Study & reference', color: 'green' });
    const personal = S.create({ type: 'notebook', title: 'Personal', color: 'red' });

    const guide = S.create({
      type: 'note', parentId: ideas.id, title: 'Start here', icon: 'i:star', fav: true,
      content: { blocks: [
        B('p', 'Welcome to <b>Z Note</b> — your own notebook for ideas, to-dos, boards and screen snips. This page is a real note, so try things right here.'),
        B('h2', 'Write'),
        B('ul', 'Type <code>/</code> on an empty line to pick a block: headings, to-dos, lists, quotes, code, pictures.'),
        B('ul', 'Or use shortcuts as you type: <code>#</code> heading, <code>-</code> bullet, <code>[]</code> to-do, <code>&gt;</code> quote, <code>1.</code> numbered list.'),
        B('ul', 'Select text to make it <b>bold</b>, <i>italic</i>, <mark class="hl-yellow">highlighted</mark> or <span class="ink-red">red pencil</span>.'),
        B('ul', 'Drag the <b>⋮⋮</b> handle beside a line to move it; click it for more options.'),
        B('todo', 'Tick me off', { checked: false }),
        B('todo', 'Already done', { checked: true }),
        B('h2', 'Snip'),
        B('ul', 'Press <kbd>Alt</kbd> + <kbd>S</kbd> (or the <b>Snip</b> button, top right) to capture a window or screen, crop it, and mark it up with a pen.'),
        B('ul', 'Already took a screenshot with <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>? Paste it anywhere with <kbd>Ctrl</kbd> + <kbd>V</kbd>.'),
        B('h2', 'Organise'),
        B('ul', '<b>Notebooks</b> on the left hold your pages. Drag pages to reorder them or drop one inside another.'),
        B('ul', '<kbd>Ctrl</kbd> + <kbd>K</kbd> searches everything. The star keeps a page in <b>favourites</b>.'),
        B('ul', '<b>Tasks</b> gathers every to-do from every list and note in one place.'),
        B('h2', 'Make it yours'),
        B('ul', 'Open <b>Style &amp; data</b> (bottom left) to change the paper, the ink colour, the handwriting and the page pattern — and to back up your notebook.'),
        B('quote', 'Delete this page whenever you like. It will wait in the trash in case you want it back.')
      ] }
    });

    const inboxIdeas = S.create({
      type: 'note', parentId: ideas.id, title: 'Idea inbox', icon: 'i:bulb',
      content: { blocks: [
        B('p', '<span class="ink-muted">Ideas you jot on the Home screen land here, newest first.</span>'),
        B('ul', 'Try the quick-capture box on Home')
      ] }
    });

    const q = shape(-150, -60, 300, 120, 'What would make this week great?', 'round', 'yellow');
    const s1 = sticky(-480, -250, 'Double-click the canvas for a new sticky', 'pink');
    const s2 = sticky(310, -250, 'Press L and drag between two things to connect them', 'blue');
    const s3 = sticky(-480, 110, 'Scroll to zoom, hold Space and drag to move around', 'green');
    const s4 = sticky(310, 110, 'Paste a screenshot with Ctrl + V', 'orange');
    S.create({
      type: 'board', parentId: ideas.id, title: 'Brainstorm (example)', icon: 'i:board',
      content: { items: [label(-150, -330, 'Brainstorm', 'xl', 300), q, s1, s2, s3, s4, link(q, s1, 'none'), link(q, s2, 'none'), link(q, s3, 'none'), link(q, s4, 'none')], view: null }
    });

    S.create({
      type: 'todo', parentId: work.id, title: 'This week', icon: 'i:calendar',
      content: { tasks: [
        T('Set up my notebooks the way I like them', { due: day(0), pri: 1 }),
        T('Write up the last meeting', { due: day(1) }),
        T('Try a board for the next plan', { due: day(3) }),
        T('Opened Z Note for the first time', { done: true, doneAt: Date.now() })
      ] }
    });

    S.create({
      type: 'note', parentId: study.id, title: 'Reference clippings', icon: 'i:pin',
      content: { blocks: [
        B('p', 'Keep screenshots and the notes that explain them side by side.'),
        B('callout', 'Press <kbd>Alt</kbd> + <kbd>S</kbd>, pick a window or screen, drag over the part you want, and it drops in right here.'),
        B('h3', 'Clippings'),
        B('p', '')
      ] }
    });

    const inbox = S.create({ type: 'todo', parentId: personal.id, title: 'To-do inbox', icon: 'i:inbox', content: { tasks: [] } });

    S.settings.expanded[ideas.id] = true;
    S.settings.expanded[work.id] = true;
    S.settings.ideasId = inboxIdeas.id;
    S.settings.inboxId = inbox.id;
    S.settings.seeded = true;
    S.settings.seedAt = Date.now();
    S.settings.recent = [guide.id];
    S.saveSettings();
    return guide;
  }

  ZN.templates = { list: TEMPLATES, pick, fromTemplate, seed, B, T };
})();
