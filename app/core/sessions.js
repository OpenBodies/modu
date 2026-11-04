// app/core/sessions.js: app sessions and the neutral chat cards: what she and he are doing in an app right now.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, clip, now, appendToChat } = core;

// --- Neutral chat cards: a grey line in the chat, not her voice and not his ---------------------------------
// Kept in his chat file as a 酒馆 system (narrator) message, so a 酒馆-style reader shows it as a note and
// leaves it out of the prompt: { name:'System', is_user:false, is_system:true, mes, extra:{ type:'narrator',
// modu_card:{ kind, app, title?, session?, id? } } }. Two kinds:
//   'summary'  one line at the end of an app session (neutral, not hers, not his)
//   'invite'   his invitation into an app: only the hook. It is drawn if one is there; nothing in
//              Modu writes one yet.
// The core's prompt never reads these lines as anyone's words (context, memory job, the contact list skip
// them): what happened reaches him through the event log instead.
const CARD_KINDS = ['summary', 'invite'];
// pure: → the card's kind ('summary' | 'invite') when the message is a neutral chat card, else ''
function chatCardKind(m){
  const c = m && m.is_system && m.extra && m.extra.modu_card;
  return c && CARD_KINDS.includes(c.kind) ? c.kind : '';
}
// card: { kind ('summary' default | 'invite'), app, line (or mes), title?, session?, id? } → Promise<message>.
// Appended to the chat and announced (the 'message' event). Throws on an empty line, an unknown kind or no companion.
async function addChatCard(card = {}){
  if (!store.name) throw new Error('还没有打开联系人');
  const kind = card.kind || 'summary';
  if (!CARD_KINDS.includes(kind)) throw new Error(`没有「${kind}」这种卡片`);
  const line = clip(String(card.line || card.mes || '').replace(/\s+/g, ' ').trim(), 200);
  if (!line) throw new Error('这张卡片是空的');
  const c = { kind, app: clip(String(card.app || ''), 40) };
  for (const k of ['title', 'session', 'id', 'type']) if (card[k]) c[k] = clip(String(card[k]), 64);
  const m = { name:'System', is_user:false, is_system:true, is_name:false, send_date: now().getTime(), mes: line, extra:{ type:'narrator', modu_card: c } };
  await appendToChat(m, { announce:true });
  return clone(m);
}

// --- App sessions: an app that owns the screen while she is in it, with him --------------------------------
// The page's ctx.session is a thin helper on these calls. A session belongs to the companion open when
// it began. While it is open its `hold` line (what his chat turns should know: "你们正在一起听《…》，第2首")
// goes into the `activity` block of his prompt. Ending it may add one summary card to the chat.
// Sessions live in memory only: a reload ends them (the app begins a new one when it mounts again).
core.openSessions = [];
const SESSION_ID = /^[A-Za-z0-9_-]{1,40}$/;
const sessionOf = id => core.openSessions.find(s => s.id === id) || null;
const said = (op, s) => emit('session', { op, session: clone(s), open: sessionList() });
// state: → the open sessions (copies), oldest first
function sessionList(){ return clone(core.openSessions); }
// { app, title?, id? } → Promise<session { id, app, title, contact, at, hold }>
async function beginSession(o = {}){
  const app = String(o.app || '');
  if (!core.RECORD_TYPE.test(app)) throw new Error(`应用「${app}」无法开始`);
  if (!store.name) throw new Error('还没有打开联系人');
  const id = o.id ? String(o.id) : now().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
  if (!SESSION_ID.test(id)) throw new Error(`编号「${id}」无法使用`);
  const was = sessionOf(id); if (was) return clone(was);
  const s = { id, app, title: clip(String(o.title || ''), 20), contact: core.currentId || '', at: now().getTime(), hold: '' };
  core.openSessions.push(s);
  said('begin', s);
  return clone(s);
}
// (id, line) → Promise<session | null>: what his chat turns see while it is open ('' = nothing)
async function holdSession(id, line){
  const s = sessionOf(String(id)); if (!s) return null;
  s.hold = clip(String(line || '').replace(/\s+/g, ' ').trim(), 160);
  said('hold', s);
  return clone(s);
}
// (id, { card? }) → Promise<{ session, card }>: closes it; card (the fields of addChatCard, kind 'summary')
// adds one neutral line to the chat. Ending a session that is not open does nothing ({ session:null, card:null }).
async function endSession(id, o = {}){
  const s = sessionOf(String(id)); if (!s) return { session:null, card:null };
  core.openSessions = core.openSessions.filter(x => x !== s);
  said('end', s);
  let card = null;
  const c = o && o.card;
  if (c && (c.line || c.mes) && s.contact === (core.currentId || '')){
    card = await addChatCard(Object.assign({}, c, { kind:'summary', app: s.app, session: s.id, title: c.title || s.title }));
  }
  return { session: clone(s), card };
}
// → the lines of the `activity` block: the open sessions of the companion open now that hold a line
function activityLines(budget){
  const out = []; let n = 0;
  for (const s of core.openSessions){
    if (!s.hold || s.contact !== (core.currentId || '')) continue;
    const l = '- ' + s.hold; if (n + l.length + 1 > budget) break;
    out.push(l); n += l.length + 1;
  }
  return out;
}

Object.assign(core, { CARD_KINDS, chatCardKind, addChatCard, sessionList, beginSession, holdSession, endSession, activityLines });
})(globalThis[Symbol.for('modu.core')]);
