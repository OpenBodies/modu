// app/core/day.js: his day record: what he does today, slot by slot, written ahead and shown only as each slot's time comes.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { clone, now, isoDay, records } = core;

// day/<YYYY-MM-DD>.json in his folder (records are one folder deep):
//   { v, id = day, day, slots: [{ at, until, where, doing, why, busy, kind, mood }], her: [{ at, app, line, what }],
//     entry (his evening line about the day, '' until written), hints? ([{ key, line }]: known, never said),
//     writer, rev, at }
// `slots` are written ahead (one sketch a day) and are hidden until their time: every read for her or
// for his prompt goes through visible(day, t), which keeps only the slots that have begun. `kind` is one
// of the doings an app offered (takes and offers) or '' for an ordinary slot; a past slot of an
// offered kind is handed to the apps that take it. `her` is her part of the day, from each app's today(day)
// hook (and the event log), never by a model call. `mood` is the slot's mood word; `what` an
// app's own short kind for a line of hers. A slot may carry `said` (his own words in chat
// that set it: a plan he stated for that time), only when there are some. life.js also keeps `from` ('sketch' | 'skeleton'), `aged` (ms: told to
// the memory source) and `line` (a skeleton day's one-liner); a reader keeps fields it does not know. The sketch,
// the status, her part, the evening and the age-out are app/life.js's.
const DAY_TYPE = 'day', DAY_ID = /^\d{4}-\d{2}-\d{2}$/;
function dayShape(r){
  r = r && typeof r === 'object' ? r : {};
  const slot = s => ({ at: Number(s.at) || 0, until: Number(s.until) || 0, where: String(s.where || ''), doing: String(s.doing || ''), why: String(s.why || ''), busy: s.busy === true, kind: String(s.kind || ''), mood: String(s.mood || ''), ...(s.said ? { said: String(s.said) } : {}) });
  return Object.assign({}, r, { v: r.v || 1, day: String(r.day || r.id || ''), slots: [].concat(r.slots || []).filter(s => s && typeof s === 'object').map(slot).sort((a, b) => a.at - b.at),
    her: [].concat(r.her || []).filter(h => h && h.line).map(h => ({ at: Number(h.at) || 0, app: String(h.app || ''), line: String(h.line), what: String(h.what || '') })),
    entry: String(r.entry || ''), hints: [].concat(r.hints || []).filter(h => h && h.line) });
}
// pure: the record as it may be seen at time t: slots that have not begun are left out
function visible(rec, t){
  const r = dayShape(rec), ms = t == null ? now().getTime() : +t;
  r.slots = r.slots.filter(s => s.at <= ms);
  return r;
}
// pure: the slot he is in at time t, or null
function slotAt(rec, t){ const ms = +t; return dayShape(rec).slots.filter(s => s.at <= ms && (!s.until || ms < s.until)).pop() || null; }
const day = {
  // → the record (whole, slots ahead included: for the scheduler and his prompt-side code; draw only visible()) or null
  async get(d){ d = d || isoDay(now()); if (!DAY_ID.test(d)) throw new Error(`日期「${d}」无法使用`); try { const r = await records.get(DAY_TYPE, d); return r ? dayShape(r) : null; } catch { return null; } },
  // writes it with the header (first writer wins on a rev clash) → { ok, record }
  async put(rec, o = {}){
    const r = dayShape(rec); if (!DAY_ID.test(r.day)) throw new Error(`日期「${r.day}」无法使用`);
    return records.commit(DAY_TYPE, Object.assign(r, { id: r.day, at: Number(rec.at) || new Date(r.day + 'T00:00').getTime() }), { writer: o.writer || rec.writer || 'life', app: 'life' });
  },
  visible, slotAt, shape: dayShape, TYPE: DAY_TYPE,
};

Object.assign(core, { DAY_TYPE, day });
})(globalThis[Symbol.for('modu.core')]);
