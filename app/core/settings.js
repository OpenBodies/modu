// app/core/settings.js: settings: defaults, opt-in persistence (the key is kept only if she says so).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { env, CONTEXT_BUDGET } = core;

// --- Settings (opt-in persistence; the key is kept only if the user said so) --------------------
const SETTINGS_KEY = 'modu-settings';
// The local model server (a model proxy on her own PC), by where the page is
// opened: on the PC itself, 127.0.0.1:8787; shared privately over Tailscale (a *.ts.net name, or an
// address by number), port 8443 of the same address (app/README.md, "On her phone over Tailscale"); on a
// real hostname with one front door for page and model, /v1 on
// the page's own origin. The server wants its per-run token (settings.token).
function localModelAddress(loc){
  const h = String((loc && loc.hostname) || ''), proto = (loc && loc.protocol) || '';
  if (proto === 'file:' || /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(h)) return 'http://127.0.0.1:8787/v1';
  if (/\.ts\.net$/i.test(h) || /^[\d.]+$/.test(h) || h.startsWith('[')) return `https://${h}:8443/v1`;
  return `${proto}//${(loc && loc.host) || h}/v1`;
}
// With no page (a backend, a worker: no location), the PC's own address.
const LOCAL_MODEL = localModelAddress(typeof location !== 'undefined' && location ? location : { hostname:'127.0.0.1', protocol:'http:' });
// assembly 'modu' (the blocks) or 'none' (an agent brings its own persona and memory),
// contextBudget (characters for the whole prompt), userPersona (how she describes herself), timezone
// (hers, IANA; '' = this device's), modelNotes (her own per-model notes).
const DEFAULT_SETTINGS = { provider:'local', endpoint:LOCAL_MODEL, model:'claude-sonnet-5-5', key:'', token:'', window:40, bridge:'', remember:false,
  assembly:'modu', contextBudget: CONTEXT_BUDGET, userPersona:'', timezone:'', modelNotes:'',
  // the side model for the small calls (day sketch, decider, age-out, shelf): null = the chat model. Its key
  // is kept like the chat key (only when she says remember), on this device, never in his folder.
  side: null };
// where settings are remembered: the host's (setEnv prefs), else localStorage, else memory for the visit
const memPrefs = (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; })();
function prefs(){ if (env.prefs) return env.prefs; try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch {} return memPrefs; }
function loadSettings(){
  try { const s = JSON.parse(prefs().getItem(SETTINGS_KEY) || 'null'); if (s) { const o = Object.assign({}, DEFAULT_SETTINGS, s, { remember:true }); if (o.provider === 'local') o.endpoint = LOCAL_MODEL; return o; } } catch {}
  return Object.assign({}, DEFAULT_SETTINGS);
}
function saveSettings(s){
  try { if (s.remember) prefs().setItem(SETTINGS_KEY, JSON.stringify(s)); else prefs().removeItem(SETTINGS_KEY); } catch {}
}

// --- The side model, her 他找你 settings, 暂停, and one counter for every side call ------------------------------
// sideSettings(s?) → the settings a side call uses: her side model when she chose one ({ endpoint, model, key }),
// else the chat model's own.
// the page's settings as they are now (her key may be kept only for this visit): useSettings(fn) → fn() is read
let live = null;
function useSettings(fn){ live = typeof fn === 'function' ? fn : null; }
function currentSettings(){ try { const s = live && live(); if (s && typeof s === 'object') return Object.assign({}, s); } catch {} return loadSettings(); }
function sideSettings(s){
  s = s || currentSettings();
  const o = s.side && typeof s.side === 'object' && String(s.side.endpoint || '').trim() ? s.side : null;
  return o ? Object.assign({}, s, { provider:'custom', endpoint: String(o.endpoint).trim(), model: String(o.model || s.model || ''), key: String(o.key || ''), token:'' }) : Object.assign({}, s);
}
// 他找你 (设置): { v, on, cap?, quiet? ['HH:MM','HH:MM'], notices, paused, pausedAt? }. Not secret, so kept on this device
// always (prefs 'modu-reach'), apart from the settings. cap and quiet are kept only once she set them; until then
// his params' knobs (initiative.default_cap, initiative.quiet_hours) answer. Hers go to params.setHer, so they win
// over every knob and a knob can never raise her cap.
// The stored setting carries its format, v: 1; an older one has none (the same shape), so on open it is
// taken as v 1 and written back once with it. A later shape bumps v and grows a step here.
const REACH_KEY = 'modu-reach', REACH_V = 1, REACH_DEFAULTS = { v: 1, on: true, cap: 2, notices: false, paused: false };   // her cap is 2 until she sets it
function loadReach(){
  let r = null; try { r = JSON.parse(prefs().getItem(REACH_KEY) || 'null'); } catch { r = null; }
  if (!(r && typeof r === 'object' && !Array.isArray(r))) r = null;
  else if (r.v == null){ r.v = REACH_V; try { prefs().setItem(REACH_KEY, JSON.stringify(r)); } catch {} }   // the migration: none → 1
  return Object.assign({}, REACH_DEFAULTS, r || {});
}
function herKnobs(r){
  const o = {};
  // always passed (2 until she sets it), so a card's knob can lower it but never raise it (a CAPS knob)
  o['initiative.default_cap'] = Number.isFinite(Number(r.cap)) && r.cap !== null && r.cap !== '' ? Math.max(0, Math.floor(Number(r.cap))) : REACH_DEFAULTS.cap;
  if (Array.isArray(r.quiet) && r.quiet.length === 2) o['initiative.quiet_hours'] = r.quiet.map(String);
  if (r.on === false) o['initiative.default_cap'] = 0;
  return o;
}
function applyReach(r){
  const keep = {}, info = core.params.info();
  for (const k of info.her || []) if (k !== 'initiative.default_cap' && k !== 'initiative.quiet_hours') keep[k] = core.param(k);
  core.params.setHer(Object.assign(keep, herKnobs(r || loadReach())));
}
// saveReach(patch) → the whole setting. Turning 暂停 off is an absence: `reach` { op:'resume', from, to }
// goes out, the memory source is told, and the next catch-up is the capped one, as after any time away.
function saveReach(patch){
  const was = loadReach(), r = Object.assign({}, was, patch || {});
  const t = core.now().getTime();
  if (r.paused && !was.paused) r.pausedAt = t;
  if (!r.paused && was.paused){ const from = was.pausedAt || t; delete r.pausedAt; core.emit('reach', { op:'resume', from, to: t });
    if (core.memorySource) core.memorySource.tell({ kind:'absence', at: t, from, to: t, days: t - from >= 432e5 ? Math.max(1, core.calendarDays(from, t)) : 0, why:'paused' }); }   // counted in calendar days, as everywhere
  else if (r.paused !== was.paused) core.emit('reach', { op: r.paused ? 'pause' : 'resume', at: t });
  try { prefs().setItem(REACH_KEY, JSON.stringify(r)); } catch {}
  applyReach(r);
  core.emit('reach', { op:'settings', reach: Object.assign({}, r) });
  return r;
}
// 暂停: while on, no side call of any kind (sketch, decider, 主动, posts, reactions, shelf, tidy). His life and memory ask paused().
const paused = () => !!loadReach().paused;
// sideCall(name, messages, opts?) → the model's text: the one door for every call that is not her own chat turn
// (name: 'sketch', 'decider', 'reach', 'ageout', 'tidy', 'shelf', 'post', …). It goes to the side model (opts.chat:
// the chat model, for words in his own voice), is counted (calls.list / calls.count: what the cost meter and the
// tests read), and is refused while 暂停 is on (an Error with code 'paused', counted as refused, never sent).
// The cost meter (设置 → 用量): every model call is also kept in a small tally on this device
// (prefs 'modu-calls', never in his folder): per day, her chat turns and the other calls by name, with the characters
// sent and received; and the last 40 calls in brief (name, time, model, the address's host, how many messages and
// characters, the first words of the last message). Never a key, a token or a whole prompt. A call that is not
// a side call (her chat turn, an app's turn, 整理, reading the card) is noted with calls.note(name, messages, o).
const callLog = [];
const CALLS_KEY = 'modu-calls', CALLS_DAYS = 14, CALLS_SENT = 40;
function tally(){
  try { const o = JSON.parse(prefs().getItem(CALLS_KEY) || 'null'); if (o && o.v === 1 && o.days && typeof o.days === 'object') return Object.assign({ sent: [] }, o); } catch {}
  return { v: 1, days: {}, sent: [] };
}
const hostOf = u => { try { return new URL(String(u || '')).host; } catch { return ''; } };
const charsOf = messages => (messages || []).reduce((n, m) => n + String((m && m.content) || '').length, 0);
// what a call sent, in brief: no key, no token, no whole prompt
function brief(name, messages, o, at){
  const s = o.settings || {}, last = (messages || [])[(messages || []).length - 1];
  return { name, at, turn: !!o.turn, model: String(s.model || '').slice(0, 60), host: hostOf(s.endpoint), msgs: (messages || []).length, chars: charsOf(messages),
    first: String((last && last.content) || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
}
function keep(e, out){
  const t = tally(), d = core.isoDay(new Date(e.at)), day = t.days[d] || (t.days[d] = { chat: 0, side: 0, by: {}, in: 0, out: 0 });
  if (out != null){ day.out += out; }
  else {
    if (e.turn) day.chat++; else { day.side++; day.by[e.name] = (day.by[e.name] || 0) + 1; }
    day.in += e.chars; t.sent.push(e); if (t.sent.length > CALLS_SENT) t.sent.splice(0, t.sent.length - CALLS_SENT);
  }
  const keepFrom = core.isoDay(new Date(e.at - CALLS_DAYS * 864e5));
  for (const k of Object.keys(t.days)) if (k < keepFrom) delete t.days[k];
  try { prefs().setItem(CALLS_KEY, JSON.stringify(t)); } catch {}
}
// one call on its way: counted for this visit (calls.list) and in the tally; → a function that notes the answer's size
function counted(name, messages, o){
  const at = core.now().getTime(), e = brief(name, messages, o, at);
  callLog.push({ name, at, side: !o.chat && !o.turn, turn: !!o.turn }); if (callLog.length > 500) callLog.splice(0, callLog.length - 500);
  keep(e);
  return text => { keep(e, String(text == null ? '' : text).length); return text; };
}
const calls = {
  list(o = {}){ return callLog.filter(c => (!o.since || c.at >= o.since) && (!o.name || c.name === o.name)).map(c => Object.assign({}, c)); },
  count(o = {}){ return calls.list(o).filter(c => !c.refused).length; },
  clear(){ callLog.length = 0; },
  // calls.note(name, messages, { turn?, settings? }) → a function to hand the answer to (it notes its size): a call that
  // does not go through sideCall. turn: her own chat turn (聊天 in the meter); anything else counts with the side calls.
  note(name, messages, o = {}){ return counted(String(name || 'other'), messages, o); },
  // calls.days(n = 7) → [{ day: 'YYYY-MM-DD', chat, side, by: { name: n }, in, out }], newest first, the days that had any
  days(n = 7){ const t = tally(); return Object.keys(t.days).sort().reverse().slice(0, n).map(d => Object.assign({ day: d }, t.days[d], { by: Object.assign({}, t.days[d].by) })); },
  // calls.sent(n = 40) → the last calls in brief, newest first: { name, at, turn, model, host, msgs, chars, first }
  sent(n = CALLS_SENT){ return tally().sent.slice(-n).reverse(); },
  forget(){ try { prefs().removeItem(CALLS_KEY); } catch {} },
};
async function sideCall(name, messages, opts = {}){
  const at = core.now().getTime(), n = String(name || 'side');
  if (paused()){ callLog.push({ name: n, at, refused: true }); const e = new Error('暂停中'); e.code = 'paused'; throw e; }
  const base = opts.settings || currentSettings(), use = opts.chat ? base : sideSettings(base);
  const done = counted(n, messages, { chat: !!opts.chat, turn: !!opts.turn, settings: use });   // opts.turn: his reply to her (聊天 in 用量)
  core.emit('sidecall', { name: n, at });
  const call = (globalThis.ModuCore && typeof globalThis.ModuCore.callModel === 'function') ? globalThis.ModuCore.callModel : core.callModel;
  return Promise.resolve(call(use, messages, { max_tokens: Number(opts.max) || 400 })).then(done);
}
core.listeners.add(ev => { if (ev === 'loaded') { try { applyReach(); } catch {} } });

// The core API's version: one place, read only. It is the contract's version, not the build's
// (the build is <meta name="modu-version"> in index.html). Bump the minor number when the API grows.
const CORE_VERSION = '0.7';

Object.assign(core, { localModelAddress, DEFAULT_SETTINGS, loadSettings, saveSettings, CORE_VERSION, sideSettings, useSettings, currentSettings, loadReach, saveReach, applyReach, paused, sideCall, calls });
})(globalThis[Symbol.for('modu.core')]);
