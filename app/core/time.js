// app/core/time.js: the clock (now / setClock), a message's time (timeOf, msgDate), days and time in words.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';

// --- Import: a message's time -----------------------------------------------------------------
// send_date as the apps write it: seconds or milliseconds (a number, or a number in a string); an ISO
// time; 酒馆's own "October 27, 2026 8:06pm" and older "2026-3-14 @20h 06m 05s 123ms". Anything else
// is no time at all: the message is undated, never given one.
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function timeOf(v){
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (typeof v === 'number' || (typeof v === 'string' && v.trim() && !isNaN(n))){
    if (!n) return null; const t = n < 1e12 ? n * 1000 : n; return isNaN(new Date(t)) ? null : t;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:[ ,@]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i);
  if (m && MONTHS.includes(m[1].toLowerCase())){
    let h = Number(m[4] || 0); const pm = m[7] && /p/i.test(m[7]); if (m[7]) h = h % 12 + (pm ? 12 : 0);
    return new Date(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]), h, Number(m[5] || 0), Number(m[6] || 0)).getTime();
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s*@\s*(\d{1,2})h\s*(\d{1,2})m(?:\s*(\d{1,2})s)?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)){ const t = Date.parse(s.replace(' ', 'T')); return isNaN(t) ? null : t; }
  return null;
}
// Messages whose time is after the moment they were imported: a time that cannot be true. Kept in her
// file exactly as exported; Modu treats them as undated (msgDate → null), so no future date is shown.
const untimely = new WeakSet();
function markUntimely(msgs, at, count){
  let n = 0;
  for (const m of msgs.slice(0, count == null ? msgs.length : count)){ const t = timeOf(m && m.send_date); if (t && t > at + 60000){ untimely.add(m); n++; } }
  return n;
}
function aheadWords(ms){ const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `in about ${m} minute${m > 1 ? 's' : ''}` : `in about ${Math.round(m / 60)} hour${m >= 90 ? 's' : ''}`; }
function today(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
// A message's date, or null when it has none, or only one that cannot be true (after its import).
function msgDate(m){ if (!m || untimely.has(m)) return null; const t = timeOf(m.send_date); return t == null ? null : new Date(t); }
function isoDay(d){ return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : ''; }

// --- Time, in words ---------------------------------------------------------------------------
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function band(h){ return h < 5 ? 'late at night' : h < 9 ? 'early morning' : h < 12 ? 'morning' : h < 14 ? 'midday' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'late at night'; }
function clockIn(d, tz){
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(d).map(x => [x.type, x.value]));
    return { text: `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`, hour: Number(p.hour) };
  } catch { return { text: `${WEEK[d.getDay()]} ${isoDay(d)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, hour: d.getHours() }; }
}
// calendar days from a to b (times or Dates): local midnights, so the 24th to the 30th is 6 whatever the hours. The one
// way Modu counts days away (the gap line, the absence memory, 暂停's absence), so his words and his memory agree
function calendarDays(a, b){
  const mid = t => { const d = new Date(+t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  return Math.round((mid(b) - mid(a)) / 864e5);
}
// gapWords(ms, end = now()): a gap of a day or more is told in calendar days (the gap ended at `end`)
function gapWords(ms, end){
  const m = Math.round(ms / 60000);
  if (m < 2) return 'just now'; if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60); if (h < 24) return `about ${h} hour${h > 1 ? 's' : ''} ago`;
  const e = end != null ? +end : +now(), d = Math.max(1, calendarDays(e - ms, e));
  return d < 14 ? `${d} day${d > 1 ? 's' : ''} ago` : `about ${Math.round(d / 7)} weeks ago`;
}
// The clock presence reads. setClock(fn) lets a demo or a screenshot pin the time (index.html ?at=).
core.clock = () => new Date();
function now(){ return core.clock(); }
function setClock(fn){ core.clock = fn || (() => new Date()); core.updatePresence(); }

Object.assign(core, { timeOf, markUntimely, aheadWords, today, msgDate, isoDay, band, clockIn, gapWords, calendarDays, now,
  setClock });
})(globalThis[Symbol.for('modu.core')]);
