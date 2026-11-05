// app/core/card-state.js: card state: extra state a card brings (a hidden score, a level), kept in his folder and moved only by state.nudge.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, isoDay, now, records, listeners, msgDate } = core;

// Modu has no score of its own. A card that wants one declares it, in card.extensions.modu.state (SillyTavern
// ignores the field, so the card still loads there unchanged) or in his params (params.state.<key>, or the
// card set's params.bond, read as the key bond.name); a card that declares none has none, and every call
// below is then a quiet no-op. Hidden in play by default: no number on screen, and he never names it.
// The rules a declaration may set, each optional (normalised by stateDecl):
//   range [lo, hi] (default [0, 100]) · start (default lo) · step (every change is rounded to it; default 1)
//   turn_max (largest change one turn may make) · caps { day_up, day_down, week_up, week_down }
//   slow { above, factor }: at or above `above`, every change and every cap is multiplied by `factor`
//   decay { per_day, toward }: drifts toward `toward` each day, only upward (time away never lowers it)
//   gates [{ at, min_days?, unlock: [ids] }]: at the value `at` (and `min_days` after the state began) the ids
//     open; an open id never closes again, whatever the value does later
//   drip { ids, min_gap_days }: of the ids a gate opens, these come out one at a time, min_gap_days apart
//   hidden (default true) · undertow { chance } (next-layer hints)
// Also read, the same rules under the names some cards use: max_per_turn (= turn_max),
// max_per_day / max_per_week (= caps both ways), slow_above { at, scale } (= slow), decay: false (off), a gate's
// unlock as one id, drip { min_days_apart } with no ids (every id a gate opens drips), undertow { skip }.
// A key is any text the card's author wrote (信任, trust level, xinren): 1 to 64 characters, no line break or
// square bracket (the reply tag could not carry it). Its record's file name is the key when that is a plain id, else a safe
// one made from it (stateId); the record keeps the key itself as `key`.
const STATE_TYPE = 'state', KEY = /^[^\n\r[\]【】]{1,64}$/, ID = /^[A-Za-z0-9_-]{1,64}$/, DAY = 86400000, LOG_KEEP = 20;
const keyNorm = k => String(k == null ? '' : k).normalize('NFKC').trim().toLowerCase();
function stateId(key){
  const k = String(key);
  if (ID.test(k)) return k;
  const hex = [...new TextEncoder().encode(k)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length <= 62) return 's-' + hex;
  let h = 2166136261; for (const ch of k) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return 's-h' + (h >>> 0).toString(36);
}
// a key as written in a tag or a 世界书 rule → the declared key it names (exact, else the same text in NFKC, any case), or ''
function keyIn(obj, key){
  if (key == null || !obj) return '';
  const k = String(key).trim(); if (Object.prototype.hasOwnProperty.call(obj, k)) return k;
  const n = keyNorm(k); return Object.keys(obj).find(x => keyNorm(x) === n) || '';
}
const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
const ids = v => [].concat(v || []).map(String).filter(Boolean);
function stateDecl(key, d){
  d = d && typeof d === 'object' ? d : {};
  const r = Array.isArray(d.range) ? d.range : [num(d.min, 0), num(d.max, 100)];
  const lo = num(r[0], 0), hi = Math.max(lo, num(r[1], 100));
  const c = Object.assign({ day: d.max_per_day, week: d.max_per_week }, d.caps && typeof d.caps === 'object' ? d.caps : {});
  const cap = (a, b) => { const v = c[a] != null ? c[a] : c[b]; return v == null ? Infinity : Math.abs(num(v, Infinity)); };
  const sa = d.slow_above && typeof d.slow_above === 'object' ? { above: d.slow_above.at, factor: d.slow_above.scale } : null;
  const slow = d.slow || sa || (d.threshold != null ? { above: d.threshold, factor: d.factor } : null);
  const tm = d.turn_max != null ? d.turn_max : d.max_per_turn;
  const decay = d.decay && typeof d.decay === 'object' && num(d.decay.per_day, 0) > 0 ? { per_day: Math.abs(num(d.decay.per_day, 0)), toward: num(d.decay.toward, num(d.start, lo)) } : null;
  return {
    key, range: [lo, hi], start: Math.min(hi, Math.max(lo, num(d.start, lo))), step: Math.abs(num(d.step, 1)) || 1,
    turn_max: tm == null ? Infinity : Math.abs(num(tm, Infinity)),
    caps: { day_up: cap('day_up', 'day'), day_down: cap('day_down', 'day'), week_up: cap('week_up', 'week'), week_down: cap('week_down', 'week') },
    slow: slow && slow.above != null ? { above: num(slow.above, hi), factor: Math.max(0, num(slow.factor, 1)) } : null,
    decay,
    // the bond's `unlocks [{ entry, min, min_days }]` are read as gates in any declaration (the same names serve all three)
    gates: [].concat(d.gates || [], [].concat(d.unlocks || []).filter(u => u && typeof u === 'object' && u.min != null).map(u => ({ at: u.min, min_days: u.min_days, asks: u.asks, unlock: [u.entry] }))).filter(g => g && g.at != null).map(g => Object.assign({ at: num(g.at, hi), min_days: Math.max(0, num(g.min_days, 0)), unlock: ids(g.unlock || g.ids) }, g.asks != null ? { asks: Math.max(0, num(g.asks, 0)) } : {})).sort((a, b) => a.at - b.at),
    // the public schema's other bond rules: pace multiplies every change before the
    // caps; tiers name levels; unlocks_stay false lets a gate close again below its value; away and echo are kept as given
    pace: Math.max(0, num(d.pace, 1)),
    tiers: [].concat(d.tiers || []).filter(x => x && x.min != null).map(x => ({ id: String(x.id || ''), name: String(x.name || ''), min: num(x.min, 0) })).sort((a, b) => a.min - b.min),
    stay: d.unlocks_stay !== false,
    away: d.away && typeof d.away === 'object' ? clone(d.away) : null,
    echo: d.echo && typeof d.echo === 'object' ? clone(d.echo) : null,
    drip: d.drip && typeof d.drip === 'object' ? { ids: d.drip.ids ? ids(d.drip.ids) : null, min_gap_days: Math.max(0, num(d.drip.min_gap_days != null ? d.drip.min_gap_days : d.drip.min_days_apart, 1)) } : null,
    hidden: d.hidden !== false,
    undertow: d.undertow && typeof d.undertow === 'object' ? { chance: Math.min(1, Math.max(0, num(d.undertow.chance, 0))) } : null,
  };
}
// params.bond (modu-character-params/0.1, every field of the public schema) as one declaration: unlocks become gates
function bondDecl(b){
  const unl = [].concat(b.unlocks || []);
  return { range: Array.isArray(b.range) ? b.range : [0, 100], start: b.start, step: b.step, pace: b.pace, tiers: b.tiers, caps: b.caps, turn_max: b.turn_max, slow: b.slow, decay: b.decay,
    hidden: b.hidden, unlocks_stay: b.unlocks_stay, away: b.away, echo: b.echo,
    gates: [].concat(b.gates || [], unl.filter(u => u && typeof u === 'object').map(u => ({ at: u.min, min_days: u.min_days, asks: u.asks, unlock: [u.entry] }))), drip: b.drip, undertow: b.undertow };
}
// the tier the value has reached (the highest whose min it reached), or null
function stateTier(decl, value){ let t = null; for (const x of (decl && decl.tiers) || []) if (value >= x.min) t = x; return t ? Object.assign({}, t) : null; }
// → { key: decl } for a card and a params file (pure). The card's own declaration wins over params for a key. A declaration
// that cannot be used (its rules not an object, a key empty or too long) is left out; stateProblems counts them (搬家 says so).
const usable = (k, d) => KEY.test(String(k).trim()) && d && typeof d === 'object' && !Array.isArray(d);
function stateProblems(card, params){
  let n = 0;
  const cs = card && card.extensions && card.extensions.modu && card.extensions.modu.state, ps = params && params.state;
  for (const s of [cs, ps]) if (s != null){ if (typeof s !== 'object' || Array.isArray(s)) n++; else for (const k of Object.keys(s)) if (!usable(k, s[k])) n++; }
  return n;
}
function stateDecls(card, params){
  const out = {}, add = (k, d) => { k = String(k == null ? '' : k).trim(); if (usable(k, d) && !keyIn(out, k)) out[k] = stateDecl(k, d); };
  const cs = card && card.extensions && card.extensions.modu && card.extensions.modu.state;
  if (cs && typeof cs === 'object') for (const k of Object.keys(cs)) add(k, cs[k]);
  const ps = params && params.state;
  if (ps && typeof ps === 'object') for (const k of Object.keys(ps)) add(k, ps[k]);
  const b = params && params.bond;
  // the key: the bond's own `key` (any usable key text: 亲近 too), else its name when that is a plain id, else 'bond'
  // (a name such as 好感度 is a label)
  if (b && typeof b === 'object' && (b.key || b.name)){ const bk = String(b.key == null ? '' : b.key).trim(); add(bk && KEY.test(bk) ? bk : [String(b.name || ''), 'bond'].find(x => ID.test(x)), bondDecl(b)); }
  return out;
}
const weekOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); };
// calendar days between two times (local midnights; Math.round, so a 23- or 25-hour day across DST is still one day)
const daysBetween = (a, b) => Math.round((new Date(isoDay(new Date(b)) + 'T00:00') - new Date(isoDay(new Date(a)) + 'T00:00')) / DAY);
const tidy = v => Math.round(v * 1e6) / 1e6;
const roundTo = (v, step) => tidy(Math.round(v / step) * step);
// toward zero, to a whole number of steps (symmetric: +0.5 and −0.5 at step 1 both give 0)
const stepsOf = (v, step) => Math.sign(v) * Math.floor(Math.abs(v) / step + 1e-9) * step;
// a fresh record for a key
function stateStart(decl, t){ return { v: 1, value: decl.start, unlocked: [], queued: [], since: t, writer: 'core', rev: 0, at: t, moved: { day: isoDay(new Date(t)), up: 0, down: 0, week: weekOf(t), wup: 0, wdown: 0 }, log: [] }; }
// time passes (pure): decay (upward only), gates that min_days now lets open, one drip if it is due
function stateSettle(decl, rec, t){
  const r = clone(rec);
  r.unlocked = ids(r.unlocked); r.queued = ids(r.queued);
  if (decl.decay && r.value < decl.decay.toward){
    const days = daysBetween(r.decayed || r.at || t, t);
    if (days > 0) r.value = Math.min(decl.decay.toward, roundTo(r.value + days * decl.decay.per_day, decl.step));
  }
  r.decayed = t;
  const age = daysBetween(r.since || t, t), drips = !decl.drip ? [] : decl.drip.ids || decl.gates.flatMap(g => g.unlock);
  // unlocks_stay false: a gate below the value closes again (its ids leave unlocked and the queue)
  if (decl.stay === false) for (const g of decl.gates) if (r.value < g.at){ r.unlocked = r.unlocked.filter(id => !g.unlock.includes(id)); r.queued = r.queued.filter(id => !g.unlock.includes(id)); }
  for (const g of decl.gates) if (r.value >= g.at && age >= g.min_days)
    for (const id of g.unlock) if (!r.unlocked.includes(id) && !r.queued.includes(id)) (drips.includes(id) ? r.queued : r.unlocked).push(id);
  if (r.queued.length && (!r.dripAt || t - r.dripAt >= decl.drip.min_gap_days * DAY)){ r.unlocked.push(r.queued.shift()); r.dripAt = t; }
  return r;
}
// one change (pure): → { rec, applied, reason, carried? } (reason when nothing moved: 'nothing' | 'turn' | 'cap' | 'small' |
// 'range'; carried: the record changed anyway, a part-step kept in rec.carry, so write it)
function stateApply(decl, rec, delta, why, o = {}){
  const t = num(o.at, now().getTime()), r = stateSettle(decl, rec, t);
  let d = num(delta, 0);
  if (!d) return { rec: r, applied: 0, reason: 'nothing' };
  if (o.turn != null && r.turn === String(o.turn)) return { rec: r, applied: 0, reason: 'turn' };   // one change per turn
  d *= decl.pace == null ? 1 : decl.pace;   // pace: faster or slower, before the per-turn max and the caps
  d = Math.sign(d) * Math.min(Math.abs(d), decl.turn_max);
  const m = r.moved = Object.assign({ day: '', up: 0, down: 0, week: '', wup: 0, wdown: 0 }, r.moved);
  const day = isoDay(new Date(t)), week = weekOf(t);
  if (m.day !== day) Object.assign(m, { day, up: 0, down: 0 });
  if (m.week !== week) Object.assign(m, { week, wup: 0, wdown: 0 });
  const f = decl.slow && r.value >= decl.slow.above ? decl.slow.factor : 1;
  d *= f;
  const room = tidy(d > 0 ? Math.min(decl.caps.day_up * f - m.up, decl.caps.week_up * f - m.wup) : Math.min(decl.caps.day_down * f - m.down, decl.caps.week_down * f - m.wdown));
  if (room <= 0) return { rec: r, applied: 0, reason: 'cap' };
  // a part-step left over from before (the same way only) joins this change; the room is a ceiling, so it is
  // clamped first, and only whole steps toward zero are applied. What is left is carried to the next change in
  // that direction (so a slow factor of 0.4 at step 1 still moves, every few changes), unless the cap cut it.
  let carry = num(r.carry, 0); if (Math.sign(carry) !== Math.sign(d)) carry = 0;
  let total = d + carry, cut = false;
  if (Math.abs(total) > room + 1e-9){ total = Math.sign(total) * room; cut = true; }
  const q = tidy(stepsOf(total, decl.step));
  r.carry = cut ? 0 : tidy(total - q);
  if (!q) return { rec: r, applied: 0, reason: cut ? 'cap' : 'small', carried: true };
  const value = tidy(Math.min(decl.range[1], Math.max(decl.range[0], r.value + q))), applied = tidy(value - r.value);
  if (!applied){ r.carry = 0; return { rec: r, applied: 0, reason: 'range', carried: true }; }
  if (applied > 0){ m.up = tidy(m.up + applied); m.wup = tidy(m.wup + applied); } else { m.down = tidy(m.down - applied); m.wdown = tidy(m.wdown - applied); }
  r.value = value; r.at = t; r.rev = (Number(r.rev) || 0) + 1; r.writer = String(o.writer || 'core');
  if (o.turn != null) r.turn = String(o.turn);
  r.log = [].concat(r.log || [], [{ at: t, delta: applied, why: String(why || '').slice(0, 120), writer: r.writer }]).slice(-LOG_KEEP);
  return { rec: stateSettle(decl, r, t), applied, reason: '' };
}
// a 世界书 entry's unlock rule (pure): extensions.modu.when = { key, at } (on once the key reaches `at`; also
// `min`) and/or { id } (on once that id is in the key's `unlocked`). An entry without one is always on.
// `view` = { key: { value, unlocked } }. An undeclared key keeps the entry off.
// Time gates in the same rule, all of what is given must hold: hours 'HH:MM-HH:MM' (may
// wrap past midnight), weekdays [0-6] (0 = Sunday), date 'MM-DD' | 'her_birthday' | 'met', lunar 'MM-DD' | 'eve',
// solar_term '<name>'. `o` = { t (ms), dates: { her_birthday, met: 'MM-DD' }, lunar(t) → { md, eve }, term(t) → name }:
// a gate whose answer is not given (no t, no lunar calendar) keeps the entry off. `state` is read as `key`.
function timeOk(w, o){
  const has = k => w[k] != null;
  if (!['hours', 'weekdays', 'date', 'lunar', 'solar_term'].some(has)) return true;
  if (!o || o.t == null) return false;
  const d = new Date(o.t), pad = n => String(n).padStart(2, '0'), md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (has('hours')){
    const m = String(w.hours).match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/); if (!m) return false;
    const now = d.getHours() * 60 + d.getMinutes(), a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    if (!(a <= b ? now >= a && now <= b : now >= a || now <= b)) return false;
  }
  if (has('weekdays') && ![].concat(w.weekdays).map(Number).includes(d.getDay())) return false;
  if (has('date')){ const want = /^\d{2}-\d{2}$/.test(w.date) ? w.date : o.dates && o.dates[w.date]; if (!want || want !== md) return false; }
  if (has('lunar')){ const l = typeof o.lunar === 'function' ? o.lunar(o.t) : null; if (!l || !(w.lunar === 'eve' ? l.eve : l.md === w.lunar)) return false; }
  if (has('solar_term')){ const n = typeof o.term === 'function' ? o.term(o.t) : null; if (!n || n !== w.solar_term) return false; }
  return true;
}
// a 世界书 entry's own id, as a gate's `unlock` / a bond's `unlocks[].entry` names it: extensions.modu.id when the card
// gives one (酒馆's own uid is a number it may renumber), else its id / uid
const entryId = e => { const m = e && e.extensions && e.extensions.modu; const v = m && m.id != null ? m.id : e ? (e.id != null ? e.id : e.uid) : null; return v == null ? null : String(v); };
function loreWhen(entry, view, o){
  const ext = entry && entry.extensions && entry.extensions.modu, w0 = ext && ext.when;
  if (!w0 || typeof w0 !== 'object') return true;
  const w = Object.assign({}, w0, { key: w0.key != null ? w0.key : w0.state });
  if (!timeOk(w, o)) return false;
  if (w.key == null) return true;
  const s = view ? view[keyIn(view, w.key)] : null;
  if (!s) return false;
  const at = w.at != null ? w.at : w.min, u = ids(s.unlocked);
  if (at == null && w.id == null) return true;
  if (at != null && s.value >= num(at, Infinity)) return true;
  // an id once opened stays open (gates never re-lock): the rule's id, or the entry's own id
  return (w.id != null && u.includes(String(w.id))) || (entryId(entry) != null && u.includes(entryId(entry)));
}
// next-layer hints ("undertow", pure): on a given day, with the key's undertow chance, one line from the next
// gate above the value: a 世界书 entry whose when.key is this key and whose when.at is that gate, with a line
// in extensions.modu.undertow; entries flagged st_only (extensions.modu.st_only, or a comment with ~undertow)
// are skipped. The draw is the same all day (seeded by day and key). → { key, at, line, entry } | null.
// The line goes into the day record's hints and that day's context as "known, never said", never his words.
function undertowFor(decl, value, entries, day){
  if (!decl || !decl.undertow || !decl.undertow.chance) return null;
  const next = decl.gates.find(g => g.at > value); if (!next) return null;
  const seed = h => { let x = 2166136261; for (const c of String(h)) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x / 4294967296; };
  if (seed(day + '|' + decl.key) >= decl.undertow.chance) return null;
  const pool = [].concat(entries || []).filter(e => {
    const m = e && e.extensions && e.extensions.modu; if (!m || typeof m.undertow !== 'string' || !m.undertow.trim()) return false;
    if (m.st_only || /~undertow/.test(String(e.comment || ''))) return false;
    const w = m.when || {}, at = w.at != null ? w.at : w.min, id = entryId(e);
    // in the next gate: the gate opens this entry (by its id), or its when rule names this key at that gate
    if (id != null && next.unlock.includes(id)) return true;
    return keyNorm(w.key != null ? w.key : w.state) === keyNorm(decl.key) && (num(at, NaN) === next.at || (w.id != null && next.unlock.includes(String(w.id))));
  });
  if (!pool.length) return null;
  const e = pool[Math.floor(seed(day + '#' + decl.key) * pool.length)];
  return { key: decl.key, at: next.at, line: e.extensions.modu.undertow.trim(), entry: entryId(e) != null ? entryId(e) : (e.comment || '') };
}
// the away effect (pure; mood only, never the value): away = { after_days, mood, recover_days } from params;
// herDays = the days she was with him ('YYYY-MM-DD', any order); today = 'YYYY-MM-DD'. After a gap of at least
// after_days, his mood on return is `mood`, fading over recover_days consecutive days with her; a gap of a day or
// more before that resets the recovery (counted again from the new return) and the mood stays. → { mood, strength (1 → 0), since } | null
function awayEffect(away, herDays, today){
  if (!away || typeof away !== 'object' || !(num(away.after_days, 0) > 0)) return null;
  if (!away.mood) away = Object.assign({}, away, { mood: 'low' });   // an away block that names no mood means 'low'
  const N = num(away.after_days, 0), M = Math.max(1, num(away.recover_days, 1));
  const days = [...new Set(ids(herDays))].filter(d => d <= today).sort();
  const gap = (a, b) => daysBetween(new Date(a + 'T12:00'), new Date(b + 'T12:00'));
  if (!days.length) return null;
  // walk her days in order: a long gap starts it (from the return), each next day with her counts toward recovery,
  // any other gap while it lasts restarts the count from the new return (the mood stays), M days done ends it
  let since = null, done = 0;
  for (let i = 1; i < days.length; i++){
    const g = gap(days[i - 1], days[i]);
    if (g >= N){ since = days[i]; done = 0; }
    else if (since){ if (g === 1) done++; else { since = days[i]; done = 0; } }
    if (since && done >= M){ since = null; done = 0; }
  }
  const last = days[days.length - 1], g = gap(last, today);
  if (g >= N) return { mood: String(away.mood), strength: 1, since: last };   // away now: how he will be when she comes
  if (!since) return null;
  if (g > 1) return { mood: String(away.mood), strength: 1, since };         // she left again mid-recovery: it starts over when she is back
  return { mood: String(away.mood), strength: Math.round((1 - done / M) * 100) / 100, since };
}

// --- the open companion's state, through records (state/<key>.json) ---------------------------------------
// a sync copy { key: { value, unlocked } } for the 世界书 rule (loreWhen) and the context, read on load and after each change
core.stateView = {}; let stateRead = Promise.resolve();
function declared(){ return stateDecls(store.card, core.paramsFile ? core.paramsFile() : null); }
// `since` = the first time Modu saw this key declared for this companion (his first load with the card); the start
// record is written then, so min_days counts from it (days of a chat imported from elsewhere do not count).
// Settling (decay, gates that min_days now opens, a due drip) is written back, so it advances on a quiet card too.
const sameRec = (a, b) => a && b && a.value === b.value && JSON.stringify(a.unlocked) === JSON.stringify(b.unlocked) && JSON.stringify(a.queued || []) === JSON.stringify(b.queued || []) && (a.dripAt || 0) === (b.dripAt || 0);
async function settleKey(k, d, t){
  let r = null; try { r = await records.get(STATE_TYPE, stateId(k)); } catch {}
  const s = stateSettle(d, r || stateStart(d, t), t);
  if (!r || !sameRec(r, s)){
    s.rev = (r ? Number(r.rev) || 0 : 0) + 1;
    const w = await records.commit(STATE_TYPE, Object.assign(s, { id: stateId(k), key: k, at: r ? (r.at || t) : t }), { writer: 'core', app: 'state' });
    return w.ok ? w.record : (w.record || s);
  }
  return r;
}
async function readState(t){
  const ds = declared(), view = {}, ms = t == null ? now().getTime() : +t;
  for (const k of Object.keys(ds)){ let r; try { r = await settleKey(k, ds[k], ms); } catch(e){ console.error(e); r = stateStart(ds[k], ms); } view[k] = { value: r.value, unlocked: ids(r.unlocked), hidden: ds[k].hidden }; }
  core.stateView = view;
  return clone(view);
}
function refreshState(t){ const go = () => readState(t); stateRead = stateRead.then(go, go); return stateRead; }
listeners.add(ev => { if (ev === 'params' || ev === 'loaded') refreshState(); });
// the away effect for the open companion at t (default now): params away, else params bond.away, else a declared
// key's own away; her days from the chat. → { mood, strength, since, gap, day, how, never } | null (gap: the days she was gone
// before `since`; day = which day of her return this is (1 = the day she came back), how = the card's own words
// for that day when its away block has them (on_return.day1, day2 … , else on_return.after once they run out), never = its
// `never` list as one line ('' when the card gives none)
function awayNow(t){
  const p = core.paramsFile ? core.paramsFile() : null, ds = declared(), pa = core.param ? core.param('away', null) : null;
  const away = (pa && typeof pa === 'object' ? pa : null) || (p && p.bond && p.bond.away) || (Object.values(ds).find(d => d.away) || {}).away || null;
  if (!away) return null;
  const ms = t == null ? now().getTime() : +t, today = isoDay(new Date(ms));
  const days = [...new Set((store.msgs || []).filter(m => m && m.is_user).map(m => msgDate(m)).filter(d => d && d.getTime() <= ms).map(d => isoDay(d)))].sort();
  const e = awayEffect(away, days, today); if (!e) return null;
  const i = days.indexOf(e.since), before = i > 0 ? days[i - 1] : null;
  const day = Math.max(1, days.filter(d => d >= e.since).length + (days.includes(today) ? 0 : 1));
  const ret = away.on_return && typeof away.on_return === 'object' ? away.on_return : {}, word = v => typeof v === 'string' ? v.trim() : '';
  const how = word(ret['day' + day]) || (Object.keys(ret).some(k => /^day\d+$/.test(k)) ? word(ret.after) : '');
  const never = [].concat(away.never || ret.never || []).filter(x => typeof x === 'string' && x.trim()).join('；');
  return Object.assign(e, { gap: before ? daysBetween(new Date(before + 'T12:00'), new Date(e.since + 'T12:00')) : 0, day, how, never });
}
// the reply-tag rule for the open companion's declared keys ('' with none). The model learns each key's name and
// how far one turn may move it, never its value; hidden as ever: never named to her, never a number.
function stateRule(){
  // hidden (default true): he never names it or hints at it; hidden false: he may speak of it in his own words. Either way
  // no number: Modu shows none on screen and he never says one (no form, no bar for any card state)
  const ds = declared(), keys = Object.keys(ds); if (!keys.length) return '';
  const one = k => { const d = ds[k]; return `「${k}」 (in steps of ${d.step}${isFinite(d.turn_max) ? `, at most ${d.turn_max} in one reply` : ''})`; };
  const hid = keys.filter(k => ds[k].hidden), open = keys.filter(k => !ds[k].hidden);
  return `${store.name || 'You'} keeps ${keys.length > 1 ? 'some quiet measures' : 'a quiet measure'} of how things stand between you: ${keys.map(one).join(', ')}. When something in this exchange really moves one, add on its own line after your reply [state: ${keys[0]}+${ds[keys[0]].step} a few words why] (or −); at most one such line, and most replies need none. She never sees the tag or any number, and you never say a number.` +
    (hid.length ? ` Never name ${hid.map(k => `「${k}」`).join(', ')} or hint at ${hid.length > 1 ? 'them' : 'it'} in your words.` : '') +
    (open.length ? ` ${open.map(k => `「${k}」`).join(', ')} you may speak of in your own words when it fits.` : '');
}
// a [state: …] tag read against the declared keys, longest first (NFKC, any case), so a key holding a sign
// or a digit (stage-2) is never cut short; → { key, delta, why } | null (no declared key starts it: the plain parse stands)
function stateFromTag(raw){
  const s = String(raw == null ? '' : raw).normalize('NFKC').trim(), low = s.toLowerCase();
  for (const k of Object.keys(declared()).sort((a, b) => b.length - a.length)){
    const n = keyNorm(k); if (!low.startsWith(n)) continue;
    const m = s.slice(n.length).match(/^\s*([+\-−])\s*(\d+(?:\.\d+)?)\s*[,，:：]?\s*([\s\S]*)$/); if (!m) continue;
    const v = parseFloat(m[2]); if (!isFinite(v) || !v) continue;
    return { key: k, delta: /[\-−]/.test(m[1]) ? -v : v, why: m[3].trim().slice(0, 120) };
  }
  return null;
}
const state = {
  // → { key: decl } for the open companion (copies); {} for a card with no state
  declared(){ return clone(declared()); },
  // → { value, unlocked, hidden, rev } or null (an undeclared key)
  async get(key){
    const ds = declared(); key = keyIn(ds, key); const d = ds[key]; if (!d) return null;
    const t = now().getTime(); let r = null; try { r = await records.get(STATE_TYPE, stateId(key)); } catch {}
    r = stateSettle(d, r || stateStart(d, t), t);
    return { value: r.value, unlocked: r.unlocked.slice(), hidden: d.hidden, rev: r.rev || 0, tier: stateTier(d, r.value) };
  },
  // the only way a value moves: → { ok, value, applied, reason }. An undeclared key is refused (reason 'undeclared')
  // and nothing is written. o: { writer ('model' for a reply tag, an app's id, 'her'), turn (one change per turn) }
  async nudge(key, delta, why, o = {}){
    const ds = declared(); key = keyIn(ds, key) || String(key); const d = ds[key]; if (!d) return { ok: false, value: null, applied: 0, reason: 'undeclared' };
    await stateRead.catch(() => {});   // the start record (written on load) first, so the two never race
    const t = now().getTime(); let r = null; try { r = await records.get(STATE_TYPE, stateId(key)); } catch {}
    const res = stateApply(d, r || stateStart(d, t), delta, why, Object.assign({}, o, { at: t }));
    const opened = !r || !sameRec(r, res.rec) || res.carried;
    if (res.applied || opened){
      if (!res.applied) res.rec.rev = (Number(r.rev) || 0) + 1;
      const w = await records.commit(STATE_TYPE, Object.assign(res.rec, { id: stateId(key), key, at: t }), { writer: res.applied ? res.rec.writer : 'core', app: 'state' });
      if (!w.ok) return { ok: false, value: w.record ? w.record.value : res.rec.value, applied: 0, reason: 'clash' };
    }
    await refreshState();
    if (res.applied) emit('state', { key, value: res.rec.value, applied: res.applied });
    return { ok: !!res.applied, value: res.rec.value, applied: res.applied, reason: res.reason };
  },
  // sync, from the copy: is this 世界书 entry on? (an entry with no when is)
  // o: the time gates' { t, dates, lunar, term } (t defaults to now())
  when(entry, o){ return loreWhen(entry, core.stateView, Object.assign({ t: now().getTime() }, o)); },
  view(){ return clone(core.stateView); },
  refresh: () => refreshState(),
  // once a day (the scheduler's daily job), or any time: settle every declared key at t (default now) and write it
  // back: decay, min_days gates, the next drip. → the view { key: { value, unlocked, hidden } }
  settle: t => refreshState(t),
  // the day's next-layer hints for the open companion, from his card's 世界书 (lore books and character_book)
  undertow(day){
    const ds = declared(), card = store.card || {}, inCard = (card.extensions && card.extensions.modu && card.extensions.modu.lore) || [];
    // the 世界书 files beside his card count too (a book of the same name already in an older card, once)
    const names = new Set([].concat(inCard).map(b => String((b && b.name) || ''))), beside = core.folderData && Array.isArray(core.folderData.lore) ? core.folderData.lore.filter(b => b && !names.has(String(b.name || ''))) : [];
    const books = [].concat(card.character_book || [], inCard, beside);
    const entries = []; for (const b of books){ const e = b && b.entries; if (Array.isArray(e)) entries.push(...e); else if (e && typeof e === 'object') entries.push(...Object.values(e)); }
    return Object.keys(ds).map(k => undertowFor(ds[k], (core.stateView[k] || {}).value != null ? core.stateView[k].value : ds[k].start, entries, day || isoDay(now()))).filter(Boolean);
  },
  away: awayEffect,
  // the away effect now, for the open companion; the reply-tag rule; the record id of a key
  awayNow, rule: stateRule, id: stateId, fromTag: stateFromTag,
  // the pure engine, for hosts and tests
  engine: { decl: stateDecl, decls: stateDecls, start: stateStart, settle: stateSettle, apply: stateApply, when: loreWhen, undertow: undertowFor, away: awayEffect, tier: stateTier, problems: stateProblems, id: stateId },
};

Object.assign(core, { STATE_TYPE, stateDecls, stateProblems, stateApply, loreWhen, undertowFor, awayEffect, state, refreshState });
})(globalThis[Symbol.for('modu.core')]);
