// 信箱 (mail): slow letters. She writes him a letter; he writes one back, and it comes when it comes:
// from five minutes to most of a day, by how his day is going, with no countdown. When it arrives the
// phone says so (a badge on 信箱, a notice). Letters are records of type 'letter' in his folder,
// so they live with him, not in the chat.
(function(){
'use strict';
const TYPE = 'letter';
const writing = new Set();   // replies being written right now (they finish even if she leaves the app)
const views = new Set();     // the open 信箱 screen's redraw, called after each background round
let watchCtx = null;         // what the page gave watch(): T, badge(n), notify(text)
const core = () => window.ModuCore;
const now = () => { const M = core(); return M && M.now ? +M.now() : Date.now(); };   // the core's clock (a test may move it)
const his = () => (core() && core().store.name) || '';
// 信箱 is not finished yet (the page holds it in the registry outside developer mode). While it is held
// nothing here runs: no letter is written (no model call for a letter she cannot open), none is announced, no badge.
const shelved = () => { const a = window.ModuApps && window.ModuApps.get('mail'); return !!(a && a.status !== 'ready'); };
const arrived = r => r.from !== 'him' || (r.text && now() >= (r.due || 0));
// a reply the model could not write is held, never dropped: tried again on its own, later each time
// (1, 5, 15, 30 minutes, then every hour), and at once when she taps 再试一次.
// an empty or unreadable answer is still a paid call, so it is tried again by itself at most 3 times
// (TRIES: the first try and 3 more); then it is left (`stopped`, no retryAt, no job) until she taps 再试一次.
const RETRY_MIN = [1, 5, 15, 30, 60], TRIES = 4;
const retryIn = tries => RETRY_MIN[Math.min(Math.max(tries, 1), RETRY_MIN.length) - 1] * 60000;
const held = r => r.from === 'him' && !r.text && (r.status === 'held' || r.status === 'failed');   // 'failed': older records, read as held
const stopped = r => held(r) && (r.stopped || (r.tries || 0) >= TRIES);

// when his letter comes is his, not a countdown: somewhere between 5 minutes and 20
// hours, by how he is when her letter reaches him. Free (here): 5 min to 2 h; busy: 1 to 8 h; asleep: 6 to
// 20 h. Spread evenly on a log scale, so the short end of each range comes as often as the long end.
// The one place letter timing is decided: a future scheduler that owns all of his timing replaces this.
const MIN = 60000, HOUR = 60 * MIN;
const DELAY = { here: [5 * MIN, 2 * HOUR], busy: [1 * HOUR, 8 * HOUR], asleep: [6 * HOUR, 20 * HOUR] };
function replyDelay(state, rand = Math.random()){
  const [lo, hi] = DELAY[state] || DELAY.here, u = Math.min(1, Math.max(0, Number(rand) || 0));
  return Math.round(lo * Math.pow(hi / lo, u));
}

// What he is asked to do, after his usual context (persona, memory, recent chat; no texting rule, no mood).
function letterRule(name, user){
  return `${user} has written you a letter, not a text message. It is below, as her last message. ` +
    `Write ${name}'s letter back to her, in your own voice. A letter is slower and fuller than texting: ` +
    `a few paragraphs of plain prose. No chat bubbles, no *actions*, no tags. Answer what she wrote, and you ` +
    `may tell her about your own days. Never invent facts about her. Begin by greeting her, end with your ` +
    `name. Write in the language of her letter.`;
}

// He writes the reply now; it shows when it is due. It is saved even if she has left the app, but only
// into the folder of the contact it was written for. If the model cannot be reached the reply is held
// (status 'held', retryAt, tries; `why` keeps the error for developers) and tried again later.
async function writeReply(reply){
  const M = core();
  if (!M || writing.has(reply.id)) return;
  writing.add(reply.id);
  const contact = M.currentId;
  try {
    const all = await M.records.list(TYPE);
    const hers = all.find(r => r.id === reply.replyTo);
    if (!hers) throw new Error('no letter');
    const earlier = all.filter(r => r.at < hers.at && r.text && arrived(r)).slice(-4)
      .map(r => `${r.from === 'him' ? his() : 'She'} (${new Date(r.at).toISOString().slice(0, 10)}):\n${r.text}`).join('\n\n');
    // her own name (聊天设置), else her chat's, else 'She'
    const user = (u => u && u !== 'You' ? u : 'She')(M.userName ? M.userName() : M.store.meta && M.store.meta.user_name);
    const settings = M.loadSettings();
    const messages = M.buildContext({ settings, bubbles: false, emotion: false }).messages;
    messages.push({ role: 'system', content: letterRule(his(), user) + (earlier ? `\n\nYour letters so far (oldest first):\n\n${earlier}` : '') });
    messages.push({ role: 'user', content: hers.text });
    const heard = (M.calls && M.calls.note ? M.calls.note('letter', messages, { settings: settings }) : (x => x));   // counted for the cost meter (设置 → 用量)
    const raw = heard(await M.callModel(settings, messages, { max_tokens: 1200 }));
    const text = M.tidyCJK(M.splitEmotion(String(raw || '')).text.trim());
    if (!text) throw new Error('empty');
    if (M.currentId !== contact) return;
    // written after it was due (it was held): it arrives now, and is dated now
    const r = Object.assign({}, reply, { text, status: 'ready', due: Math.max(reply.due || 0, now()) });
    delete r.retryAt; delete r.why; delete r.stopped;
    await M.records.put(TYPE, r, { app: 'mail' });
    await book(M, [r]);   // its arrival, on the one clock
  } catch(e){
    const tries = (reply.tries || 0) + 1, h0 = Object.assign({}, reply, { status: 'held', tries, why: String(e && e.message || e).slice(0, 160) });
    if (tries >= TRIES){ h0.stopped = true; delete h0.retryAt; } else { delete h0.stopped; h0.retryAt = now() + retryIn(tries); }
    if (M.currentId === contact){ const h = await M.records.put(TYPE, h0, { app: 'mail' }).catch(() => null); if (h) await book(M, [h]); }
  } finally {
    writing.delete(reply.id);
  }
}
// One background round, every half minute, when 信箱 opens, and when a letter changes: a reply that was being
// written when the page closed is written now; a held one is tried again once its time has come; a letter
// of his that has arrived and was not announced yet is announced (once); the 信箱 badge counts his unread ones.
let round = null;
async function tick(){
  if (round) return round;
  round = (async () => {
    const M = core();
    if (!M || !M.records || !M.store || !M.store.name || shelved()) return;
    let list; try { list = await M.records.list(TYPE); } catch { return; }
    if (!Array.isArray(list)) return;   // another core may have no letters to give
    const paused = !!(M.paused && M.paused());   // 暂停: no model call; a letter waits until she is back
    for (const r of list){
      if (paused || r.from !== 'him' || r.text || writing.has(r.id)) continue;
      if (r.status === 'writing' || (held(r) && !stopped(r) && now() >= (r.retryAt || 0))) writeReply(r);
    }
    for (const r of list) if (r.from === 'him' && arrived(r) && !r.read && !r.notified){
      await M.records.put(TYPE, Object.assign({}, r, { notified: now() }), { app: 'mail' }).catch(() => {});
      if (watchCtx && watchCtx.notify) watchCtx.notify(watchCtx.T('app.mail.arrived', { name: his() }), { tag: 'modu-mail-' + r.id });
    }
    if (watchCtx && watchCtx.badge) watchCtx.badge(list.filter(r => r.from === 'him' && arrived(r) && !r.read).length);
  })().finally(() => { round = null; });
  await round;
  for (const v of views) v();
}
// No timer of its own. When his letter is due, and when a held one is tried again, are jobs in his
// folder, booked by id when the letter is written or held, and run by the one clock (app/core/clock.js),
// which calls tick. (A letter with no job is announced by the round on open, on any record change, or in 信箱.)
// again: a suffix for the ids, so a letter whose job was put off while 信箱 was held is booked anew at its own time
async function book(M, list, again = ''){
  if (!M.jobs) return;
  for (const r of list){
    if (r.from !== 'him') continue;
    if (held(r) && !stopped(r) && r.retryAt) await M.jobs.add({ id: `letter-retry-${r.id}-${r.tries || 0}${again}`, owner: 'mail', kind: 'retry', at: r.retryAt }).catch(() => {});
    else if (r.text && !r.notified && r.due) await M.jobs.add({ id: 'letter-' + r.id + again, owner: 'mail', kind: 'letter', at: r.due }).catch(() => {});
  }
}
// while held, a letter job that comes due is put off a day (no write on every beat); when 信箱 is let go its
// letters are booked again at their own times (below), so a put-off job only runs a round that finds nothing to do
if (core() && core().jobs) core().jobs.handle('mail', job => shelved() ? { at: now() + 24 * HOUR } : (job.kind === 'retry' && core().paused && core().paused()) ? { at: now() + 30 * 60000 } : tick());
// held or let go (the developer switch). Held: his prompt says nothing of letters (the life block leaves the
// type out). Let go: the round runs at once (a reply left half-written is written, one that came is announced) and every
// letter's job is booked again at its own time.
let wasShelved = null;
if (window.ModuApps && window.ModuApps.on) window.ModuApps.on(ev => {
  if (ev !== 'apps' || !window.ModuApps.get('mail')) return;
  const now0 = shelved(), M = core(); if (now0 === wasShelved) return;
  const before = wasShelved; wasShelved = now0;
  if (M && M.lifeTypes && M.lifeTypes.hold) M.lifeTypes.hold(TYPE, now0);
  if (before && !now0 && M && M.records) tick().then(() => M.records.list(TYPE)).then(l => Array.isArray(l) && book(M, l, '-u' + now())).catch(() => {});
});

ModuApps.register({
  id: 'mail', version: '0.3', icon: 'i-mail', title: 'app.mail', status: 'ready', css: true, records: [TYPE],
  // what it writes, held to it by a static check
  writes: { records: ['letter'], events: {}, chat: 'none' },
  jobs: { kinds: ['letter', 'retry'] },   // booked through the core, never a timer of its own
  replyDelay,               // how long his reply takes, by his state (pure; tests read it)
  check: tick,              // run the background round now (tests; the page needs nothing of it)
  // while 信箱 is closed, it still announces his letter when it comes
  watch(ctx){
    watchCtx = ctx;
    const M = ctx.core;
    let soon = 0; const later = () => { clearTimeout(soon); soon = setTimeout(tick, 50); };
    M.on(ev => { if (ev === 'records' || ev === 'loaded') later(); });
    tick();
  },
  mount(el, ctx){
    const M = ctx.core, T = ctx.T;
    let alive = true, seq = 0, view = { kind: 'list' };
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
    const pad = n => String(n).padStart(2, '0');
    const when = at => { const d = new Date(at); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    // her half-written letter is kept for this companion (ctx.drafts, drafts.js); sending clears it
    const drafts = ctx.drafts || { get: () => '', set(){}, clear(){}, bind: () => () => {} };

    el.innerHTML = `<div class="pad-top"></div><div class="bar"><button class="back" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(T('app.mail'))}</div><div class="sp"><button class="a-mail-pen" aria-label="${esc(T('app.mail.write'))}"><svg class="ic"><use href="#i-pen"/></svg></button></div></div><div class="a-mail-body"></div>`;
    const body = el.querySelector('.a-mail-body'), pen = el.querySelector('.a-mail-pen');
    el.querySelector('.back').onclick = () => { if (view.kind === 'list') ctx.back(); else { view = { kind: 'list' }; render(); } };
    pen.onclick = () => { view = { kind: 'write' }; render(); };
    // a letter written, held or arriving redraws the list (never the page she is writing on)
    const redraw = () => { if (alive && view.kind !== 'write') render(); };
    const off = M.on((ev, d) => { if (ev === 'records' && d && d.type === TYPE) redraw(); });
    views.add(redraw);

    async function render(){
      if (!alive) return;
      const mine = ++seq;   // a later render wins over one still waiting for the records
      pen.hidden = view.kind !== 'list';
      if (ctx.inner) ctx.inner(view.kind !== 'list', () => { view = { kind: 'list' }; render(); });   // Android's back leaves a letter first
      if (view.kind === 'write') return drawWrite();
      const list = await M.records.list(TYPE);
      if (!alive || mine !== seq) return;
      if (view.kind === 'read'){ const r = list.find(x => x.id === view.id); if (r && arrived(r)) return drawRead(r); view = { kind: 'list' }; }
      drawList(list.slice().reverse());   // newest first
    }
    function drawList(list){
      const draft = drafts.get('mail.letter');
      const draftCard = draft ? `<button class="mcard a-mail-card her a-mail-draft"><span class="a-mail-head"><b>${esc(T('app.mail.draft'))}</b></span><span class="a-mail-ex">${esc(draft.replace(/\s+/g, ' ').slice(0, 80))}</span></button>` : '';
      const bindDraft = () => { const d = body.querySelector('.a-mail-draft'); if (d) d.onclick = () => { view = { kind: 'write' }; render(); }; };
      if (!list.length && draft){ body.innerHTML = `<div class="mem">${draftCard}</div>`; bindDraft(); return; }
      if (!list.length){ body.innerHTML = `<div class="mem"><div class="empty">${esc(T('app.mail.empty', { name: his() }))}</div></div>`; return; }
      body.innerHTML = `<div class="mem">${draftCard}${list.map(r => {
        if (r.from === 'him' && !arrived(r)){
          // held past its time, it says so in plain words, and that it will be tried again by itself
          if (held(r) && now() >= (r.due || 0)) return writing.has(r.id)
            ? `<div class="mcard a-mail-wait held"><i class="a-mail-dot"></i><span><b>${esc(T('app.mail.held', { name: his() }))}</b><small>${esc(T('app.mail.trying'))}</small></span></div>`
            : `<div class="mcard a-mail-wait held"><span><b>${esc(T('app.mail.held', { name: his() }))}</b><small>${esc(T(stopped(r) ? 'app.mail.held.stopped' : 'app.mail.held.sub', { name: his() }))}</small></span><button class="a-mail-retry" data-id="${esc(r.id)}">${esc(T('app.mail.retry'))}</button></div>`;
          // no countdown and no time: only that she is waiting for his letter, and when hers went
          const hers = list.find(x => x.id === r.replyTo);
          return `<div class="mcard a-mail-wait"><span><b>${esc(T('app.mail.waiting', { name: his() }))}</b><small>${esc(T('app.mail.waiting.sub', { when: when(hers ? hers.at : r.at) }))}</small></span></div>`;
        }
        const from = r.from === 'him' ? his() : T('app.mail.me');
        const first = (r.text || '').replace(/\s+/g, ' ').slice(0, 80);
        return `<button class="mcard a-mail-card ${r.from === 'him' ? 'him' : 'her'}" data-id="${esc(r.id)}"><span class="a-mail-head"><b>${esc(from)}</b>${r.from === 'him' && !r.read ? `<em class="a-mail-new">${esc(T('app.mail.new'))}</em>` : ''}<small>${esc(when(r.from === 'him' ? r.due : r.at))}</small></span><span class="a-mail-ex">${esc(first)}</span></button>`;
      }).join('')}</div>`;
      body.querySelectorAll('.a-mail-card[data-id]').forEach(b => b.onclick = () => { view = { kind: 'read', id: b.dataset.id }; render(); });
      bindDraft();
      body.querySelectorAll('.a-mail-retry').forEach(b => b.onclick = async () => {
        const r = await M.records.get(TYPE, b.dataset.id); if (!r || writing.has(r.id)) return;
        const p = writeReply(r); render(); await p;
      });
    }
    async function drawRead(r){
      const from = r.from === 'him' ? his() : T('app.mail.me');
      body.innerHTML = `<div class="a-mail-sheet"><div class="a-mail-meta"><b>${esc(r.from === 'him' ? T('app.mail.from', { name: from }) : T('app.mail.to', { name: his() }))}</b><small>${esc(when(r.from === 'him' ? r.due : r.at))}</small></div><div class="a-mail-paper">${esc(r.text)}</div></div>`
        + (r.from === 'him' ? `<div class="a-mail-actions"><button class="btn a-mail-answer">${esc(T('app.mail.answer'))}</button></div>` : '');
      const ans = body.querySelector('.a-mail-answer'); if (ans) ans.onclick = () => { view = { kind: 'write' }; render(); };
      if (r.from === 'him' && !r.read){ r.read = true; await M.records.put(TYPE, r, { app: 'mail' }); }
    }
    function drawWrite(){
      body.innerHTML = `<div class="a-mail-sheet"><div class="a-mail-meta"><b>${esc(T('app.mail.to', { name: his() }))}</b><small>${esc(when(now()))}</small></div><textarea class="a-mail-paper" placeholder="${esc(T('app.mail.placeholder'))}"></textarea></div><div class="a-mail-actions"><button class="btn a-mail-send">${esc(T('app.mail.send'))}</button></div>`;
      const ta = body.querySelector('textarea');
      drafts.bind(ta, 'mail.letter');
      body.querySelector('.a-mail-send').onclick = async () => {
        const text = ta.value.trim();
        if (!text){ ctx.toast(T('app.mail.blank')); ta.focus(); return; }
        const at = now(), state = M.presence();
        view = { kind: 'list' };
        const mine = await M.records.put(TYPE, { from: 'her', text, at }, { app: 'mail' });
        drafts.clear('mail.letter');
        // when it will come is decided now and kept in the record, so a reload keeps it
        const reply = await M.records.put(TYPE, { from: 'him', replyTo: mine.id, text: '', status: 'writing', at: at + 1, due: at + replyDelay(state), state }, { app: 'mail' });
        ctx.toast(T('app.mail.sent'));
        render();
        writeReply(reply);
      };
    }
    render(); tick();
    return () => { alive = false; off(); views.delete(redraw); };
  },
});
})();
