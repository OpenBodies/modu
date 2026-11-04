// app/core/life-block.js: the `life` context block: a fresh copy of what he posted, wrote and has on his phone.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { listeners, store, clip, aheadWords, gapWords, now, RECORD_TYPE, records } = core;

// --- His life on the phone, for the chat (block `life`) ------------------------------------------
// What he posted, wrote and has on his phone lives in records, which are async; buildContext is
// not. So the core keeps a copy of the record types declared to it (lifeTypes, below), read again whenever a record changes or
// another companion is loaded, and send() waits for that read before it builds the prompt. A type this
// companion does not have is skipped. One row per type: (record, words) → [{ at, text }].
// The core knows no app here: a record type reaches the block only once it is declared with
// lifeTypes.add(type, lines), where lines(record, words) → [{ at, text }] says, in words for him, what one
// record is. words = { t (now, ms), she, She, her (her name, or she / She / her), clip(text, n),
// ago(ms) ('2 hours ago'), ahead(ms) ('in about 5 minutes') }. Modu's four built-in types (朋友圈, 信箱, 日记,
// 查手机) are declared in life-types.js through this same call, the way any app declares its own.
const LIFE_TYPES = {};
const lifeTypes = {
  add(type, lines){
    if (typeof type !== 'string' || !RECORD_TYPE.test(type)) throw new Error(`记录类型「${type}」无法使用`);
    const f = typeof lines === 'function' ? lines : lines && typeof lines.lines === 'function' ? lines.lines : null;
    if (!f) throw new Error(`lifeTypes.add('${type}', lines): lines must be a function (record, words) → [{ at, text }]`);
    LIFE_TYPES[type] = f; if (store.name) refreshLife();
    return lifeTypes.list();
  },
  remove(type){ delete LIFE_TYPES[type]; if (store.name) refreshLife(); return lifeTypes.list(); },
  list(){ return Object.keys(LIFE_TYPES); },
  // a type held back: declared, but not read into the block while held (an app still 开发中, such as 信箱, so his
  // prompt says nothing of letters she cannot open). hold(type, false) lets it in again. → the held types
  hold(type, on = true){ if (on) HELD.add(String(type)); else HELD.delete(String(type)); if (store.name) refreshLife(); return [...HELD]; },
  held(){ return [...HELD]; },
};
const HELD = new Set();
core.life = { key:'', recs:[] }; let lifeRead = Promise.resolve();
function lifeKey(){ return (core.currentId || '') + '|' + (store.name || ''); }
async function readLife(){
  const key = lifeKey(); if (!store.name){ core.life = { key, recs:[] }; return; }
  let types = []; try { types = await records.types(); } catch { types = []; }
  const recs = [];
  for (const t of Object.keys(LIFE_TYPES)) if (types.includes(t) && !HELD.has(t)) { try { for (const r of await records.list(t)) recs.push({ t, r }); } catch {} }
  if (key === lifeKey()) core.life = { key, recs };
}
// → a Promise that settles once the copy is fresh (every read waits for the one before it)
// and an outside memory source's recall, so the memory block can be built synchronously
function refreshLife(){ const both = () => readLife().then(core.readLog, core.readLog).then(core.readKnown, core.readKnown).then(core.readRecall, core.readRecall); lifeRead = lifeRead.then(both, both); return lifeRead; }
// 'contacts' too: on a load, 'loaded' comes before he is the current contact (register), and demo records are per contact.
// A change on her phone (owner 'her') is none of his: nothing of his to read again.
listeners.add((ev, d) => { if ((ev === 'records' && !(d && d.owner === 'her')) || ev === 'loaded' || ev === 'contacts') refreshLife(); });
// → the lines of the life block, newest first, each with its time in words; the oldest are dropped to fit
function lifeLines(user, budget){
  if (core.life.key !== lifeKey()) return [];
  const t = now().getTime(), named = user && user !== 'You', items = [];
  const w = { t, she: named ? user : 'she', She: named ? user : 'She', her: named ? user : 'her', clip, ago: gapWords, ahead: aheadWords };
  for (const { t: type, r } of core.life.recs){ if (HELD.has(type)) continue; try { for (const it of LIFE_TYPES[type](r, w)) if (it && it.text) items.push({ at: Number(it.at) || 0, text: it.text }); } catch {} }
  items.sort((a, b) => b.at - a.at);
  const out = []; let n = 0;
  for (const it of items){
    const s = `- ${it.at ? gapWords(Math.max(0, t - it.at)) : 'some time ago'}: ${it.text}`;
    if (n + s.length + 1 > budget) break;   // newest first, so what is cut is the oldest
    out.push(s); n += s.length + 1;
  }
  return out;
}

Object.assign(core, { lifeTypes, lifeKey, refreshLife, lifeLines });
})(globalThis[Symbol.for('modu.core')]);
