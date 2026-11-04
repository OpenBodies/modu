// 清单 (todo): her to-do list, the full list behind the home screen's 清单 widget.
// Her list is on HER phone, so each task is a record
// of type 'todo' in her own store (myRecords), never in a companion's folder, and it stays whoever she
// talks to. The home widget is drawn from this app (widget(), widgetTap()), so there is one copy of this code.
// He is not told what is on it. She can show him one task (告诉他, shareWith): only then is it in his prompt.
// Record: { type:'todo', v:1, id, at, date, t, done }; newest first (by `at`). An older list in
// localStorage 'modu-todo' = { items:[{ t, done }] } (newest first) is moved here once (migrate), and the old key is
// kept, never read again, once the move is confirmed.
(function(){
'use strict';
const TYPE = 'todo', KEY = 'modu-todo', MOVED = 'modu-todo:moved';
const M = () => window.ModuCore;
// time from the core's one clock (ModuCore.now), so ?at= and a test's clock move it too
const nowMs = () => { const c = M(); return c && c.now ? c.now().getTime() : Date.now(); };
const nowD = () => new Date(nowMs());
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

// One time: the list she had in this browser becomes records on her phone; read back before the move counts as done.
let moving = null;
function migrate(){
  if (!moving) moving = (async () => {
    const core = M(); if (!core || !core.myRecords || !core.myStore || core.myStore.where !== 'phone') return 0;
    let items = null;
    try { if (localStorage.getItem(MOVED)) return 0; const c = JSON.parse(localStorage.getItem(KEY) || 'null'); items = c && Array.isArray(c.items) ? c.items : null; } catch { return 0; }
    if (!items) return 0;
    // newest first in the old list: the first gets the latest time, so the order stays
    const keep = items.map((it, i) => [it, 'lm' + i, i]).filter(([it]) => it && it.t), base = nowMs();
    for (const [it, id, i] of keep) if (!(await core.myRecords.get(TYPE, id))) await core.myRecords.put(TYPE, { id, at: base - i, t: String(it.t), done: !!it.done }, { app: TYPE });
    const have = new Set(((await core.myRecords.list(TYPE)) || []).map(r => r.id));
    if (!keep.every(([, id]) => have.has(id))) { moving = null; return 0; }
    try { localStorage.setItem(MOVED, JSON.stringify({ at: nowMs(), n: keep.length, to: 'her phone: todo records' })); } catch {}
    return keep.length;
  })().catch(e => { console.error(e); moving = null; return 0; });
  return moving;
}
// The demo (her store kept in memory for the visit) starts with three sample tasks.
let seeded = false;
async function seed(T){
  const core = M(); if (seeded || !core.myStore || core.myStore.where !== 'memory') return; seeded = true;
  if (((await core.myRecords.list(TYPE)) || []).length) return;
  const t = nowMs();
  await core.myRecords.put(TYPE, { id: 'demo1', at: t, t: T('todo.demo1'), done: true }, { app: TYPE });
  await core.myRecords.put(TYPE, { id: 'demo2', at: t - 1, t: T('todo.demo2'), done: false }, { app: TYPE });
  await core.myRecords.put(TYPE, { id: 'demo3', at: t - 2, t: T('todo.demo3'), done: false }, { app: TYPE });
}
// → her tasks, newest first
async function tasks(T){
  await migrate(); await seed(T);
  return ((await M().myRecords.list(TYPE)) || []).filter(r => r && r.t).sort((a, b) => (b.at || 0) - (a.at || 0));
}
async function tick(id){ const it = await M().myRecords.get(TYPE, id); if (it) await M().myRecords.put(TYPE, Object.assign(it, { done: !it.done }), { app: TYPE }); return it; }
async function sharedIds(){
  const core = M(); if (!core.store || !core.store.name || !core.knownList) return new Set();
  try { return new Set(((await core.knownList({ app: TYPE })) || []).map(e => e.item && e.item.id).filter(Boolean)); } catch { return new Set(); }
}
// 告诉他: she shows him one task, as it is now (done or not)
const share = it => M().shareWith({ app: TYPE, title: '清单', id: it.id, line: `她清单上的事：「${it.t}」${it.done ? '（已经做完了）' : '（还没做）'}`, item: { id: it.id, t: it.t, done: !!it.done } });

// The widget's sheet: every task with 删除, and a new one at the top
async function quickSheet(ctx){
  const T = ctx.T, all = await tasks(T);
  ctx.sheet(`<h3>${esc(T('todo.title'))}</h3><div class="items">${all.map(it => `<div><span>${it.done ? '✓ ' : ''}${esc(it.t)}</span><button class="x" data-i="${esc(it.id)}">${esc(T('delete'))}</button></div>`).join('')}</div>
    <input type="text" id="todoNew" placeholder="${esc(T('todo.new'))}"><button class="btn" id="todoAdd">${esc(T('todo.add'))}</button><button class="btn2" data-close>${esc(T('done'))}</button>`, el => {
    el.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => { await M().myRecords.remove(TYPE, b.dataset.i); quickSheet(ctx); });
    el.querySelector('#todoAdd').onclick = async () => {
      const inp = el.querySelector('#todoNew'), t = inp.value.trim(); if (!t) { inp.focus(); return; }
      await M().myRecords.put(TYPE, { t, done: false, at: Math.max(nowMs(), ...all.map(x => (x.at || 0) + 1)) }, { app: TYPE }); quickSheet(ctx);
    };
  });
}

ModuApps.register({
  id: 'todo', version: '0.2', icon: 'i-check', title: 'app.todo', status: 'ready', css: true, records: [], myRecords: [TYPE],
  // what it writes, held to it by a static check
  writes: { records: [], mine: ['todo'], events: {}, chat: 'none' },
  // the home screen's 清单 widget: the first four tasks and how many are left; a tap on one ticks it
  async widget(ctx){
    const all = await tasks(ctx.T);
    return { left: all.filter(x => !x.done).length, total: all.length, items: all.slice(0, 4).map(it => ({ id: it.id, t: it.t, done: !!it.done })) };
  },
  // 'tick:<id>': her tap on a task; 'open': her tap elsewhere on the widget, the quick sheet it always had
  async widgetTap(what, ctx){ const m = /^tick:(.+)$/.exec(String(what || '')); if (m) await tick(m[1]); else if (what === 'open') await quickSheet(ctx); },
  api: { migrate },   // → Promise<number moved>; runs by itself on the first read
  mount(el, ctx){
    const T = ctx.T, core = ctx.core;
    let seq = 0;
    const him = () => (core.pronouns ? core.pronouns().zh : '') || '他';
    async function draw(){
      const my = ++seq, all = await tasks(T), told = await sharedIds();
      if (my !== seq) return;
      const left = all.filter(x => !x.done).length, done = all.length - left;
      const canTell = !!(core.store && core.store.name && core.shareWith);
      const row = it => `<div class="opt a-todo-it${it.done ? ' done' : ''}"><button class="a-todo-ck" data-tick="${esc(it.id)}" aria-label="done"></button><span>${esc(it.t)}</span>` +
        (canTell ? `<button class="val a-todo-tell${told.has(it.id) ? ' on' : ''}" data-tell="${esc(it.id)}">${esc(T(told.has(it.id) ? 'app.todo.told' : 'app.todo.tell', { him: him() }))}</button>` : '') +
        `<button class="val a-todo-x" data-del="${esc(it.id)}">${esc(T('delete'))}</button></div>`;
      el.innerHTML = `<div class="pad-top"></div>
        <div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(T('app.todo'))}</div><div class="sp"><span class="txt">${all.length ? esc(T('todo.left', { n: left })) : ''}</span></div></div>
        <div class="list a-todo">
          <div class="group"><div class="opt a-todo-add"><input type="text" id="a-todo-new" placeholder="${esc(T('todo.new'))}"><button class="val" id="a-todo-addbtn">${esc(T('todo.add'))}</button></div></div>
          ${all.length ? `<div class="group">${all.map(row).join('')}</div>` : `<div class="empty">${esc(T('app.todo.empty'))}</div>`}
          ${done ? `<button class="a-todo-clear" id="a-todo-clear">${esc(T('app.todo.clear', { n: done }))}</button>` : ''}
        </div>`;
      el.querySelectorAll('[data-tick]').forEach(b => b.onclick = async () => { await tick(b.dataset.tick); draw(); });
      el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await core.myRecords.remove(TYPE, b.dataset.del); draw(); });
      el.querySelectorAll('[data-tell]').forEach(b => b.onclick = async () => {
        const it = all.find(x => x.id === b.dataset.tell); if (!it) return;
        try { await share(it); ctx.toast(T('app.todo.told.toast', { name: core.store.name })); } catch(e){ ctx.toast(e.message); }
        draw();
      });
      const add = async () => {
        const inp = el.querySelector('#a-todo-new'), t = inp.value.trim(); if (!t) { inp.focus(); return; }
        inp.value = '';
        await core.myRecords.put(TYPE, { t, done: false, at: Math.max(nowMs(), ...all.map(x => (x.at || 0) + 1)) }, { app: TYPE });   // newest first
        await draw(); const again = el.querySelector('#a-todo-new'); if (again) again.focus();
      };
      el.querySelector('#a-todo-addbtn').onclick = add;
      el.querySelector('#a-todo-new').onkeydown = e => { if (e.key === 'Enter') add(); };
      const cl = el.querySelector('#a-todo-clear'); if (cl) cl.onclick = async () => { for (const it of all.filter(x => x.done)) await core.myRecords.remove(TYPE, it.id); ctx.toast(T('app.todo.cleared')); draw(); };
    }
    draw();
    const off = core.on((ev, d) => { if ((ev === 'records' && d && d.owner === 'her' && d.type === TYPE) || ev === 'loaded' || ev === 'shared') { clearTimeout(draw.t); draw.t = setTimeout(draw, 60); } });
    return () => { off(); clearTimeout(draw.t); };
  },
});
})();
