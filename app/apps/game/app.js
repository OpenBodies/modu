// 小游戏 (game), a page-2 app. Two text games with him,
// played in their own screen like a phone game: he takes his turn through the model, and what he says
// shows inside the game, never in the chat. His 心声 (inner voice, `buildContext({inner:true})`, read by
// `parseReply`) is the part of the game she gets to see, closed until she taps it.
// - 猜拳: he chooses first, before she does (one model call with an app tag [出: 石头|剪刀|布] and his 心声);
//   she picks; the screen shows both hands, who won, what he was thinking, and his one-line reaction.
// - 真心话: she asks him and his answer shows in the game; or he asks her, she answers in the game, and he
//   says a line back.
// An app session for one person (scope 'contact', surface 'session'; his
// chat's ··· → 一起玩). His turns go through the session (s.turn: never into the chat); every round is one line
// in the event log (s.log, with the session id), so in chat afterwards he knows what happened; while she
// plays, s.hold tells his chat turns what they are doing (the activity block). When she leaves (back, home,
// switching person), the session ends with one neutral grey line in the chat (not her voice, not his).
// Rounds are the record type `game`. Nothing leaves the page but the model call the core already makes.
(function(){
'use strict';
const TYPE = 'game', ID = 'game';
const M = () => window.ModuCore;
// time from the core's one clock (ModuCore.now), so ?at= and a test's clock move it too
const nowMs = () => { const c = M(); return c && c.now ? c.now().getTime() : Date.now(); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// her name in his prompts is the one she gave in 聊天设置 (ModuCore.userName); what is stored keeps her chat's own
const userName = () => M().userName ? M().userName() : ((M().store.meta && M().store.meta.user_name) || 'You');
const HANDS = ['rock', 'scissors', 'paper'];
const HAND_ZH = { rock:'石头', scissors:'剪刀', paper:'布' };
const BEATS = { rock:'scissors', scissors:'paper', paper:'rock' };
const RESULT_ZH = { her:'她赢了', him:'你赢了', draw:'平局' };
// what he is told (not shown to her; like the core's own rules, kept in code)
const IN_GAME = '这是在小手机的游戏里，不是在聊天里';
const TOLD = {
  rps: () => `（小手机里的小游戏，${IN_GAME}）你们在玩猜拳，你先出，她还没出，你不知道她会出什么。按你的性格选一个，可以说一句话，也可以不说。最后单独一行写 [出: 石头] 或 [出: 剪刀] 或 [出: 布]。`,
  rpsDone: (her, his, who) => `（小手机里的小游戏，${IN_GAME}）猜拳揭晓：她出了${HAND_ZH[her]}，你出了${HAND_ZH[his]}，${RESULT_ZH[who]}。在游戏里回她一句，像玩游戏时随口说的，不超过二十个字。`,
  truthAsk: q => `（小手机里的小游戏，${IN_GAME}）你们在玩真心话，她问你：「${q}」。要说真话，按你的性格回答，一两句，不超过六十个字。`,
  truthHim: () => `（小手机里的小游戏，${IN_GAME}）你们在玩真心话，轮到你问她一个问题。按你的性格和你对她的了解，问一个你真的想知道的问题。只写问题本身，一句，不超过三十个字，不要加别的。`,
  truthHer: (q, a) => `（小手机里的小游戏，${IN_GAME}）你们在玩真心话，你问她：「${q}」，她答：「${a}」。在游戏里回她一句，不超过三十个字。`,
};

// the session open now (ctx.session): set by mount, cleared by its unmount. Without one (the api
// called on its own, as tests do) his turn is the core's ModuCore.turn and a round goes to logEvent directly.
let cur = null;
// One turn of his about the game: his usual prompt (with the 心声 rule) plus one system line,
// through the session's s.turn (the core's ModuCore.turn), never into the chat. His usual prompt carries the
// event log, so he knows the rounds before this one. → his raw text (the game reads its own [出: …] tag).
async function ask(question){
  const o = { inner: true, max: 400 };
  if (cur) return (await cur.turn(question, o)).raw;
  return (await M().turn(question, o)).raw;
}
// [出: 石头] (also 猜拳, hand, rock / scissors / paper, 拳头, 锤子, 包袱). → { text, hand: id or '' }
const HAND_TAG = /[\[【(（]\s*(?:出|猜拳|hand|play)\s*[:：]\s*([^\]】)）\n]{1,12})\s*[\]】)）]/gi;
function handOf(w){
  w = String(w || '').trim().toLowerCase();
  if (/石头|拳头|锤|rock/.test(w)) return 'rock';
  if (/剪刀|scissors/.test(w)) return 'scissors';
  if (/布|包袱|paper/.test(w)) return 'paper';
  return '';
}
function readHand(raw){
  let hand = '';
  const text = String(raw == null ? '' : raw).replace(HAND_TAG, (m, w) => { hand = handOf(w) || hand; return ''; });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), hand };
}
function winner(her, his){ return her === his ? 'draw' : BEATS[her] === his ? 'her' : 'him'; }
// his reply, read with the reply format, as words for the game screen (never into the chat)
function said(raw){
  const core = M(), r = core.parseReply(raw);
  const inner = core.tidyCJK(r.inner || '');
  if (r.noReply) return { text:'', inner };
  const text = core.tidyCJK(String(r.text || '').replace(/\*[^*\n]+\*/g, '').replace(/\s*\n+\s*/g, ' ').trim());
  return { text: core.dropFinalStop ? core.dropFinalStop(text) : text, inner };   // no final 。, like his chat lines
}
// one line into the phone's event log: who played, what happened, for him to read later
// (s.log: logEvent with the session id)
function log(what, line, detail){
  const e = { who: 'both', what, line, detail };
  return (cur ? cur.log(e) : M().logEvent(Object.assign({ app: ID, title: '小游戏' }, e))).catch(err => console.error(err));
}
// what his chat turns see while she plays (s.hold → the activity block)
function hold(){
  if (!cur || !visit) return;
  const n = visit.rps.her + visit.rps.him + visit.rps.draw;
  const line = visit.last === 'truth' ? `你们正在小游戏里玩真心话，第${visit.truth}轮` : n ? `你们正在小游戏里玩猜拳，第${n}局` : '你们正在小游戏里';
  cur.hold(line).catch(e => console.error(e));
}

// ---- this visit: what she played, for the one chat line when she leaves ----
let visit = null;   // { rps: { her, him, draw }, truth: n, last: 'rps' | 'truth' }
const newVisit = () => ({ rps: { her: 0, him: 0, draw: 0 }, truth: 0, last: '' });

// ---- 猜拳 ----
// His hand is asked for before she picks (when the screen opens, and after each round), so he cannot see hers.
let pending = null;   // Promise<{ hand, inner, said }>
function askHand(){
  if (pending) return pending;
  pending = ask(TOLD.rps()).then(raw => {
    const h = readHand(raw), r = said(h.text);
    return { hand: h.hand || HANDS[Math.floor(Math.random() * 3)], picked: h.hand ? 'model' : 'random', inner: r.inner, said: r.text };
  }).catch(() => ({ hand: HANDS[Math.floor(Math.random() * 3)], picked: 'random', inner: '', said: '' }));
  return pending;
}
// → the round record { her, his, winner, inner, said, react }. onReveal(rec) is called once the hands are
// known, before his reaction, so the screen shows the result at once.
async function play(her, ctx, onReveal){
  if (!HANDS.includes(her)) return null;
  const mine = await askHand(); pending = null;
  const who = winner(her, mine.hand);
  let rec = await M().records.put(TYPE, { game:'rps', her, his: mine.hand, picked: mine.picked, winner: who, inner: mine.inner, said: mine.said, react:'' }, { app: ID });
  if (visit) { visit.rps[who]++; visit.last = 'rps'; hold(); }
  if (onReveal) { try { onReveal(rec); } catch(e){ console.error(e); } }
  let react = '';
  try { react = said(await ask(TOLD.rpsDone(her, mine.hand, who))).text; }
  catch(e){ if (ctx && ctx.toast) ctx.toast(ctx.T('app.game.toast.noanswer')); }
  if (react) rec = await M().records.put(TYPE, Object.assign({}, rec, { react }), { app: ID });
  await log('rps', `猜拳：她出${HAND_ZH[her]}，你出${HAND_ZH[mine.hand]}，${RESULT_ZH[who]}` + (react ? `；你说「${clip(react, 40)}」` : ''), { id: rec.id, her, his: mine.hand, winner: who });
  askHand();
  return rec;
}

// ---- 真心话 ----
// she asks: → the record { q, a, inner } (his answer shows in the game)
async function truthAsk(q, ctx){
  q = String(q || '').trim(); if (!q) return null;
  let r;
  try { r = said(await ask(TOLD.truthAsk(q))); }
  catch(e){ if (ctx && ctx.toast) ctx.toast(ctx.T('app.game.toast.noanswer')); return null; }
  const rec = await M().records.put(TYPE, { game:'truth', by:'her', q, a: r.text, inner: r.inner }, { app: ID });
  if (visit) { visit.truth++; visit.last = 'truth'; hold(); }
  await log('truth', `真心话：她问你「${clip(q, 60)}」，你答「${clip(r.text || '（没有回答）', 80)}」`, { id: rec.id, by:'her' });
  return rec;
}
// he asks: → the record { q, inner } (the question shows in the game; she answers with truthAnswer)
async function truthHim(ctx){
  let r;
  try { r = said(await ask(TOLD.truthHim())); }
  catch(e){ if (ctx && ctx.toast) ctx.toast(ctx.T('app.game.toast.noanswer')); return null; }
  const q = r.text; if (!q) return null;
  return M().records.put(TYPE, { game:'truth', by:'him', q, inner: r.inner }, { app: ID });
}
// her answer to his question: → the record with her answer `a` and his line back `react`
async function truthAnswer(id, a, ctx){
  a = String(a || '').trim(); if (!a) return null;
  let rec = await M().records.get(TYPE, id); if (!rec || rec.by !== 'him') return null;
  rec = await M().records.put(TYPE, Object.assign({}, rec, { a }), { app: ID });
  if (visit) { visit.truth++; visit.last = 'truth'; hold(); }
  let react = '';
  try { react = said(await ask(TOLD.truthHer(rec.q, a))).text; }
  catch(e){ if (ctx && ctx.toast) ctx.toast(ctx.T('app.game.toast.noanswer')); }
  if (react) rec = await M().records.put(TYPE, Object.assign({}, rec, { react }), { app: ID });
  await log('truth', `真心话：你问她「${clip(rec.q, 60)}」，她答「${clip(a, 80)}」` + (react ? `；你说「${clip(react, 40)}」` : ''), { id: rec.id, by:'him' });
  return rec;
}

// ---- after the game: one neutral line in the chat (not her voice, not his) ----
// pure: (visit, T, name) → the summary line, or '' when nothing was played
function summary(v, T, name){
  const n = v.rps.her + v.rps.him + v.rps.draw;
  if (!n && !v.truth) return '';
  const parts = [];
  if (n) parts.push(T('app.game.chat.visit.rps', { n, her: v.rps.her, him: v.rps.him, draw: v.rps.draw, name }));
  if (v.truth) parts.push(T('app.game.chat.visit.truth', { n: v.truth }));
  return T('app.game.chat.visit', { what: parts.join(T('app.game.chat.visit.and')), name });
}
// ends the session s at once (so the page's own end, and a switch of person, find it ended with its card);
// a visit with no round ends with no card. The visit record (the card's id) is saved beside it.
function leave(s, v, T, name){
  const line = v ? summary(v, T, name) : '';
  if (!line) return s.end();
  const id = nowMs().toString(36) + Math.random().toString(36).slice(2, 6), n = v.rps.her + v.rps.him + v.rps.draw;
  M().records.put(TYPE, { id, game:'visit', session: s.id, rps: Object.assign({ n }, v.rps), truth: v.truth }, { app: ID }).catch(e => console.error(e));
  return s.end({ card: { line, type: TYPE, id } });
}

// ---- the chat card ----
async function card(msg, ctx){
  const c = msg.extra && msg.extra.modu_card; if (!c || !c.id) return null;
  const g = await M().records.get(TYPE, c.id); if (!g) return null;
  const T = ctx.T;
  if (g.game === 'visit'){
    const parts = [];
    if (g.rps && g.rps.n) parts.push(T('app.game.card.visit.rps', { n: g.rps.n }));
    if (g.truth) parts.push(T('app.game.card.visit.truth', { n: g.truth }));
    return { icon:'i-game', title: parts.join(' · '), sub: g.rps && g.rps.n ? T('app.game.card.visit.score', { her: g.rps.her || 0, him: g.rps.him || 0, draw: g.rps.draw || 0 }) : T('app.game.truth'), foot: T('app.game'), done: true };
  }
  // older rounds (saved when each round went into the chat) still draw
  if (g.game === 'rps') return { icon:'i-game', title: T('app.game.result.' + g.winner),
    sub: T('app.game.card.hands', { her: T('app.game.hand.' + g.her), his: T('app.game.hand.' + g.his) }),
    foot: g.inner ? T('app.game.card.inner', { inner: g.inner }) : T('app.game.rps'), done: true };
  if (g.game === 'truth' && g.by === 'him') return { icon:'i-game', title: clip(g.q, 24), sub: T('app.game.card.hisq'), foot: T('app.game.truth') };
  return null;
}

// ---- the screen ----
// 心声: closed until she taps it, like under his chat replies
const innerBtn = (t, T) => t ? `<button type="button" class="a-game-inner" aria-expanded="false" aria-label="${esc(T('app.game.inner.tap'))}" data-inner="${esc(t)}"><span class="a-game-inner-k">${esc(T('app.game.inner'))}</span><span class="a-game-inner-t"></span></button>` : '';
const his = (text, name) => `<div class="a-game-his"><small>${esc(name)}</small><p>${esc(text)}</p></div>`;
const wait = (T, name) => `<div class="a-game-his a-game-wait"><small>${esc(name)}</small><p>${esc(T('app.game.thinking', { name }))}</p></div>`;
const box = (k, text, cls) => `<div class="a-game-q${cls ? ' ' + cls : ''}"><small>${esc(k)}</small><p>${esc(text)}</p></div>`;
function wire(root){
  root.querySelectorAll('[data-inner]').forEach(b => b.onclick = () => {
    const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open));
    b.querySelector('.a-game-inner-t').textContent = open ? b.dataset.inner : '';
  });
}

function mountGame(el, ctx){
  const T = ctx.T, name = () => (ctx.contact && ctx.contact.name) || M().store.name;
  let alive = true, busy = false;
  el.querySelector('.a-game-body').innerHTML = `
    <div class="gtitle">${esc(T('app.game.rps'))}</div>
    <div class="group a-game-rps"><p class="a-game-lead">${esc(T('app.game.rps.lead', { name: name() }))}</p>
      <div class="a-game-hands">${HANDS.map(h => `<button data-hand="${h}">${esc(T('app.game.hand.' + h))}</button>`).join('')}</div>
      <div class="a-game-stage" id="gRps" hidden></div>
      <small class="a-game-score"></small></div>
    <div class="gtitle">${esc(T('app.game.truth'))}</div>
    <div class="group a-game-truth">
      <div class="a-game-two"><button id="gAsk">${esc(T('app.game.truth.ask', { name: name() }))}</button><button id="gHim">${esc(T('app.game.truth.him', { name: name() }))}</button></div>
      <div class="a-game-stage" id="gTruth" hidden></div></div>
    <div class="foot">${esc(T('app.game.foot', { name: name() }))}</div>`;
  const $ = s => el.querySelector(s), hands = () => el.querySelectorAll('[data-hand]');
  const setHands = on => hands().forEach(x => x.disabled = !on);

  async function score(){
    const rounds = (await M().records.list(TYPE)).filter(g => g.game === 'rps');
    const s = { her: 0, him: 0, draw: 0 }; rounds.forEach(g => { s[g.winner] = (s[g.winner] || 0) + 1; });
    if (alive) $('.a-game-score').textContent = T('app.game.score', s);
  }
  // react: null while he is still answering, '' when he said nothing
  function rpsStage(rec, react){
    const st = $('#gRps'); st.hidden = false;
    st.innerHTML = `<b class="a-game-res">${esc(T('app.game.result.' + rec.winner))}</b>
      <div class="a-game-vs">${esc(T('app.game.card.hands', { her: T('app.game.hand.' + rec.her), his: T('app.game.hand.' + rec.his) }))}</div>
      ${innerBtn(rec.inner, T)}
      ${react === null ? wait(T, name()) : react ? his(react, name()) : ''}
      ${react === null ? '' : `<button class="btn" id="gAgain">${esc(T('app.game.again'))}</button>`}`;
    wire(st);
    const again = st.querySelector('#gAgain'); if (again) again.onclick = () => { st.hidden = true; st.innerHTML = ''; setHands(true); };
  }
  hands().forEach(b => b.onclick = async () => {
    if (busy) return; busy = true; setHands(false);
    const st = $('#gRps'); st.hidden = false; st.innerHTML = wait(T, name());
    try {
      const rec = await play(b.dataset.hand, ctx, r => { if (alive) rpsStage(r, null); });
      if (alive && rec) rpsStage(rec, rec.react || '');
      score();
    } finally { busy = false; }
  });

  const tst = $('#gTruth');
  function askForm(){
    tst.hidden = false;
    tst.innerHTML = `<p class="a-game-lead">${esc(T('app.game.truth.lead'))}</p>
      <textarea id="gQ" rows="2" maxlength="80" placeholder="${esc(T('app.game.truth.placeholder'))}"></textarea>
      <button class="btn" id="gGo">${esc(T('app.game.truth.go'))}</button>`;
    const q = tst.querySelector('#gQ');
    tst.querySelector('#gGo').onclick = async () => {
      const text = q.value.trim(); if (!text) { q.focus(); return; }
      if (busy) return; busy = true;
      tst.innerHTML = box(T('app.game.truth.yourq'), text) + wait(T, name());
      try {
        const rec = await truthAsk(text, ctx);
        if (!alive) return;
        tst.innerHTML = box(T('app.game.truth.yourq'), text) +
          (rec && rec.a ? his(rec.a, name()) : `<p class="a-game-lead">${esc(T('app.game.toast.noanswer'))}</p>`) + innerBtn(rec && rec.inner, T) +
          `<button class="btn" id="gMore">${esc(T('app.game.truth.more'))}</button>`;
        wire(tst); tst.querySelector('#gMore').onclick = askForm;
      } finally { busy = false; }
    };
  }
  async function himAsks(){
    if (busy) return; busy = true;
    tst.hidden = false; tst.innerHTML = wait(T, name());
    try {
      const rec = await truthHim(ctx);
      if (!alive) return;
      if (!rec) { tst.innerHTML = `<p class="a-game-lead">${esc(T('app.game.toast.noanswer'))}</p>`; return; }
      const head = box(T('app.game.card.hisq'), rec.q, 'a-game-hisq');
      tst.innerHTML = head + innerBtn(rec.inner, T) +
        `<textarea id="gA" rows="3" maxlength="200" placeholder="${esc(T('app.game.truth.answer.placeholder'))}"></textarea>
        <button class="btn" id="gAnswer">${esc(T('app.game.truth.answer'))}</button>`;
      wire(tst);
      const a = tst.querySelector('#gA');
      tst.querySelector('#gAnswer').onclick = async () => {
        const text = a.value.trim(); if (!text) { a.focus(); return; }
        if (busy) return; busy = true;
        const both = head + box(T('app.game.truth.youra'), text);
        tst.innerHTML = both + wait(T, name());
        try {
          const done = await truthAnswer(rec.id, text, ctx);
          if (!alive) return;
          tst.innerHTML = both + (done && done.react ? his(done.react, name()) : '') + `<button class="btn" id="gMore">${esc(T('app.game.truth.again'))}</button>`;
          tst.querySelector('#gMore').onclick = himAsks;
        } finally { busy = false; }
      };
    } finally { busy = false; }
  }
  $('#gAsk').onclick = () => { if (!busy) askForm(); };
  $('#gHim').onclick = himAsks;
  score();
  return () => { alive = false; };
}

ModuApps.register({
  id: 'game', version: '0.3', icon: 'i-game', title: 'app.game', status: 'ready', css: true, records: [TYPE],
  // played with one person, in its own session; what it writes, held to it by a static check
  scope: 'contact', surface: 'session',
  writes: { records: ['game'], events: { rps: '猜拳', truth: '真心话' }, chat: 'summary' },
  contactActions: [{ id: 'play', title: 'app.game.with' }],
  invite: { kind: 'game', words: 'invite.game', hours: [18, 23] },   // 主动: he may ask her to this (app/core/reach.js)
  mount(el, ctx){
    el.innerHTML = `<div class="pad-top"></div><div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(ctx.T('app.game'))}</div></div><div class="list a-game-body"></div>`;
    pending = null;   // a hand asked for in another session (or for another person) is not his now
    const s = ctx.session.begin({ title: '小游戏' }), v = newVisit();
    cur = s; visit = v;
    s.hold('你们正在小游戏里').catch(e => console.error(e));
    const stop = mountGame(el, ctx);
    askHand();   // he chooses his hand now, before she picks
    const who = (ctx.contact && ctx.contact.name) || M().store.name;
    return () => { stop(); if (cur === s) { cur = null; visit = null; pending = null; } leave(s, v, ctx.T, who); };
  },
  card,
  api: { play, askHand, truthAsk, truthHim, truthAnswer, readHand, winner, summary, reset(){ pending = null; } },
});
})();
