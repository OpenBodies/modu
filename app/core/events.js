// app/core/events.js: the event log: what happened in the phone's apps, one call for every app; the `events` block reads it.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, clip, isoDay, gapWords, now, RECORD_TYPE, records, lifeKey, refreshLife } = core;

// --- The event log: what happened in the phone's apps (block `events`) -------------------------------
// One call for every app: logEvent({ app, who, what, line, title?, detail?, at? }). The core never knows
// which apps exist: it keeps the entries, newest last, and the `events` block reads them back as lines.
// A new game or app writes here and needs no change in this file. Stored as the record type 'log', one
// record per day (log/dYYYYMMDD.json, { items: [...] }); writes are queued so two at once never lose one.
// What the `life` block already tells him (朋友圈, 信箱, 日记, 查手机) is not written here.
// An entry may carry `session` (the app session it happened in, ctx.session; read
// back with eventList({ session })) and `quiet: true` (kept in the log, but left out of his prompt unless a
// notice rule, below, says otherwise).
const LOG_TYPE = 'log', LOG_DAYS = 7, LOG_PER_DAY = 300, LOG_WHO = ['her', 'him', 'both'];
core.eventLog = { key:'', items:[] }; let logWrite = Promise.resolve();
const logId = t => 'd' + isoDay(new Date(t)).replace(/-/g, '');
async function readLog(){
  const key = lifeKey(); if (!store.name){ core.eventLog = { key, items:[] }; return; }
  const t = now().getTime(), items = [];
  for (let i = LOG_DAYS - 1; i >= 0; i--){
    let r = null; try { r = await records.get(LOG_TYPE, logId(t - i * 864e5)); } catch {}
    if (r && Array.isArray(r.items)) for (const e of r.items) if (e && e.line) items.push(e);
  }
  items.sort((a, b) => (a.at || 0) - (b.at || 0));
  if (key === lifeKey()) core.eventLog = { key, items };
}
// → Promise<entry>: the entry as kept. Throws (with words for her) on a bad app id or an empty line.
function logEvent(e = {}){
  if (!e || typeof e !== 'object') return Promise.reject(new Error('记录必须是一个对象'));
  const app = String(e.app || '');
  if (!RECORD_TYPE.test(app)) return Promise.reject(new Error(`应用「${app}」无法记录`));
  const line = clip(String(e.line || '').replace(/\s+/g, ' ').trim(), 240);
  if (!line) return Promise.reject(new Error('这条记录是空的'));
  const t = now().getTime(), at = Math.min(Number(e.at) || t, t);   // never in the future
  const entry = { id: at.toString(36) + Math.random().toString(36).slice(2, 6), at, app, who: LOG_WHO.includes(e.who) ? e.who : 'her', what: clip(String(e.what || ''), 40), line };
  if (e.title) entry.title = clip(String(e.title), 20);
  if (e.session) entry.session = clip(String(e.session), 40);
  if (e.quiet === true) entry.quiet = true;
  if (e.detail !== undefined){ try { const s = JSON.stringify(e.detail); if (s && s.length <= 4000) entry.detail = JSON.parse(s); } catch {} }
  const job = async () => {
    const id = logId(at), day = (await records.get(LOG_TYPE, id)) || { id, items:[] };
    const items = (Array.isArray(day.items) ? day.items : []).concat(entry).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-LOG_PER_DAY);
    await records.put(LOG_TYPE, { id, date: isoDay(new Date(at)), at: items[items.length - 1].at, items }, { app:'log' });
    if (core.eventLog.key === lifeKey() && !core.eventLog.items.some(x => x.id === entry.id)) core.eventLog = { key: core.eventLog.key, items: core.eventLog.items.concat(entry).sort((a, b) => (a.at || 0) - (b.at || 0)) };
    emit('logged', clone(entry));
    return clone(entry);
  };
  const p = logWrite.then(job, job); logWrite = p.catch(() => {}); return p;
}
// → Promise<entry[]> of the last `days` days (default 7, at most 60), oldest first; `app` keeps one app's only,
// `session` one session's only.
async function eventList(opts = {}){
  await refreshLife();
  const days = Math.max(1, Math.min(60, Number(opts.days) || LOG_DAYS)), t = now().getTime();
  let items = core.eventLog.items;
  if (days > LOG_DAYS){ items = []; for (let i = days - 1; i >= 0; i--){ let r = null; try { r = await records.get(LOG_TYPE, logId(t - i * 864e5)); } catch {} if (r && Array.isArray(r.items)) items.push(...r.items); } }
  const from = t - days * 864e5;
  return clone(items.filter(e => (e.at || 0) > from && (!opts.app || e.app === opts.app) && (!opts.session || e.session === opts.session)).sort((a, b) => (a.at || 0) - (b.at || 0)));
}
// --- Notice rules: the seam where it is decided whether, and how, an entry reaches his prompt --------------
// noticeRules.add(what, rule): for every entry whose `what` is this kind, rule(entry, words) gives the line the
// events block shows instead of entry.line ('' or null: he is not told this one). words: { t (now, ms), she,
// ago(ms) }. With no rule, an entry shows its own line, and a quiet entry (quiet: true) shows nothing. The
// core ships with NO rules: this is the hook where a page decides, for
// example, whether he notices that she looked through his phone (the kind 'peeked':
// rarely, depending on his mood). The core never names an app or a kind here.
const notice = new Map();
const noticeRules = {
  add(what, rule){
    if (typeof what !== 'string' || !what || what.length > 40) throw new Error(`notice rule: 「${what}」 is not an event kind`);
    if (typeof rule !== 'function') throw new Error('notice rule: needs a function (entry, words) → line');
    notice.set(what, rule); return [...notice.keys()];
  },
  remove(what){ notice.delete(what); return [...notice.keys()]; },
  list(){ return [...notice.keys()]; },
};
function noticeLine(e, t, She){
  const rule = notice.get(e.what);
  if (!rule) return e.quiet ? '' : e.line;
  try { const l = rule(clone(e), { t, she: She, ago: ms => gapWords(Math.max(0, ms)) }); return l ? clip(String(l).replace(/\s+/g, ' ').trim(), 240) : ''; }
  catch(err){ console.error(err); return ''; }
}
// → the lines of the events block, newest first, each with its time in words; the oldest dropped to fit
function eventLines(user, budget){
  if (core.eventLog.key !== lifeKey()) return [];
  const t = now().getTime(), named = user && user !== 'You', She = named ? user : 'she';
  const by = { her: She, him: 'you', both: `you and ${named ? user : 'her'}` };
  const out = []; let n = 0;
  for (const e of core.eventLog.items.slice().reverse()){
    if ((e.at || 0) > t) continue;
    const line = noticeLine(e, t, She); if (!line) continue;
    const s = `- ${gapWords(Math.max(0, t - (e.at || 0)))}, ${e.title || e.app}, ${by[e.who] || She}: ${line}`;
    if (n + s.length + 1 > budget) break;
    out.push(s); n += s.length + 1;
  }
  return out;
}

Object.assign(core, { readLog, logEvent, eventList, eventLines, noticeRules });
})(globalThis[Symbol.for('modu.core')]);
