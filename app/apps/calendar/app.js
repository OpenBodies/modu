// 日历 (calendar): her calendar, the full app behind the home screen's 日程 widget.
// Her calendar is on HER phone, so each plan is a record of type 'calendar' in her own store (myRecords), never in a
// companion's folder, and it stays whoever she talks to. The home widget is drawn from this app (widget()), so there is one copy of this code.
// He is not told what is on it. She can show him one plan (告诉他): that goes to him through a knowledge path
// (shareWith), marked as something she shared, and only then is it in his prompt.
// Record: { type:'calendar', v:1, id, at, date, day:'YYYY-MM-DD' ('' for an old undated plan), what, time?:'HH:MM'
// (none = 全天), end?:'HH:MM' (when it ends, only with a time and after it), when?:<free text of an old undated plan> }.
// An older list in localStorage 'modu-cal' = { items:[{ date, what, time? }] } is moved here once (migrate), and the
// old key is kept, never read again, once the move is confirmed.
(function(){
'use strict';
const TYPE = 'calendar', KEY = 'modu-cal', MOVED = 'modu-cal:moved';
const M = () => window.ModuCore;
// time from the core's one clock (ModuCore.now), so ?at= and a test's clock move it too
const nowMs = () => { const c = M(); return c && c.now ? c.now().getTime() : Date.now(); };
const nowD = () => new Date(nowMs());
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const okTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
// a plan's time as words: '19:30', '19:30–21:00' with an end, '' for 全天 (an end without a start, or not after
// it, is not read)
const okEnd = it => okTime(it.time) && okTime(it.end) && it.end > it.time;
const span = it => okTime(it.time) ? it.time + (okEnd(it) ? '–' + it.end : '') : '';
// the next full hour from now (the start a timed plan is offered), at most 23:00; an hour after a start (at most 23:59)
const nextHour = () => pad(Math.min(23, nowD().getHours() + 1)) + ':00';
const hourAfter = t => !okTime(t) ? '' : Number(t.slice(0, 2)) >= 23 ? '23:59' : pad(Number(t.slice(0, 2)) + 1) + t.slice(2);
// when a new plan is: 全天 (a switch, on to start with), or a start time and, if she adds one, an end. On an
// iPhone an empty time box shows nothing at all, so a time box is never shown
// empty; turning 全天 off fills the start with the next full hour, and 加结束时间 fills the end an hour after it.
// st: { timed, time, end, endOn }: what the boxes hold, kept exactly as she picks it (a time is never cleared or hidden
// while she is still turning the wheel); it is read and checked only when she taps 添加 (whenOf). Moving the start moves
// the end with it, keeping the same length. An end is the same day: one at or before the start (past midnight) is not
// kept, and 添加 says so in one quiet line.
// The rows use the page's .opt and .switch, so they look the same in the app and in the sheet (the two small end buttons
// are styled inline: the sheet is outside this app's screen).
const mins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
function whenRows(T, st, p){
  const end = !!st.endOn;
  return `<button type="button" class="opt ${p}-allday${st.timed ? '' : ' on'}" id="${p}-allday" aria-pressed="${!st.timed}"><span>${esc(T('app.calendar.allday'))}</span><span class="switch${st.timed ? '' : ' on'}"></span></button>
    <div class="opt ${p}-when" id="${p}-startrow"${st.timed ? '' : ' hidden'}><span>${esc(T('app.calendar.start'))}</span><input type="time" id="${p}-time" value="${esc(st.time)}" aria-label="${esc(T('app.calendar.start'))}"></div>
    <div class="opt ${p}-when" id="${p}-endrow"${st.timed ? '' : ' hidden'}><span>${esc(T('app.calendar.end'))}</span><input type="time" id="${p}-end" value="${esc(st.end)}" aria-label="${esc(T('app.calendar.end'))}"${end ? '' : ' hidden'}><button type="button" class="${p}-endx" id="${p}-endx" style="flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:var(--m-soft);color:var(--m-muted)" aria-label="${esc(T('app.calendar.end.none'))}"${end ? '' : ' hidden'}>×</button><button type="button" class="${p}-endadd" id="${p}-endadd" style="flex:0 0 auto;color:var(--m-accent);font-weight:600"${end ? ' hidden' : ''}>${esc(T('app.calendar.end.add'))}</button></div>`;
}
function bindWhen(root, st, p){
  const q = id => root.querySelector('#' + p + '-' + id);
  const all = q('allday'), tIn = q('time'), eIn = q('end');
  const show = () => {
    all.classList.toggle('on', !st.timed); all.setAttribute('aria-pressed', String(!st.timed)); all.querySelector('.switch').classList.toggle('on', !st.timed);
    q('startrow').hidden = q('endrow').hidden = !st.timed;
    eIn.hidden = q('endx').hidden = !st.endOn; q('endadd').hidden = !!st.endOn;
    if (tIn.value !== st.time) tIn.value = st.time;
    if (eIn.value !== st.end) eIn.value = st.end;
  };
  all.onclick = () => { st.timed = !st.timed; if (st.timed && !okTime(st.time)) st.time = nextHour(); show(); };
  // a time picked (or typed) turns 全天 off; the end follows the start by the same length (at most to 23:59)
  tIn.oninput = tIn.onchange = () => {
    const was = st.time, now = tIn.value;
    // a start cleared (the picker's 重置) is 全天 again: never an empty time box left showing (an iPhone draws it as nothing)
    if (!okTime(now)){ Object.assign(st, blankWhen()); show(); return; }
    st.time = now; st.timed = true;
    if (st.endOn && okTime(was) && okTime(now) && okTime(st.end) && mins(st.end) > mins(was)){
      st.end = hhmm(Math.min(23 * 60 + 59, mins(st.end) + mins(now) - mins(was))); eIn.value = st.end;
    }
    all.classList.toggle('on', !st.timed); all.querySelector('.switch').classList.toggle('on', !st.timed); q('startrow').hidden = q('endrow').hidden = !st.timed;
  };
  // kept as it is, checked at 添加; an end cleared on the picker is no end: 加结束时间 comes back (no empty 结束 × row)
  eIn.oninput = eIn.onchange = () => { st.end = eIn.value; if (!st.end){ st.endOn = false; show(); } };
  q('endadd').onclick = () => { st.endOn = true; st.end = hourAfter(okTime(st.time) ? st.time : nextHour()); show(); };
  q('endx').onclick = () => { st.endOn = false; st.end = ''; show(); };
  show();
}
// what a new plan gets from the rows: { time?, end? }, and dropped: true when an end was there but could not be kept
// (not after the start)
const whenOf = st => {
  const o = {}; if (!(st.timed && okTime(st.time))) return o;
  o.time = st.time;
  // an empty end is simply no end; one that is there but not after the start is dropped, and said
  if (st.endOn && st.end){ if (okTime(st.end) && st.end > st.time) o.end = st.end; else Object.defineProperty(o, 'dropped', { value: true }); }
  return o;
};
const blankWhen = () => ({ timed: false, time: '', end: '', endOn: false });
// by day, then 全天 first, then by time
const order = (a, b) => (a.day || '9').localeCompare(b.day || '9') || (okTime(a.time) ? a.time : '').localeCompare(okTime(b.time) ? b.time : '');
const dayZh = date => { const d = new Date(date + 'T00:00'); return isNaN(d) ? '' : `${d.getMonth() + 1}月${d.getDate()}日`; };
const WEEK_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function toRec(it, id, at){
  const r = { id, at, day: typeof it.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : '', what: String(it.what || '') };
  if (okTime(it.time)) r.time = it.time;
  if (okTime(it.time) && okTime(it.end) && it.end > it.time) r.end = it.end;
  if (!r.day && it.when) r.when = String(it.when);
  return r;
}

// One time: the plans she had in this browser (localStorage 'modu-cal') become records on her phone. Read back
// before the move counts as done; until then nothing is lost (the old key stays, and a retry writes the same ids).
let moving = null;
function migrate(){
  if (!moving) moving = (async () => {
    const core = M(); if (!core || !core.myRecords || !core.myStore || core.myStore.where !== 'phone') return 0;
    let items = null;
    try { if (localStorage.getItem(MOVED)) return 0; const c = JSON.parse(localStorage.getItem(KEY) || 'null'); items = c && Array.isArray(c.items) ? c.items : null; } catch { return 0; }
    if (!items) return 0;
    const keep = items.map((it, i) => [it, 'lm' + i]).filter(([it]) => it && it.what), base = nowMs();
    for (const [it, id] of keep) if (!(await core.myRecords.get(TYPE, id))) await core.myRecords.put(TYPE, toRec(it, id, base + Number(id.slice(2))), { app: TYPE });
    const have = new Set(((await core.myRecords.list(TYPE)) || []).map(r => r.id));
    if (!keep.every(([, id]) => have.has(id))) { moving = null; return 0; }
    try { localStorage.setItem(MOVED, JSON.stringify({ at: nowMs(), n: keep.length, to: 'her phone: calendar records' })); } catch {}
    return keep.length;
  })().catch(e => { console.error(e); moving = null; return 0; });
  return moving;
}
// The demo (her store kept in memory for the visit) starts with two sample plans.
let seeded = false;
async function seed(T){
  const core = M(); if (seeded || !core.myStore || core.myStore.where !== 'memory') return; seeded = true;
  if (((await core.myRecords.list(TYPE)) || []).length) return;
  const at = n => { const d = nowD(); d.setDate(d.getDate() + n); return iso(d); };
  const sun = (7 - nowD().getDay()) % 7 || 7, t = nowMs();
  await core.myRecords.put(TYPE, { id: 'demo1', at: t, day: at(sun), what: T('cal.demo.what1') }, { app: TYPE });
  await core.myRecords.put(TYPE, { id: 'demo2', at: t + 1, day: at(sun + 3), what: T('cal.demo.what2') }, { app: TYPE });
}
// → her plans, sorted by day then time
async function plans(T){
  await migrate(); await seed(T);
  const l = (await M().myRecords.list(TYPE)) || [];
  return l.filter(r => r && r.what).sort(order);
}
const upcoming = (all, today) => all.filter(it => !it.day || it.day >= today);
// what she shared with the companion open now, by plan id
async function sharedIds(){
  const core = M(); if (!core.store || !core.store.name || !core.knownList) return new Set();
  try { return new Set(((await core.knownList({ app: TYPE })) || []).map(e => e.item && e.item.id).filter(Boolean)); } catch { return new Set(); }
}
// 告诉他: she shows him one plan. He keeps what she showed him (his folder, 'known'), until the day is over.
function share(it){
  const d = it.day ? new Date(it.day + 'T00:00') : null;
  const when = d ? `${dayZh(it.day)} ${WEEK_ZH[d.getDay()]} ${span(it) || '全天'}` : (it.when || '');
  const end = d ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() : undefined;
  return M().shareWith({ app: TYPE, title: '日历', id: it.id, line: `她日历上的安排：${when}「${it.what}」`, until: end, item: Object.assign({ id: it.id, day: it.day, time: it.time || '', what: it.what }, okEnd(it) ? { end: it.end } : {}) });
}

function labelFor(T, it, today){
  if (!it.day) return it.when || '';
  const d = new Date(it.day + 'T00:00'), n = Math.round((d - new Date(today + 'T00:00')) / 864e5);
  const WEEK = T('app.calendar.weekdays').split(/\s+/);
  return n === 0 ? T('cal.today') : n === 1 ? T('cal.tomorrow') : n > 1 && n < 7 ? WEEK[d.getDay()] || '' : T('app.calendar.day', { m: d.getMonth() + 1, d: d.getDate() });
}

// The widget's sheet: the month with her days marked, every plan with 删除,
// and a day, a time and what, to add one. Each change goes to her phone and the sheet draws again.
// the sheet's when (and day), kept while it draws again after a delete
let quickWhen = blankWhen(), quickDay = '';
async function quickSheet(ctx){
  const T = ctx.T, all = await plans(T), now = nowD(), y = now.getFullYear(), m = now.getMonth(), today = iso(now);
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), has = new Set(all.map(it => it.day));
  let grid = '日一二三四五六'.split('').map(c => `<span class="h">${c}</span>`).join('') + '<span></span>'.repeat(first);
  for (let i = 1; i <= days; i++){ const k = iso(new Date(y, m, i)); grid += `<span class="${i === now.getDate() ? 'today' : ''} ${has.has(k) ? 'has' : ''}">${i}</span>`; }
  const label = it => it.day ? labelFor(T, it, today) + ' ' + (span(it) || T('app.calendar.allday')) : it.when || '';
  const st = quickWhen;
  ctx.sheet(`<h3>${esc(T('cal.title'))} · ${m + 1}月</h3><div class="month">${grid}</div>
    <div class="items">${all.map(it => `<div><span><small>${esc(label(it))}</small>${esc(it.what)}</span><button class="x" data-i="${esc(it.id)}">${esc(T('delete'))}</button></div>`).join('')}</div>
    <div class="row2"><input type="date" id="calDate" value="${esc(quickDay || today)}"><input type="text" id="calWhat" placeholder="${esc(T('cal.what'))}"></div><div class="calwhen">${whenRows(T, st, 'calw')}</div>
    <button class="btn" id="calAdd">${esc(T('cal.add'))}</button><button class="btn2" data-close>${esc(T('done'))}</button>`, el => {
    el.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => { await M().myRecords.remove(TYPE, b.dataset.i); quickSheet(ctx); });
    bindWhen(el, st, 'calw');
    el.querySelector('#calDate').onchange = e => { quickDay = e.target.value; };
    el.querySelector('#calAdd').onclick = async () => {
      const w = el.querySelector('#calWhat'), what = w.value.trim(); if (!what) { w.focus(); return; }
      const d = el.querySelector('#calDate').value;
      const wh = whenOf(st), it = Object.assign({ day: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today, what }, wh);
      if (wh.dropped) ctx.toast(T('app.calendar.end.dropped'));
      quickWhen = blankWhen(); quickDay = '';
      await M().myRecords.put(TYPE, it, { app: TYPE }); quickSheet(ctx);
    };
  });
}

ModuApps.register({
  id: 'calendar', version: '0.3', icon: 'i-cal', title: 'app.calendar', status: 'ready', css: true, records: [], myRecords: [TYPE],
  // what it writes, held to it by a static check
  writes: { records: [], mine: ['calendar'], events: {}, chat: 'none' },
  // the home screen's 日程 widget: the next two plans, each with its day and its time (or 全天)
  async widget(ctx){
    const T = ctx.T, today = iso(nowD());
    const next = upcoming(await plans(T), today).slice(0, 2);
    return { items: next.map(it => ({ id: it.id, label: it.day ? labelFor(T, it, today) + ' ' + (span(it) || T('app.calendar.allday')) : it.when || '', what: it.what })) };
  },
  // her tap on the widget ('open'): the quick sheet it always had (this month, her plans, add one on any day),
  // drawn by this app in the page's sheet, so the page keeps no code for it
  async widgetTap(what, ctx){ if (what === 'open') await quickSheet(ctx); },
  api: { migrate },   // → Promise<number moved>; runs by itself on the first read, so no one needs to call it
  mount(el, ctx){
    const T = ctx.T, core = ctx.core;
    const today = iso(nowD());
    let sel = today; const view = nowD(); view.setDate(1);
    const WEEK = T('app.calendar.weekdays').split(/\s+/);   // 周日 周一 …
    // when the next plan she adds is: 全天, or a start and maybe an end (kept while the screen draws again)
    const when = blankWhen();
    let seq = 0;
    const timeText = it => span(it) || T('app.calendar.allday');
    const him = () => (core.pronouns ? core.pronouns().zh : '') || '他';
    async function draw(){
      const my = ++seq, all = await plans(T), told = await sharedIds();
      if (my !== seq) return;
      const has = new Set(all.map(it => it.day)), y = view.getFullYear(), m = view.getMonth();
      const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
      let grid = T('app.calendar.week').split(/\s+/).map(h => `<span class="a-calendar-h">${esc(h)}</span>`).join('') + '<span></span>'.repeat(first);
      for (let i = 1; i <= days; i++){
        const k = iso(new Date(y, m, i));
        grid += `<button class="a-calendar-d${k === today ? ' today' : ''}${k === sel ? ' sel' : ''}${has.has(k) ? ' has' : ''}" data-day="${k}">${i}</button>`;
      }
      const sd = new Date(sel + 'T00:00'), dayItems = all.filter(it => it.day === sel);
      const next = upcoming(all, today);
      const canTell = !!(core.store && core.store.name && core.shareWith);
      // each plan: its time (or 全天) on the left; under 接下来 its day above the words; 告诉他 to show him this one
      const row = withDay => it => `<div class="opt a-calendar-it">${it.day ? `<span class="a-calendar-at${okTime(it.time) ? '' : ' allday'}">${esc(timeText(it))}</span>` : ''}<span>${withDay || !it.day ? `<small>${esc(labelFor(T, it, today))}</small>` : ''}${esc(it.what)}</span>` +
        (canTell ? `<button class="val a-calendar-tell${told.has(it.id) ? ' on' : ''}" data-tell="${esc(it.id)}">${esc(T(told.has(it.id) ? 'app.calendar.told' : 'app.calendar.tell', { him: him() }))}</button>` : '') +
        `<button class="val a-calendar-x" data-del="${esc(it.id)}">${esc(T('delete'))}</button></div>`;
      el.innerHTML = `<div class="pad-top"></div>
        <div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(T('app.calendar'))}</div></div>
        <div class="list a-calendar">
          <div class="group a-calendar-month">
            <div class="a-calendar-nav"><button data-mon="-1" aria-label="prev">‹</button><b>${esc(T('app.calendar.month', { y, m: m + 1 }))}</b><button data-mon="1" aria-label="next">›</button></div>
            <div class="a-calendar-grid">${grid}</div>
          </div>
          <div class="gtitle">${esc(T('app.calendar.day', { m: sd.getMonth() + 1, d: sd.getDate() }))} ${esc(WEEK[sd.getDay()] || '')}</div>
          <div class="group">
            ${dayItems.length ? dayItems.map(row(false)).join('') : `<div class="opt a-calendar-none"><span>${esc(T('app.calendar.none'))}</span></div>`}
            <div class="opt a-calendar-add"><input type="text" id="a-calendar-what" placeholder="${esc(T('cal.what'))}"><button class="val" id="a-calendar-addbtn">${esc(T('cal.add'))}</button></div>
            ${whenRows(T, when, 'a-calendar')}
          </div>
          <div class="gtitle">${esc(T('app.calendar.upcoming'))}</div>
          <div class="group">${next.length ? next.map(row(true)).join('') : `<div class="opt a-calendar-none"><span>${esc(T('app.calendar.upcoming.none'))}</span></div>`}</div>
        </div>`;
      el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { sel = b.dataset.day; draw(); });
      el.querySelectorAll('[data-mon]').forEach(b => b.onclick = () => { view.setMonth(view.getMonth() + Number(b.dataset.mon)); draw(); });
      el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await core.myRecords.remove(TYPE, b.dataset.del); draw(); });
      el.querySelectorAll('[data-tell]').forEach(b => b.onclick = async () => {
        const it = all.find(x => x.id === b.dataset.tell); if (!it) return;
        try { await share(it); ctx.toast(T('app.calendar.told.toast', { name: core.store.name })); } catch(e){ ctx.toast(e.message); }
        draw();
      });
      const add = async () => {
        const inp = el.querySelector('#a-calendar-what'), what = inp.value.trim(); if (!what) { inp.focus(); return; }
        const w = whenOf(when), it = Object.assign({ day: sel, what }, w);
        Object.assign(when, blankWhen());
        await core.myRecords.put(TYPE, it, { app: TYPE });
        ctx.toast(T(w.dropped ? 'app.calendar.end.dropped' : 'app.calendar.added')); draw();   // an end that could not be kept is said
      };
      el.querySelector('#a-calendar-addbtn').onclick = add;
      bindWhen(el, when, 'a-calendar');
      el.querySelector('#a-calendar-what').onkeydown = e => { if (e.key === 'Enter') add(); };
    }
    draw();
    // her calendar changed (the widget, another screen), or another companion is open (what he was told): draw again
    const off = core.on((ev, d) => { if ((ev === 'records' && d && d.owner === 'her' && d.type === TYPE) || ev === 'loaded' || ev === 'shared') { clearTimeout(draw.t); draw.t = setTimeout(draw, 60); } });
    return () => { off(); clearTimeout(draw.t); };
  },
});
})();
