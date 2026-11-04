// 通话 (call), the dock's app: 视频通话 as a contact-scoped session.
// - The dock opens this app's screen: 最近通话 (her phone's call list, plus his `call` events) and 联系人. A tap
//   on a person calls him (the page opens him first when he is not the one open).
// - The call itself stays the page's own screen (#s-call: his face, his voice, the mic). When a call
//   starts, the page asks this app for the call (`live(ctx)`): one app session. Her words and his go to him
//   through s.turn, never into the chat.
// - When it ends: the whole call is one record of his (`call`, with the transcript), one line on her phone
//   (`calls`, for 最近通话), one `call` event (length and a one-line gist, so in chat he knows it happened), and
//   ONE neutral card in the chat: [视频通话] 通话时长 03:12 · the gist. Her tap on it opens the transcript.
// Calls made before this app (each line a chat message) stay in the chat as they were.
(function(){
'use strict';
const ID = 'call', TYPE = 'call', MINE = 'calls';
const M = () => window.ModuCore;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const pad = n => String(n).padStart(2, '0');
const nowMs = () => { const c = M(); return c.now ? c.now().getTime() : Date.now(); };
// seconds → mm:ss (h:mm:ss past an hour)
function len(secs){
  secs = Math.max(0, Math.round(Number(secs) || 0));
  const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
  return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
}
const plain = t => String(t || '').replace(/\*[^*\n]+\*/g, '').replace(/\s+/g, ' ').trim();

// ---- what he is told on a call (not shown to her; like the core's own rules, kept in code) ----
const RULE = `(This is a video call in the phone, not the chat.) You are on a video call with her right now. You can see each other; her camera may be off, and what she says reaches you as her words. Answer the way you would speak on a call: short and spoken, one to three sentences, no *actions*, no describing the call itself. Never say that there is only text, or that you can't see or hear her because this is text.`;
const LINES = 24;
function told(lines, said, secs){
  const before = lines.slice(-LINES).map(l => (l.who === 'her' ? '她' : '你') + '：' + clip(l.text, 200)).join('\n');
  return [RULE + ` The call has lasted ${len(secs)} so far.`,
    before ? 'Said so far on this call (她 = her, 你 = you):\n' + before : 'The call has just connected.',
    `She says now: 「${said}」`].join('\n');
}
// the one-line gist: asked of the model with its own short prompt (neutral, nobody's voice); else her first words
const GIST = 'Below is a video call between her (她) and him (你). Write ONE short neutral line saying what they talked about, in the language of the call, at most 20 Chinese characters or 12 English words, like 聊了周末去看海的事. No quotes, no names, nothing else.';
async function gistOf(lines, T){
  if (!lines.length) return '';
  const text = lines.slice(-40).map(l => (l.who === 'her' ? '她' : '你') + '：' + clip(l.text, 160)).join('\n');
  try {
    const s = M().loadSettings(), asked = [{ role:'system', content: GIST }, { role:'user', content: text }];
    const heard = M().calls && M().calls.note ? M().calls.note('call', asked, { settings: s }) : (x => x);   // counted for the cost meter
    const raw = heard(await M().callModel(s, asked, { max_tokens: 60 }));
    const g = clip(String(raw || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '', 40).replace(/^[「"“'【\[]+|[」"”'】\]]+$/g, '').replace(/[。.]$/, '');
    if (g && !/^\[?emotion/i.test(g)) return g;
  } catch {}
  const first = lines.find(l => l.who === 'her') || lines[0];
  return T('app.call.gist.fallback', { q: clip(first.text, 14) });
}

// ---- one call: the session the page's call screen runs (live) ----
// ctx: the page's ctx plus session (as a mount's). → { id, lines, say(text) → Promise<{ text, mood, noReply }>,
// end() → Promise<{ session, card }> } or null with nobody open.
function live(ctx){
  const core = M(), who = ctx.contact; if (!who || !who.id && !who.name) return null;
  const T = ctx.T, t0 = nowMs(), lines = [];
  const s = ctx.session.begin({ title: T('app.call.video') });
  s.hold('你们正在视频通话');
  const secs = () => Math.max(0, Math.round((nowMs() - t0) / 1000));
  const base = () => ({ id: s.id, kind: 'video', contact: who.id, name: who.name, at: t0, secs: secs(), lines: lines.slice() });
  // the transcript is kept as it grows, so a reload in the middle of a call loses nothing she said
  let saving = Promise.resolve();
  const keep = extra => { const r = Object.assign(base(), extra); saving = saving.then(() => core.records.put('call', r, { app: ID })).catch(e => console.error(e)); return saving; };
  let ended = null;
  return {
    id: s.id, lines, contact: who,
    async say(text){
      text = String(text || '').trim(); if (!text || ended) return null;
      const at = nowMs();
      const r = await s.turn(told(lines, text, secs()), { max: 300 });
      lines.push({ who: 'her', text, at });
      const said = core.tidyCJK(plain(r.text));
      if (!r.noReply && said) lines.push({ who: 'him', text: said, mood: r.mood, at: nowMs() });
      keep({});
      return { text: r.noReply ? '' : said, mood: r.mood, noReply: r.noReply || !said };
    },
    end(){
      if (ended) return ended;
      const n = secs();
      ended = (async () => {
        await keep({ secs: n });
        // only while he is still the one open: his folder, his log, his chat
        const still = () => (core.currentId || '') === (who.id || '');
        const gist = await gistOf(lines, T);
        if (!still()) return s.end();
        await keep({ secs: n, gist });
        try { await core.myRecords.put('calls', { id: s.id, contact: who.id, name: who.name, at: t0, secs: n, gist }, { app: ID }); } catch(e){ console.error(e); }
        const last = l => { const x = [...lines].reverse().find(y => y.who === l); return x ? clip(x.text, 40) : ''; };
        const line = `视频通话 ${len(n)}` + (gist ? `：${gist}` : '，没有说话') + (lines.length ? `（她最后说「${last('her')}」` + (last('him') ? `，你说「${last('him')}」` : '') + '）' : '');
        try { await s.log({ who: 'both', what: 'call', line, detail: { id: s.id, secs: n, lines: lines.length } }); } catch(e){ console.error(e); }
        return s.end({ card: { line: T('app.call.card', { len: len(n) }) + (gist ? ' · ' + gist : ''), id: s.id, type: TYPE } });
      })().catch(e => { console.error(e); return s.end(); });
      return ended;
    },
  };
}

// ---- the call card (a neutral card, tappable): the transcript, one tap away ----
async function cardTap(msg, ctx){
  const c = msg && msg.extra && msg.extra.modu_card; if (!c || !c.id) return;
  let r = null; try { r = await M().records.get(TYPE, c.id); } catch {}
  if (!r) return;
  const T = ctx.T, him = r.name || M().store.name;
  const d = new Date(r.at);
  const rows = (r.lines || []).map(l => `<div><span><small>${esc(l.who === 'her' ? T('app.call.her') : him)}</small>${esc(l.text)}</span></div>`).join('');
  ctx.sheet(`<h3><svg class="ic"><use href="#i-video"/></svg>${esc(T('app.call.video'))}</h3>
    <p>${esc(`${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`)} · ${esc(T('app.call.sheet.len', { len: len(r.secs) }))}${r.gist ? '<br>' + esc(r.gist) : ''}</p>
    ${rows ? `<div class="items a-call-script">${rows}</div>` : `<p>${esc(T('app.call.sheet.none'))}</p>`}
    <button class="btn2" data-close>${esc(T('done'))}</button>`);
}

// ---- 最近通话: her phone's list, and his call events (the one open) ----
async function recents(){
  const core = M(), out = new Map();
  try { for (const r of await core.myRecords.list(MINE)) if (r && r.id) out.set(r.id, r); } catch {}
  try {
    for (const e of await core.eventList({ app: ID, days: 60 })){
      if (e.what !== 'call') continue;
      const id = (e.detail && e.detail.id) || e.id;
      if (!out.has(id)) out.set(id, { id, contact: core.currentId, name: core.store.name, at: e.at, secs: e.detail && e.detail.secs, gist: '' });
    }
  } catch {}
  return [...out.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30);
}
function when(at, T){
  const d = new Date(at), n = new Date(nowMs()), y = new Date(n); y.setDate(n.getDate() - 1);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === n.toDateString()) return hm;
  if (d.toDateString() === y.toDateString()) return T('app.call.yesterday') + ' ' + hm;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

ModuApps.register({
  id: 'call', version: '0.1', icon: 'i-video', title: 'app.call.title', status: 'ready', css: true,
  page: 0,   // the dock's, not a page-2 tile
  records: [TYPE], myRecords: [MINE],
  // what it writes, held to it by a static check
  scope: 'phone', surface: 'screen',
  writes: { records: ['call'], mine: ['calls'], events: { call: '视频通话' }, chat: 'summary' },
  mount(el, ctx){
    const core = ctx.core, T = ctx.T;
    let alive = true;
    const av = c => c && c.avatar ? ` style="background-image:url(&quot;${esc(c.avatar)}&quot;)"` : '';
    async function draw(){
      const list = await recents(); if (!alive) return;
      const people = core.contacts || [];
      const byId = id => people.find(c => c.id === id) || null;
      el.innerHTML = `<div class="pad-top"></div>
        <div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(T('app.call.title'))}</div></div>
        <div class="clist a-call">
          <div class="a-call-h">${esc(T('app.call.recent'))}</div>
          ${list.length ? list.map(r => { const c = byId(r.contact);
            return `<button class="citem a-call-recent" data-call="${esc(c ? c.id : '')}" data-id="${esc(r.id)}"${c ? '' : ' disabled'}><div class="av"${av(c)}></div><div class="cmid"><b>${esc((c && c.name) || r.name || '')}</b><small>${esc(T('app.call.row', { len: len(r.secs) }) + (r.gist ? ' · ' + r.gist : '') + (c ? '' : ' · ' + T('app.call.gone')))}</small></div><small class="t">${esc(when(r.at, T))}</small></button>`; }).join('')
            : `<div class="a-call-none">${esc(T('app.call.recent.none'))}</div>`}
          <div class="a-call-h">${esc(T('app.call.contacts'))}</div>
          ${people.map(c => `<button class="citem a-call-who" data-call="${esc(c.id)}"><div class="av"${av(c)}></div><div class="cmid"><b>${esc(c.name || '')}</b><small>${esc(T('app.call.video'))}</small></div><svg class="ic a-call-ic"><use href="#i-video"/></svg></button>`).join('')}
        </div>`;
      el.querySelectorAll('[data-call]').forEach(b => b.onclick = () => { if (b.dataset.call) ctx.go('call', { contact: b.dataset.call }); });
    }
    draw();
    const off = core.on(ev => { if (ev === 'contacts') draw(); });
    return () => { alive = false; off(); };
  },
  // the page's call screen (#s-call) asks for each call
  live,
  // the call card is a neutral line the page makes tappable for an app with cardTap
  cardTap,
  // for tests and other apps; README.md
  api: { live, len, told, gistOf, recents },
});
})();
