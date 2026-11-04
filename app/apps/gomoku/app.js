// 五子棋 (gomoku), a page-2 app. The proof that a new game is one folder: it is
// registered, keeps its own records (`gomoku`) and its own event kind (`game`), declared in `writes`,
// and needs no change in the core and no new prompt block.
// - Played with one person (scope 'contact'; his chat's ··· → 下五子棋), in its own session (surface 'session',
//   ctx.session): his moves are his turns (s.turn: his usual prompt plus one line, never into the chat). He
//   is told the board and a few good points (the app's own reckoning) and picks one with [落子: H7]; an
//   answer with no move, or a taken point, gets the best point instead (picked: 'auto'). What he says while
//   he plays shows in a thin strip in the game, and his 心声 under it, closed until she taps it.
// - Every finished game is one line in the event log (s.log), so in chat afterwards he knows; while she plays,
//   s.hold tells his chat turns what they are doing (the activity block).
// - Leaving (back, home, switching person) ends the session with one neutral grey line in the chat
//   (not her voice, not his). Nothing leaves the page but the model call the core already makes.
(function(){
'use strict';
const ID = 'gomoku', TYPE = 'gomoku', N = 13, COLS = 'ABCDEFGHIJKLM', EMPTY = 0, BLACK = 1, WHITE = 2;
const M = () => window.ModuCore;
// time from the core's one clock (ModuCore.now), so ?at= and a test's clock move it too
const nowMs = () => { const c = M(); return c && c.now ? c.now().getTime() : Date.now(); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const newId = () => nowMs().toString(36) + Math.random().toString(36).slice(2, 6);

// ---- the board (pure): an array of N*N points, EMPTY | BLACK | WHITE; a point is { r, c } (0-based) ----
const at = (b, r, c) => r >= 0 && r < N && c >= 0 && c < N ? b[r * N + c] : -1;
const pointName = p => COLS[p.c] + (p.r + 1);   // { r:6, c:7 } → 'H7' (columns A–M, rows 1–13 from the top)
// 'H7', 'h 7', '[落子: H7]' → { r, c }, or null
function parseMove(t){
  const m = /([A-Ma-m])\s*[-－]?\s*(1[0-3]|[1-9])(?!\d)/.exec(String(t == null ? '' : t));
  return m ? { r: Number(m[2]) - 1, c: COLS.indexOf(m[1].toUpperCase()) } : null;
}
function boardOf(moves){
  const b = new Array(N * N).fill(EMPTY);
  moves.forEach(([r, c], i) => { b[r * N + c] = i % 2 ? WHITE : BLACK; });   // black moves first
  return b;
}
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
// the run of `who` through (r, c) along one direction, counting (r, c) itself, and how many of its ends are open
function run(b, r, c, dr, dc, who){
  let n = 1, open = 0;
  for (const s of [1, -1]){
    let k = 1; while (at(b, r + dr * k * s, c + dc * k * s) === who){ n++; k++; }
    if (at(b, r + dr * k * s, c + dc * k * s) === EMPTY) open++;
  }
  return { n, open };
}
// did the stone at (r, c) make five (or more) in a row?
function wins(b, r, c){ const who = at(b, r, c); return who > 0 && DIRS.some(([dr, dc]) => run(b, r, c, dr, dc, who).n >= 5); }
const SCORE = (n, open) => n >= 5 ? 100000 : !open ? 0 : n === 4 ? (open === 2 ? 20000 : 4000) : n === 3 ? (open === 2 ? 2000 : 150) : n === 2 ? (open === 2 ? 120 : 15) : open;
const worth = (b, r, c, who) => DIRS.reduce((v, [dr, dc]) => { const x = run(b, r, c, dr, dc, who); return v + SCORE(x.n, x.open); }, 0);
// the app's own reckoning: the k best empty points for `who` (its own lines a little above blocking hers), best first
function best(b, who, k = 5){
  const mid = N >> 1;
  if (!b.some(x => x)) return [{ r: mid, c: mid, v: 0 }];
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++){
    if (b[r * N + c]) continue;
    let near = false;
    for (let dr = -2; dr <= 2 && !near; dr++) for (let dc = -2; dc <= 2 && !near; dc++) if (at(b, r + dr, c + dc) > 0) near = true;
    if (near) out.push({ r, c, v: worth(b, r, c, who) * 1.1 + worth(b, r, c, 3 - who) });
  }
  const far = p => Math.abs(p.r - mid) + Math.abs(p.c - mid);
  return out.sort((x, y) => y.v - x.v || far(x) - far(y) || x.r - y.r || x.c - y.c).slice(0, k);
}
// the board as he reads it: ● black, ○ white, · empty
function boardText(b){
  const rows = ['    ' + COLS.split('').join(' ')];
  for (let r = 0; r < N; r++) rows.push(String(r + 1).padStart(2) + '  ' + b.slice(r * N, r * N + N).map(x => x === BLACK ? '●' : x === WHITE ? '○' : '·').join(' '));
  return rows.join('\n');
}

// what he is told (not shown to her; like the core's own rules, kept in code)
const IN_GAME = '这是在小手机的五子棋里，不是在聊天里';
const STONE = { [BLACK]: '黑棋（●）', [WHITE]: '白棋（○）' };
const TOLD = {
  move: (b, his, last, cands) => `（小手机里的五子棋，${IN_GAME}）你们在下五子棋，棋盘 13×13，先连成五子的赢。你执${STONE[his]}，她执${STONE[3 - his]}。${last ? `她刚下在 ${last}。` : '你先下。'}现在的棋盘（列 A–M，行 1–13）：\n${boardText(b)}\n轮到你下。按你的性格下，想认真就认真，想让她就让她。可以随口说一句（不超过二十个字），也可以不说。几个不错的空位：${cands}（只是参考）。最后单独一行写 [落子: H7] 这样的位置，必须是空位。`,
  end: (result, n) => `（小手机里的五子棋，${IN_GAME}）这一局下完了：${result}，一共${n}手。在游戏里回她一句，像下棋时随口说的，不超过二十个字。`,
};
const RESULT = { her: '她赢了', him: '你赢了', draw: '和棋', resign: '她认输了' };

// ---- this visit: the session open now and the games in it ----
let cur = null, visit = null;   // visit: { her, him, draw, games, live: the game on the board }
async function turn(told, o){ return cur ? await cur.turn(told, o) : await M().turn(told, o); }
// one line into the event log (s.log: logEvent with the session id)
// (s: the session the game was played in, so a line written as she leaves still carries its id)
function log(what, line, detail, s = cur){
  const e = { who: 'both', what, line, detail };
  return (s ? s.log(e) : M().logEvent(Object.assign({ app: ID, title: '五子棋' }, e))).catch(err => console.error(err));
}
function hold(){
  const g = visit && visit.live; if (!cur || !g) return;
  cur.hold(`你们正在下五子棋，第${g.n}局，第${g.moves.length}手`).catch(e => console.error(e));
}
// his words, as words for the game screen: no *actions*, no final 。 (like his chat lines)
function words(t){
  const core = M(); t = String(t || '').replace(/\*[^*\n]+\*/g, '').replace(/\s*\n+\s*/g, ' ').trim();
  return core.dropFinalStop ? core.dropFinalStop(t) : t;
}
function newGame(n){ return { id: newId(), n, first: n % 2 ? 'her' : 'him', moves: [], picked: [], said: [], winner: '' }; }
const hisColor = g => g.first === 'him' ? BLACK : WHITE;
const whoseTurn = g => (g.moves.length % 2 ? WHITE : BLACK) === hisColor(g) ? 'him' : 'her';
function save(g){
  return M().records.put(TYPE, { id: g.id, kind: 'game', session: cur ? cur.id : '', n: g.n, first: g.first, moves: g.moves, picked: g.picked, said: g.said, winner: g.winner }, { app: ID }).catch(e => console.error(e));
}

// his move: → { move, picked: 'model' | 'auto', text, inner }
async function hisMove(g, ctx){
  const b = boardOf(g.moves), his = hisColor(g), cands = best(b, his, 5);
  const last = g.moves.length ? pointName({ r: g.moves[g.moves.length - 1][0], c: g.moves[g.moves.length - 1][1] }) : '';
  let move = null, text = '', inner = '';
  try {
    const r = await turn(TOLD.move(b, his, last, cands.map(pointName).join('、')), { inner: true, max: 300, tags: ['落子'] });
    const p = parseMove(r.tags && r.tags['落子']);
    if (p && at(b, p.r, p.c) === EMPTY) move = p;
    if (!r.noReply) text = words(r.text);
    inner = r.inner || '';
  } catch(e){ if (ctx && ctx.toast) ctx.toast(ctx.T('app.gomoku.toast.noanswer')); }
  return { move: move || cands[0], picked: move ? 'model' : 'auto', text, inner };
}
// the game is over: tally it, ask him for one line (unless his own winning move already said one), log it
async function finish(g, winner, ctx){
  const s = cur;
  g.winner = winner;
  if (visit && visit.live === g){ visit[winner === 'resign' ? 'him' : winner]++; visit.games++; }
  let react = '';
  if (winner !== 'him'){
    try { const r = await turn(TOLD.end(RESULT[winner], g.moves.length), { inner: true, max: 200 }); if (!r.noReply) react = words(r.text); if (react) g.said.push({ at: g.moves.length, text: react, inner: r.inner || '' }); }
    catch(e){ if (ctx && ctx.toast) ctx.toast(ctx.T('app.gomoku.toast.noanswer')); }
  }
  await save(g);
  const said = react || (g.said.length && g.said[g.said.length - 1].at === g.moves.length ? g.said[g.said.length - 1].text : '');
  await log('game', `五子棋第${g.n}局：${g.first === 'her' ? '她执黑先下' : '你执黑先下'}，${g.moves.length}手，${RESULT[winner]}` + (said ? `；你说「${clip(said, 40)}」` : ''), { id: g.id, winner, moves: g.moves.length }, s);
  return react;
}

// ---- after the game: one neutral line in the chat (not her voice, not his) ----
// pure: (visit, T, name) → the summary line, or '' when no stone was placed
function summary(v, T, name){
  const open = v.live && !v.live.winner && v.live.moves.length ? v.live.moves.length : 0;
  if (!v.games && !open) return '';
  const parts = [];
  if (v.games) parts.push(T('app.gomoku.chat.games', { n: v.games, her: v.her, him: v.him, draw: v.draw, name }));
  if (open) parts.push(T('app.gomoku.chat.open', { m: open }));
  return T('app.gomoku.chat', { what: parts.join(T('app.gomoku.chat.and')), name });
}
// ends the session at once (the page's own end, and a switch of person, then find it ended with its card)
function leave(s, v, T, name){
  const line = summary(v, T, name), g = v.live;
  if (g && !g.winner && g.moves.length){
    save(g);
    s.log({ who: 'both', what: 'game', line: `五子棋第${g.n}局：下了${g.moves.length}手，没有下完`, detail: { id: g.id, moves: g.moves.length } }).catch(e => console.error(e));
  }
  if (!line) return s.end();
  const id = newId();
  M().records.put(TYPE, { id, kind: 'visit', session: s.id, games: v.games, her: v.her, him: v.him, draw: v.draw }, { app: ID }).catch(e => console.error(e));
  return s.end({ card: { line, type: TYPE, id } });
}

// ---- the screen ----
const innerBtn = (t, T) => t ? `<button type="button" class="a-gmk-inner" aria-expanded="false" aria-label="${esc(T('app.gomoku.inner.tap'))}" data-inner="${esc(t)}"><span class="a-gmk-inner-k">${esc(T('app.gomoku.inner'))}</span><span class="a-gmk-inner-t"></span></button>` : '';
function mountBoard(el, ctx){
  const T = ctx.T, name = (ctx.contact && ctx.contact.name) || M().store.name;
  let alive = true, busy = false;
  el.querySelector('.a-gmk-body').innerHTML = `
    <div class="group a-gmk-top"><b class="a-gmk-status" aria-live="polite"></b><small class="a-gmk-score"></small></div>
    <div class="a-gmk-board" role="grid" aria-label="${esc(T('app.gomoku'))}">${Array.from({ length: N * N }, (_, i) => `<button type="button" class="a-gmk-pt" data-pt="${i}" aria-label="${pointName({ r: Math.floor(i / N), c: i % N })}"></button>`).join('')}</div>
    <div class="group a-gmk-strip" aria-live="polite"></div>
    <div class="a-gmk-acts"><button type="button" class="btn2" id="gmkResign">${esc(T('app.gomoku.resign'))}</button><button type="button" class="btn" id="gmkAgain" hidden>${esc(T('app.gomoku.again'))}</button></div>
    <div class="foot">${esc(T('app.gomoku.foot', { name }))}</div>`;
  const $ = s => el.querySelector(s), pts = [...el.querySelectorAll('[data-pt]')];
  function draw(){
    const g = visit.live, b = boardOf(g.moves), last = g.moves.length ? g.moves[g.moves.length - 1] : null;
    pts.forEach((p, i) => {
      const x = b[i]; p.classList.toggle('bk', x === BLACK); p.classList.toggle('wh', x === WHITE);
      p.classList.toggle('last', !!last && last[0] * N + last[1] === i);
      p.disabled = !!x || busy || !!g.winner || whoseTurn(g) !== 'her';
    });
    const mine = STONE_WORD(T, 3 - hisColor(g));
    $('.a-gmk-status').textContent = g.winner ? T('app.gomoku.result.' + g.winner, { name }) : busy || whoseTurn(g) === 'him' ? T('app.gomoku.thinking', { name }) : T('app.gomoku.yours', { stone: mine });
    $('.a-gmk-score').textContent = T('app.gomoku.score', { n: g.n, her: visit.her, him: visit.him, name });
    const lines = g.said.slice(-3);
    $('.a-gmk-strip').innerHTML = lines.length ? lines.map((l, i) => `<div class="a-gmk-his"><small>${esc(name)}</small><p>${esc(l.text)}</p>${i === lines.length - 1 ? innerBtn(l.inner, T) : ''}</div>`).join('') : `<small class="a-gmk-quiet">${esc(T('app.gomoku.strip.empty', { name }))}</small>`;
    $('.a-gmk-strip').querySelectorAll('[data-inner]').forEach(bt => bt.onclick = () => {
      const open = bt.getAttribute('aria-expanded') !== 'true'; bt.setAttribute('aria-expanded', String(open));
      bt.querySelector('.a-gmk-inner-t').textContent = open ? bt.dataset.inner : '';
    });
    $('#gmkResign').hidden = !!g.winner || !g.moves.length; $('#gmkAgain').hidden = !g.winner;
  }
  async function his(){
    const g = visit.live; busy = true; draw();
    try {
      const m = await hisMove(g, ctx);
      if (!alive || !visit || visit.live !== g || g.winner) return;
      g.moves.push([m.move.r, m.move.c]); g.picked.push(m.picked);
      if (m.text || m.inner) g.said.push({ at: g.moves.length, text: m.text, inner: m.inner });
      hold();
      const b = boardOf(g.moves);
      if (wins(b, m.move.r, m.move.c)) await finish(g, 'him', ctx);
      else if (g.moves.length === N * N) await finish(g, 'draw', ctx);
      else save(g);
    } finally { busy = false; if (alive) draw(); }
  }
  async function start(n){
    visit.live = newGame(n); hold(); draw();
    if (whoseTurn(visit.live) === 'him') await his();
  }
  pts.forEach((p, i) => p.onclick = async () => {
    const g = visit.live; if (busy || g.winner || whoseTurn(g) !== 'her' || boardOf(g.moves)[i]) return;
    const r = Math.floor(i / N), c = i % N;
    g.moves.push([r, c]); hold();
    if (wins(boardOf(g.moves), r, c)){ busy = true; draw(); try { await finish(g, 'her', ctx); } finally { busy = false; if (alive) draw(); } return; }
    if (g.moves.length === N * N){ busy = true; draw(); try { await finish(g, 'draw', ctx); } finally { busy = false; if (alive) draw(); } return; }
    await his();
  });
  $('#gmkResign').onclick = async () => {
    const g = visit.live; if (busy || g.winner || !g.moves.length) return;
    busy = true; draw(); try { await finish(g, 'resign', ctx); } finally { busy = false; if (alive) draw(); }
  };
  $('#gmkAgain').onclick = () => { if (!busy) start(visit.live.n + 1); };
  start(1);
  return () => { alive = false; };
}
const STONE_WORD = (T, x) => T(x === BLACK ? 'app.gomoku.black' : 'app.gomoku.white');

ModuApps.register({
  id: 'gomoku', version: '0.1', icon: 'i-gomoku', title: 'app.gomoku', status: 'ready', css: true, records: [TYPE],
  icons: { 'i-gomoku': '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/><circle cx="9.3" cy="9.3" r="1.6" fill="currentColor"/><circle cx="14.7" cy="14.7" r="1.6"/>' },
  // played with one person, in its own session; what it writes, held to it by a static check
  scope: 'contact', surface: 'session',
  writes: { records: ['gomoku'], events: { game: '五子棋' }, chat: 'summary' },
  contactActions: [{ id: 'play', title: 'app.gomoku.with' }],
  invite: { kind: 'game', words: 'invite.game', hours: [18, 23] },   // 主动: he may ask her to this (app/core/reach.js)
  mount(el, ctx){
    el.innerHTML = `<div class="pad-top"></div><div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(ctx.T('app.gomoku'))}</div></div><div class="list a-gmk-body"></div>`;
    const s = ctx.session.begin({ title: '五子棋' }), v = { her: 0, him: 0, draw: 0, games: 0, live: null };
    cur = s; visit = v;
    const stop = mountBoard(el, ctx), who = (ctx.contact && ctx.contact.name) || M().store.name;
    return () => { stop(); if (cur === s) { cur = null; visit = null; } leave(s, v, ctx.T, who); };
  },
  api: { N, parseMove, boardOf, wins, best, boardText, summary, pointName },
});
})();
