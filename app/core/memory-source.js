// app/core/memory-source.js: the memory source: where his memory block comes from: Modu's own engine by default, or her own (an outside agent, another tool).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store, clone, now } = core;

// Modu's memory is a replaceable default. A source is plain text out and events in:
//   { id, recall({ recent, status, budget }) → text (or a Promise of it), tell?(event) }
//   recent: her and his last messages [{ who: 'her' | 'him', text, at }]; status: personaState(); budget: characters;
//   companion: { id, name } (whose memory: one outside memory may serve several companions; also on every event).
//   A recall that fails or takes longer than the knob memory.recall_timeout_ms (default 4000) counts as none this
//   turn: Modu's own block is used instead, and it is logged.
//   The text is placed where the memory block goes, as it comes. '' = nothing to say this turn.
//   event = { kind: 'chat' | 'day' | 'app' | 'absence', at, … }: chat { msgs: [{ who, text, at }] } after each turn;
//   day { day, record } when a day ages out; app { app, line } for an app moment worth keeping; absence { from, to, days }.
// Nothing here assumes files, YAML, scores or fading: those are Modu's own engine's business, behind the seam.
// Modu's own source is the default: its engine (memory-engine.js: fading, threads, BM25, age-out, facts) builds
// the memory block itself and takes the same events; `memorySource.own` is that engine.
const companion = () => ({ id: core.currentId || '', name: store.name || '' });
const MODU = Object.freeze({ id: 'modu', recall: o => core.memoryOwn ? core.memoryOwn.recall(o) : null, tell: e => core.memoryOwn ? core.memoryOwn.tell(e) : undefined });
let source = MODU;
const LATE = Symbol('late');
core.recalled = null;   // { key, text }: the last recall of an outside source, for the synchronous memory block
const memorySource = {
  // use(source) → its id; use(null) puts Modu's own back. A source without recall is refused.
  use(s){
    if (s == null){ source = MODU; core.recalled = null; return source.id; }
    if (typeof s !== 'object' || typeof s.recall !== 'function') throw new Error('记忆来源需要 recall');
    source = Object.freeze({ id: String(s.id || 'outside'), recall: s.recall.bind(s), tell: typeof s.tell === 'function' ? s.tell.bind(s) : () => {},
      url: /^https?:\/\//.test(String(s.url || '')) ? String(s.url) : '' });
    core.recalled = null; return source.id;
  },
  get id(){ return source.id; },
  get outside(){ return source !== MODU; },
  // for the 记忆 page: where her own memory can be read and edited (an http(s) address the source gives as `url`), and
  // the text its last recall gave (what 记忆 shows, "the few he recalled lately")
  get link(){ return source.url || ''; },
  get last(){ return source !== MODU && core.recalled ? core.recalled.text : ''; },
  async recall(o = {}){ const v = await source.recall(Object.assign({ companion: companion() }, clone(o))); return v == null ? null : String(v); },
  async tell(e){ if (!e || typeof e !== 'object' || !e.kind) return false; try { await source.tell(Object.assign({ at: now().getTime(), companion: companion() }, clone(e))); return true; } catch(err){ console.error(err); return false; } },
};
// before a turn (refreshLife waits for it): an outside source is asked once, so the block can be built synchronously
let asked = '';   // what the last recall was asked for (the companion and the chat's length): asked again only when it moves
async function readRecall(){
  if (!memorySource.outside || !store.name){
    core.recalled = null; asked = '';
    if (store.name && core.memoryOwn){ try { await core.memoryOwn.prepare(); } catch(e){ console.error(e); } }   // Modu's own: waiting days, the tidy, meaning search
    return;
  }
  const key = core.lifeKey(), at = source.id + '|' + key + '|' + store.msgs.length;
  if (at === asked && core.recalled && core.recalled.key === key) return;
  asked = at;
  const recent = store.msgs.filter(m => !(core.chatCardKind && core.chatCardKind(m))).slice(-8).map(m => ({ who: m.is_user ? 'her' : 'him', text: String(m.mes || ''), at: (core.msgDate(m) || now()).getTime() }));
  let text = null, timer = null;
  const ms = Math.max(100, Number(core.param ? core.param('memory.recall_timeout_ms', 4000) : 4000) || 4000);
  const late = new Promise(res => { timer = setTimeout(() => res(LATE), ms); });
  try { text = await Promise.race([memorySource.recall({ recent, status: core.personaState(), budget: 3500 }), late]); }
  catch(e){ console.warn(`memory source ${source.id}: recall failed, Modu's own memory this turn`, e); text = null; core.emit('memorysource', { ok: false, id: source.id }); }
  finally { clearTimeout(timer); }
  if (text === LATE){ console.warn(`memory source ${source.id}: no answer in ${ms} ms, Modu's own memory this turn`); text = null; asked = ''; core.emit('memorysource', { ok: false, id: source.id, late: true }); }
  core.recalled = text == null ? null : { key, text };
}

Object.assign(core, { memorySource, readRecall });
})(globalThis[Symbol.for('modu.core')]);
