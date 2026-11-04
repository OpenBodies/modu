// app/core/kernel.js: the event bus every part talks through (on / emit), the product defaults, small text helpers.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
//
// ModuCore, the core of Modu 小手机: all of the logic, so a UI can sit on top without holding any.
// Plain script, no build step: it defines window.ModuCore. Nothing here touches the DOM except the
// File System Access pickers the browser itself draws.
//
// Modules: Import (card PNG/JSON + 酒馆 chat JSONL) · Store (a folder the user owns; on phones, with no
// folder picker, a folder inside the browser's own storage) · Contacts (several companions) · Memory
// (Markdown + front matter, written in his voice) · Persona assembly · Brain link (OpenAI-style, the user's
// own key; the reply carries a closed-set emotion label) · Body seam (BroadcastChannel "modu-body" +
// optional device bridge).
(function(core){
'use strict';

// Product choices are settings, not code. The core alone is neutral: no pronoun is assumed for a
// card that is silent (they/them), memories are written in the language of the chat, and no words are
// banned. Modu's page sets its own choices at boot with setDefaults(MODU_DEFAULTS); another UI that adopts
// the core sets its own, or none. While the card says nothing, pronouns() reads the default. Only when a
// UI asks (writePronouns: true) does stageImport also write the default into a silent card: Modu does
// (so card.json says it too); the bare core never does.
const NEUTRAL_DEFAULTS = Object.freeze({ pronouns:'', memoryLanguage:'', bannedWords:[], writePronouns:false });
const MODU_DEFAULTS = Object.freeze({ pronouns:'he/him', memoryLanguage:'Simplified Chinese', bannedWords:Object.freeze(['陪伴', '接住', '温柔']), writePronouns:true });
core.defaults = Object.assign({}, NEUTRAL_DEFAULTS);
function setDefaults(d){
  const o = Object.assign({}, NEUTRAL_DEFAULTS, d || {});
  core.defaults = { pronouns: /^(he|she|they)\//i.test(o.pronouns || '') ? o.pronouns : '', memoryLanguage: String(o.memoryLanguage || ''),
               bannedWords: [].concat(o.bannedWords || []).map(String).map(s => s.trim()).filter(Boolean), writePronouns: o.writePronouns === true };
  emit('defaults', getDefaults());
  return getDefaults();
}
function getDefaults(){ return { pronouns: core.defaults.pronouns, memoryLanguage: core.defaults.memoryLanguage, bannedWords: core.defaults.bannedWords.slice(), writePronouns: core.defaults.writePronouns }; }
const listeners = new Set();
function emit(ev, data){ for (const f of listeners) { try { f(ev, data); } catch(e){ console.error(e); } } }

// --- The host: what the core needs from wherever it runs, passed in, never reached for ---
// The core reads nothing from the browser while it loads. A page gets the browser's own by default, each
// thing looked up when it is first used; a Node backend, a worker or a test passes its own with setEnv:
//   fetch(url, opts)  the brain link, the bundled samples, first run          default: the runtime's fetch
//   clock() → Date    "now" for presence, the prompt, records (as setClock)   default: new Date()
//   storage           this device's storage: get(table, key) / put(table, key, value) / del(table, keys) /
//                     keys(table), each a Promise; tables 'kv' (contacts, first run, his body model) and
//                     'vfs' (the in-browser folder)                         default: IndexedDB, else memory
//   prefs             where settings are remembered: getItem / setItem / removeItem   default: localStorage, else memory
//   channel           the body seam's in-browser channel: postMessage / addEventListener   default: BroadcastChannel 'modu-body', if any
//   socket(url)       a WebSocket to the device bridge                       default: new WebSocket(url)
//   thumb(url) → Promise<string>  a contact's small picture as a data URL   default: a canvas when there is a document, else ''
// null or undefined puts a thing back to its default. Returns what is in use ('host' or the default's kind).
const env = {};
const ENV_KEYS = ['fetch', 'clock', 'storage', 'prefs', 'channel', 'socket', 'thumb'];
function setEnv(patch){
  const p = patch || {};
  const unknown = Object.keys(p).filter(k => !ENV_KEYS.includes(k));
  if (unknown.length) throw new Error(`setEnv: unknown ${unknown.join(', ')} (it takes ${ENV_KEYS.join(', ')})`);
  for (const k of Object.keys(p)) { if (p[k] == null) delete env[k]; else env[k] = p[k]; }
  if ('clock' in p) core.setClock(env.clock);
  if ('channel' in p) core.openChannel(env.channel);
  return envInfo();
}
function envInfo(){
  const o = {}; for (const k of ENV_KEYS) o[k] = env[k] ? 'host' : 'default';
  if (!env.storage) o.storage = core.storage().kind;
  return o;
}
// fetch through the host's, else the runtime's own, looked up at the moment of the call (a page or a test may swap it)
function hostFetch(url, opts){ const f = env.fetch || globalThis.fetch; return f(url, opts); }

// ---------------------------------------------------------------------------------------------
// Store: the companion currently loaded. One at a time.
const store = { dir:null, name:'', card:null, cardSource:null, meta:{}, msgs:[], memory:[], writable:false,
                avatarURL:'', source:'', folderName:'', importedAt:0, seeded:false };
const clone = o => JSON.parse(JSON.stringify(o));
// Fill a list of strings into a budget, in order; returns the ones that fit.
function fit(items, budget, sep = 1){ const out = []; let n = 0; for (const s of items){ if (n + s.length + sep > budget) continue; out.push(s); n += s.length + sep; } return out; }
function clip(s, budget){ s = String(s || ''); return s.length <= budget ? s : s.slice(0, Math.max(0, budget - 1)) + '…'; }

Object.assign(core, { NEUTRAL_DEFAULTS, MODU_DEFAULTS, setDefaults, getDefaults, listeners, emit, store,
  clone, fit, clip, env, setEnv, hostFetch });
})(globalThis[Symbol.for('modu.core')] = globalThis[Symbol.for('modu.core')] || {});
