// app/core/memory-job.js: the memory job (整理): read the chat in parts and ask the model for memories.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, msgDate, isoDay, tidyCJK, slug, saveMemoryItem, pronouns, LANG_NAME, chatLanguage,
  callModel } = core;

// Derive: ask the model for durable facts + one summary, as JSON lines, written by him to her.
// The chat file stays the source; memory is a view on it she can read and correct.
// The work is a job of the core, not of a screen: it goes on while she leaves 记忆, and asking again
// while it runs gives the same job (never a second one, never a restart). A long chat (a big import) is
// read in parts of about 12,000 characters, oldest first, at most MEMORY_PARTS (the newest ones), each
// part's memories saved as soon as they are found; memoryJob() and the event 'memoryjob' say how far
// along it is ({ running, done, total, found }; null / { running:false, … } when it is over).
// The answer has room for all its lines (about 16, in Chinese up to 1,500 tokens) beside a model that thinks first: its
// thinking comes out of the same max_tokens, so the old 900 left it nothing, or half a line, and on a part of 12,000 characters
// it can think past 6,000. Cut off, it is asked once more with MEMORY_ROOM. Room not used is not paid for.
const MEMORY_PART = 12000, MEMORY_PARTS = 24, MEMORY_MAX = 4000, MEMORY_ROOM = 12000;
let memJob = null;
function memoryJob(){ return memJob && memJob.who === core.currentId ? { running: true, done: memJob.done, total: memJob.total, found: memJob.found } : null; }
function deriveMemory(settings, opts={}){
  if (memJob && memJob.who === core.currentId) return memJob.promise;
  const job = memJob = { who: core.currentId, done: 0, total: 1, found: 0 };
  job.promise = deriveParts(settings, opts, job).finally(() => {
    if (memJob === job) memJob = null;
    emit('memoryjob', { running: false, done: job.done, total: job.total, found: job.found });
  });
  return job.promise;
}
// her lines carry her name (or "User": never "You", which the model reads as itself), his carry his
const herLabel = () => { const u = core.userName(); return u && u !== 'You' ? u : 'User'; };   // her own name, from 聊天设置 too
const chatLines = msgs => { const her = herLabel(); return msgs.map(m => `[${isoDay(msgDate(m))}] ${m.is_user ? her : store.name}: ${m.mes}`); };
async function deriveParts(settings, opts, job){
  const msgs = store.msgs.filter(m => !core.chatCardKind(m)), lines = chatLines(msgs);
  // parts of the chat, oldest first; one part for a chat of up to MEMORY_PART characters
  const parts = []; let cur = '';
  for (const l of lines){
    const t = l.length > MEMORY_PART ? l.slice(0, MEMORY_PART) : l;
    if (cur && cur.length + t.length + 1 > MEMORY_PART){ parts.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + t;
  }
  if (cur || !parts.length) parts.push(cur);
  const use = parts.slice(-MEMORY_PARTS);
  job.total = use.length; emit('memoryjob', memoryJob());
  const all = [];
  for (let i = 0; i < use.length; i++){
    if (core.currentId !== job.who) break;   // she opened someone else: his memories are never written into another's folder
    const items = await deriveOne(settings, opts, use[i], msgs, i === use.length - 1, use.length > 1);
    if (core.currentId !== job.who) break;
    await keepItems(items);
    if (!items.read && !items.none) all.unread = true;   // the page says so, never 没有新条目 (a paid answer that could not be read)
    all.push(...items); job.done = i + 1; job.found = all.length;
    if (items.length) emit('memory', store.memory);
    emit('memoryjob', memoryJob());
  }
  if (!all.length) emit('memory', store.memory);   // the list is drawn again when it is over
  if (core.currentId === job.who && job.done === use.length) await readThrough(msgs);   // the day's run starts after what 整理 read
  if (core.memoryOwn && core.currentId === job.who){ try { await core.memoryOwn.consistency(); } catch(e){ console.error(e); } }   // the facts pass, at summary time
  return all;
}
async function keepItems(items){
  for (const it of items){ it.file = `${it.date}-${it.kind}-${slug(it.text)}.md`; await saveMemoryItem(it); store.memory.push(it); }
  if (core.memoryOwn) for (const f of items.said || []) await core.memoryOwn.noteSaid(f.key, f.text, 'chat', 'chat.jsonl');
}

// A chat that came with 搬家 is queued for the memory job (the record memory-queue/import), so what he knows of
// her is there without her finding 整理记忆. ONE call, through sideCall (counted in 用量, refused while 暂停), over the
// newest IMPORT_CHARS of the chat (an older part she can still 整理 by hand). A failed or unreadable answer backs off
// (1 h, 2 h, 4 h … up to a day) and the record waits; after IMPORT_TRIES of them (an unreadable answer was still
// paid for) the record is gone and the chat counts as read, like the daily job's DAY_TRIES: nothing is bought again until
// new chat comes (整理 still reads it by hand). 暂停 leaves it waiting with no back-off and no try counted. It is tried when it is
// queued and again before her turns (memorySource.own.prepare, which an open's refresh runs too), never twice at once. Her own (outside) memory:
// nothing is queued, Modu writes nothing.
const IQ = 'memory-queue', IQID = 'import', IMPORT_CHARS = 24000, IMPORT_TRIES = 3, HOUR = 3600000;
const outside = () => !!(core.memorySource && core.memorySource.outside);
async function importQueued(){ try { const r = await core.records.get(IQ, IQID); return r && r.msgs ? r : null; } catch { return null; } }
// queueImportMemory(n): the import just saved brought n messages (some of them hers) → queued, and tried now
async function queueImportMemory(n){
  if (!store.name || !(Number(n) > 0) || outside()) return false;
  await core.records.commit(IQ, { id: IQID, v: 1, msgs: Number(n), fails: 0, retry_at: 0, at: core.now().getTime() }, { writer: 'core', app: 'memory' });
  importMemory().catch(e => console.error(e));
  return true;
}
let importing = null;
function importMemory(){ if (!importing) importing = importOnce().finally(() => { importing = null; }); return importing; }
async function importOnce(){
  const q = await importQueued(); if (!q) return null;
  if (outside()){ try { await core.records.remove(IQ, IQID); } catch {} return null; }
  if ((core.paused && core.paused()) || (q.retry_at && core.now().getTime() < q.retry_at)) return null;
  const who = core.currentId;
  if (memJob && memJob.who === who){ await memJob.promise.catch(() => {}); if (core.currentId === who) await core.records.remove(IQ, IQID).catch(() => {}); return null; }   // 整理 read it all
  const job = memJob = { who, done: 0, total: 1, found: 0 };
  let items = null, paused = false;
  job.promise = (async () => {
    emit('memoryjob', memoryJob());
    const msgs = store.msgs.filter(m => !core.chatCardKind(m)), lines = chatLines(msgs);
    let hist = '', cut = false;
    for (let i = lines.length - 1; i >= 0; i--){ const l = lines[i].slice(0, IMPORT_CHARS); if (hist && hist.length + l.length + 1 > IMPORT_CHARS){ cut = true; break; } hist = l + (hist ? '\n' + hist : ''); }
    try { items = await deriveOne(null, { side: true, partNote: cut ? ' This is the newest part of a long chat that was just brought in; its older part is not shown.' : '' }, hist, msgs, true, false); }
    catch(e){ if (e && e.code === 'paused') paused = true; else console.error(e); items = null; }
    if (core.currentId !== who) return [];
    if (items && items.read){
      await keepItems(items); job.done = 1; job.found = items.length;
      await core.records.remove(IQ, IQID).catch(() => {});
      await readThrough(msgs);
      emit('memory', store.memory);
      if (core.memoryOwn){ try { await core.memoryOwn.consistency(); } catch(e){ console.error(e); } }
      return items;
    }
    if (!paused){ const fails = (Number(q.fails) || 0) + 1;   // failed or not JSON: wait, then try again; the last try leaves it
      if (fails >= IMPORT_TRIES){ await core.records.remove(IQ, IQID).catch(() => {}); await readThrough(msgs); }
      else await core.records.commit(IQ, Object.assign({}, q, { rev: undefined, fails, retry_at: core.now().getTime() + Math.min(24, Math.pow(2, fails - 1)) * HOUR }), { writer: 'core', app: 'memory' }).catch(() => {}); }
    return null;
  })().finally(() => {
    if (memJob === job) memJob = null;
    emit('memoryjob', { running: false, done: job.done, total: job.total, found: job.found });
  });
  return job.promise;
}

// The chat of a day that is over becomes memory by itself, so 记忆 is not empty after a whole day of talking (otherwise
// only 整理, her tap, or the age-out, a day leaving his 3-day window, would write memory). The
// first turn of theirs on a later day (Modu's engine asks after each turn: never on the clock alone, never while he sleeps),
// the chat since the last run up to today's midnight is read in ONE call through sideCall('memory'), on the side model
// (counted in 用量, refused while 暂停: it waits
// with no back-off), the newest MEMORY_PART characters of it, facts only (no daily summary). The record memory-queue/chat
// { through (ms), fails, retry_at } says how far it has read; 整理 and the import's job move it on too, so nothing is read
// twice. At most one run a day (today's chat waits for tomorrow), none for days she said nothing, none while 整理 or the
// import's job runs. An answer that says there is nothing to keep (nothing, or {"kind":"none"}) is a good answer: the day is
// done. A failed or unreadable answer backs off as the import does, and after DAY_TRIES of them the span is left (nothing
// is bought again until new chat comes). First seen: it starts from today. The knob memory.daily (default on) turns it off.
// A companion switched mid-call: the answer is dropped (his folder is no longer the open one) and the next turn reads it again.
const CQID = 'chat', DAY_TRIES = 3;
async function readThrough(msgs){
  const last = Math.max(0, ...msgs.map(m => { const d = msgDate(m); return d ? d.getTime() : 0; }));
  if (!last) return;
  let q = null; try { q = await core.records.get(IQ, CQID); } catch {}
  if (q && Number(q.through) >= last) return;
  await core.records.commit(IQ, { id: CQID, v: 1, through: last, fails: 0, retry_at: 0, at: core.now().getTime() }, { writer: 'core', app: 'memory' }).catch(() => {});
}
let daily = null;
function dayMemory(){ if (!daily) daily = dayOnce().finally(() => { daily = null; }); return daily; }
async function dayOnce(){
  if (!store.name || outside() || (memJob && memJob.who === core.currentId) || importing || await importQueued()) return null;
  const on = core.param ? core.param('memory.daily', true) : true; if (on === false || on === 'off' || on === 0) return null;
  const who = core.currentId, d = core.now(), today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  let q = null; try { q = await core.records.get(IQ, CQID); } catch {}
  const put = x => core.records.commit(IQ, Object.assign({ id: CQID, v: 1, through: today, fails: 0, retry_at: 0 }, q ? { through: q.through } : {}, x, { at: d.getTime() }), { writer: 'core', app: 'memory' });
  if (!q || !isFinite(Number(q.through))){ await put({ through: today }); return null; }   // first seen: from today on
  if ((core.paused && core.paused()) || (q.retry_at && d.getTime() < q.retry_at)) return null;
  const at = m => { const x = msgDate(m); return x ? x.getTime() : 0; };
  if (!store.msgs.some(m => m.is_user && at(m) >= today)) return null;   // only once she is here today (never on the clock at night)
  const msgs = store.msgs.filter(m => !core.chatCardKind(m) && at(m) > Number(q.through) && at(m) < today);
  if (!msgs.some(m => m.is_user)){ if (Number(q.through) < today) await put({ through: today }); return null; }   // she said nothing: nothing to keep
  const job = memJob = { who, done: 0, total: 1, found: 0 };
  let items = null, paused = false;
  job.promise = (async () => {
    emit('memoryjob', memoryJob());
    const lines = chatLines(msgs);
    let hist = '', cut = false;
    for (let i = lines.length - 1; i >= 0; i--){ const l = lines[i].slice(0, MEMORY_PART); if (hist && hist.length + l.length + 1 > MEMORY_PART){ cut = true; break; } hist = l + (hist ? '\n' + hist : ''); }
    const note = ` This is the chat of the last day${cut ? ' (its newest part)' : ''}, since memories were last written; the earlier chat was read before. Facts only: no summary this time. If nothing here is worth keeping, answer with the one line {"kind":"none"}.`;
    try { items = await deriveOne(null, { side: true, chat: false, factsOnly: true, partNote: note }, hist, msgs, true, false); }
    catch(e){ if (e && e.code === 'paused') paused = true; else console.error(e); items = null; }
    if (core.currentId !== who) return [];
    if (items && (items.read || items.none)){   // read, or a plain "nothing to keep": the day is done
      await keepItems(items); job.done = 1; job.found = items.length;
      await put({ through: today, fails: 0, retry_at: 0 }).catch(() => {});
      emit('memory', store.memory);
      return items;
    }
    if (!paused){ const fails = (Number(q.fails) || 0) + 1;
      await put(fails >= DAY_TRIES ? { through: today, fails: 0, retry_at: 0 } : { fails, retry_at: d.getTime() + Math.min(24, Math.pow(2, fails - 1)) * HOUR }).catch(() => {}); }
    return null;
  })().finally(() => {
    if (memJob === job) memJob = null;
    emit('memoryjob', { running: false, done: job.done, total: job.total, found: job.found });
  });
  return job.promise;
}

// the memory prompt is app/prompts/memory.txt; the same words stay here as its fallback
core.prompts.fallback('memory', 'You write the memory of {{char}}, a companion in a chat app. {{char}} is {{pronoun_en}}. Output ONLY JSON lines, one object per line, no prose, no code fences. Each object: {"kind":"fact"|"summary","text":"...","date":"YYYY-MM-DD","confidence":"high"|"medium"|"low"}. Write every text in {{lang}}, in {{char}}\'s own voice: {{voice}}, the way {{pron}} would jot it down for {{self}}, plain and short, no commentary, no praise.{{banned}} In the chat, a line marked "{{her}}:" is the user\'s (her words and her *actions*); a line marked "{{char}}:" is {{char}}\'s own. Keep who said or did what: what {{char}} said or did is written as {{i_form}}, what the user said or did as {{you_form}}; never put one\'s words or deeds on the other. Facts: durable things worth remembering about the user or the two of them (preferences, plans, things that happened, what she told him), taken from what she said or did and what happened between them, never a line of {{char}}\'s own copied as a fact, one per line, each with the date it came up (from the [date] in front of the line). One summary: two sentences on what the time together has been like, with "date" the first day. Skip anything already known. At most 12 lines. A fact may carry "importance": 1 to 5 (5 = would hurt to forget). Besides those, up to 4 lines {"kind":"said","key":"...","text":"..."}: a fact {{char}} stated in the chat about {{char}}\'s own life (work, home, a count, a stage) that will still be true next week, never a moment (where {{pron}} is tonight, what {{pron}} is doing now or just did), "key" a short name for it{{moving}}.{{part}}');
async function deriveOne(settings, opts, hist, msgs, lastPart, parted){
  const her = herLabel();
  // the memories are in the language they talk in, per companion: an English chat gets English
  // memories even where Modu's default (MODU_DEFAULTS) says Simplified Chinese for a Chinese chat
  const said = chatLanguage(store.msgs), foreign = said === 'en' || said === 'other';
  const lang = opts.language || (foreign && core.defaults.memoryLanguage ? LANG_NAME[said] : core.defaults.memoryLanguage) || 'the language the chat is mostly written in';
  const voiceWords = foreign && !opts.language ? 'first person ("I"), speaking to the user as "you"' : 'first person ("我"), speaking to the user as "你"';
  const banned = core.defaults.bannedWords.length ? ` Never use these words: ${core.defaults.bannedWords.join(' / ')}.` : '';
  const known = store.memory.map(m => '- ' + m.text).join('\n').slice(-6000);
  const pron = pronouns();
  const moving = core.memoryOwn ? core.memoryOwn.cardFacts().moving.filter(f => f.owner.kind === 'memory').map(f => f.key) : [];   // a counter's or state's own fact is not memory's
  // a long chat in parts: the summary comes with the last (newest) part only
  const part = opts.partNote != null && !parted ? opts.partNote : parted ? (lastPart ? ' This is the newest part of a long chat; earlier parts were read before.' : ' This is one part of a long chat. Facts only from this part: no summary this time.') : '';
  const prompt = [
    { role:'system', content: await core.prompt('memory', { char: store.name, pronoun_en: pron.en, lang, voice: voiceWords, pron: pron.en.split('/')[0], self: pron.en === 'she/her' ? 'herself' : pron.en === 'he/him' ? 'himself' : 'themself', banned, her,
      i_form: foreign && !opts.language ? '"I …"' : '"我…"', you_form: foreign && !opts.language ? '"you …"' : '"你…"', moving: moving.length ? ` (use one of these when it fits: ${moving.join(', ')})` : '', part }) },
    { role:'user', content:(known ? `Already known:\n${known}\n\n` : '') + `Chat so far:\n${hist}` }
  ];
  // 整理 is her own tap (noted for 用量); the import's job goes through the one door for calls she did not make
  let text;
  if (opts.side) text = String(await core.sideCall('memory', prompt, { chat: opts.chat !== false, max: MEMORY_MAX, room: MEMORY_ROOM, whole: true }) || '');
  else { const heard = core.calls ? core.calls.note('memory', prompt, { settings }) : (x => x);   // counted for the cost meter (设置 → 用量)
    text = heard(await callModel(settings, prompt, { max_tokens: MEMORY_MAX, room: MEMORY_ROOM, whole: true, own: true })); }   // 整理 is her own tap
  const dates = msgs.map(msgDate).filter(Boolean);
  const first = isoDay(dates.length ? new Date(Math.min(...dates)) : new Date()), last = isoDay(dates.length ? new Date(Math.max(...dates)) : new Date());
  const items = [], saidFacts = items.said = [];   // said: the facts he stated, kept beside the items
  items.read = false;   // whether any line of the answer was readable (an import's job backs off when none is)
  // a plain "nothing to keep" (an empty answer, {"kind":"none"}, or a short 没有 / nothing) is a good answer, not a failure
  const bare = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  items.none = !bare || /^\[\s*\]$/.test(bare) || /"kind"\s*:\s*"none"/.test(bare) || (!bare.includes('{') && bare.length <= 40 && /没有|无可|nothing|none/i.test(bare));
  for (const line of text.split(/\r?\n/)){
    const t = line.trim().replace(/^```(json)?|```$/g,''); if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t); if (!o || !o.text) continue;
      items.read = true;
      // a fact he has said, never a moment (今晚在家, 刚到家): kept as "where things stand", with no end, it stood
      // days later. A said fact is the kind that stays true (work, home, a count); a moment has passed by the next prompt
      if (o.kind === 'said'){ if (o.key && !core.MOMENT.test(String(o.text))) saidFacts.push({ key: String(o.key), text: tidyCJK(String(o.text).trim()) }); continue; }
      const kind = o.kind === 'summary' ? 'summary' : 'fact';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : (kind === 'summary' ? first : last);
      if (kind === 'summary' && ((parted && !lastPart) || opts.factsOnly)) continue;
      const it = { kind, text: tidyCJK(String(o.text).trim()), confidence: o.confidence || 'medium', date, to: kind === 'summary' ? last : '',
                   source: `chat.jsonl (${msgs.length} messages, derived by the model)`, voice:'his' };
      if (kind === 'fact' && isFinite(Number(o.importance)) && Number(o.importance) >= 1) it.importance = Math.min(5, Number(o.importance));   // memory 0.4: it fades
      items.push(it);
    } catch {}
  }
  return items;
}

Object.assign(core, { memoryJob, deriveMemory, queueImportMemory, importMemory, dayMemory });
})(globalThis[Symbol.for('modu.core')]);
