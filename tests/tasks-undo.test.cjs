'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the real task model/view with synthetic tasks only. No browser
// storage, notebook directories, or user notes are read by these checks.
function harness(tasks = [], options = {}) {
  let serial = 0;
  const touched = [], saved = new Map(), messages = [], drag = [], timers = [], settingWrites = [];
  const listeners = new Map(), subscriptions = new Map();
  const document = { activeElement: null,
    addEventListener(type,fn) { if (!listeners.has(type)) listeners.set(type,new Set()); listeners.get(type).add(fn); },
    removeEventListener(type,fn) { listeners.get(type)?.delete(fn); },
    getElementById(id) { return id === 'layer' ? document.layer : null; },
    querySelector() { return document.modal ? {} : null; }
  };

  function simpleMatch(el, selector) {
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    selector = selector.replace(/\[[^\]]*\]/g, '');
    const tag = selector.match(/^[a-z][a-z0-9-]*/i);
    if (tag && el.tag !== tag[0]) return false;
    if ([...selector.matchAll(/\.([\w-]+)/g)].some(m => !el.classes.has(m[1]))) return false;
    return attrs.every(([, key, value]) => {
      const actual = key.startsWith('data-') ? el.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : el.attributes[key];
      return value === undefined ? actual !== undefined : String(actual) === value;
    });
  }
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const bits = part.trim().split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      if (!simpleMatch(el, bits.pop())) return false;
      let parent = el.parentElement;
      while (bits.length) {
        const next = bits.pop();
        while (parent && !simpleMatch(parent, next)) parent = parent.parentElement;
        if (!parent) return false;
        parent = parent.parentElement;
      }
      return true;
    });
  }
  class Element {
    constructor(selector) {
      this.nodeType = 1;
      this.tag = selector.match(/^[^.#]+/)[0]; this.tagName = this.tag.toUpperCase();
      this.classes = new Set(selector.split('.').slice(1));
      this.children = []; this.parentElement = null; this.dataset = {}; this.attributes = {};
      this.events = new Map(); this.value = ''; this.offsetTop = 0; this.isConnected = true;
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.classList = {
        contains: key => this.classes.has(key),
        add: (...keys) => keys.forEach(key => this.classes.add(key)),
        remove: (...keys) => keys.forEach(key => this.classes.delete(key)),
        toggle: (key, on) => { if (on === undefined) on = !this.classes.has(key); if (on) this.classes.add(key); else this.classes.delete(key); return on; }
      };
    }
    append(...children) {
      for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue;
        if (child instanceof Element) { child.remove(); child.parentElement = this; }
        this.children.push(child);
      }
      if (this.tag === 'select' && !this.value) this.value = this.children.find(c => c.selected)?.value || this.children[0]?.value || '';
    }
    appendChild(child) { this.append(child); return child; }
    remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
    get textContent() { return this.children.map(c => c instanceof Element ? c.textContent : String(c)).join(''); }
    set textContent(value) { this.children = [String(value)]; }
    setAttribute(name, value) {
      this.attributes[name] = value;
      if (name === 'value') this.value = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
    removeEventListener(name, callback) { this.events.set(name, (this.events.get(name) || []).filter(fn => fn !== callback)); }
    all() { return this.children.flatMap(c => c instanceof Element ? [c, ...c.all()] : []); }
    querySelectorAll(selector) { return this.all().filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { let el = this; while (el && !matches(el, selector)) el = el.parentElement; return el; }
    contains(el) { for (; el; el = el.parentElement) if (el === this) return true; return false; }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = null; }
    scrollIntoView() {}
    getBoundingClientRect() { return { top: 0, bottom: 28, left: 0, width: 300, height: 28 }; }
    fire(type, extra = {}) {
      const event = Object.assign({ type, target: this, key: '', preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }, extra);
      let el = this;
      while (el) { for (const fn of el.events.get(type) || []) fn(event); if (event.stopped) break; el = el.parentElement; }
      return event;
    }
  }
  function h(selector, props, ...children) {
    if (props == null) props = {};
    else if (typeof props !== 'object' || props instanceof Element || Array.isArray(props)) { children.unshift(props); props = {}; }
    const el = new Element(selector);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style') Object.assign(el.style, value);
      else { el[key] = value; el.setAttribute(key, value); }
    }
    el.append(...children);
    return el;
  }
  const page = { id: 'list1', type: 'todo', title: 'Example list', parentId: 'book1', content: { tasks } };
  const pages = [page, ...(options.pages || [])];
  const ZN = {
    views: {}, db: {},
    util: {
      h, uid: () => 'task' + ++serial, dueInfo: due => due ? { label: due, cls: 'later' } : null,
      ymd: () => '2026-11-23', addDays: (date,n) => new Date(date.getTime()+n*86400000), debounce: fn => { const d=()=>{}; d.cancel=()=>{}; return d; }, parseDue: text => text === 'fri' ? '2026-11-27' : null,
      text: text => String(text), cleanHTML: text => String(text),
      clear: el => { if (el.contains(document.activeElement)) document.activeElement = document.body; for (const c of el.children) if (c instanceof Element) c.parentElement = null; el.children = []; return el; },
      append: (el, kids) => el.append(kids),
      caret: { set: el => el?.focus(), offset: () => 0, rect: () => ({ top: 0, bottom: 28, left: 0 }), setAtX: el => el.focus() }
    },
    store: {
      settings: { ...(options.settings || {}) },
      live: type => pages.filter(p => !p.trashed && (!type || p.type === type)),
      get: id => pages.find(p => p.id === id), isLive: p => pages.includes(p) && !p.trashed,
      touch: id => { touched.push(id); saved.set(id, JSON.parse(JSON.stringify(pages.find(p => p.id === id)))); },
      update: (id, patch) => { const p = pages.find(p => p.id === id); Object.assign(p, patch); saved.set(id, JSON.parse(JSON.stringify(p))); },
      setSetting: (key, value) => { settingWrites.push([key, value]); ZN.store.settings[key] = value; },
      on: (name,fn) => { if (!subscriptions.has(name)) subscriptions.set(name,new Set()); subscriptions.get(name).add(fn); return ()=>subscriptions.get(name).delete(fn); }, blank: () => ({ tasks: [] })
    },
    ui: {
      toast: (text,options) => messages.push({text,options}),
      dragColumns: options => { drag.push(options); return () => {}; },
      dragSort: options => { drag.push(options); return () => {}; },
      menu: (anchor, items) => { ZN.ui.lastMenu = items; },
      datePicker: (anchor,value,fn) => { ZN.ui.datePicked = fn; }
    },
    icon: () => h('svg'), tickHTML: '', pageTitle: p => p.title, pageIcon: () => h('svg'),
    pageHead: () => ({ el: h('header'), focusTitle() {} }), openPage() {}
  };
  const context = { window: { ZN }, document, console, requestAnimationFrame: fn => fn(), getComputedStyle: () => ({ lineHeight: '28' }),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/todo.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/settings.js'), 'utf8'), context);
  const host = h('main'); document.body = h('body'); document.body.append(host);
  return { ZN, model: ZN.tasks, page, pages, tasks, h, host, touched, saved, messages, drag, document, settingWrites,
    mount() { return ZN.views.todo(host, page); }, mountTasks() { return ZN.views.tasks(host); },
    key(key='z',extra={}) { const e={key,ctrlKey:true,target:document.activeElement || document.body,preventDefault(){this.defaultPrevented=true;},...extra}; for(const fn of listeners.get('keydown') || []) fn(e); return e; },
    listeners, subscriptions, drainTimers() { while (timers.length) timers.shift()(); } };
}


const task = (id, extra={}) => ({id,text:id+' task',pri:0,done:false,due:null,note:'',created:100,doneAt:0,...extra});
const list = (id,tasks) => ({id,type:'todo',title:id,content:{tasks}});

function priority(h,id,value) {
  const select=h.host.querySelector('.task[data-id="'+id+'"] .task-priority');
  select.value=value; select.fire('change'); return select;
}
function more(h,id,label) {
  h.host.querySelector('.task[data-id="'+id+'"] [data-act="more"]').fire('click');
  return h.ZN.ui.lastMenu.find(item=>item && item.label===label);
}

test('priority selection can immediately undo and redo without assigning legacy fields',()=>{
  const original=task('one',{pri:1,custom:{keep:true}}), h=harness([original]); h.mount();
  const before=JSON.stringify(h.tasks); priority(h,'one','C');
  assert.equal(h.document.activeElement.classList.contains('task-priority'),true);
  const after=JSON.stringify(h.tasks); assert.notEqual(after,before);
  assert.equal(h.key().defaultPrevented,true); assert.equal(JSON.stringify(h.tasks),before);
  h.key('z',{shiftKey:true}); assert.equal(JSON.stringify(h.tasks),after);
  h.key(); h.key('y'); assert.equal(JSON.stringify(h.tasks),after);
});

test('completion and date changes each undo independently and persist restored arrays',()=>{
  const h=harness([task('one')]); h.mount();
  h.host.querySelector('.task[data-id="one"] [data-act="due"]').fire('click');
  h.ZN.ui.datePicked('2026-12-03');
  h.host.querySelector('.task[data-id="one"] [data-act="check"]').fire('click');
  h.key(); assert.equal(h.tasks[0].done,false); assert.equal(h.tasks[0].due,'2026-12-03');
  h.key(); assert.equal(h.tasks[0].due,null);
  h.drainTimers(); assert.equal(h.saved.get('list1').content.tasks[0].due,null);
});

test('dragged priority and order are restored in one undo step',()=>{
  const h=harness([task('one',{priority:'A'}),task('two',{priority:'B'})],{settings:{taskLayout:'columns'}}); h.mount();
  const before=JSON.stringify(h.tasks);
  h.drag[0].onDrop(h.host.querySelector('.task[data-id="one"]'),null,h.host.querySelector('.todo-column[data-priority="C"]'));
  assert.equal(h.tasks.find(t=>t.id==='one').priority,'C'); h.key(); assert.equal(JSON.stringify(h.tasks),before);
  h.key('y'); assert.equal(h.tasks.find(t=>t.id==='one').priority,'C');
});

test('delete toast and Ctrl Z share one history without duplicated restored tasks',()=>{
  const h=harness([task('one'),task('two')]); h.mount(); const before=JSON.stringify(h.tasks);
  more(h,'one','Delete').onClick(); const undo=h.messages.at(-1).options.action.fn;
  assert.equal(h.tasks.length,1); h.key(); assert.equal(JSON.stringify(h.tasks),before);
  undo(); assert.equal(JSON.stringify(h.tasks),before); h.key('y'); assert.equal(h.tasks.length,1);
});

test('clearing completed tasks is one reversible change',()=>{
  const h=harness([task('one',{done:true,doneAt:100}),task('two'),task('three',{done:true,doneAt:200})]); h.mount();
  const before=JSON.stringify(h.tasks); h.host.querySelector('[data-act="clear-done"]').fire('click');
  assert.equal(h.tasks.length,1); h.key(); assert.equal(JSON.stringify(h.tasks),before);
});

test('moving between lists restores both arrays and refuses to overwrite later destination edits',()=>{
  const destination=list('second',[task('other')]), h=harness([task('one')],{pages:[destination]}); h.mount();
  const before=JSON.stringify(h.pages.map(p=>p.content.tasks));
  more(h,'one','Move to another list').items[0].onClick(); assert.equal(h.tasks.length,0);
  h.key(); assert.equal(JSON.stringify(h.pages.map(p=>p.content.tasks)),before);
  h.key('y'); assert.equal(h.tasks.length,0); destination.content.tasks[0].text='Edited elsewhere';
  const latest=JSON.stringify(h.pages); h.key(); assert.equal(JSON.stringify(h.pages),latest);
  assert.match(h.messages.at(-1).text,/changed elsewhere/);
});

test('new edits after undo discard redo while layout changes do not enter history',()=>{
  const h=harness([task('one')]); h.mount();
  priority(h,'one','A'); h.key(); priority(h,'one','C'); h.key('y'); assert.equal(h.tasks[0].priority,'C');
  h.host.querySelectorAll('button').find(e=>e.textContent==='3 columns').fire('click');
  h.key(); assert.equal(h.tasks[0].priority,undefined); assert.equal(h.ZN.store.settings.taskLayout,'columns');
});

test('native typing, unrelated focus, modal dialogs and IME keep their shortcuts',()=>{
  const h=harness([task('one')]); h.mount(); priority(h,'one','A');
  for(const selector of ['.todo-input','.task-text']) {
    h.host.querySelector(selector).focus(); assert.equal(h.key().defaultPrevented,undefined); assert.equal(h.tasks[0].priority,'A');
  }
  h.document.body.focus();
  for(const extra of [{ctrlKey:false},{altKey:true},{isComposing:true},{defaultPrevented:true}]) h.key('z',extra);
  h.document.modal=true; assert.equal(h.key().defaultPrevented,undefined); h.document.modal=false;
  h.host.setAttribute('inert',''); assert.equal(h.key().defaultPrevented,undefined); delete h.host.attributes.inert;
  h.document.layer=h.h('div',h.h('div.modal')); assert.equal(h.key().defaultPrevented,undefined); h.document.layer=null;
  const outside=h.h('button'); outside.focus(); assert.equal(h.key().defaultPrevented,undefined);
  h.document.body.focus(); h.key('z',{ctrlKey:false,metaKey:true}); assert.equal(h.tasks[0].priority,undefined);
});

test('adding a task can be undone after leaving the input, without intercepting text undo',()=>{
  const h=harness([task('one')]); h.mount(); const input=h.host.querySelector('.todo-input');
  input.value='New task'; input.focus(); input.fire('keydown',{key:'Enter'}); assert.equal(h.tasks.length,2);
  assert.equal(h.key().defaultPrevented,undefined); assert.equal(h.tasks.length,2);
  h.document.body.focus(); h.key(); assert.equal(h.tasks.length,1); h.key('y'); assert.equal(h.tasks[1].text,'New task');
});

test('remote page replacement and unmount cannot mutate the previous page through undo',()=>{
  const h=harness([task('one')]); const view=h.mount(); priority(h,'one','A');
  h.pages[0]={...h.page,content:{tasks:[task('remote')]}}; const after=JSON.stringify(h.pages); h.key(); assert.equal(JSON.stringify(h.pages),after);
  view.unmount(); assert.equal(h.listeners.get('keydown').size,0); h.key('y'); assert.equal(JSON.stringify(h.pages),after);
});

test('main Tasks undo and redo priority and completion across lists and note checkboxes',()=>{
  const note={id:'note',type:'note',title:'Note',content:{blocks:[{id:'box',t:'todo',html:'<b>Keep rich text</b>',checked:false,custom:7}]}},
    h=harness([task('one')],{pages:[list('second',[task('one',{priority:'C'})]),note]}); h.mountTasks();
  const find=key=>h.host.querySelectorAll('.tasks-main-row').find(row=>row.dataset.key===key);
  const before=JSON.stringify(h.pages);
  const select=find('second:one').querySelector('.task-priority'); select.value='A'; select.fire('change');
  find('note:box').querySelector('.chk').fire('click');
  h.document.body.focus(); h.key(); assert.equal(note.content.blocks[0].checked,false); h.key(); assert.equal(JSON.stringify(h.pages),before);
  h.key('y'); h.key('y'); assert.equal(h.pages[1].content.tasks[0].priority,'A'); assert.equal(note.content.blocks[0].checked,true);
  assert.equal(note.content.blocks[0].html,'<b>Keep rich text</b>'); assert.equal(note.content.blocks[0].custom,7);
});

test('main Tasks inbox quick add is undoable and a stale snapshot leaves newer tasks intact',()=>{
  const h=harness([task('one')],{settings:{inboxId:'list1'}}); const view=h.mountTasks();
  const input=h.host.querySelector('.todo-input'); input.value='Inbox addition'; input.fire('keydown',{key:'Enter'});
  h.document.body.focus(); h.key(); assert.equal(h.tasks.length,1); h.key('y'); assert.equal(h.tasks.length,2);
  h.tasks[0].text='Fresh change from another window'; const before=JSON.stringify(h.tasks); h.key(); assert.equal(JSON.stringify(h.tasks),before);
  view.unmount(); assert.equal(h.listeners.get('keydown').size,0);
});
