// 日记 (diary): his own diary, which she reads. He writes it
// himself, in the evening, about his day: app/life.js (window.ModuLife) writes one entry for each
// night that has passed, dated that day. Nothing here asks him to write or rewrite. Each entry is a
// record of type 'diary' in his folder (diary/<YYYY-MM-DD>.json), so it goes with him in export
// and import. Only days that have passed (or tonight, after his evening) are ever shown.
//
// Record: { type:'diary', v:1, id:'YYYY-MM-DD', date:'YYYY-MM-DD', at, text, mood, from:'life'|'model', messages:<n> }
(function(){
'use strict';
const TYPE = 'diary';
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

const M = () => window.ModuCore;
const plain = t => String(t || '').replace(/\s+/g, ' ').trim();
// What 日记 keeps of his own life (the `life` part of register): life.js says "he wrote his diary
// about this day"; the entry is kept here, in the record above.
const LIFE = {
  takes: ['journal'],
  async kept(){ return (await M().records.list(TYPE)).map(d => d.id); },
  async did(d){
    const core = M(), n = (core.store.msgs || []).filter(m => { const x = core.msgDate(m); return x && iso(x) === d.day; }).length;
    await core.records.put(TYPE, { id: d.day, date: d.day, at: d.at, text: d.text, mood: d.mood, from: d.from || 'life', messages: n }, { app: 'diary' });
  },
  // for life.js's own small prompt block: his latest entry
  async remember({ now, since, when }){
    const e = (await M().records.list(TYPE)).filter(d => d.at <= now && d.at > since).sort((a, b) => b.at - a.at)[0];
    return e ? [`- ${when(e.at)}, you wrote in your diary: ${plain(e.text).slice(0, 120)}`] : [];
  },
};

ModuApps.register({
  id: 'diary', version: '0.3', icon: 'i-diary', title: 'app.diary', status: 'ready', css: true, records: [TYPE],
  // what it writes, held to it by a static check
  writes: { records: ['diary'], events: {}, chat: 'none' },
  life: LIFE,
  mount(el, ctx){
    const T = ctx.T, core = ctx.core;
    let entries = [];
    const now = () => core.now ? core.now() : new Date();
    const dayText = k => { const d = new Date(k + 'T00:00'); return T('app.diary.day', { m: d.getMonth() + 1, d: d.getDate() }); };
    // an entry written after midnight belongs to the day before: say 次日 00:05, not that day's 00:05
    const dayOf = at => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const time = at => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    function draw(){
      el.innerHTML = `<div class="pad-top"></div>
        <div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(T('app.diary'))}</div></div>
        <div class="list a-diary">
          ${entries.length ? entries.map(e => `<article class="group a-diary-entry" data-id="${esc(e.id)}"><div class="a-diary-date">${esc(dayText(e.date))}${e.at ? ` <small>${esc(dayOf(e.at) === String(e.date) ? time(e.at) : T('app.diary.late', { t: time(e.at) }))}</small>` : ''}</div><p>${esc(e.text)}</p></article>`).join('')
            : `<div class="empty">${esc(T('app.diary.empty', { name: core.store.name }))}</div>`}
        </div>`;
    }
    async function load(){
      const t = now(), today = iso(t);
      try { entries = (await core.records.list(TYPE)).filter(e => e && e.text && String(e.date) <= today && (!e.at || e.at <= t.getTime())).sort((a, b) => String(b.date).localeCompare(String(a.date))); } catch { entries = []; }
      draw();
    }
    const off = core.on((ev, data) => { if (ev === 'records' && data && data.type === TYPE) { clearTimeout(load.t); load.t = setTimeout(load, 120); } });
    draw(); load();
    if (window.ModuLife) window.ModuLife.wake();
    return () => { off(); clearTimeout(load.t); };
  },
});
})();
