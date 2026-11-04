// app/core/memory-engine.js: Modu's own memory engine, the default behind the memory source: fading, threads, BM25 recall, age-out, tidy, facts he has said, meaning search.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, clip, now, isoDay, records, slug, saveMemoryItem, memorySource, hostFetch, callModel, prompt,
  pronouns, chatLanguage, LANG_NAME } = core;

// Everything here is Modu's own engine, behind the seam: an outside memory (her own agent, for example) replaces
// all of it through memorySource.use and gets the same events. Nothing outside this file reads a score.
const DAY = 86400000;
const P = (name, fb) => core.param ? core.param('memory.' + name, fb) : fb;   // knobs: memory.fade_cut, memory.half_days
const dayMs = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? new Date(+m[1], m[2] - 1, +m[3]).getTime() : NaN; };
const todayIso = () => isoDay(now());
const lifeKey = () => core.lifeKey ? core.lifeKey() : store.name;

// --- Fading: worked out on read from the file's inputs (memory format 0.4), never stored ---------------------
// importance 1-5; a value below 1 is read as 0-1, one over 5 as 1-10 (other tools' scales)
function importance(m){
  const raw = m && m.importance; if (raw == null || raw === '') return null;
  let n = Number(raw); if (!isFinite(n)) return null;
  if (n > 0 && n < 1) n *= 5; else if (n > 5) n /= 2;   // 0-1 scale below 1; exactly 1 is 1 of 5
  return Math.min(5, Math.max(1, n));
}
// Never fades: hers, pinned, written by hand, a summary, or a file with no fading inputs at all (every memory from
// before memory format 0.4 behaves exactly as it did).
function lasting(m){
  return !m || m.pinned || m.voice === 'hers' || m.kind === 'summary' || /by hand/.test(m.source || '') ||
    (importance(m) == null && m.valence == null && m.arousal == null && !m.last_seen);
}
const openThread = m => !!(m && Array.isArray(m.threads) && m.threads.length && !m.closed);
// → 0..1, how strongly he still holds it at time t. Half-life: memory.half_days (7) × 2^(importance − 1), longer for a
// strong feeling (× 1 + |valence|/2 + arousal), by the times it was brought back (× 1 + 0.5 × reinforced, counted up to 6)
// and while a thread is open (× 2). The clock starts again at last_seen. A tidy's "overtaken" mark (faded) leaves a quarter.
function strength(m, t){
  if (lasting(m)) return 1;
  const ms = t == null ? now().getTime() : +t, imp = importance(m) == null ? 3 : importance(m);
  const feel = Math.abs(Number(m.valence) || 0) / 2 + Math.max(0, Number(m.arousal) || 0);
  let half = Number(P('half_days', 7)) * Math.pow(2, imp - 1) * (1 + feel) * (1 + 0.5 * Math.min(6, Number(m.reinforced) || 0));
  if (openThread(m)) half *= 2;
  const from = dayMs(m.last_seen) || dayMs(m.date) || ms, age = Math.max(0, (ms - from) / DAY);
  let s = Math.pow(0.5, age / half);
  if (m.faded && dayMs(m.faded) <= ms) s *= 0.25;
  return s;
}
const cut = () => Number(P('fade_cut', 0.25));
const faded = (m, t) => strength(m, t) < cut();

// --- Matching: BM25 over two-character pieces and Latin words; single characters count a little ---------
const STOP = new Set(['我们', '你们', '他们', '什么', '一个', '没有', '不是', '就是', '这个', '那个', '可以', '知道', '因为', '所以', '还是', '时候', '自己', '现在', '今天', 'the', 'and', 'you', 'that', 'this', 'for', 'with']);
const GLUE = /[的了是在有一不这那我你他她它说个就也都和吗呢吧啊么着过要会]/;
const ONE = '\u0001';   // marks a single character piece
function pieces(text){
  const t = String(text || '').toLowerCase(), out = [];
  for (const w of t.match(/[a-z0-9]{2,}/g) || []) if (!STOP.has(w)) out.push(w);
  for (const run of t.match(/[一-鿿]+/g) || []){
    for (const ch of run) if (!GLUE.test(ch)) out.push(ONE + ch);
    for (let i = 0; i + 1 < run.length; i++){ const p = run.slice(i, i + 2); if (!STOP.has(p) && !(GLUE.test(p[0]) && GLUE.test(p[1]))) out.push(p); }
  }
  return out;
}
const single = x => x[0] === ONE;
// BM25 (k1 1.2, b 0.75) of each text against the query → { scores, hits }; a hit shares a telling piece (a word or
// a pair that is in at most a quarter of the texts) with the query, so a lone common character is never a hit
function score(texts, query){
  const docs = texts.map(pieces), N = docs.length, df = new Map();
  const avg = docs.reduce((a, d) => a + d.length, 0) / (N || 1) || 1;
  for (const d of docs) for (const x of new Set(d)) df.set(x, (df.get(x) || 0) + 1);
  const q = [...new Set(pieces(query))], scores = [], hits = [];
  for (const d of docs){
    let s = 0, hit = false;
    if (d.length){
      const tf = new Map(); for (const x of d) tf.set(x, (tf.get(x) || 0) + 1);
      for (const x of q){
        const f = tf.get(x); if (!f) continue;
        const n = df.get(x), idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += (single(x) ? 0.3 : 1) * idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * d.length / avg));
        if (!single(x) && n <= Math.max(1, N * 0.25)) hit = true;
      }
    }
    scores.push(s); hits.push(hit);
  }
  return { scores, hits };
}
const bm25 = (texts, query) => score(texts, query).scores;
// Rank memories for the recent text → [{ m, hit, score }], best first. opts: { t, avoid (Set), seed (turns the order
// of the ones that only fill the room), qvec (meaning search) }. A faded memory comes back only when the text is
// plainly about it; the rest are weighed by how strongly he still holds them.
function rank(memories, recentText, opts = {}){
  const t = opts.t == null ? now().getTime() : opts.t;
  const list = opts.avoid && opts.avoid.size ? memories.filter(m => !opts.avoid.has(m)) : memories.slice();
  const { scores, hits } = score(list.map(m => m.text), recentText), top = Math.max(0, ...scores) || 1, n = list.length;
  const out = [];
  list.forEach((m, i) => {
    const s = strength(m, t), cos = opts.qvec ? meaningOf(m, opts.qvec) : 0;
    const rel = scores[i] / top, hit = hits[i] || cos >= 0.45;
    if (s < cut() && !(hit && rel >= 0.5)) return;
    const recency = n > 1 ? i / (n - 1) : 1;
    const trust = m.confidence === 'high' ? 0.15 : m.confidence === 'low' ? -0.15 : 0;
    const turn = opts.seed == null || hit ? 0 : ((Math.imul(opts.seed + 1, 2654435761) ^ Math.imul(i + 1, 40503)) >>> 0) % 1000 / 1000 * 0.6;
    out.push({ m, hit, score: (rel * 2 + Math.max(0, cos - 0.3) * 3) * (0.5 + 0.5 * s) + recency * 0.3 * s + trust + turn + (openThread(m) ? 0.1 : 0) });
  });
  return out.sort((x, y) => (y.hit - x.hit) || y.score - x.score);
}
// what fits the budget, put back in date order
function pick(memories, recentText, budget, opts){
  const ranked = rank(memories, recentText, opts), chosen = []; let size = 0;
  for (const s of ranked){ const l = s.m.text.length + 3; if (size + l > budget) continue; chosen.push(s); size += l; }
  return { items: chosen.sort((a, b) => memories.indexOf(a.m) - memories.indexOf(b.m)).map(s => s.m), matched: chosen.filter(s => s.hit).length };
}
// the memories he brought up in his last replies (two telling pieces shared), unless her latest
// message is about them
const USED_WINDOW = 15;
function telling(memories){
  const n = memories.length, ts = memories.map(m => new Set(pieces(m.text).filter(x => !single(x) && !GLUE.test(x)))), df = new Map();
  for (const mt of ts) for (const x of mt) df.set(x, (df.get(x) || 0) + 1);
  return ts.map(mt => [...mt].filter(x => df.get(x) <= Math.max(1, n * 0.25)));
}
function usedLately(memories, replies, herLast){
  const out = new Set(); if (!memories.length || !replies.length) return out;
  const keys = telling(memories), rs = replies.map(r => new Set(pieces(r))), her = new Set(pieces(herLast));
  memories.forEach((m, i) => {
    const key = keys[i]; if (key.length < 2) return;
    const hits = t => key.filter(x => t.has(x)).length;
    if (rs.some(t => hits(t) >= 2) && hits(her) < 2) out.add(m);
  });
  return out;
}

// --- The context's memory block, built by this engine: what he remembers. An outside source's text goes there as it came
function memoryBlock(ctx){
  // her own memory's text as it came; when it failed or was late this turn (no text for this companion), Modu's own
  if (memorySource.outside && core.recalled && core.recalled.key === lifeKey()){
    ctx.note.memory = { total: store.memory.length, used: 0, matched: 0, resting: 0, source: memorySource.id };
    return clip(core.recalled.text || '', ctx.budget);
  }
  const t = now().getTime();
  const own = store.memory.filter(m => m.voice !== 'imported' && m.voice !== 'hers'), brought = store.memory.filter(m => m.voice === 'imported');
  const written = store.memory.filter(m => m.voice === 'hers' && m.kind !== 'summary');
  const sum = own.filter(m => m.kind === 'summary').slice(-1)[0];
  const notes = own.filter(m => m.kind !== 'summary');
  const state = placed() ? '' : current();
  const room = ctx.budget - (sum ? sum.text.length : 0) - state.length - 500;
  const all = notes.length + brought.length + written.length;
  const share = all ? notes.length / all : 1, shareW = all ? written.length / all : 0;
  const hers = ctx.allMsgs.filter(m => m.is_user), herText = hers.slice(-4).map(m => m.mes).join('\n');
  const rest = usedLately(notes.concat(brought, written), ctx.allMsgs.filter(m => !m.is_user).slice(-USED_WINDOW).map(m => m.mes), (hers[hers.length - 1] || {}).mes || '');
  const opt = { avoid: rest, seed: ctx.allMsgs.length, t, qvec: meaning.qvec };
  const a = pick(notes, herText, Math.max(0, room * share), opt), b = pick(brought, herText, Math.max(0, room * (1 - share - shareW)), opt);
  const w = pick(written, herText, Math.max(0, room * shareW), opt);
  const parts = [];
  if (state) parts.push(state);
  if (sum || a.items.length) parts.push(`What ${ctx.name} remembers (his own notes from earlier conversations; "我" is ${ctx.name}, "你" is the user):\n` + [sum ? sum.text : ''].concat(a.items.map(m => '- ' + m.text)).filter(Boolean).join('\n'));
  if (w.items.length) parts.push(`What she wrote down for ${ctx.name} herself, in her own words. Here "我" / "I" is HER, the user, not ${ctx.name}; "你" / "you" is ${ctx.name}. These are facts about her (or about the two of you) that ${ctx.name} knows:\n` + w.items.map(m => '- ' + m.text).join('\n'));
  if (b.items.length) parts.push(`More of what ${ctx.name} remembers about her, from your time together before she moved you here. They are written in the third person: 她 / she / 用户 / the user is the person you are talking to now. These are your own memories of what she told you or what happened between you; when they come up, remember them:\n` + b.items.map(m => '- ' + m.text).join('\n'));
  // open threads (he brings back an unresolved thread on his own): at most two, never one that rests
  const open = notes.filter(m => openThread(m) && !rest.has(m) && !faded(m, t)).sort((x, y) => strength(y, t) - strength(x, t)).slice(0, 2);
  if (open.length) parts.push(`Still open between you (something unanswered or still to happen). ${ctx.name} may bring one up on his own when it fits, at most one, never as a list:\n` + open.map(m => '- ' + m.threads.join('; ') + '（' + clip(m.text, 40) + '）').join('\n'));
  if (rest.size && parts.length) parts.push(`${ctx.name} brought these up in his last few replies, so let them rest unless she asks about them, and do not use them as proof that he remembers her: ` + [...rest].slice(0, 6).map(m => '「' + clip(m.text, 30) + '」').join(' '));
  ctx.note.memory = { total: store.memory.length, used: a.items.length + b.items.length + w.items.length + (sum ? 1 : 0), matched: a.matched + b.matched + w.matched, resting: rest.size,
    faded: store.memory.filter(m => faded(m, t)).length, open: open.length, source: 'modu' };
  return clip(parts.join('\n\n'), ctx.budget);
}
// The block is this engine's, put in through setContextBlock (context.js is the layers' file), and again after a reset.
function install(){ if (core.contextBlocks().some(b => b.id === 'memory')) core.setContextBlock('memory', { build: memoryBlock }); }
const reset0 = core.resetContextBlocks;
core.resetContextBlocks = function(){ reset0(); install(); return core.contextBlocks(); };
install();

// --- Facts: the card is the starting state; memory wins for what moves -------------------------
// The card's: card.extensions.modu.facts and/or params.facts = { fixed: [text], moving: [{ id, card_says, owner?, note? }] }, owner
// one of 'memory' | 'state.<k>' (a card state key) | 'counters.<k>' (the params' own lore counters); key/start are read as id/card_says.
// His: facts/<id>.json = { v, id, key, value, said_at, from: 'chat' | 'app' | 'memory', source?, slip?: { breaks, keep },
// overtaken?, writer, rev, at }. The "current state" text, current(), goes after the card and wins on conflict (the
// context's block with id 'current' places it; without such a block it leads the memory block).
const FACTS = 'facts';
function cardFacts(){
  const c = (store.card && store.card.extensions && store.card.extensions.modu && store.card.extensions.modu.facts) || {};
  const p = (core.params && core.params.get && (core.params.get() || {}).facts) || {};
  const fixed = [...new Set([].concat(c.fixed || [], p.fixed || []).map(String).filter(Boolean))];
  const moving = [], seen = new Set();
  // → [{ key, start, note, owner: { kind: 'memory' | 'state' | 'counter', key } }]; an owner in any other form is memory's
  for (const f of [].concat(c.moving || [], p.moving || [])){
    const key = f && String(f.key || f.id || ''); if (!key || seen.has(key)) continue;
    seen.add(key);
    const o = String(f.owner || (f.counter ? 'counters.' + f.counter : '')), m = /^(counters?|state)\.([^\n\r[\]【】]{1,64})$/.exec(o);   // a state key in any text
    moving.push({ key, start: f.start != null ? String(f.start) : f.card_says != null ? String(f.card_says) : '', note: f.note ? String(f.note) : '',
      owner: m ? { kind: m[1] === 'state' ? 'state' : 'counter', key: m[2] } : { kind: 'memory', key: '' } });
  }
  return { fixed, moving };
}
// a record id for any key (a Chinese one too): the key when it is a plain id, else a short hash of it
function factId(key){
  const k = String(key || '').trim();
  if (/^[A-Za-z0-9_-]{1,64}$/.test(k)) return k;
  let h = 2166136261; for (const ch of k) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return 'k' + (h >>> 0).toString(36);
}
let facts = { key: null, said: [], text: '' }, checkedAt = 0;
async function readFacts(){
  const key = lifeKey();
  let said = []; try { said = store.name ? await records.list(FACTS) : []; } catch { said = []; }
  facts = { key, said, text: '' };
  facts.text = stateText();
}
function stateText(){
  const { moving } = cardFacts(), said = facts.said.filter(f => !f.overtaken), lines = [];
  for (const f of moving){
    // a counter- or state-owned fact moves only by what its owner gives (from 'app'); chat and memory never override it
    const rec = said.filter(s => (s.key === f.key || s.id === factId(f.key)) && (f.owner.kind === 'memory' || s.from === 'app')).sort((a, b) => (a.said_at || a.at || 0) - (b.said_at || b.at || 0)).pop();
    // only what was said or remembered, in words: a state's value is hidden and never goes into his prompt, and the lore
    // counters are the card's own (a counter's words may be put here with noteSaid(key, words, 'app'))
    const v = rec ? String(rec.value) : '';
    if (v !== '' && v !== f.start) lines.push(`- ${f.key}${f.note ? '（' + f.note + '）' : ''}: ${v}`);
  }
  for (const s of said.filter(s => s.slip && s.slip.keep).slice(-3)) lines.push(`- keep to: ${s.slip.keep} (not "${clip(s.value, 40)}")`);
  if (!lines.length) return '';   // nothing moved: the context's own current block shows the card's facts as they started
  // the same words as the context's own current block (context.js), which renders this text
  const user = core.userName(), fixed = cardFacts().fixed;
  return `Where things stand now between ${store.name || 'him'} and ${user} (newer than the card above: where the card says otherwise, this wins):\n` + lines.join('\n') +
    (fixed.length ? '\n\nThese stay true whatever was said later:\n' + fixed.map(x => '- ' + x).join('\n') : '');
}
function current(){ return facts.key === lifeKey() ? facts.text : ''; }
const placed = () => core.contextBlocks().some(b => b.id === 'current');
// the moving keys a counter or a state owns (memory may not move them), and the ones memory owns
const ownedKeys = () => new Set(cardFacts().moving.filter(f => f.owner.kind !== 'memory').map(f => f.key));
const memoryKeys = () => cardFacts().moving.filter(f => f.owner.kind === 'memory').map(f => f.key);
// a fact he said: one record per key, the newest value wins (first writer wins on a clash)
async function noteSaid(key, value, from = 'chat', source = ''){
  key = String(key || '').trim(); value = String(value || '').trim(); if (!key || !value || !store.name) return null;
  if (from !== 'app' && ownedKeys().has(key)) return null;   // its counter or state owns it: only the owner moves it
  const id = factId(key), old = await records.get(FACTS, id);
  if (old && old.value === value && !old.overtaken) return old;
  const t = now().getTime(), rec = { id, key, value, said_at: t, from, at: t };
  if (source) rec.source = source;
  const r = await records.commit(FACTS, rec, { writer: 'core', app: FACTS });
  return r.ok ? r.record : null;
}

// --- Side calls: the side model if she set one; never while 暂停 is on ------------------------------------
let pageSettings = null;   // useSettings(fn): the page's own settings object (she may not have asked to remember them)
function settingsNow(){ try { return pageSettings ? pageSettings() || {} : core.loadSettings ? core.loadSettings() : {}; } catch { return {}; } }
// 暂停 (the switch in 设置 → 他找你): read every way it may be kept; while on, no side call at all
function paused(s = settingsNow()){
  if (typeof core.paused === 'function'){ try { if (core.paused()) return true; } catch {} }   // the scheduler's own reading of it
  const r = s && s.reach;
  return !!(s && (s.pause === true || s.paused === true || (r && (r.pause === true || r.paused === true || (r.pause && r.pause.on === true)))));
}
function sideSettings(s){
  const sd = s && s.side;
  return sd && sd.model && sd.endpoint ? Object.assign({}, s, { endpoint: sd.endpoint, model: sd.model, key: sd.key || '' }) : s;
}
function json(text){
  const t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
function vars(extra){
  const pron = pronouns(), said = chatLanguage(store.msgs), user = core.userName();
  return Object.assign({ char: store.name, user, pronoun: pron.zh || 'TA', pronoun_en: pron.en || 'they/them',
    lang: said === 'en' || said === 'other' ? LANG_NAME[said] : (core.defaults && core.defaults.memoryLanguage) || 'the language the chat is mostly written in' }, extra);
}
let sideCalls = 0;   // side calls this engine made in this realm (for the cost meter and the tests)
async function side(name, v, max = 900){
  const s = settingsNow(); if (paused(s)) return null;
  const text = await prompt(name, vars(v)); if (!text) return null;
  sideCalls++;
  const messages = [{ role: 'system', content: text }];
  // the one counted door for calls that are not her chat (sideCall: side model, cost meter, refused while 暂停);
  // a core without it calls as before
  if (typeof core.sideCall === 'function'){
    try { return json(await core.sideCall(name, messages, { max })); } catch(e){ if (e && e.code === 'paused'){ sideCalls--; return null; } throw e; }
  }
  return json(await callModel(sideSettings(s), messages, { max_tokens: max }));
}

// --- Writing items (add(list): a host or a test adds items with their inputs; each is a memory file) --------------------------------------------------------------------------------------
// what the automatic paths (reinforce, close, merge, fade, tidy) may touch: Modu's own files only (written in his voice, or
// with Modu's format line); never hers, pinned, hand-written, imported, or another tool's file
const ours = m => !!m && !(m.voice === 'hers' || m.pinned || /by hand/.test(m.source || '') || m.voice === 'imported') &&
  (m.voice === 'his' || /^modu-xiaoshouji-memory\//.test(m.format || ''));
let seq = 0;
function newItem(o){
  const it = { kind: o.kind || 'moment', date: o.date || todayIso(), to: o.to || '', source: o.source || '', confidence: o.confidence || 'medium', voice: 'his', text: String(o.text || '').trim() };
  for (const k of ['importance', 'valence', 'arousal', 'reinforced']) if (o[k] != null && o[k] !== '' && isFinite(Number(o[k]))) it[k] = Number(o[k]);
  if (o.last_seen) it.last_seen = String(o.last_seen);
  if (Array.isArray(o.threads) && o.threads.filter(Boolean).length) it.threads = o.threads.map(String).filter(Boolean);
  it.file = `${it.date}-${it.kind}-${slug(it.text)}-${(now().getTime() + seq++).toString(36).slice(-5)}.md`;
  return it;
}
async function addItems(list){
  const out = [];
  for (const o of list){ if (!o || !String(o.text || '').trim()) continue; const it = newItem(o); await saveMemoryItem(it); store.memory.push(it); out.push(it); }
  if (out.length){ store.memory.sort((a, b) => (a.date + a.file).localeCompare(b.date + b.file)); emit('memory', store.memory); if (!tidyAt) await bookTidy(); }
  return out;
}
async function dropItem(it){
  if (store.writable){ try { const md = await store.dir.getDirectoryHandle('memory'); await md.removeEntry(it.file); } catch(e){ if (e.name !== 'NotFoundError') throw e; } }
  store.memory = store.memory.filter(m => m !== it);
}
const byFile = f => store.memory.find(m => m.file === f);

// --- Events in (tell) --------------------------------------------------------------------------------
// chat: a fading memory that is mentioned (two telling pieces) is brought back: last_seen today, reinforced + 1, once
// a day. A memory that does not fade (every format 0.3 file) is never rewritten by talking.
async function reinforce(msgs){
  const fading = store.memory.filter(m => !lasting(m) && ours(m)); if (!fading.length) return 0;
  const keys = telling(store.memory), said = msgs.map(x => new Set(pieces(x.text))), d = todayIso();
  let n = 0;
  for (const m of fading){
    const key = keys[store.memory.indexOf(m)]; if (!key || key.length < 2 || m.last_seen === d) continue;
    if (!said.some(s => key.filter(x => s.has(x)).length >= 2)) continue;
    m.last_seen = d; m.reinforced = (Number(m.reinforced) || 0) + 1; await saveMemoryItem(m); n++;
  }
  if (n) emit('memory', store.memory);
  return n;
}
// day: the days that left his window wait in a record and go out together in ONE age-out call, at most 4 items for
// all of them (a long absence costs what a few days do).
const QTYPE = 'memory-queue', QID = 'days';
async function queued(){ try { const q = await records.get(QTYPE, QID); return q && Array.isArray(q.days) ? q : { id: QID, days: [] }; } catch { return { id: QID, days: [] }; } }
// the queue record keeps its back-off: fails (in a row) and retry_at (ms). A failed or unreadable answer waits an hour,
// then 2, 4 … up to a day: never a call on every turn
const HOUR = 3600000;
let qlock = Promise.resolve();   // every change to the queue, one after another (a day told while a call runs is never lost)
function withQueue(fn){ const r = qlock.then(fn, fn); qlock = r.catch(() => {}); return r; }
async function putQueue(days, extra){
  if (!days.length && !(extra && extra.fails)){ try { await records.remove(QTYPE, QID); } catch {} return; }
  await records.commit(QTYPE, Object.assign({ id: QID, days, at: now().getTime() }, extra || {}), { writer: 'core', app: 'memory' });
}
let lastDayTell = 0;
function queueDays(list){ return withQueue(() => queueDaysNow(list)); }
async function queueDaysNow(list){
  const q = await queued(), have = new Set(q.days.map(d => d.day));
  for (const d of list) if (d && /^\d{4}-\d{2}-\d{2}$/.test(String(d.day || '')) && !have.has(d.day)){ have.add(d.day); q.days.push({ day: d.day, record: d.record ? clone(d.record) : null }); }
  q.days.sort((a, b) => a.day.localeCompare(b.day));
  lastDayTell = Date.now();
  await putQueue(q.days, { fails: q.fails || 0, retry_at: q.retry_at || 0 });
  return q.days.length;
}
async function tell(e){
  if (!e || !store.name) return;
  if (e.kind === 'chat'){
    // after a turn of theirs, the chat of a day that is over becomes memory (one call a day at most; not awaited)
    if (core.dayMemory) core.dayMemory().catch(err => console.error(err));
    return reinforce([].concat(e.msgs || []));
  }
  if (e.kind === 'day') return queueDays(Array.isArray(e.days) ? e.days : [{ day: e.day, record: e.record }]);
  if (e.kind === 'app' && e.line){
    const d = isoDay(new Date(e.at || now().getTime())), line = String(e.line).trim();
    if (store.memory.some(m => m.date === d && m.text === line)) return;
    return addItems([{ kind: 'moment', date: d, text: line, importance: e.importance || 2, source: `app: ${e.app || ''}`.trim() }]);
  }
  if (e.kind === 'absence' && Number(e.days) > 0){
    const to = dayOf(e.to) || todayIso(), from = dayOf(e.from);
    // the count is calendar days from her last day to her return (core.calendarDays, as the chat's gap line counts)
    const days = from ? Math.max(1, core.calendarDays ? core.calendarDays(dayMs(from), dayMs(to)) : Math.round((dayMs(to) - dayMs(from)) / DAY)) : Number(e.days);
    if (store.memory.some(m => m.kind === 'absence' && m.to === to)) return;
    const told = from ? toldAway(from) : '';   // she said she would be away (a trip): not "didn't come to find me"
    return addItems([{ kind: 'absence', date: from || to, to, text: absenceText(from, to, days, told),
      importance: days >= 7 ? 4 : 3, valence: told ? 0 : -0.3, arousal: told ? 0.2 : 0.4, source: 'absence, written by Modu' }]);
  }
}
// an absence item is his own note, in his voice (never a line from the system to her, never ISO dates)
const dayOf = v => v == null || v === '' ? '' : typeof v === 'number' || v instanceof Date ? isoDay(new Date(+v)) : String(v).slice(0, 10);
const ZH = '零一二三四五六七八九';
const zhNum = n => n < 10 ? ZH[n] : n < 20 ? '十' + (n % 10 ? ZH[n % 10] : '') : n < 100 ? ZH[Math.floor(n / 10)] + '十' + (n % 10 ? ZH[n % 10] : '') : String(n);
// whether she told him she was going away, in her own lines of her last day (or the day before):
// → the line she said it in, or ''. Words only; a trip she named is an absence she explained.
// (a ride or 不在家 alone is not a trip: 「我在高铁上看到…」 on a commute; it counts with a going-away word: 要 / 明天 / 出发 …)
const AWAY = /出差|旅行|旅游|出远门|出门几天|出去玩|去玩几天|回老家|回趟家|探亲|考试周|集训|住院|\b(?:trip|travel(?:l?ing)?|vacation|holiday|away for|out of town)\b/i;
const RIDE = /飞机|高铁|动车|火车|不在家|\bflying\b/i, GOING = /要去|明天|后天|这几天|出发|要走|走了|几天|\b(?:tomorrow|leaving|going)\b/i;
function toldAway(from){
  const a = dayMs(from) - DAY, b = dayMs(from) + DAY;
  const hers = store.msgs.filter(m => { if (!m.is_user) return false; const d = core.msgDate(m); return d && +d >= a && +d < b; });
  const hit = hers.reverse().find(m => { const t = String(m.mes || ''); return AWAY.test(t) || (RIDE.test(t) && GOING.test(t)); });
  return hit ? String(hit.mes) : '';
}
// was `day` ('YYYY-MM-DD') inside a time away she had told him about? She did not write that day, and her last
// day before it (or the day before that) says she was going away (toldAway). → her line, or ''. An explained absence is
// never "she did not come to me": the age-out is told so, and an item it writes for such a day is kept to that.
function awayTold(day){
  const d = dayOf(day); if (!d) return '';
  const hers = [...new Set(store.msgs.filter(m => m.is_user).map(m => core.msgDate(m)).filter(Boolean).map(x => isoDay(x)))].sort();
  if (hers.includes(d)) return '';
  const last = hers.filter(x => x < d).pop(); if (!last) return '';
  const line = toldAway(last); if (!line) return '';
  // a trip explains the days it said it would last (三四天 → 4), plus a day; none said: a week; never more than 14 days
  const said = tripDays(line), upto = Math.min(14, said ? said + 1 : 7);
  return core.calendarDays(dayMs(last), dayMs(d)) <= upto ? line : '';
}
const ZH_N = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function tripDays(t){
  const m = /([0-9一两二三四五六七八九十]{1,3})\s*(天|日|周|个?星期|days?|weeks?)/i.exec(String(t || '')); if (!m) return 0;
  const digits = [...m[1]].map(c => /\d/.test(c) ? Number(c) : ZH_N[c] || 0);
  let n = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1].includes('十') ? (m[1].startsWith('十') ? 10 : (ZH_N[m[1][0]] || 1) * 10) + (m[1].endsWith('十') ? 0 : ZH_N[m[1].slice(-1)] || 0) : Math.max(...digits);
  return /周|星期|week/i.test(m[2]) ? n * 7 : n;
}
// the words that make an explained day "she did not come to me" (and his half of it, "nor did I go to her"): cut out
const NOT_CAME = /[，,；;]?\s*[^，,。；;！!]*?(?:没(?:有)?来?(?:找|理|联系|搭理)我|不来?(?:找|理)我|我也没去?找(?:你|她))[^，,。；;！!]*/g;
function keepTold(text){
  const t = String(text || '').replace(NOT_CAME, '').replace(/^[，,；;\s]+/, '').replace(/[，,；;]\s*([。！!]?)$/, '$1').trim();
  return t && !/[。！!.]$/.test(t) && /[。！!.]$/.test(String(text).trim()) ? t + String(text).trim().slice(-1) : t;
}
function absenceText(from, to, days, told){
  const md = d => { const t = new Date(dayMs(d)); return { zh: `${t.getMonth() + 1}月${t.getDate()}日`, en: t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) }; };
  if (chatLanguage(store.msgs) === 'en'){
    const n = `${days} day${days > 1 ? 's' : ''}`;
    if (told && from) return `You told me you were going away; you were gone ${n} after ${md(from).en} and came back on ${md(to).en}.`;
    return from ? `After ${md(from).en} you didn't come to me for ${n}; you came back on ${md(to).en}.` : `You didn't come to me for ${n}.`;
  }
  if (told && from) return `${md(from).zh}你说要出门，走了${zhNum(days)}天，${md(to).zh}回来了。`;
  return from ? `${md(from).zh}之后你${zhNum(days)}天没来找我，${md(to).zh}才回来。` : `你${zhNum(days)}天没来找我。`;
}
// an older absence item ("你有6天没来（2026-10-24 到 2026-10-30）") is written again in his voice, on open
async function reword(){
  if (!store.writable) return 0;
  let n = await redate();
  // an older item of his (written before items were dated) that still says 明天 / 今天 …: written again, the word read as a date.
  // Once per companion: after a pass that rewrote something, the record memory-queue/dated { v: 1 } says it is done (new items
  // are dated when written). A companion with nothing to rewrite gets no record (opening him writes nothing); the look is cheap
  let dated = null; try { dated = await records.get(QTYPE, 'dated'); } catch {}
  if (!(dated && Number(dated.v) >= 1) && core.datedWords){
    let k = 0;
    for (const m of store.memory) if (ours(m) && m.voice === 'his' && /前天|昨天|昨晚|今天|今早|今晚|明天|明早|明晚|后天/.test(m.text || '') && core.datedWords(m.text, m.date) !== m.text){
      try { await saveMemoryItem(m); k++; } catch(e){ console.error(e); }
    }
    if (k) try { await records.commit(QTYPE, { id: 'dated', v: 1, at: now().getTime() }, { writer: 'core', app: 'memory' }); } catch(e){ console.error(e); }
    n += k;
  }
  for (const m of store.memory) if (m.kind === 'absence' && /written by Modu/.test(m.source || '') && /^(你有\d+天没来|You were away for \d+ days)/.test(m.text || '')){
    const from = m.date && m.date !== m.to ? m.date : '', to = m.to || m.date;
    const days = from ? core.calendarDays(dayMs(from), dayMs(to)) : Number((/\d+/.exec(m.text) || [0])[0]);
    if (!(days > 0)) continue;
    m.text = absenceText(from, to, days); try { await saveMemoryItem(m); n++; } catch(e){ console.error(e); }
  }
  if (n) emit('memory', store.memory);
  return n;
}
// The age-out: every waiting day in one call, with the tidy (merge, fade) inside it, then the facts pass.
// → { items, merged, faded, days } or null (nothing waiting, 暂停, or the call failed: the days wait; never a retry loop)
let aging = null;
function flush(){ if (!aging) aging = ageOut().finally(() => { aging = null; }); return aging; }
async function ageOut(){
  const q = await queued(); if (!q.days.length || paused() || (q.retry_at && now().getTime() < q.retry_at)) return null;
  const who = core.currentId, t = now().getTime(), items = store.memory.filter(m => !faded(m, t) || openThread(m)).slice(-60);
  const v = { date: q.days.length === 1 ? q.days[0].day : `${q.days[0].day} – ${q.days[q.days.length - 1].day} (${q.days.length} days, together)`,
    day_record: q.days.map(d => dayText(d.day, d.record)).join('\n\n'),
    // the days of a time away she had told him about (a trip): never "she did not come to me"
    away_note: (() => { const told = q.days.map(d => d.day).filter(d => awayTold(d)); return told.length ? `On ${told.join(', ')} she was away on a trip she had told ${store.name} about before she left. Those days she was away for a reason: never write that she did not come to ${store.name}, did not look for ${store.name} or left ${store.name} alone, and give them no bad feeling of their own.` : ''; })(),
    memory_items: items.map(m => `${m.file}: ${m.text}${openThread(m) ? '（open: ' + m.threads.join('; ') + '）' : ''}`).join('\n') || '(none)' };
  let out = null, tried = false; try { tried = !paused(); out = await side('ageout', v); } catch(err){ console.error(err); out = null; }
  if (core.currentId !== who) return null;
  const sent = new Set(q.days.map(d => d.day));
  if (!out){
    if (tried && !paused()){   // failed or not JSON: back off, keep every day (and any told meanwhile)
      await withQueue(async () => { const q2 = await queued(), fails = (Number(q2.fails) || 0) + 1;
        await putQueue(q2.days, { fails, retry_at: now().getTime() + Math.min(24, Math.pow(2, fails - 1)) * HOUR }); });
    }
    return null;
  }
  const day = q.days[q.days.length - 1].day, src = `day/${q.days.map(d => d.day).join(', ')} (aged out, derived by the model)`;
  const got = [].concat(out.items || []).filter(o => o && o.text).slice(0, 4);
  // each item is dated by the day it is from (its "day", or a date it starts with), not all by the last day of the batch
  const made = await addItems(got.map(o => { const w = itemDay(o, q.days.map(d => d.day));
    // an item for a day of a time away she had explained keeps no "没来找我", and no bad feeling for it
    const told = awayTold(w.day), text = told ? keepTold(w.text) : w.text, val = told && Number(o.valence) < 0 ? 0 : o.valence;
    return { kind: 'moment', date: w.day, text: core.tidyCJK ? core.tidyCJK(text) : text,
      importance: o.importance, valence: val, arousal: o.arousal, threads: o.threads, source: src }; }));
  for (const o of got) for (const f of [].concat(o.closes || [])){ const m = byFile(f); if (m && ours(m) && !m.closed){ m.closed = day; await saveMemoryItem(m); } }
  let merged = 0, fadedN = 0;
  for (const g of [].concat(out.merge || [])){
    const keep = g && byFile(g.keep); if (!keep || !ours(keep)) continue;
    for (const f of [].concat(g.drop || [])){
      const m = byFile(f); if (!m || m === keep || !ours(m)) continue;
      const imp = Math.max(importance(keep) || 0, importance(m) || 0); if (imp) keep.importance = imp;
      if (m.reinforced) keep.reinforced = (Number(keep.reinforced) || 0) + Number(m.reinforced);
      await dropItem(m); merged++;
    }
    if (g.text && String(g.text).trim()) keep.text = String(g.text).trim();
    await saveMemoryItem(keep);
  }
  for (const f of [].concat(out.fade || [])){ const m = byFile(f); if (m && ours(m) && !m.faded){ m.faded = day; await saveMemoryItem(m); fadedN++; } }
  merged += await tidyLocal();
  await withQueue(async () => { const q2 = await queued(); await putQueue(q2.days.filter(d => !sent.has(d.day)), { fails: 0, retry_at: 0 }); });   // only the days this call took
  emit('memory', store.memory);
  await consistency();
  return { items: made, merged, faded: fadedN, days: q.days.map(d => d.day) };
}
// which of the aged-out days an item is from → { day, text }: its "day" when that is one of them, else a date its text
// starts with ("10-30 早上…", "2026-10-30 …", "10月30日…": that prefix is dropped, the date shows under it), else the last day
const LEAD_DAY = /^\s*(?:(\d{4})[-/.年])?(\d{1,2})(?:[-/.月])(\d{1,2})日?\s*[,，:：]?\s*/;
function itemDay(o, days){
  const text = String(o.text || '').trim(), last = days[days.length - 1];
  const want = String(o.day || o.date || '').slice(0, 10);
  if (days.includes(want)) return { day: want, text };
  const m = LEAD_DAY.exec(text);
  if (m){ const md = `${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`, hit = days.find(d => d.slice(5) === md && (!m[1] || d.startsWith(m[1])));
    if (hit && text.slice(m[0].length).trim()) return { day: hit, text: text.slice(m[0].length).trim() }; }
  return { day: last, text };
}
// an older aged-out item, dated by the last day of its batch though its text names another of those
// days, is dated again (on open); its words stay as they are
async function redate(){
  let n = 0;
  for (const m of store.memory){
    const src = /^day\/([\d, -]+) \(aged out/.exec(m.source || ''); if (!src) continue;
    const days = src[1].split(/,\s*/).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)); if (days.length < 2) continue;
    const w = itemDay({ text: m.text }, days); if (w.day === m.date || w.text === String(m.text || '').trim()) continue;
    m.date = w.day; try { await saveMemoryItem(m); n++; } catch(e){ console.error(e); }
  }
  if (n) store.memory.sort((a, b) => (a.date + a.file).localeCompare(b.date + b.file));
  return n;
}
function dayText(day, rec){
  rec = core.day && core.day.shape ? core.day.shape(rec || {}) : rec || {};
  const hm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const lines = [`${day}:`];
  for (const s of rec.slots || []) lines.push(`- ${hm(s.at)}${s.until ? '–' + hm(s.until) : ''} ${[s.where, s.doing].filter(Boolean).join('，')}${s.why ? '（' + s.why + '）' : ''}`);
  for (const h of rec.her || []) lines.push(`- ${h.at ? hm(h.at) + ' ' : ''}${h.line}`);
  if (rec.entry) lines.push(`evening: ${rec.entry}`);
  if (lines.length === 1) lines.push('- (only the outline of an ordinary day)');
  return lines.join('\n');
}
// Tidy with no call: the same thing written twice (nearly every pair shared) becomes one, the older kept. Never hers.
async function tidyLocal(){
  const list = store.memory.filter(m => ours(m) && m.kind !== 'summary'), sets = list.map(m => new Set(pieces(m.text).filter(x => !single(x))));
  let n = 0; const gone = new Set();
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++){
    if (gone.has(i) || gone.has(j) || !sets[i].size || !sets[j].size) continue;
    let both = 0; for (const x of sets[i]) if (sets[j].has(x)) both++;
    if (both / (sets[i].size + sets[j].size - both) < 0.85) continue;
    const keep = list[i], m = list[j];
    const imp = Math.max(importance(keep) || 0, importance(m) || 0); if (imp) keep.importance = imp;
    if (m.reinforced) keep.reinforced = (Number(keep.reinforced) || 0) + Number(m.reinforced);
    await saveMemoryItem(keep); await dropItem(m); gone.add(j); n++;
  }
  if (n) emit('memory', store.memory);
  return n;
}
// The tidy while he sleeps: a job (owner 'memory', kind 'memory-tidy') at his bedtime. The scheduler runs it through
// the handler below (jobs.handle), which moves the same job on to the next night; a core with no scheduler has it
// run before the next turn after it is due (or by memorySource.own.run(job)).
const TIDY_KIND = 'memory-tidy', TIDY_OWNER = 'memory';
let tidyAt = 0;
function bedtime(t){
  const d = new Date(t), weekend = d.getDay() === 0 || d.getDay() === 6;
  const hm = String(core.param ? core.param(`clock.${weekend ? 'weekend' : 'weekday'}.sleep`, '23:50') : '23:50').split(':').map(Number);
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hm[0] || 0, hm[1] || 0).getTime() + ((hm[0] || 0) < 6 ? DAY : 0) + 30 * 60000;
  return at > t ? at : at + DAY;
}
let booking = Promise.resolve();
function bookTidy(){ booking = booking.then(bookOnce, bookOnce); return booking; }   // one at a time: never two pending tidies
async function bookOnce(){
  if (!core.jobs || !store.name || memorySource.outside) return;   // her own memory: Modu's engine books nothing
  if (!store.memory.some(m => !lasting(m) && ours(m))) return;   // nothing that could be written twice yet: no job in his folder
  try {
    const open = (await core.jobs.list({ owner: TIDY_OWNER, kind: TIDY_KIND, state: 'pending' }))[0];
    tidyAt = open ? open.at : (await core.jobs.add({ id: TIDY_KIND + '-' + (await core.jobs.list({ owner: TIDY_OWNER, kind: TIDY_KIND })).length, kind: TIDY_KIND, owner: TIDY_OWNER, at: bedtime(now().getTime()), payload: { what: 'merge his memory items written twice' } })).at;
  } catch(e){ console.error(e); }
}
// the scheduler's handler for owner 'memory': tidy (never while 暂停), then the same job waits for the next night
async function onJob(job, ctx){
  if (!job || job.kind !== TIDY_KIND || memorySource.outside) return 'drop';   // her own memory: Modu's engine tidies nothing
  const t = ctx && ctx.t != null ? ctx.t : now().getTime();
  if (!paused()) await tidyLocal();
  tidyAt = bedtime(t + 60000);
  return { at: tidyAt };
}
const scheduled = !!(core.jobs && typeof core.jobs.handle === 'function');
if (scheduled) core.jobs.handle(TIDY_OWNER, onJob);
async function run(job){
  if (!job || job.kind !== TIDY_KIND) return false;
  if (!paused()) await tidyLocal();   // makes no call, but 暂停 means no tidy either
  try { await core.jobs.done(job.id, 'core'); } catch {}
  await bookTidy();
  return true;
}

// --- The facts pass (consistency, at summary time: after an age-out or 整理) ----------------------------------
async function consistency(){
  await readFacts();
  const { fixed, moving } = cardFacts(), said = facts.said.filter(f => !f.overtaken);
  if (!said.length || paused()) return null;
  const last = Math.max(...said.map(f => f.said_at || f.at || 0));
  if (!checkedAt){ try { const r = await records.get(QTYPE, 'pass'); checkedAt = (r && Number(r.checked_at)) || 0; } catch {} }
  if (last <= checkedAt) return null;   // nothing said since the last pass (kept in memory-queue/pass.json, across opens)
  let out = null;
  try {
    out = await side('consistency', {
      card_facts: fixed.map(f => '- ' + f).join('\n') || '(none)',
      moving_facts: moving.filter(f => f.owner.kind === 'memory').map(f => `- ${f.key}: ${f.start}${f.note ? '（' + f.note + '）' : ''}`).join('\n') || '(none)',
      said_facts: said.map(f => `- ${f.key}: ${f.value}`).join('\n'),
      memory_items: store.memory.filter(m => !faded(m)).slice(-40).map(m => '- ' + m.text).join('\n') || '(none)' }, 700);
  } catch(e){ console.error(e); out = null; }
  if (!out) return null;
  checkedAt = last;
  for (const c of [].concat(out.current || [])) if (c && c.fact && c.value != null && String(c.value).trim()) await noteSaid(c.fact, c.value, c.from === 'said' ? 'chat' : 'memory', 'consistency pass');
  const mark = async (f, extra) => records.commit(FACTS, Object.assign({}, f, { rev: undefined }, extra), { writer: 'core', app: FACTS });
  for (const s of [].concat(out.slips || [])){ const f = s && s.said && (said.find(x => x.value === s.said) || said.find(x => x.value.includes(s.said))); if (f) await mark(f, { slip: { breaks: String(s.breaks || ''), keep: String(s.keep || '') } }); }
  for (const d of [].concat(out.drop_said || [])){ const f = d && said.find(x => x.value === d); if (f) await mark(f, { overtaken: now().getTime() }); }
  await readFacts();
  checkedAt = Math.max(checkedAt, ...facts.said.map(f => f.said_at || 0));
  try { await records.commit(QTYPE, { id: 'pass', checked_at: checkedAt, at: now().getTime() }, { writer: 'core', app: 'memory' }); } catch(e){ console.error(e); }
  return out;
}

// --- Meaning search (off by default): her own embedding key; the vectors are a deletable derived cache --------
// settings.meaning = { on, endpoint, model, key }, in this browser with her other settings, never in his folder. The
// vectors are a record beside the items, memory-vectors/<model>.json; forgetVectors() deletes it; it is rebuilt.
const meaning = { qvec: null, vecs: null, model: '' };
const VEC = 'memory-vectors';
function meaningSettings(){ const s = settingsNow(), m = s && s.meaning; return m && m.on && m.endpoint && m.model ? m : null; }
// Each embedding call is noted in 用量 (calls.note('meaning'): its own row, cost.row.meaning) and
// there are at most memory.meaning_per_day of them a day (default 60, about 30 turns; counted from 用量's tally, so a
// reload does not reset it). Over the cap the turn goes on with the plain search.
let meaningToday = { day: '', n: 0 };
function meaningUsed(){
  const day = core.isoDay(now());
  if (core.calls && typeof core.calls.days === 'function'){ const d = core.calls.days(31).find(x => x.day === day); return d ? Number((d.by || {}).meaning) || 0 : 0; }
  return meaningToday.day === day ? meaningToday.n : 0;
}
async function embed(m, input){
  if (meaningUsed() >= Math.max(0, Number(P('meaning_per_day', 60)) || 0)) throw Object.assign(new Error('meaning cap'), { code: 'cap' });
  const day = core.isoDay(now()); meaningToday = { day, n: (meaningToday.day === day ? meaningToday.n : 0) + 1 };
  const heard = core.calls ? core.calls.note('meaning', [{ role: 'user', content: input.join('\n') }], { settings: { endpoint: m.endpoint, model: m.model } }) : (x => x);
  const r = await hostFetch(String(m.endpoint).replace(/\/+$/, '') + '/embeddings', { method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, m.key ? { Authorization: 'Bearer ' + m.key } : {}), body: JSON.stringify({ model: m.model, input }) });
  if (!r.ok) throw new Error('embeddings ' + r.status);
  const j = await r.json(), out = (j.data || []).map(d => d.embedding);
  heard(out.length ? `${out.length} × ${(out[0] || []).length}` : '');   // the answer's size, in brief: how many vectors
  return out;
}
const unit = v => { const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1; return v.map(x => Math.round(x / n * 1e4) / 1e4); };
function meaningOf(m, q){ const v = meaning.vecs && meaning.vecs[m.file]; if (!v || v.length !== q.length) return 0; let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * q[i]; return s; }
async function prepareMeaning(){
  const m = meaningSettings(); meaning.qvec = null;
  if (!m || paused() || !store.name) return;
  const id = factId(m.model);
  try {
    if (!meaning.vecs || meaning.model !== m.model){ const r = await records.get(VEC, id); meaning.vecs = (r && r.vecs) || {}; meaning.model = m.model; }
    const missing = store.memory.filter(x => !meaning.vecs[x.file]).slice(0, 16);   // at most 16 new items a turn, in one call
    if (missing.length){
      const got = await embed(m, missing.map(x => x.text)); sideCalls++;
      missing.forEach((x, i) => { if (got[i]) meaning.vecs[x.file] = unit(got[i]); });
      await records.commit(VEC, { id, model: m.model, vecs: meaning.vecs, at: now().getTime() }, { writer: 'core', app: 'memory' });
    }
    const her = store.msgs.filter(x => x.is_user).slice(-4).map(x => x.mes).join('\n');
    if (her){ const [q] = await embed(m, [her]); sideCalls++; meaning.qvec = q ? unit(q) : null; }
  } catch(e){ if (!e || e.code !== 'cap') console.error(e); meaning.qvec = null; }
}
async function forgetVectors(){
  meaning.vecs = null; meaning.qvec = null;
  for (const r of await records.list(VEC).catch(() => [])) await records.remove(VEC, r.id);
}

// --- Before each turn (the memory source's readRecall, which refreshLife waits for) ------------------------------
async function prepare(){
  if (!store.name) return;
  if (facts.key !== lifeKey()) await readFacts();
  const q = await queued();
  if (q.days.length && Date.now() - lastDayTell > 1500) flush();   // days told one after another go out together
  // a chat that came with 搬家 and is still waiting for the memory job: her turn waits for it a little (memory.import_wait_ms),
  // so the first thing she asks ("他记得我吗") meets what he knows of her
  if (core.importMemory){
    let timer = null; const ms = Math.max(0, Number(P('import_wait_ms', 20000)) || 0);
    try { await Promise.race([core.importMemory(), new Promise(res => { timer = setTimeout(res, ms); })]); } catch(e){ console.error(e); } finally { clearTimeout(timer); }
  }
  if (tidyAt && now().getTime() >= tidyAt && core.jobs && !scheduled){
    tidyAt = 0;
    try { const due = (await core.jobs.due()).filter(j => j.owner === TIDY_OWNER && j.kind === TIDY_KIND); for (const j of due) await run(j); if (!due.length) await bookTidy(); } catch(e){ console.error(e); }
  }
  await prepareMeaning();
}
// Modu's own recall, for a host that asks the seam: the memory block's text for these messages
function recall(o = {}){
  const msgs = [].concat(o.recent || []).map(m => ({ is_user: m.who === 'her', mes: String(m.text || '') }));
  return memoryBlock({ name: store.name || '', allMsgs: msgs, budget: Number(o.budget) || 3500, note: {} });
}
// memory format 0.4 on open: older Modu files are written again as real YAML, nothing lost (memoryNeedsMigration)
async function migrate(){
  if (!store.writable || !core.memoryNeedsMigration) return 0;
  let n = 0; for (const m of store.memory.slice()) if (core.memoryNeedsMigration(m)){ try { await saveMemoryItem(m, { format: true }); n++; } catch(e){ console.error(e); } }
  return n;
}
core.listeners.add((ev, d) => {
  if (ev === 'loaded'){ migrate().then(reword, reword); facts = { key: null, said: [], text: '' }; meaning.vecs = null; checkedAt = 0; tidyAt = 0; bookTidy(); readFacts(); }
  if (ev === 'records' && d && (d.type === FACTS || d.type === 'state') && d.owner !== 'her') readFacts();
});

const own = { id: 'modu', recall, tell, prepare, flush, run, add: addItems, useSettings: fn => { pageSettings = typeof fn === 'function' ? fn : null; }, tidy: tidyLocal, consistency, noteSaid, current, cardFacts, factId,
  strength, faded, lasting, importance, rank, bm25, pieces, forgetVectors, paused, queued, TIDY_KIND, TIDY_OWNER, onJob,
  get sideCalls(){ return sideCalls; }, get facts(){ return clone(facts.said); } };
memorySource.own = own;
Object.assign(core, { memoryOwn: own, awayTold });
})(globalThis[Symbol.for('modu.core')]);
