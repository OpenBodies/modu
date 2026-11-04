// app/core/turn.js: one turn: her message in, his reply out (send).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, msgDate, tidyCJK, parseReply, appendToChat, writeChat, refreshLife, publishPersona,
  publish, setPhase, buildContext, callModel } = core;

// --- One turn: her message in, his reply out --------------------------------------------------
// Returns his message (a 酒馆 message with extra.modu_emotion) or throws.
core.lastContext = null;   // what the last turn's prompt was made of (sizes only), for 设置 and tests
async function send(text, settings, opts={}){
  // her message is stored under her chat's own name (store.meta.user_name); the name she gave in 聊天设置
  // is hers, on her phone, and only his prompts read it (buildContext, core.userName), never his folder
  const userName = (store.meta && store.meta.user_name) || 'You';
  const mine = { name:userName, is_user:true, is_name:true, send_date: +core.now(), mes:text };   // the core's clock (?at=, a host, a test)
  if (opts.later) mine.extra = { modu_asleep: mine.send_date };
  await appendToChat(mine); emit('message', mine);
  publish({ type:'turn', speaker:'user', name:userName, text });
  // opts.later: he is asleep, so nothing is asked of the model now. Her message is in the chat, delivered
  // and not read (extra.modu_asleep: when it came); the 'deferred' event lets the scheduler book his reply for his wake
  // (reach.js, replies.asleep); his message comes back as with [no-reply]: mes '', extra.modu_no_reply 'asleep', unsaved
  if (opts.later){
    const theirs = { name: store.name, is_user:false, is_name:true, send_date: mine.send_date, mes:'', extra:{ modu_emotion:'neutral', modu_emotion_from:'none', modu_no_reply:'asleep' } };
    emit('deferred', mine); core.updatePresence(); publishPersona();
    return theirs;
  }
  setPhase('thinking');
  try {
    await refreshLife();   // the life block reads his records: wait until the copy is fresh
    const ctx = buildContext({ window: opts.window, inner: opts.inner, noReply: opts.noReply, next: opts.next, promise: opts.promise, call: opts.call, actions: opts.actions, settings });
    core.lastContext = { size: ctx.size, report: ctx.report, memory: ctx.memory, life: ctx.life, events: ctx.events, known: ctx.known, skipped: !!ctx.skipped, at: Date.now() };
    // her turn is counted for the cost meter (设置 → 用量): calls.note, no key kept
    const heard = core.calls ? core.calls.note('chat', ctx.messages, { turn: true, settings }) : (x => x);
    const raw = heard(await callModel(settings, ctx.messages, Object.assign({ own: true }, ctx.skipped ? { user: core.currentId || store.name } : {})));   // her own turn
    // this turn got through, and its context carried her earlier unsent messages to him: unmark them
    let carried = false;
    for (const m of store.msgs) if (m.extra && m.extra.modu_unsent){ delete m.extra.modu_unsent; carried = true; }
    const r = parseReply(raw);
    const said = tidyCJK(r.text), emotion = r.emotion;
    const theirs = { name: store.name, is_user:false, is_name:true, send_date: +core.now(), mes: said, extra:{ modu_emotion: emotion, modu_emotion_from: r.labelled ? 'model' : 'none' } };
    if (r.inner) theirs.extra.modu_inner = tidyCJK(r.inner);
    // his first [state: …] tag is a proposal; state.nudge keeps to the card's rules and refuses a key
    // it did not declare (a card with no state: nothing happens). [promise: …] is kept for the scheduler.
    // read again against the card's own keys first (a key such as stage-2 holds a sign)
    if (r.state.length && core.state) { try { const s0 = (core.state.fromTag && core.state.fromTag(r.state[0].raw)) || r.state[0]; await core.state.nudge(s0.key, s0.delta, s0.why, { writer:'model', turn: mine.send_date }); } catch(e){ console.error(e); } }
    if (r.promises.length) theirs.extra.modu_promises = r.promises.slice(0, 3);
    if (r.nextContact != null) theirs.extra.modu_next_contact = r.nextContact;
    // he read it and did not answer (asked for with [no-reply], or nothing left to say once the
    // tags are cut). Nothing goes into the chat; the 'noreply' event says so, and his message comes back
    // with mes '' and extra.modu_no_reply, unsaved.
    if (r.noReply || !said){
      theirs.extra.modu_no_reply = r.noReply ? 'model' : 'empty';
      if (carried) await writeChat();
      emit('noreply', theirs);
      return theirs;
    }
    setPhase('speaking');
    await appendToChat(theirs); emit('message', theirs);
    publish({ type:'turn', speaker:'companion', name: store.name, text: said, emotion });
    // the memory source hears every turn (Modu's own does nothing with it yet); never waited for
    if (core.memorySource) core.memorySource.tell({ kind:'chat', msgs: [{ who:'her', text, at: mine.send_date }, { who:'him', text: said, at: theirs.send_date }] });
    return theirs;
  } catch(e){
    // her message did not reach him. It stays in her chat marked as unsent (extra.modu_unsent, the
    // time it failed), so the mark is still there after a reload; the error goes on to the caller.
    mine.extra = Object.assign({}, mine.extra, { modu_unsent: Date.now() });
    await writeChat();
    throw e;
  } finally { setPhase('idle'); publishPersona(); }
}

// --- His turn inside an app --------------------------------------------------------------------------------
// turn(told, { inner, max, tags }): one turn of his about something that happens in an app: his usual prompt
// (buildContext, with the event log and the activity block) plus one system line `told`, read with parseReply
// Nothing is added to the chat and no 'message' event is sent: the app shows his words itself (or, to
// put them in the chat as his message, uses 钱包's sayAsHim). Throws when the model fails.
//   inner  ask for his 心声 too                    max   max_tokens (default 400)   settings  (default loadSettings())
//   tags   app tag names to read out of his reply, e.g. ['出']: a line [出: 石头] is cut from text and given
//          back as tags['出'] = '石头' (the first one of each name)
//   as     the name the cost meter counts this call under (e.g. 'shelf' for 他可能喜欢; default 'app')
// → { text (tidied, tags cut), inner, mood (the emotion label), raw (the model's text as it came), noReply, tags }
async function turn(told, opts = {}){
  const settings = opts.settings || core.loadSettings();
  setPhase('thinking');
  try {
    await refreshLife();
    const built = buildContext({ settings, inner: !!opts.inner });   // the core names her (core.userName)
    const extra = String(told == null ? '' : told).trim();
    // through the public ModuCore.callModel, so a host or a test that swaps it (as the apps' own tests do) is heard
    const call = (globalThis.ModuCore && typeof globalThis.ModuCore.callModel === 'function') ? globalThis.ModuCore.callModel : callModel;
    const msgs = built.messages.concat(extra ? [{ role:'system', content: extra }] : []);
    const heard = core.calls ? core.calls.note(opts.as || 'app', msgs, { settings }) : (x => x);   // counted for the cost meter
    const raw = heard(await call(settings, msgs, { max_tokens: Number(opts.max) || 400, own: true }));   // her own tap in an app
    const tags = {}; let rest = String(raw == null ? '' : raw);
    for (const name of [].concat(opts.tags || []).map(String).filter(Boolean)){
      const q = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rest = rest.replace(new RegExp(`[\\[【(（]\\s*${q}\\s*[:：]\\s*([^\\]】)）\\n]{0,60}?)\\s*[\\]】)）]`, 'g'), (m, v) => { if (!(name in tags)) tags[name] = v.trim(); return ''; });
    }
    const r = parseReply(rest.replace(/\n{3,}/g, '\n\n').trim());
    return { text: tidyCJK(r.text || ''), inner: tidyCJK(r.inner || ''), mood: r.emotion, raw: String(raw == null ? '' : raw), noReply: !!r.noReply, tags };
  } finally { setPhase('idle'); }
}

// The day they met: the first dated message (for 在一起第 N 天).
function togetherSince(){ const ds = store.msgs.map(msgDate).filter(Boolean); return ds.length ? new Date(Math.min(...ds)) : null; }

Object.assign(core, { send, turn, togetherSince });
})(globalThis[Symbol.for('modu.core')]);
