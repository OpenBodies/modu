// The page's side of the one clock and of 主动 (the rules themselves are in the core: app/core/clock.js,
// app/core/reach.js, app/core/jobs.js). The page calls ModuScheduler.init(page) once, with its own small helpers:
//   - starts the one clock (the only timer while the page is open) and ticks it again when she looks;
//   - the bell's ringer: a system notification when the page is out of sight and she allowed it, else the toast;
//   - the peek notice (an app's rule, so the page's, never the core's) and which invites the
//     apps offer (an app's `invite: { kind, words }`);
//   - an app's notice (e.g. a watch's notify) keeps her quiet hours: held while the page is out of sight, shown at their end;
//   - the invite card in the chat (好啊 / 下次吧), and the read mark under her message;
//   - 设置 → 他找你 (on, cap, quiet hours, notices, 暂停) and 小事用的模型 (the side model);
//   - 设置 → 用量: the cost meter, read from the core's one tally (ModuCore.calls.days / calls.sent).
// Notices on a locked phone are not done yet (a native shell would set the bell's ringer).
(function(){
'use strict';
const M = window.ModuCore;
if (!M || !M.clock || !M.reach || !M.useSettings) return;   // a different core keeps its own clock
let P = null;   // the page: { T, toast, go, sheet, closeSheet, choose, esc, $, settings(), persist(), current(), name() }

function ring(n){
  try {
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted'){
      new Notification(n.title || 'Modu', { body: n.line, tag: n.tag || undefined, icon: 'brand/modu-icon-192.png' }); return;
    }
  } catch {}
  if (P && P.current() !== 'chat') P.toast(n.line);
}
function offers(){
  const A = window.ModuApps; if (!A) return [];
  return A.list().filter(a => a.status === 'ready' && a.invite && a.invite.kind)
    .map(a => Object.assign({}, a.invite, { kind: String(a.invite.kind), app: a.id, words: P.T(a.invite.words || ('invite.' + a.invite.kind)), title: P.T(a.title) }));
}

// --- the peek notice -------------------------------------------------------------------------------------------------
// When she looked through his phone (a quiet `peeked` entry), his next turn may tease her about it, rarely: 1 in 6 in a
// good mood, 1 in 15 neutral, never low, the first ever about 1 in 3, never twice within 5 days (knobs peek.notice_first,
// peek.notice_good, peek.notice_neutral); only on his next turn after the look, only when light, never with an invite. It
// never touches his state. Its counters are a record of his own, peek-notice/state.json { v: 1, last, count, seen, decided };
// when that record is missing, they are taken over from the older `peek` field of the core's reach record.
const PEEK_TYPE = 'peek-notice', MIN = 60000, DAY = 864e5;
const HEAVY = /难过|哭|伤心|分手|生病|病了|疼|难受|焦虑|崩溃|对不起|生气|烦死|累死|去世|葬礼|sad|crying|sorry|hurt/i;
const knob = (name, fallback) => { const v = M.param(name, fallback); return v == null ? fallback : v; };
const rand = () => (M.reach.random || Math.random)();
const tOf = m => { const d = m && M.msgDate(m); return d ? d.getTime() : 0; };
// pure: should he mention this peek? p: { last, count, seen }; c: { at, mood ('good'|'neutral'|'low'), light, rand } → { say, p }
function peekDecide(p, c){
  p = Object.assign({ last: 0, count: 0, seen: 0 }, p || {});
  const first = !p.seen; p.seen++;
  if (c.mood === 'low' || !c.light) return { say: false, p };
  if (p.count && c.at - p.last < 5 * DAY) return { say: false, p };
  const chance = first ? Number(knob('peek.notice_first', 1 / 3)) : c.mood === 'good' ? Number(knob('peek.notice_good', 1 / 6)) : Number(knob('peek.notice_neutral', 1 / 15));
  if ((c.rand || Math.random)() < chance){ p.last = c.at; p.count++; return { say: true, p }; }
  return { say: false, p };
}
let pk = null, pkFor = '', pkLoading = null;
const pkKey = () => (M.currentId || '') + '|' + ((M.store && M.store.name) || '');
function peekLoad(){
  const key = pkKey();
  if (pk && pkFor === key) return Promise.resolve(pk);
  if (pkLoading) return pkLoading;
  pkLoading = (async () => {
    let r = null; try { r = await M.records.get(PEEK_TYPE, 'state'); } catch { r = null; }
    if (!r){ let old = null; try { old = await M.reach.state(); } catch {} r = old && old.peek ? Object.assign({}, old.peek) : {}; }   // the migration: the core's old field
    pk = Object.assign({ last: 0, count: 0, seen: 0, decided: {} }, r, { v: 1, id: 'state' }); pkFor = key;
    return pk;
  })().finally(() => { pkLoading = null; });
  return pkLoading;
}
function peekSave(){
  if (!pk || !M.store || !M.store.name) return;
  const rec = Object.assign({}, pk, { at: M.now().getTime() }); delete rec.rev;
  M.records.commit(PEEK_TYPE, rec, { writer: 'scheduler', app: 'peek' }).catch(e => console.error(e));
}
// the notice rule for `peeked` (events 0.2): '' (not this one) or the line his next turn gets
function peekRule(e, w){
  if (!pk || pkFor !== pkKey()){ peekLoad().catch(() => {}); return ''; }
  const st = M.reach.current(); if (!st) return '';
  const msgs = (M.store.msgs || []).filter(m => !m.is_system);
  const at = e.at || 0, hisLast = [...msgs].reverse().find(m => !m.is_user);
  if (hisLast && tOf(hisLast) > at) return '';                                   // only on his next turn after it
  if ((st.invites || []).some(i => i.state === 'open' || i.at >= at)) return '';  // never with an invite
  const key = String(at);
  if (!(key in pk.decided)){
    if (Object.keys(pk.decided).some(k => Math.abs(Number(k) - at) < 30 * MIN)) return '';   // one look through his phone, one chance
    const her = [...msgs].reverse().find(m => m.is_user);
    const r = peekDecide(pk, { at, mood: M.reach.moodClass(M.personaState()), light: !(her && HEAVY.test(String(her.mes || ''))), rand });
    pk = Object.assign(r.p, { decided: Object.assign(pk.decided || {}, { [key]: r.say }) });
    for (const k of Object.keys(pk.decided).sort().slice(0, -40)) delete pk.decided[k];
    peekSave();
  }
  if (!pk.decided[key]) return '';
  const where = e.detail && e.detail.app && rand() < 0.2 ? `; you happen to know she opened your ${e.detail.app}` : '';
  return `${w.she} looked through your phone (you know only that she looked${where}). If the moment is light you may tease her about it once: curious and pleased, never hurt, never jealous, never asking for her phone.`;
}
M.reach.lend({ peekRule, peekDecide });   // the core's older names for these forward here
M.on(ev => { if (ev === 'loaded'){ pk = null; peekLoad().catch(() => {}); } });

// --- an app's notice keeps her quiet hours ---------------------------------------------------------------------------
// A letter that came or an order that arrived is not him writing first, but it would still ping her at night: while the page
// is out of sight inside her quiet hours it is held (one per tag, the newest), and shown when they end (the clock's beat
// looks). In front of her it shows at once. hold(text, o, show) → true when held; show(text, o) is called later.
const heldNotes = [];
function hold(text, o, show){
  const t = M.now().getTime(), away = typeof document === 'undefined' || document.visibilityState !== 'visible';
  if (!away || !M.reach.inQuiet(t) || typeof show !== 'function') return false;
  const tag = o && o.tag, i = tag ? heldNotes.findIndex(n => n.o && n.o.tag === tag) : -1;
  if (i >= 0) heldNotes.splice(i, 1);
  heldNotes.push({ text, o: Object.assign({}, o), show });
  return true;
}
M.clock.on(t => { if (!heldNotes.length || M.reach.inQuiet(t)) return; for (const n of heldNotes.splice(0)) { try { n.show(n.text, n.o); } catch(e){ console.error(e); } } });

// --- the invite card: drawn by the page's neutral card, finished here ------------------------------------------------
function inviteCard(d, m){
  const c = m.extra.modu_card, id = c.id || '';
  d.classList.add('invite');
  const state = M.reach.inviteState(id) || 'open';
  if (state !== 'open'){
    const w = state === 'accepted' ? 'invite.done' : state === 'declined' ? 'invite.declined' : 'invite.gone';
    d.textContent = `${m.mes} · ${P.T(w)}`; return d;
  }
  d.textContent = m.mes + ' ';
  const yes = document.createElement('button'), no = document.createElement('button');
  yes.className = 'link inv-yes'; yes.textContent = P.T('invite.yes'); no.className = 'link inv-no'; no.textContent = P.T('invite.no');
  yes.onclick = async () => { const inv = await M.reach.answerInvite(id, 'yes'); P.go('app:' + c.app, { contact: M.currentId, action: inv && inv.pays ? 'invite-pay' : 'invite' }); };
  no.onclick = async () => { await M.reach.answerInvite(id, 'no'); d.textContent = `${m.mes} · ${P.T('invite.declined')}`; };
  d.append(yes, ' ', no);
  return d;
}
// the read mark under her message ([no-reply], or he let it sit);
// a message of hers that came while he slept says 已送达 under it until he wakes and reads it (then 已读)
function readMark(m){
  if (!(m && m.is_user && m.extra && (m.extra.modu_read || m.extra.modu_asleep))) return null;
  const s = document.createElement('div'); s.className = 'sysline readmark'; s.textContent = P.T(m.extra.modu_read ? 'reach.read' : 'reach.delivered');
  if (!m.extra.modu_read) s.dataset.delivered = ''; return s;
}

// --- 设置 → 他找你 and 小事用的模型 -------------------------------------------------------------------------------
const QUIET = [['23:00', '08:00'], ['00:30', '08:00'], ['22:00', '07:00'], ['01:00', '09:00'], ['', '']];
// how long away brings his one message, from the same knob reach reads (initiative.catchup_after_hours, 20)
function awayWords(){ const h = Number(M.param('initiative.catchup_after_hours', 20)) || 20; return h % 24 === 0 ? P.T('reach.away.days', { n: h / 24 }) : P.T('reach.away.hours', { n: h }); }
// the explanation under 他找你 as short lines, one sentence each (a ； ends a line as a 。), with no spaces between them
const lines = list => list.flatMap(s => String(s || '').split(/(?<=[。；])/)).map(s => s.trim().replace(/；$/, '。')).filter(Boolean);
let sideWhy = null;   // what 拉取模型 found for the side model, drawn again when 设置 redraws
let sideKeyCleared = false;   // its key was cleared by a change of service (the line under 服务 says so until she types one)
function render(){
  const box = P.$('reachBlock'); if (!box) return;
  const T = P.T, esc = P.esc, name = P.name() || '他', r = M.loadReach(), s = P.settings();
  const cap = M.reach.cap(), q = M.param('initiative.quiet_hours', ['00:30', '08:00']) || [], side = s.side && s.side.endpoint;
  const sw = on => `<span class="switch${on ? ' on' : ''}"></span>`;
  // the side model is set up as the chat model is (index.html's window.ModuModelSetup): the service by
  // name (地址 only for 自己填), her key, 拉取模型. Until she picks one, OpenRouter (box.dataset.svc keeps a pick not saved yet).
  // The side model goes live only once it has both an address and a model; until then what she typed is a draft
  // (settings.sideDraft), shown here and used by nothing (a model name borrowed from the chat's service would mean nothing)
  const sd = (s.side && s.side.endpoint ? s.side : s.sideDraft) || null, drafting = !side && !!(sd && (sd.endpoint || sd.key || sd.model));
  const MS = window.ModuModelSetup, ssvc = MS ? (sd && sd.endpoint ? MS.svcOf(sd) : box.dataset.svc || M.modelServices[0].id) : 'own';
  box.innerHTML = `<div class="gtitle">${esc(T('reach.title', { name }))}</div>
<div class="group">
  <button class="opt" data-r="on"><span style="flex:1"><span>${esc(T('reach.on', { name }))}</span><small>${esc(T('reach.on.sub', { name }))}</small></span>${sw(r.on !== false)}</button>
  <button class="opt" data-r="cap"><span>${esc(T('reach.cap'))}</span><span class="val">${esc(r.on === false ? T('reach.cap.off') : T('reach.cap.n', { n: cap }))}</span></button>
  <button class="opt" data-r="quiet"><span>${esc(T('reach.quiet'))}</span><span class="val">${esc(q[0] && q[0] !== q[1] ? T('reach.quiet.range', { from: q[0], to: q[1] }) : T('reach.quiet.none'))}</span></button>
  <button class="opt" data-r="notices"><span style="flex:1"><span>${esc(T('reach.notice'))}</span><small>${esc(T('reach.notice.sub'))}</small></span>${sw(!!r.notices)}</button>
  <button class="opt" data-r="pause"><span style="flex:1"><span>${esc(T('reach.pause'))}</span><small>${esc(T('reach.pause.sub', { name }))}</small></span>${sw(!!r.paused)}</button>
</div>
<div class="foot" data-reach-foot>${lines([T('reach.cap.foot', { name }), T('reach.quiet.foot', { name }), T('reach.away.foot', { name, n: M.param('initiative.flood_cap', 3), away: awayWords() }), T('reach.pause.foot', { name }), T('reach.wake.shut', { name }), T('reach.notice.locked')]).map(esc).join('<br>')}</div>
<div class="gtitle">${esc(T('side.title'))}</div>
<div class="group">
  <button class="opt choice${side || drafting || box.dataset.other ? '' : ' on'}" data-side="same"><span class="dot"></span><span style="flex:1"><span>${esc(T('side.same'))}</span><small>${esc(T('side.sub', { name }))}</small></span></button>
  <button class="opt choice${side || drafting || box.dataset.other ? ' on' : ''}" data-side="other"><span class="dot"></span><span>${esc(T('side.other'))}</span></button>
  <div data-siderows ${side || drafting || box.dataset.other ? '' : 'hidden'}>
    ${MS ? `<button class="opt" data-sside><span style="flex:1"><span>${esc(T('model.service'))}</span><small>${esc(T('model.how.' + ssvc))}</small></span><span class="val">${esc(MS.svcName(ssvc))} ›</span></button><div class="opt why" data-ssvcwhy hidden></div>` : ''}
    <label class="opt"${ssvc === 'own' ? '' : ' hidden'}><span>${esc(T('side.endpoint'))}</span><input data-sf="endpoint" placeholder="https://…/v1" spellcheck="false" autocapitalize="off" inputmode="url" value="${esc((sd && sd.endpoint) || '')}"></label>
    <label class="opt"><span>${esc(T('side.key'))}</span><input data-sf="key" type="password" autocomplete="off" placeholder="${esc(T('settings.key.empty'))}" value="${esc((sd && sd.key) || '')}"></label>
    <label class="opt"><span>${esc(T('side.model'))}</span><input data-sf="model" spellcheck="false" autocapitalize="off" placeholder="${esc(T('model.name.empty'))}" value="${esc((sd && sd.model) || '')}"></label>
    ${MS ? `<button class="opt" data-sfetch><span>${esc(T('model.fetch'))}</span><span class="val">›</span></button><div class="opt why" data-sfetchwhy hidden></div>` : ''}
    <div class="opt sub" data-sdraft${drafting ? '' : ' hidden'}>${esc(T('side.draft'))}</div>
  </div>
</div>
<div class="foot">${esc(T('side.foot'))}</div>
${meter(T, esc, name)}`;
  box.querySelector('[data-r="on"]').onclick = () => { M.saveReach({ on: M.loadReach().on === false }); render(); };
  box.querySelector('[data-r="cap"]').onclick = () => P.choose(T('reach.cap'), [0, 1, 2, 3, 4, 5].map(n => [String(n), n ? T('reach.cap.n', { n }) : T('reach.cap.off')]), String(cap),
    v => { M.saveReach({ cap: Number(v), on: Number(v) > 0 }); render(); });
  box.querySelector('[data-r="quiet"]').onclick = () => P.choose(T('reach.quiet.pick'), QUIET.map(([a, b]) => [a ? `${a}-${b}` : '-', a ? T('reach.quiet.range', { from: a, to: b }) : T('reach.quiet.none')]), q[0] && q[0] !== q[1] ? `${q[0]}-${q[1]}` : '-',
    v => { M.saveReach({ quiet: v === '-' ? ['00:00', '00:00'] : v.split('-') }); render(); });
  box.querySelector('[data-r="notices"]').onclick = async () => {
    const want = !M.loadReach().notices;
    if (want && 'Notification' in window && Notification.permission === 'default'){ P.toast(T('reach.notice.ask')); try { await Notification.requestPermission(); } catch {} }
    if (want && 'Notification' in window && Notification.permission === 'denied') P.toast(T('reach.notice.denied'));
    M.saveReach({ notices: want }); render();
  };
  box.querySelector('[data-r="pause"]').onclick = () => { M.saveReach({ paused: !M.loadReach().paused }); render(); };
  const sentRow = box.querySelector('[data-cost-open]');
  if (sentRow && P.sheet) sentRow.onclick = () => P.sheet(`<h3>${esc(T('cost.sent'))}</h3>${sentList(T, esc, name)}<button class="btn" data-close>${esc(T('ok'))}</button>`);
  box.querySelector('[data-side="same"]').onclick = () => { const st = P.settings(); st.side = null; delete st.sideDraft; delete box.dataset.other; P.persist(); render(); };
  box.querySelector('[data-side="other"]').onclick = () => { box.dataset.other = '1'; box.querySelector('[data-siderows]').hidden = false; box.querySelector('[data-side="other"]').classList.add('on'); box.querySelector('[data-side="same"]').classList.remove('on'); };
  // the side model as she has it, with the service she picked filled in (its address) when she has not saved one yet
  const sideNow = () => { const st = P.settings(), o = Object.assign({}, st.side || st.sideDraft || {}); if (MS && !o.endpoint && ssvc !== 'own') MS.useService(o, ssvc); return o; };
  const keep = o => { const st = P.settings(); if (o.endpoint && o.model){ st.side = o; delete st.sideDraft; } else { st.side = null; st.sideDraft = o; } P.persist(); };
  // while it is a draft, one line says it is used only once the model name is in
  const draftLine = () => { const st = P.settings(), d = box.querySelector('[data-sdraft]'); if (d) d.hidden = !!(st.side && st.side.endpoint) || !st.sideDraft; };
  for (const inp of box.querySelectorAll('[data-sf]')) inp.onchange = () => {
    const o = sideNow(), was = MS ? MS.hostOf(o.endpoint) : '';
    o[inp.dataset.sf] = inp.dataset.sf === 'endpoint' ? M.normEndpoint(inp.value) : inp.value.trim();
    // under 自己填, another host (relay A → relay B) never gets A's key
    const moved = inp.dataset.sf === 'endpoint' && MS && was && MS.hostOf(o.endpoint) !== was && String(o.key || '').trim();
    if (moved){ o.key = ''; box.querySelector('[data-sf="key"]').value = ''; sideKeyCleared = true; MS.showWhy(box.querySelector('[data-ssvcwhy]'), { text: T('model.key.cleared') }); }
    keep(o); draftLine();
    if (inp.dataset.sf === 'endpoint') inp.value = o.endpoint;
    usingAgain(); if (inp.dataset.sf === 'key' && sideKeyCleared){ sideKeyCleared = false; if (MS) MS.showWhy(box.querySelector('[data-ssvcwhy]'), null); }
    if (inp.dataset.sf === 'model'){ sideWhy = null; if (MS) MS.showWhy(box.querySelector('[data-sfetchwhy]'), null); }
  };
  if (!MS) return;
  box.querySelector('[data-sside]').onclick = () => MS.pickService(ssvc, id => {
    const o = sideNow(), cleared = MS.useService(o, id); box.dataset.svc = id; box.dataset.other = '1'; sideWhy = null; keep(o);
    sideKeyCleared = cleared; render();   // another service's key is never sent here: cleared, and said so
  });
  if (sideKeyCleared) MS.showWhy(box.querySelector('[data-ssvcwhy]'), { text: T('model.key.cleared') });
  const why = box.querySelector('[data-sfetchwhy]');
  if (sideWhy) MS.showWhy(why, sideWhy);
  box.querySelector('[data-sfetch]').onclick = () => MS.fetchModels(sideNow(), box.querySelector('[data-sfetch] .val'), why, m => {
    const o = sideNow(); o.model = m.id; keep(o); draftLine(); box.querySelector('[data-sf="model"]').value = m.id; sideWhy = { text: T('model.fetch.picked', { model: m.id }) }; usingAgain();
  }).then(() => { if (!why.hidden && why.dataset.state === 'bad') sideWhy = { text: why.querySelector('.say').textContent, raw: why.querySelector('.raw').textContent }; });
}

// --- 设置 → 用量: the cost meter ----------------------------------------------------------------------------------------
// Calls per day by kind, from the core's tally, and what the last calls sent, in brief (never the key, never the whole prompt).
// The address is not shown (an address on 设置 is a developer's word): the model's name only.
const ROWS = { sketch: 'sketch', decider: 'decider', ageout: 'memory', tidy: 'memory', consistency: 'memory', memory: 'memory', evening: 'diary',
  shelf: 'shelf', contacts: 'contacts', calibrate: 'calibrate', reach: 'reach', promise: 'reach', 'reply-later': 'reach', invite: 'reach',
  post: 'post', reaction: 'post', letter: 'letter', app: 'app', call: 'app', peek: 'app', meaning: 'meaning', check: 'check', retry: 'retry' };   // check: 设置's 测试连接; retry: asked again with more room
const ORDER = ['sketch', 'decider', 'reach', 'diary', 'post', 'memory', 'shelf', 'contacts', 'calibrate', 'meaning', 'letter', 'app', 'check', 'retry', 'other'];
const pad2 = n => String(n).padStart(2, '0');
const dayOf = t => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
// when a call went, with its day: 今天 10:30 · 昨天 18:49 · 11月1日 10:30
function sentWhen(T, at, now){
  const d = new Date(at), hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, day = dayOf(at);
  if (day === dayOf(now)) return T('cost.sent.today', { hm });
  if (day === dayOf(now - 864e5)) return T('cost.sent.yesterday', { hm });
  return T('cost.sent.day', { m: d.getMonth() + 1, d: d.getDate(), hm });
}
// → { chat, side, rows: { row: n }, k } for the days given; k = thousands of tokens, about 2 characters a token
function costOf(days){
  const o = { chat: 0, side: 0, rows: {}, chars: 0 };
  for (const d of days){ o.chat += d.chat || 0; o.side += d.side || 0; o.chars += (d.in || 0) + (d.out || 0);
    for (const [n, c] of Object.entries(d.by || {})){ const r = ROWS[n] || 'other'; o.rows[r] = (o.rows[r] || 0) + c; } }
  o.k = Math.round(o.chars / 2 / 100) / 10;
  return o;
}
// which model she is on, at the top of 用量, where she looks at what it costs (the chat's, and the side model's
// when it has its own); usingAgain() redraws only these rows when she changes the model, so a box she is typing in keeps its focus
function using(T, esc){
  const st = (P && P.settings && P.settings()) || M.loadSettings(), sm = st.side && st.side.endpoint ? String(st.side.model || st.model || '') : '';
  return `<div class="opt" data-cost-model><span>${esc(T('cost.model.chat'))}</span><span class="val">${esc(String(st.model || '') || T('cost.model.none'))}</span></div>` +
    (sm ? `<div class="opt" data-cost-model><span>${esc(T('side.title'))}</span><span class="val">${esc(sm)}</span></div>` : '');
}
function usingAgain(){
  const g = P && P.$('reachBlock') && P.$('reachBlock').querySelector('[data-cost]'); if (!g) return;
  for (const r of g.querySelectorAll('[data-cost-model]')) r.remove();
  g.insertAdjacentHTML('afterbegin', using(P.T, P.esc));
}
function meter(T, esc, name){
  if (!M.calls || typeof M.calls.days !== 'function') return '';
  const now = M.now().getTime(), today = dayOf(now), from = dayOf(now - 6 * 864e5), days = M.calls.days(14);
  const d = costOf(days.filter(x => x.day === today)), w = costOf(days.filter(x => x.day >= from && x.day <= today));
  const line = (label, c) => `<div class="opt"><span style="flex:1"><span>${esc(label)}</span><small>${esc([T('cost.chat', { n: c.chat }), T('cost.side', { n: c.side }), T('cost.tokens', { k: c.k })].join(' · '))}</small></span></div>`;
  const rows = ORDER.filter(r => d.rows[r]).map(r => `<div class="opt"><span>${esc(T('cost.row.' + r, { name }))}</span><span class="val">${d.rows[r]}</span></div>`).join('');
  // 最近发出的 is one row here; a tap opens the list in a sheet (sentList), so 用量 stays short
  const n = M.calls.sent().length;   // every call the tally keeps (calls.sent's own limit), all of them in the list
  return `<div class="gtitle">${esc(T('cost.title'))}</div>
<div class="group" data-cost>${using(T, esc)}${line(T('cost.today'), d)}${rows}${line(T('cost.week'), w)}<button class="opt" data-cost-open><span>${esc(T('cost.sent'))}</span><span class="val">${n ? esc(T('cost.sent.count', { n })) + ' ' : ''}›</span></button></div>
<div class="foot">${esc(T('cost.foot'))}</div>`;
}
// 最近发出的, the list the row opens: each with its day (今天 / 昨天 / 11月1日) and newest first; his reply to her (a
// reply-later: on waking, or one he let sit) is a chat turn, 聊天, not 找你 (the tally marks it `turn`; an older
// entry without the mark is known by its name)
function sentList(T, esc, name){
  if (!M.calls || typeof M.calls.sent !== 'function') return '';
  const now = M.now().getTime();
  const sent = M.calls.sent().sort((a, b) => b.at - a.at).map(c => {
    const what = c.turn || c.name === 'reply-later' ? T('cost.chat', { n: 1 }) : T('cost.row.' + (ROWS[c.name] || 'other'), { name });
    return `<div class="opt"><small>${esc(T('cost.sent.line', { time: sentWhen(T, c.at, now), what, n: c.msgs, k: c.chars, model: c.model }))}</small></div>`; }).join('');
  return `<div class="group" data-cost-sent>${sent || `<div class="opt"><small>${esc(T('cost.sent.none'))}</small></div>`}</div>
<div class="foot" style="margin:10px 0 16px">${esc(T('cost.sent.foot'))}</div>`;
}

function init(page){
  if (P) return;
  P = page;
  M.useSettings(page.settings);
  M.bell.set(ring);
  M.noticeRules.add('peeked', peekRule);
  M.reach.invites(offers);
  M.clock.start();
  M.reach.seen().catch(() => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden){ M.reach.seen().catch(() => {}); M.clock.tick(); } });
  M.on((ev, d) => { if (ev === 'reach' && d && (d.op === 'read' || d.op === 'invite') && P.redrawChat) P.redrawChat();
    if (ev === 'loaded' || ev === 'reach' || ev === 'params') { if (ev === 'loaded') M.reach.seen().catch(() => {}); if (P.current() === 'settings') render(); } });
  render();
}
window.ModuScheduler = { version: '0.2', init, render, inviteCard, readMark, sendOptions: () => M.reach.sendOptions(), costOf, meter, usingAgain, sentList, ROWS, hold, peek: { rule: peekRule, decide: peekDecide, load: peekLoad } };
})();
