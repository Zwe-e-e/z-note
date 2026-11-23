'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function harness(pages, settings = {}) {
  const touched = [], savedSettings = [], drags = [], subscriptions = new Map();
  let stopped = 0;
  function match(el, selector) {
    const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    return classes.every(c => el.classes.has(c)) && (!/^[a-z]/i.test(selector) || el.tag === selector.match(/^[a-z]+/i)[0]);
  }
  class Element {
    constructor(selector) {
      this.tag = selector.split('.')[0]; this.classes = new Set(selector.split('.').slice(1));
      this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.value = '';
      this.classList = { contains: c => this.classes.has(c), add: c => this.classes.add(c), remove: c => this.classes.delete(c),
        toggle: (c, on) => { if (on === undefined) on = !this.classes.has(c); if (on) this.classes.add(c); else this.classes.delete(c); } };
    }
    append(...children) { for (const c of children.flat(Infinity)) if (c != null && c !== false) { this.children.push(c); if (c instanceof Element) c.parentElement = this; } }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(k, fn) { (this.events[k] = this.events[k] || []).push(fn); }
    get textContent() { return this.children.map(c => c instanceof Element ? c.textContent : String(c)).join(''); }
    set textContent(value) { this.children = [value]; }
    all() { return this.children.flatMap(c => c instanceof Element ? [c, ...c.all()] : []); }
    querySelectorAll(s) { return this.all().filter(c => match(c, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    focus() { this.focused = true; }
    fire(type, more = {}) { const event = { target: this, preventDefault() {}, ...more }; for (const fn of this.events[type] || []) fn(event); }
  }
  function h(selector, props, ...kids) {
    if (props == null) props = {};
    else if (typeof props !== 'object' || props instanceof Element || Array.isArray(props)) { kids.unshift(props); props = {}; }
    const el = new Element(selector);
    for (const [k,v] of Object.entries(props)) {
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2),v);
      else if (k === 'dataset') Object.assign(el.dataset,v);
      else { el[k] = v; el.setAttribute(k,v); }
    }
    el.append(...kids); return el;
  }
  const ZN = { views: {}, util: { h, uid: () => 'newtask', text: s => s.replace(/<[^>]*>/g,''),
    clear: el => { el.children = []; return el; }, append: (el, kids) => el.append(kids), caret: {},
    dueInfo: due => due ? {label: due, cls: 'later'} : null, ymd: date => date ? date.toISOString().slice(0,10) : '2026-11-23',
    addDays: (date,n) => new Date(date.getTime()+n*86400000),
    debounce: fn => { const queue = () => { queue.pending = true; }; queue.cancel = () => { queue.pending = false; }; queue.flush = () => { if (queue.pending) { queue.pending = false; fn(); } }; return queue; } },
    store: { settings, get: id => pages.find(p=>p.id===id), isLive: p => !p.trashed,
      live: type => pages.filter(p => !p.trashed && (!type || p.type===type)),
      touch: id => touched.push(id), setSetting: (key,value) => { settings[key]=value; savedSettings.push([key,value]); },
      on: (name,fn) => { if (!subscriptions.has(name)) subscriptions.set(name,new Set()); subscriptions.get(name).add(fn); return ()=>subscriptions.get(name).delete(fn); } },
    ui: { dragColumns: options => { drags.push(options); return ()=>{stopped++;}; }, toast() {} },
    icon: ()=>h('svg'), tickHTML:'', pageTitle:p=>p.title, pageIcon:()=>h('svg'), openPage() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/js/todo.js'),'utf8'),{ window:{ZN}, document:{}, console, Date });
  const host=h('main');
  const view=ZN.views.tasks(host);
  const button = name => host.querySelectorAll('button').find(e=>e.textContent===name);
  const card = key => host.querySelectorAll('.tasks-priority-card').find(e=>e.dataset.key===key);
  return {ZN,host,view,pages,touched,settings,savedSettings,drags,button,card, get stopped(){return stopped;},subscriptions};
}
const task=(id,extra={})=>({id,text:'Task '+id,done:false,pri:0,due:null,note:'Keep details',created:100,doneAt:0,...extra});
const list=(id,tasks)=>({id,type:'todo',title:'List '+id,parentId:'book',content:{tasks}});
const fixture=()=>[list('one',[task('first',{pri:1}),task('same')]),list('two',[task('same',{priority:'C'}),task('other')]),
  {id:'notes',type:'note',title:'Meeting note',parentId:'book',content:{blocks:[{id:'check',t:'todo',html:'<b>Follow up</b>',checked:false,custom:'kept'}]}}];
const snapshot=pages=>JSON.stringify(pages);
const clickTab=(h,key)=>h.host.querySelectorAll('button').find(e=>e.attributes.role==='tab' && e.textContent.startsWith(key)).fire('click');

test('main Tasks starts in one-column All open view without rewriting existing task data',()=>{
  const pages=fixture(), before=snapshot(pages), h=harness(pages);
  assert.equal(h.host.querySelectorAll('.todo-column').length,0);
  assert.equal(h.host.querySelectorAll('.tasks-main-row').length,5);
  assert.match(h.host.textContent,/List one/); assert.match(h.host.textContent,/List two/); assert.match(h.host.textContent,/Meeting note/);
  assert.equal(snapshot(pages),before); assert.deepEqual(h.touched,[]); assert.deepEqual(h.savedSettings,[]);
});

test('switching layouts groups every source without changing tasks or their order',()=>{
  const pages=fixture(), before=snapshot(pages), h=harness(pages);
  h.button('3 columns').fire('click');
  assert.equal(h.settings.taskLayout,'columns'); assert.equal(h.host.querySelectorAll('.todo-column').length,3);
  assert.deepEqual(h.host.querySelectorAll('.todo-column').map(c=>c.querySelectorAll('.tasks-priority-card').length),[1,3,1]);
  assert.match(h.card('notes:check').textContent,/Meeting note/);
  h.button('1 column').fire('click');
  assert.equal(h.host.querySelectorAll('.todo-column').length,0); assert.equal(snapshot(pages),before); assert.deepEqual(h.touched,[]);
});

test('cross-list drag changes only the dragged task priority and keeps its source and array order',()=>{
  const pages=fixture(), h=harness(pages,{taskLayout:'columns'}), original=pages[1].content.tasks[1], untouched=snapshot([pages[0],pages[2]]);
  const order=pages[1].content.tasks.map(t=>t.id);
  h.drags.at(-1).onDrop(h.card('two:other'),h.card('one:first'),h.host.querySelectorAll('.todo-column')[0]);
  assert.equal(original.priority,'A'); assert.equal(original.pri,1); assert.equal(original.note,'Keep details');
  assert.deepEqual(pages[1].content.tasks.map(t=>t.id),order); assert.equal(pages[1].content.tasks[1],original);
  assert.equal(snapshot([pages[0],pages[2]]),untouched); assert.deepEqual(h.touched,['two']);
});

test('compound task keys prevent same-ID tasks in different lists from changing together',()=>{
  const pages=fixture(), h=harness(pages,{taskLayout:'columns'});
  const select=h.card('one:same').querySelector('.task-priority'); select.value='A'; select.fire('change');
  assert.equal(pages[0].content.tasks[1].priority,'A'); assert.equal(pages[1].content.tasks[0].priority,'C'); assert.deepEqual(h.touched,['one']);
});

test('note checkbox priority moves preserve rich text and stay in the original note',()=>{
  const pages=fixture(), h=harness(pages,{taskLayout:'columns'}), block=pages[2].content.blocks[0];
  h.drags.at(-1).onDrop(h.card('notes:check'),null,h.host.querySelectorAll('.todo-column')[2]);
  assert.equal(block.priority,'C'); assert.equal(block.html,'<b>Follow up</b>'); assert.equal(block.checked,false); assert.equal(block.custom,'kept');
  assert.equal(pages[2].content.blocks[0],block); assert.deepEqual(h.touched,['notes']);
});

test('checking a rendered task resolves the fresh record after a sync replaces the original',()=>{
  const pages=fixture(), h=harness(pages,{taskLayout:'columns'}), old=pages[0].content.tasks[0];
  const checkbox=h.card('one:first').querySelector('.chk');
  pages[0].content.tasks[0]={...old,text:'Changed remotely'};
  checkbox.fire('click');
  assert.equal(old.done,false); assert.equal(pages[0].content.tasks[0].done,true); assert.equal(pages[0].content.tasks[0].text,'Changed remotely');
  assert.deepEqual(h.touched,['one']);
});

test('a stale drop cannot resurrect a removed task or change another source',()=>{
  const pages=fixture(), h=harness(pages,{taskLayout:'columns'}), dragged=h.card('two:other'), callback=h.drags.at(-1).onDrop;
  pages[1].content.tasks.pop(); const before=snapshot(pages);
  callback(dragged,null,h.host.querySelectorAll('.todo-column')[0]);
  assert.equal(snapshot(pages),before); assert.deepEqual(h.touched,[]);
});

test('Done follows both layouts and reopening a task restores its chosen priority',()=>{
  const pages=fixture(); pages[1].content.tasks[0].done=true;
  const h=harness(pages,{taskLayout:'columns'});
  clickTab(h,'Done'); assert.equal(h.host.querySelectorAll('.todo-column').length,3); assert.equal(h.settings.taskLayout,'columns');
  assert.equal(h.card('two:same').querySelector('.task-priority').disabled,true);
  assert.equal(h.drags.length,1); // The original open-task board was the only drag handler.
  h.button('1 column').fire('click'); assert.equal(h.host.querySelectorAll('.todo-column').length,0);
  h.button('3 columns').fire('click'); assert.equal(h.host.querySelectorAll('.todo-column').length,3);
  h.card('two:same').querySelector('.chk').fire('click');
  assert.equal(pages[1].content.tasks[0].done,false); assert.equal(pages[1].content.tasks[0].priority,'C');
  clickTab(h,'All open'); assert.equal(h.card('two:same').querySelector('.task-priority').value,'C');
});

test('Today and Upcoming keep their filters when columns are enabled',()=>{
  const pages=[list('one',[task('today',{due:'2026-11-23'}),task('future',{due:'2026-11-27'}),task('flag',{pri:1}),task('later')])];
  const before=snapshot(pages), h=harness(pages,{taskLayout:'columns'});
  clickTab(h,'Today'); assert.deepEqual(h.host.querySelectorAll('.tasks-priority-card').map(c=>c.dataset.key).sort(),['one:flag','one:today']);
  clickTab(h,'Upcoming'); assert.deepEqual(h.host.querySelectorAll('.tasks-priority-card').map(c=>c.dataset.key),['one:future']);
  assert.equal(snapshot(pages),before); assert.deepEqual(h.touched,[]);
});

test('rerender and unmount cancel active column drag handlers and subscriptions',()=>{
  const h=harness(fixture(),{taskLayout:'columns'}); clickTab(h,'Today'); assert.equal(h.stopped,1);
  h.view.unmount(); assert.equal(h.stopped,2);
  for (const handlers of h.subscriptions.values()) assert.equal(handlers.size,0);
});
