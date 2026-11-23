/* Z Note · to-do lists, and the Tasks view that gathers every to-do in the notebook */
(function () {
  'use strict';
  const ZN = window.ZN, U = ZN.util, h = U.h, S = ZN.store, ui = ZN.ui, C = U.caret;

  const PRIORITIES = [
    { key: 'A', name: 'High', hint: 'Do first' },
    { key: 'B', name: 'Medium', hint: 'Plan next' },
    { key: 'C', name: 'Low', hint: 'When time allows' }
  ];
  const validPriority = value => PRIORITIES.some(p => p.key === value);
  // Older notebooks used a single important flag. Reading them never rewrites tasks.
  const priorityOf = task => validPriority(task.priority) ? task.priority : task.pri ? 'A' : 'B';
  function setPriority(task, priority) {
    if (!task || !validPriority(priority)) return false;
    task.priority = priority;
    task.pri = priority === 'A' ? 1 : 0;
    return true;
  }
  function movePriority(tasks, id, priority, beforeId) {
    if (!validPriority(priority)) return false;
    const task = tasks.find(t => t.id === id);
    const before = beforeId ? tasks.find(t => t.id === beforeId) : null;
    if (!task || task.done || beforeId === id ||
        (beforeId && (!before || before.done || priorityOf(before) !== priority))) return false;
    const reordered = tasks.filter(t => t !== task);
    let at = before ? reordered.indexOf(before) : -1;
    if (!before) {
      reordered.forEach((t, i) => { if (!t.done && priorityOf(t) === priority) at = i; });
      at++;
    }
    reordered.splice(at, 0, task);
    if (priorityOf(task) === priority && reordered.every((t, i) => tasks[i] === t)) return false;
    setPriority(task, priority);
    tasks.splice(0, tasks.length, ...reordered);
    return true;
  }
  function prioritySelect(value, label, className) {
    const select = h('select.' + className, { 'aria-label': label },
      PRIORITIES.map(p => h('option', { value: p.key }, p.key + ' · ' + p.name)));
    select.value = value;
    return select;
  }

  // Layout is a viewing preference. Opening a view never assigns priorities or saves pages.
  const layoutMode = () => S.settings.taskLayout === 'columns' ? 'columns' : 'list';
  function layoutSwitch(onChange) {
    const buttons = [];
    const el = h('div.task-layout-switch', { role: 'group', 'aria-label': 'Task layout' });
    for (const [mode, label] of [['list', '1 column'], ['columns', '3 columns']]) {
      const button = h('button.task-layout-option', { type: 'button', 'aria-pressed': 'false', onclick: () => {
        if (layoutMode() === mode) return;
        S.setSetting('taskLayout', mode);
        refresh();
        onChange();
      } }, label);
      buttons.push({ mode, button }); el.append(button);
    }
    function refresh() {
      buttons.forEach(({ mode, button }) => {
        const selected = layoutMode() === mode;
        button.classList.toggle('on', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
    }
    refresh();
    return { el, refresh };
  }

  function newTask(text, extra) {
    const task = Object.assign({ id: U.uid(), text: text || '', done: false, due: null, pri: 0, note: '', created: Date.now(), doneAt: 0 }, extra || {});
    setPriority(task, priorityOf(task));
    return task;
  }

  /* "Call the supplier @fri !" → { text: 'Call the supplier', due: '2026-11-13', pri: 1 } */
  function parseQuick(raw) {
    let due = null, pri = 0;
    const words = String(raw || '').replace(/\s+/g, ' ').trim().split(' ');
    const keep = [];
    words.forEach(w => {
      if (/^!+$/.test(w)) { pri = 1; return; }                         // a lone "!" flags it
      if (/!!+$/.test(w)) { pri = 1; w = w.replace(/!+$/, ''); }        // so does "urgent!!"
      if (w.length > 1 && w[0] === '@') { const d = U.parseDue(w.slice(1)); if (d) { due = d; return; } }
      if (w) keep.push(w);
    });
    return { text: keep.join(' '), due, pri };
  }

  /* the list that quick-added to-dos land in (created on first use) */
  function inboxPage() {
    let p = S.settings.inboxId ? S.get(S.settings.inboxId) : null;
    if (p && S.isLive(p) && p.type === 'todo') return p;
    p = S.live('todo').find(x => /inbox/i.test(x.title));
    if (!p) {
      const nb = S.notebooks().find(n => /personal/i.test(n.title)) || S.ensureNotebook();
      p = S.create({ type: 'todo', parentId: nb.id, title: 'To-do inbox', icon: 'i:inbox', content: { tasks: [] } });
    }
    S.setSetting('inboxId', p.id);
    return p;
  }

  function quickAdd(raw, page) {
    const q = parseQuick(raw);
    if (!q.text) return null;
    const list = page || inboxPage();
    if (!list.content || !Array.isArray(list.content.tasks)) list.content = { tasks: [] };
    list.content.tasks.push(newTask(q.text, { due: q.due, pri: q.pri }));
    S.touch(list.id);
    return list;
  }

  /* every to-do in the notebook: list items, plus tick-boxes written inside notes */
  function collect() {
    const out = [];
    S.live().forEach(p => {
      if (p.type === 'todo' && p.content && Array.isArray(p.content.tasks)) {
        p.content.tasks.forEach(t => {
          if (!t.text) return;
          out.push({ key: p.id + ':' + t.id, kind: 'task', page: p, ref: t, text: t.text, done: !!t.done, due: t.due || null, pri: priorityOf(t) === 'A' ? 1 : 0, priority: priorityOf(t), doneAt: t.doneAt || 0 });
        });
      } else if (p.type === 'note' && p.content && Array.isArray(p.content.blocks)) {
        p.content.blocks.forEach(b => {
          if (b.t !== 'todo') return;
          const text = U.text(b.html).trim();
          if (!text) return;
          out.push({ key: p.id + ':' + b.id, kind: 'block', page: p, ref: b, text, done: !!b.checked, due: null, pri: 0, priority: priorityOf(b), doneAt: 0 });
        });
      }
    });
    return out;
  }

  function changeCollectedPriority(key, priority) {
    if (!validPriority(priority)) return false;
    // Resolve again at action time: a sync may have replaced the original object.
    const item = collect().find(t => t.key === key);
    if (!item || item.done || item.priority === priority) return false;
    if (item.kind === 'task') setPriority(item.ref, priority);
    else item.ref.priority = priority;
    S.touch(item.page.id);
    return true;
  }

  function dueCount() {
    const today = U.ymd();
    let n = 0;
    S.live('todo').forEach(p => ((p.content && p.content.tasks) || []).forEach(t => { if (!t.done && t.text && t.due && t.due <= today) n++; }));
    return n;
  }

  function toggle(item) {
    if (item.kind === 'task') { item.ref.done = !item.ref.done; item.ref.doneAt = item.ref.done ? Date.now() : 0; }
    else item.ref.checked = !item.ref.checked;
    S.touch(item.page.id);
  }

  /* a to-do as shown outside its own list (Home, Tasks) */
  function row(item, o) {
    o = o || {};
    const due = U.dueInfo(item.due);
    const chk = h('button.chk' + (item.done ? '.on' : ''), { type: 'button', 'aria-label': item.done ? 'Mark as not done' : 'Mark as done', html: ZN.tickHTML });
    const r = h('div.prow.task-row' + (item.done ? '.done' : ''), chk,
      h('button.task-open', { type: 'button', onclick: () => ZN.openPage(item.page.id), 'data-tip': 'Open “' + ZN.pageTitle(item.page) + '”' }, h('span.prow-title', item.text)),
      item.pri ? h('span.task-flag', { 'aria-label': 'Important' }, ZN.icon('flag', 14)) : null,
      due && !item.done ? h('span.chip.' + due.cls, due.label) : null,
      o.where === false ? null : h('span.prow-meta', (item.kind === 'block' ? 'note · ' : '') + ZN.pageTitle(item.page)));
    chk.addEventListener('click', () => {
      chk.classList.toggle('on');
      r.classList.toggle('done');
      setTimeout(() => toggle(item), 260);       // let the tick draw before lists re-sort
    });
    return r;
  }

  ZN.tasks = { newTask, parseQuick, quickAdd, collect, dueCount, toggle, row, inboxPage, priorityOf, setPriority, movePriority, changeCollectedPriority };

  /* ====================================================================== */
  /* a to-do list page */
  ZN.views.todo = function (el, page) {
    if (!page.content || !Array.isArray(page.content.tasks)) page.content = { tasks: [] };
    const tasks = page.content.tasks;
    const noteOpen = new Set();
    let alive = true, offSort = () => {};

    const addInput = h('input.todo-input', { type: 'text', placeholder: 'Add a to-do and press Enter', 'aria-label': 'Add a to-do', maxlength: 400 });
    const addPriority = prioritySelect('B', 'New task priority', 'todo-add-priority');
    const head = ZN.pageHead(page, { onLeave: () => addInput.focus() });
    const progress = h('div.todo-progress');
    const openEl = h('div.todo-open');
    const layout = layoutSwitch(() => { render(); setPat(); });
    const announcement = h('div.todo-announcement', { role: 'status', 'aria-live': 'polite' });
    const doneHead = h('button.done-head', { type: 'button' });
    const doneEl = h('div.tasks.tasks-done');
    const sheet = h('div.sheet.page.todo', head.el,
      h('div.todo-add', h('span.todo-plus', ZN.icon('plus', 17)), addInput, addPriority),
      h('div.todo-hint', 'Use 3 columns to arrange priorities, or keep the original list in 1 column. ', h('kbd', '@fri'), ' sets a date; ', h('kbd', '!'), ' adds to A · High.'),
      h('div.task-layout-bar', h('span.task-layout-label', 'View'), layout.el),
      progress, openEl, announcement, doneHead, doneEl);
    el.append(h('div.page-wrap', sheet));

    const byId = id => tasks.find(t => t.id === id);
    const changed = () => S.touch(page.id);
    const textEl = id => { const r = sheet.querySelector('.task[data-id="' + id + '"] .task-text'); return r || null; };
    const focusTask = (id, where) => { const t = textEl(id); if (t) C.set(t, where === undefined ? 'end' : where); };

    function noteEl(t) {
      return h('div.task-note', { contenteditable: 'plaintext-only', 'data-ph': 'Add a note…', spellcheck: 'true' }, t.note || '');
    }

    function taskRow(t) {
      const due = U.dueInfo(t.due);
      const priority = prioritySelect(priorityOf(t), 'Priority for ' + (t.text || 'new task'), 'task-priority');
      priority.dataset.act = 'priority';
      return h('div.task' + (t.done ? '.done' : '') + (priorityOf(t) === 'A' ? '.pri' : ''), { dataset: { id: t.id } },
        h('button.task-grip', { type: 'button', tabindex: '-1', 'aria-label': 'Drag task between priorities or reorder', 'data-tip': 'Drag to move or reorder' }, ZN.icon('grip', 15)),
        h('button.chk' + (t.done ? '.on' : ''), { type: 'button', 'data-act': 'check', 'aria-label': t.done ? 'Mark as not done' : 'Mark as done', html: ZN.tickHTML }),
        h('div.task-main',
          h('div.task-text', { contenteditable: 'plaintext-only', spellcheck: 'true', 'data-ph': 'To-do', role: 'textbox', 'aria-label': 'To-do' }, t.text),
          t.note || noteOpen.has(t.id) ? noteEl(t) : null),
        h('div.task-side',
          due ? h('button.chip.' + (t.done ? 'later' : due.cls), { type: 'button', 'data-act': 'due', 'data-tip': 'Change the due date' }, ZN.icon('calendar', 13), due.label)
            : h('button.chip.ghost.task-quiet', { type: 'button', 'data-act': 'due' }, ZN.icon('calendar', 13), 'Date'),
          priority,
          h('button.ibtn.sm.task-quiet', { type: 'button', 'data-act': 'more', 'data-tip': 'More', 'aria-label': 'More options' }, ZN.icon('more', 15))));
    }

    function render() {
      offSort(); offSort = () => {};
      const open = tasks.filter(t => !t.done);
      const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      const columns = layoutMode() === 'columns';
      sheet.classList.toggle('is-columns', columns);
      sheet.classList.toggle('is-list', !columns);
      openEl.classList.toggle('todo-columns', columns);
      openEl.setAttribute('aria-label', columns ? 'Tasks by priority' : 'Open tasks');
      layout.refresh();
      U.clear(openEl);
      if (columns) PRIORITIES.forEach(p => {
        const items = open.filter(t => priorityOf(t) === p.key);
        const list = h('div.tasks.todo-column-tasks', items.map(taskRow));
        if (!items.length) list.append(h('p.todo-column-empty', 'Drop a task here'));
        openEl.append(h('section.todo-column', { dataset: { priority: p.key }, 'aria-label': p.key + ' · ' + p.name + ' priority' },
          h('div.todo-column-head', h('h2', h('span.todo-priority-letter', p.key), p.name),
            h('span.todo-column-count', { 'aria-label': items.length + ' tasks' }, String(items.length))),
          h('p.todo-column-hint', p.hint), list,
          h('button.todo-column-add', { type: 'button', onclick: () => { addPriority.value = p.key; addInput.focus(); } }, ZN.icon('plus', 14), 'Add task')));
      });
      else {
        const list = h('div.tasks.todo-list-column', open.map(taskRow));
        if (!open.length) list.append(h('div.empty', tasks.length ? 'All done. Nice work!' : 'A fresh list',
          !tasks.length ? h('small', 'Type your first to-do in the box above.') : null));
        openEl.append(list);
      }
      U.clear(doneEl);
      const hide = !!page.content.hideDone;
      doneHead.hidden = !done.length;
      doneEl.hidden = !done.length || hide;
      U.clear(doneHead).append(h('span.twisty' + (hide ? '' : '.open'), ZN.icon('chevR', 13)), h('span.section-label', 'done · ' + done.length),
        done.length ? h('span.done-clear', { role: 'button', tabindex: '0', 'data-act': 'clear-done' }, 'Clear') : null);
      if (!hide) done.forEach(t => doneEl.append(taskRow(t)));
      const total = tasks.length;
      U.clear(progress);
      if (total) {
        progress.append(h('div.todo-meter', h('span', { style: { width: Math.round(done.length / total * 100) + '%' } })),
          h('span.todo-count', done.length + ' of ' + total + ' done'));
      }
      offSort = ui.dragColumns({
        container: openEl, column: '.todo-column, .todo-list-column', item: '.task', handle: '.task-grip', scroller: el,
        onDrop: (item, beforeEl, column) => {
          const beforeId = beforeEl && beforeEl.dataset.id;
          if (layoutMode() === 'columns') {
            if (!movePriority(tasks, item.dataset.id, column.dataset.priority, beforeId)) return;
            announcement.textContent = 'Task moved to ' + column.dataset.priority + ' · ' + PRIORITIES.find(p => p.key === column.dataset.priority).name + '.';
          } else {
            const t = byId(item.dataset.id), before = beforeId && byId(beforeId);
            if (!t || t.done || (beforeId && (!before || before.done || before === t))) return;
            const next = tasks.filter(x => x !== t);
            let at = before ? next.indexOf(before) : 0;
            if (!before) next.forEach((x, i) => { if (!x.done) at = i + 1; });
            next.splice(at, 0, t);
            if (next.every((x, i) => tasks[i] === x)) return;
            tasks.splice(0, tasks.length, ...next);
            announcement.textContent = 'Task reordered. Priority unchanged.';
          }
          render(); changed();
        }
      });
    }

    function addFromInput() {
      const q = parseQuick(addInput.value);
      if (!q.text) return;
      const t = newTask(q.text, { due: q.due, priority: q.pri ? 'A' : addPriority.value });
      tasks.push(t);
      addInput.value = '';
      render();
      changed();
      const r = sheet.querySelector('.task[data-id="' + t.id + '"]');
      if (r) r.scrollIntoView({ block: 'nearest' });
    }

    function setDone(t, on) {
      t.done = on;
      t.doneAt = on ? Date.now() : 0;
      changed();
      setTimeout(() => { if (alive) render(); }, 380);
    }

    function remove(t, quiet) {
      const i = tasks.indexOf(t);
      if (i < 0) return;
      tasks.splice(i, 1);
      noteOpen.delete(t.id);
      render();
      changed();
      if (!quiet) ui.toast('To-do deleted', { action: { label: 'Undo', fn: () => { tasks.splice(Math.min(i, tasks.length), 0, t); if (alive) render(); changed(); } } });
    }

    function moveTask(t, dir) {
      const open = tasks.filter(x => !x.done && (layoutMode() === 'list' || priorityOf(x) === priorityOf(t)));
      const k = open.indexOf(t);
      const other = open[k + dir];
      if (k < 0 || !other) return;
      const i = tasks.indexOf(t), j = tasks.indexOf(other);
      tasks[i] = other; tasks[j] = t;
      const off = C.offset(textEl(t.id));
      render();
      focusTask(t.id, off);
      changed();
    }

    function changePriority(t, priority) {
      if (priorityOf(t) === priority) return;
      if (!setPriority(t, priority)) return;
      render(); changed();
      const select = sheet.querySelector('.task[data-id="' + t.id + '"] .task-priority');
      if (select) select.focus();
      announcement.textContent = 'Task moved to ' + priority + ' · ' + PRIORITIES.find(p => p.key === priority).name + '.';
    }

    function moreMenu(anchor, t) {
      const lists = S.live('todo').filter(p => p.id !== page.id).sort((a, b) => ZN.pageTitle(a).localeCompare(ZN.pageTitle(b)));
      ui.menu(anchor, [
        { label: t.note ? 'Edit the note' : 'Add a note', icon: 'note', onClick: () => { noteOpen.add(t.id); render(); const n = sheet.querySelector('.task[data-id="' + t.id + '"] .task-note'); if (n) C.set(n, 'end'); } },
        { label: 'Priority', icon: 'flag', items: PRIORITIES.map(p => ({ label: p.key + ' · ' + p.name, onClick: () => changePriority(t, p.key) })) },
        { label: 'Duplicate', icon: 'copy', onClick: () => { const c = newTask(t.text, { due: t.due, priority: priorityOf(t), note: t.note }); tasks.splice(tasks.indexOf(t) + 1, 0, c); render(); changed(); focusTask(c.id); } },
        lists.length ? {
          label: 'Move to another list', icon: 'move',
          items: lists.map(p => ({
            label: ZN.pageTitle(p), icon: 'todo',
            onClick: () => {
              tasks.splice(tasks.indexOf(t), 1);
              if (!p.content || !Array.isArray(p.content.tasks)) p.content = { tasks: [] };
              p.content.tasks.push(t);
              S.touch(p.id);
              render(); changed();
              ui.toast('Moved to “' + ZN.pageTitle(p) + '”', { action: { label: 'Open', fn: () => ZN.openPage(p.id) } });
            }
          }))
        } : null,
        { sep: true },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(t) }
      ], { align: 'end' });
    }

    sheet.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'clear-done') {
        e.stopPropagation();
        const gone = tasks.filter(t => t.done);
        if (!gone.length) return;
        const snapshot = tasks.slice();
        for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].done) tasks.splice(i, 1);
        render(); changed();
        ui.toast(gone.length + (gone.length === 1 ? ' finished to-do cleared' : ' finished to-dos cleared'), { action: { label: 'Undo', fn: () => { tasks.length = 0; snapshot.forEach(t => tasks.push(t)); if (alive) render(); changed(); } } });
        return;
      }
      const r = act.closest('.task');
      const t = r ? byId(r.dataset.id) : null;
      if (!t) return;
      if (a === 'check') {
        const on = !t.done;
        act.classList.toggle('on', on);
        r.classList.toggle('done', on);
        setDone(t, on);
      } else if (a === 'due') ui.datePicker(act, t.due, v => { t.due = v; render(); changed(); });
      else if (a === 'more') moreMenu(act, t);
    });
    sheet.addEventListener('change', e => {
      if (!e.target.classList.contains('task-priority')) return;
      const r = e.target.closest('.task'), t = r && byId(r.dataset.id);
      if (t) changePriority(t, e.target.value);
    });
    doneHead.addEventListener('click', e => {
      if (e.target.closest('[data-act]')) return;
      page.content.hideDone = !page.content.hideDone;
      render();
      S.update(page.id, { content: page.content }, { keepTime: true, quiet: true });
    });

    sheet.addEventListener('input', e => {
      const r = e.target.closest ? e.target.closest('.task') : null;
      const t = r ? byId(r.dataset.id) : null;
      if (!t) return;
      if (e.target.classList.contains('task-text')) {
        if (e.target.textContent.trim() === '') e.target.textContent = '';
        t.text = e.target.textContent.replace(/\s*\n\s*/g, ' ');
        changed();
      } else if (e.target.classList.contains('task-note')) {
        if (e.target.textContent.trim() === '') e.target.textContent = '';
        t.note = e.target.textContent;
        changed();
      }
    });
    sheet.addEventListener('paste', e => {
      const te = e.target.closest ? e.target.closest('.task-text, .task-note') : null;
      if (!te) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain') || '';
      document.execCommand('insertText', false, te.classList.contains('task-note') ? text : text.replace(/\s+/g, ' '));
    });
    sheet.addEventListener('focusout', e => {
      // tidy up: an emptied note closes, an emptied to-do disappears
      const r = e.target.closest ? e.target.closest('.task') : null;
      const t = r ? byId(r.dataset.id) : null;
      if (!t || (e.relatedTarget && r.contains(e.relatedTarget))) return;
      if (e.target.classList.contains('task-note') && !t.note) { noteOpen.delete(t.id); e.target.remove(); }
      if (e.target.classList.contains('task-text') && !t.text && !t.note) setTimeout(() => { if (alive && tasks.indexOf(t) >= 0 && !t.text && document.activeElement !== textEl(t.id)) remove(t, true); }, 0);
    });

    sheet.addEventListener('keydown', e => {
      const te = e.target.closest ? e.target.closest('.task-text') : null;
      if (!te) {
        if (e.target.classList && e.target.classList.contains('task-note') && e.key === 'Escape') e.target.blur();
        if (e.target.classList && e.target.classList.contains('done-clear') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.target.click(); }
        return;
      }
      const t = byId(te.closest('.task').dataset.id);
      if (!t) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (mod) { const row2 = te.closest('.task'); const on = !t.done; row2.classList.toggle('done', on); row2.querySelector('.chk').classList.toggle('on', on); setDone(t, on); return; }
        if (!t.text) return;
        const nt = newTask('', { priority: priorityOf(t) });
        tasks.splice(tasks.indexOf(t) + 1, 0, nt);
        render();
        focusTask(nt.id, 0);
        return;
      }
      if (e.key === 'Backspace' && te.textContent === '') {
        e.preventDefault();
        const rows = Array.from(sheet.querySelectorAll('.task-text'));
        const prev = rows[rows.indexOf(te) - 1];
        const pid = prev ? prev.closest('.task').dataset.id : null;
        remove(t, true);
        if (pid) focusTask(pid, 'end'); else addInput.focus();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const up = e.key === 'ArrowUp';
        if (e.altKey) { e.preventDefault(); if (!t.done) moveTask(t, up ? -1 : 1); return; }
        if (e.shiftKey || mod) return;
        const r = C.rect(te), tb = te.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(te).lineHeight) || 28;
        if (!(up ? r.top - tb.top < lh * 0.7 : tb.bottom - r.bottom < lh * 0.7)) return;
        const rows = Array.from(sheet.querySelectorAll('.task-text'));
        const next = rows[rows.indexOf(te) + (up ? -1 : 1)];
        e.preventDefault();
        if (next) C.setAtX(next, r.left, up); else if (up) addInput.focus();
        return;
      }
      if (e.key === 'Escape') te.blur();
    });

    addInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
      else if (e.key === 'ArrowDown') { const f = sheet.querySelector('.task-text'); if (f) { e.preventDefault(); C.set(f, 'end'); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); head.focusTitle(); }
    });

    const setPat = () => sheet.style.setProperty('--pat-y', (openEl.offsetTop % (parseFloat(getComputedStyle(openEl).lineHeight) || 28)) + 'px');
    const offStyle = S.on('style', () => requestAnimationFrame(() => { if (alive) setPat(); }));
    render();
    setPat();

    return {
      focusTitle: head.focusTitle,
      unmount() {
        alive = false;
        offSort();
        offStyle();
        // drop to-dos that were left empty
        let dropped = false;
        for (let i = tasks.length - 1; i >= 0; i--) if (!tasks[i].text && !tasks[i].note) { tasks.splice(i, 1); dropped = true; }
        if (dropped) S.update(page.id, { content: page.content }, { keepTime: true });
      }
    };
  };

  /* ====================================================================== */
  /* Tasks: everything to do, across the whole notebook */
  let tab = 'all';

  ZN.views.tasks = function (el) {
    let alive = true, offDrag = null;
    const input = h('input.todo-input', { type: 'text', placeholder: 'Add a to-do to your inbox and press Enter', 'aria-label': 'Add a to-do', maxlength: 400 });
    const tabsEl = h('div.tabs', { role: 'tablist' });
    const body = h('div.tasks-body');
    const announcement = h('div.todo-announcement', { role: 'status', 'aria-live': 'polite' });
    const modeControl = layoutSwitch(() => render());
    const sheet = h('div.sheet.listing.tasks-view',
      h('h1', ZN.icon('tasks', 32), 'Tasks'),
      h('p.sub', 'Every to-do from your lists and the tick-boxes inside your notes, gathered in one place.'),
      h('div.todo-add', h('span.todo-plus', ZN.icon('plus', 17)), input),
      modeControl.el,
      h('p.todo-hint', 'Choose a view, then adjust priorities when you are ready. Tasks stay in their original lists and notes.'),
      tabsEl, body, announcement);
    el.append(h('div.page-wrap', sheet));

    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const list = quickAdd(input.value);
      if (!list) return;
      input.value = '';
      ui.toast('Added to “' + ZN.pageTitle(list) + '”', { action: { label: 'Open', fn: () => ZN.openPage(list.id) } });
    });

    const currentItem = key => collect().find(item => item.key === key);
    function priorityChanged(key, priority) {
      if (!alive || !changeCollectedPriority(key, priority)) return;
      render();
      const select = Array.from(body.querySelectorAll('.task-priority')).find(node => node.dataset.key === key);
      if (select) select.focus();
      announcement.textContent = 'Priority changed to ' + priority + ' · ' + PRIORITIES.find(p => p.key === priority).name + '. Original list kept.';
    }
    function taskRow(item, card, where) {
      const due = U.dueInfo(item.due);
      const chk = h('button.chk' + (item.done ? '.on' : ''), { type: 'button',
        'aria-label': item.done ? 'Mark as not done' : 'Mark as done', html: ZN.tickHTML,
        onclick: () => {
          // A sync may have replaced this record since the row was rendered.
          const current = currentItem(item.key);
          if (!alive || !current) return;
          toggle(current);
          render();
        }
      });
      const select = prioritySelect(item.priority || priorityOf(item.ref), 'Priority for ' + item.text, 'task-priority');
      select.dataset.key = item.key;
      select.disabled = !!item.done;
      select.addEventListener('change', () => priorityChanged(item.key, select.value));
      const open = h('button.task-open' + (card ? '.tasks-priority-title' : ''), { type: 'button', onclick: () => ZN.openPage(item.page.id),
        'data-tip': 'Open “' + ZN.pageTitle(item.page) + '”' }, h('span.' + (card ? 'task-text' : 'prow-title'), item.text));
      const source = where === false ? null : h('button.task-source', { type: 'button', onclick: () => ZN.openPage(item.page.id),
        'aria-label': 'Open ' + (item.kind === 'block' ? 'note ' : 'list ') + ZN.pageTitle(item.page) },
        (item.kind === 'block' ? 'Note · ' : '') + ZN.pageTitle(item.page));
      if (!card) return h('div.prow.task-row.tasks-main-row' + (item.done ? '.done' : ''), { dataset: { key: item.key } }, chk, open,
        due && !item.done ? h('span.chip.' + due.cls, due.label) : null, select, source);
      return h('div.task.tasks-priority-card' + (item.done ? '.done' : '') + (item.priority === 'A' ? '.pri' : ''), { dataset: { key: item.key } },
        h('button.task-grip', { type: 'button', tabindex: '-1', 'aria-label': 'Drag task between priorities', 'data-tip': 'Drag to change priority' }, ZN.icon('grip', 15)),
        chk, h('div.task-main', open),
        h('div.task-side', due && !item.done ? h('span.chip.' + due.cls, due.label) : null, select), source);
    }
    const group = (title, items, cls) => (items.length ? [h('div.task-group' + (cls ? '.' + cls : ''), h('span.section-label', title), h('span.task-group-n', String(items.length))), h('div.plist', items.map(t => taskRow(t, false)))] : null);
    const byDue = (a, b) => (a.due || '9').localeCompare(b.due || '9') || b.pri - a.pri;

    function render() {
      if (!alive) return;
      refill.cancel();
      if (offDrag) { offDrag(); offDrag = null; }
      const columns = layoutMode() === 'columns';
      sheet.classList.toggle('is-columns', columns);
      sheet.classList.toggle('is-list', !columns);
      modeControl.refresh();
      const all = collect();
      const open = all.filter(t => !t.done);
      const today = U.ymd(), week = U.ymd(U.addDays(new Date(), 7));
      const overdue = open.filter(t => t.due && t.due < today).sort(byDue);
      const dueToday = open.filter(t => t.due === today).sort(byDue);
      const flagged = open.filter(t => !t.due && t.pri);
      const upcoming = open.filter(t => t.due && t.due > today).sort(byDue);
      const counts = { today: overdue.length + dueToday.length + flagged.length, upcoming: upcoming.length, all: open.length, done: all.length - open.length };

      U.clear(tabsEl);
      [['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All open'], ['done', 'Done']].forEach(x => {
        tabsEl.append(h('button.tab' + (tab === x[0] ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(tab === x[0]), onclick: () => { tab = x[0]; render(); } },
          x[1], h('small.tab-n', String(counts[x[0]]))));
      });

      U.clear(body);
      if (columns) {
        const visible = tab === 'today' ? overdue.concat(dueToday, flagged) : tab === 'upcoming' ? upcoming :
          tab === 'done' ? all.filter(item => item.done).sort((a, b) => b.doneAt - a.doneAt).slice(0, 150) : open;
        const board = h('div.todo-columns', { 'aria-label': 'All tasks by priority' });
        PRIORITIES.forEach(p => {
          const items = visible.filter(item => (item.priority || priorityOf(item.ref)) === p.key);
          const list = h('div.tasks.todo-column-tasks', items.map(item => taskRow(item, true)));
          if (!items.length) list.append(h('p.todo-column-empty', 'No tasks in this priority'));
          board.append(h('section.todo-column', { dataset: { priority: p.key }, 'aria-label': p.key + ' · ' + p.name + ' priority' },
            h('div.todo-column-head', h('h2', h('span.todo-priority-letter', p.key), p.name),
              h('span.todo-column-count', { 'aria-label': items.length + (items.length === 1 ? ' task' : ' tasks') }, String(items.length))),
            h('p.todo-column-hint', p.hint), list));
        });
        body.append(board);
        if (tab !== 'done') offDrag = ui.dragColumns({ container: board, column: '.todo-column', item: '.tasks-priority-card', handle: '.task-grip', scroller: el,
          onDrop: (item, before, column) => priorityChanged(item.dataset.key, column.dataset.priority) });
        return;
      }
      let parts = [];
      if (tab === 'today') {
        parts = [group('overdue', overdue, 'late'), group('today', dueToday), group('flagged', flagged)];
        if (!counts.today) parts = [h('div.empty', 'Nothing due today.', h('small', upcoming.length ? 'Next up: “' + upcoming[0].text + '” — ' + U.dueInfo(upcoming[0].due).label.toLowerCase() + '.' : 'Give a to-do a date and it will show up here on the day.'))];
      } else if (tab === 'upcoming') {
        const tomorrow = U.ymd(U.addDays(new Date(), 1));
        parts = [group('tomorrow', upcoming.filter(t => t.due === tomorrow)), group('this week', upcoming.filter(t => t.due > tomorrow && t.due <= week)), group('later', upcoming.filter(t => t.due > week))];
        if (!upcoming.length) parts = [h('div.empty', 'Nothing scheduled ahead.', h('small', 'Use the Date button on a to-do, or end it with @fri when you type it.'))];
      } else if (tab === 'all') {
        const pages = [];
        open.forEach(t => { if (pages.indexOf(t.page) < 0) pages.push(t.page); });
        parts = pages.map(p => [
          h('div.task-group', h('button.task-group-link', { type: 'button', onclick: () => ZN.openPage(p.id) }, ZN.pageIcon(p, 15), h('span.section-label', ZN.pageTitle(p))), h('span.task-group-n', String(open.filter(t => t.page === p).length))),
          h('div.plist', open.filter(t => t.page === p).map(t => taskRow(t, false, false)))
        ]);
        if (!open.length) parts = [h('div.empty', 'Nothing left to do.', h('small', 'Add a to-do above, or type [] in any note.'))];
      } else {
        const done = all.filter(t => t.done).sort((a, b) => b.doneAt - a.doneAt).slice(0, 150);
        parts = done.length ? [h('div.plist', done.map(t => taskRow(t, false)))] : [h('div.empty', 'Nothing ticked off yet.')];
      }
      U.append(body, parts);
    }
    const refill = U.debounce(render, 150);
    render();
    const offs = [S.on('content', refill), S.on('tree', refill), S.on('settings', key => { if (key === 'taskLayout') refill(); })];
    return { unmount() { alive = false; refill.cancel(); if (offDrag) offDrag(); offs.forEach(f => f()); } };
  };
})();
