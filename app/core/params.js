// app/core/params.js: per-character parameters: params.json beside his card, read through one call, param(name, fallback).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, readText, listeners } = core;

// Every 活人感 rule reads its knobs here and nowhere else. Three layers, the first that has the knob wins:
//   1. her settings (setHer): always win; for a knob in CAPS hers is a ceiling, so a knob can never raise her cap
//   2. his params.json (modu-character-params/0.1): written by the
//      calibration call at import, or by hand for a house character
//   3. Modu's defaults: DEFAULT_PARAMS below, the one place they live in code. It is the knob part of
//      the default params file, word for word
// then the caller's own fallback. A knob is a dotted path into the file: 'initiative.default_cap',
// 'clock.weekday.wake'. A new knob is one new name with a fallback; old files keep working.
const PARAMS_FORMAT = 'modu-character-params/0.1';
const DEFAULT_PARAMS = Object.freeze({"clock":{"chronotype":"normal","weekday":{"wake":"07:40","sleep":"23:50"},"weekend":{"wake":"09:00","sleep":"00:40"},"jitter_min":30,"late_night_chance":0.08,"late_night_until":"02:00","nap":{"chance":0.1,"from":"13:00","to":"14:00"}},"work":{"kind":"上班","blocks":[{"from":"09:30","to":"12:00","label":"在忙","place":"work","busy":0.7},{"from":"13:30","to":"18:00","label":"在忙","place":"work","busy":0.7}],"deadline":{"days_per_month":[1,3],"effect":{"busy":0.85,"reply_delay_x":2,"mood_shift":"tired","initiative_x":0.5}},"days_off_per_week":2},"replies":{"typing_chars_per_s":5,"first_delay_s":[5,90],"busy_delay_min":[10,60],"asleep":"defer_to_wake","read_no_reply":{"when_busy":0.1,"when_free":0,"max_per_day":1},"bubbles":[1,3],"length":"short"},"initiative":{"per_day":[0,2],"default_cap":2,"quiet_hours":["00:30","08:00"],"never_chase_twice":true,"after_silence_hours":36,"kinds":[{"id":"share","weight":4},{"id":"ask_her_day","weight":3},{"id":"invite","weight":1,"rules":"behaviour-rules.md §1"}]},"mood":{"baseline":"calm","moods":["calm","content","playful","tired","low"],"volatility":0.25,"low_days_per_month":[1,2],"lifts":["你主动来找"],"dips":["很累的一天"],"low_mood_behaviour":"话少一点，但会回"},"jealousy":{"level":0.5,"style":"teasing","triggers":["你亲昵地提到别人"],"response":["说出来，半开玩笑"],"never":["冷暴力","控制"],"cooldown_hours":12},"teasing":{"notes":"无"},"gifts":{"per_month":[0,2],"kinds":[{"id":"small","weight":1,"pool":["一杯奶茶","一张照片"]}]},"diary":{"voice":"第一人称，自然","length_chars":[150,350],"perspective":"first","must":["去了哪、做了什么","你出现过的时刻"],"quirks":[],"avoid":["重复前三天的开头和结尾"]},"day":{"slots_per_day":[6,9],"templates":[{"id":"workday","weight":5,"shape":["起床","通勤","上班","午饭","上班","回家","晚饭","放松"]},{"id":"dayoff","weight":2,"shape":["睡懒觉","出门逛","吃饭","在家"]}],"weekly":{},"seasonal":[]},"places":[{"id":"home","name":"家里","kind":"home","weight":5},{"id":"work","name":"工作的地方","kind":"work","weight":5},{"id":"shop","name":"楼下便利店","kind":"errand","weight":1},{"id":"street","name":"街上","kind":"inspiration","weight":1}],"tastes":[],"peek":{"contacts_file":null,"notes_style":"待办和随手记","search_style":"日常"},"friends_reach_out":{"per_day":[0,2]}});
// knobs where her setting is a ceiling (a number, or each end of a [lo, hi] range), never raised by a knob
const CAPS = ['initiative.default_cap', 'initiative.per_day'];
let file = null, her = {};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const path = (o, name) => { let v = o; for (const k of String(name).split('.')) { if (v == null || typeof v !== 'object' || !has(v, k)) return undefined; v = v[k]; } return v; };
// the file's own value: a file's `knobs` object first, then the schema's top-level groups
function fromFile(name){ if (!file) return undefined; const k = file.knobs && typeof file.knobs === 'object' ? path(file.knobs, name) : undefined; return k !== undefined ? k : path(file, name); }
function capped(mine, knob){
  if (typeof mine === 'number' && typeof knob === 'number') return Math.min(mine, knob);
  if (typeof mine === 'number' && Array.isArray(knob)) return knob.map(x => typeof x === 'number' ? Math.min(x, mine) : x);
  if (Array.isArray(mine) && Array.isArray(knob)) return knob.map((x, i) => typeof x === 'number' && typeof mine[i] === 'number' ? Math.min(x, mine[i]) : x);
  return mine;
}
const copy = v => v === undefined ? undefined : clone(v);
// → the knob's value (a copy), from her settings, his params, Modu's defaults, or `fallback`
function param(name, fallback){
  const p = fromFile(name), knob = p !== undefined ? p : path(DEFAULT_PARAMS, name);
  if (has(her, name)) return copy(CAPS.includes(name) && knob !== undefined ? capped(her[name], knob) : her[name]);
  return knob !== undefined ? copy(knob) : fallback;
}
// which layer answered: 'her' | 'params' | 'default' | 'fallback'
function paramSource(name){
  if (has(her, name)) return 'her';
  return fromFile(name) !== undefined ? 'params' : path(DEFAULT_PARAMS, name) !== undefined ? 'default' : 'fallback';
}
// A file that is not an object (broken JSON, a list) is no file: defaults, and no error shown to her.
function useParams(o){ file = o && typeof o === 'object' && !Array.isArray(o) ? clone(o) : null; emit('params', paramsInfo()); return paramsInfo(); }
// her settings as knob names → values, e.g. { 'initiative.default_cap': 1 }; the page passes them (设置 → 他找你)
function setHer(map){ her = map && typeof map === 'object' && !Array.isArray(map) ? clone(map) : {}; emit('params', paramsInfo()); return paramsInfo(); }
// the header, in both shapes ({ writer, made_at, card_hash } at the top, or the schema's { character, calibration })
function paramsInfo(){
  if (!file) return { loaded: false, format: PARAMS_FORMAT, writer: 'default', made_at: null, card_hash: null, rev: 0, her: Object.keys(her) };
  const cal = file.calibration && typeof file.calibration === 'object' ? file.calibration : {};
  return { loaded: true, format: file.format || PARAMS_FORMAT, writer: file.writer || 'hand', made_at: file.made_at || cal.at || null,
    card_hash: file.card_hash || (file.character && file.character.card_hash) || cal.card_hash || null, rev: Number(file.rev) || 0, her: Object.keys(her) };
}
// the whole file as read (a copy), or null: for the card-state engine (params.state, params.bond) and his pronoun
function paramsFile(){ return file ? clone(file) : null; }
// his folder's params.json, read again on each load; a companion with none (or in demo) gets the defaults.
// Her own params added beside a card that brought its own are params.her.json (the author's file is never written over),
// and hers is read first
// The folder is the one open when the read began, and only the newest read is kept (two loads close together
// never leave the older companion's file in force)
let reading = 0;
async function readParams(){
  const mine = ++reading, dir = store.writable ? store.dir : null;
  let o = null;
  if (dir){ for (const f of ['params.her.json', 'params.json']){ try { o = JSON.parse(await readText(dir, f) || 'null'); } catch { o = null; } if (o) break; } }
  else o = store.params || null;   // a staged import may carry one (a card folder)
  if (mine === reading) useParams(o);
}
core.paramsRead = Promise.resolve();
// On a load the previous companion's file is let go at once, so param() never answers with his knobs while
// the new folder is read (Modu's defaults until then)
listeners.add(ev => { if (ev === 'loaded'){ file = null; core.paramsRead = readParams(); } });

const params = { get: paramsFile, info: paramsInfo, use: useParams, setHer, source: paramSource, read: readParams, CAPS: CAPS.slice(), DEFAULTS: DEFAULT_PARAMS, FORMAT: PARAMS_FORMAT };
Object.assign(core, { PARAMS_FORMAT, DEFAULT_PARAMS, param, params, paramsFile });
})(globalThis[Symbol.for('modu.core')]);
