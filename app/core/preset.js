// app/core/preset.js: presets: her SillyTavern preset read as text blocks in her order, and Modu's own defaults (app/defaults/: preset, 世界书, regex) that fill a layer the card does not bring.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store, hostFetch, listeners, clone } = core;

// --- Modu's defaults: app/defaults/preset.json, lorebook.json, regex.json ----------------------------------
// Read once through the host's fetch (the page and a headless host alike) from `defaults/` beside core.js; until
// they arrive (or where they cannot be read) the layer is simply empty. A host or a test sets the folder with
// moduDefaults.base(url). The prompt is built synchronously, so the files are read when a companion loads.
const DEFAULT_FILES = { preset: 'preset.json', lore: 'lorebook.json', regex: 'regex.json' };
let dBase = (() => {
  try {
    const s = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
    if (s) return new URL(/\/core\/[^/]+\.js(\?.*)?$/.test(s) ? '../defaults/' : 'defaults/', s).href;
  } catch {}
  return 'defaults/';
})();
const dflt = { preset: null, lore: null, regex: null }; let dRead = null;
function readDefaults(){
  if (dRead) return dRead;
  dRead = (async () => {
    for (const [k, f] of Object.entries(DEFAULT_FILES)){
      try { const r = await hostFetch(dBase + f); if (r && r.ok) dflt[k] = JSON.parse(await r.text()); } catch { dflt[k] = null; }
    }
  })();
  return dRead;
}
listeners.add(ev => { if (ev === 'loaded') core.defaultsRead = readDefaults(); });
core.defaultsRead = Promise.resolve();
const moduDefaults = {
  base(url){ if (url != null){ dBase = String(url); if (dBase && !dBase.endsWith('/')) dBase += '/'; dRead = null; dflt.preset = dflt.lore = dflt.regex = null; } return dBase; },
  read(){ core.defaultsRead = readDefaults(); return core.defaultsRead; },
  // → { preset, lore, regex } as read (copies; null where missing)
  get(){ return clone(dflt); },
  raw: dflt,
};

// --- A SillyTavern preset (chat completion): its text blocks in her order --------------------------------------
// prompts: [{ identifier, name, role, content, system_prompt?, marker?, enabled? }]; prompt_order: [{ character_id,
// order: [{ identifier, enabled }] }] (the global order is character_id 100001; else the longest). A marker (chat
// history, the card's fields, 世界书 placement) has no text of its own: Modu fills those places itself. Blocks after the
// chat-history marker are hers to come after the chat. Sampling (temperature, top_p, …) is never applied: it is kept
// as suggestions only (her model settings decide). A block may carry `modu_when`, the name of a chat signal (chatSignals,
// context.js): it then goes in only on the turns that signal is up, so a habit's words live in the preset, swappable with it.
// → { name, blocks: [{ id, name, role, text, on, after, when? }], sampling, markers } or null for something that is not a preset.
const SAMPLING = ['temperature', 'top_p', 'top_k', 'top_a', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'openai_max_tokens', 'openai_max_context', 'max_tokens', 'seed'];
function parsePreset(j){
  if (!j || typeof j !== 'object' || !Array.isArray(j.prompts)) return null;
  const byId = new Map(j.prompts.filter(p => p && p.identifier).map(p => [String(p.identifier), p]));
  const orders = [].concat(j.prompt_order || []).filter(o => o && Array.isArray(o.order));
  const ord = orders.find(o => Number(o.character_id) === 100001) || orders.sort((a, b) => b.order.length - a.order.length)[0];
  const seq = ord ? ord.order.map(o => ({ id: String(o.identifier), on: o.enabled !== false })) : j.prompts.filter(p => p && p.identifier).map(p => ({ id: String(p.identifier), on: p.enabled !== false }));
  const blocks = [], markers = []; let after = false;
  for (const s of seq){
    const p = byId.get(s.id); if (!p) continue;
    if (s.id === 'chatHistory'){ after = true; markers.push(s.id); continue; }
    const text = typeof p.content === 'string' ? p.content.trim() : '';
    if (p.marker || !text){ markers.push(s.id); continue; }
    blocks.push(Object.assign({ id: s.id, name: String(p.name || s.id), role: p.role === 'user' || p.role === 'assistant' ? p.role : 'system', text, on: s.on && p.enabled !== false, after }, p.modu_when ? { when: String(p.modu_when) } : {}));
  }
  const sampling = {}; for (const k of SAMPLING) if (j[k] != null && typeof j[k] !== 'object') sampling[k] = j[k];
  return { name: String(j.name || j.preset_name || ''), blocks, sampling, markers };
}
// The preset layer for the open companion: a preset beside the card in the folder she brought (card-folder), the
// card's own (extensions.modu.preset, hers), else Modu's default. → { source, name, preset, mine } (preset null until read)
// `mine` is true only for a preset she added herself later (搬家, addBesideCard: card_folder.preset.by 'her').
// Only that one has switches (presetSwitch), kept as her record preset/switches.json = { blocks: { id: on } }; a card's own
// preset (in its folder or inside the card) is the card's settings: never switched, and 设置 does not list its blocks.
const switches = { key: '', blocks: {} };
async function readSwitches(){
  const key = core.cardKey ? core.cardKey() : '';
  let r = null; try { r = await core.records.get('preset', 'switches'); } catch {}
  switches.key = key; switches.blocks = r && r.blocks && typeof r.blocks === 'object' ? Object.assign({}, r.blocks) : {};
}
listeners.add(ev => { if (ev === 'loaded') core.switchesRead = readSwitches().catch(() => {}); });
core.switchesRead = Promise.resolve();
function presetLayer(){
  const f = core.folderData || null, cf = store.cardFolder && store.cardFolder.preset;
  if (f && f.preset){
    const mine = !!(cf && cf.by === 'her'), on = mine && core.cardKey && switches.key === core.cardKey() ? switches.blocks : {};
    const preset = mine ? Object.assign({}, f.preset, { blocks: f.preset.blocks.map(b => b.id in on ? Object.assign({}, b, { on: !!on[b.id] }) : b) }) : f.preset;
    return { source: 'card-folder', name: (cf && cf.name) || f.preset.name || 'preset', preset, mine };
  }
  const own = store.card && store.card.extensions && store.card.extensions.modu && parsePreset(store.card.extensions.modu.preset);
  if (own) return { source: 'hers', name: own.name || 'preset', preset: own, mine: false };
  const d = parsePreset(dflt.preset);
  return { source: 'default', name: 'Modu default', preset: d, mine: false };
}
// one block of her own preset on or off → true; false for anything else (a card's preset, Modu's, a block it lacks)
async function presetSwitch(id, on){
  const P = presetLayer(); id = String(id);
  if (!P.mine || !P.preset || !P.preset.blocks.some(b => b.id === id)) return false;
  const key = core.cardKey ? core.cardKey() : '';
  if (switches.key !== key) { switches.key = key; switches.blocks = {}; }
  switches.blocks = Object.assign({}, switches.blocks, { [id]: !!on });
  await core.records.commit('preset', { id: 'switches', blocks: switches.blocks, at: core.now().getTime() }, { writer: 'her', app: 'preset' });
  return true;
}

Object.assign(core, { moduDefaults, parsePreset, presetLayer, presetSwitch, readDefaults });
})(globalThis[Symbol.for('modu.core')]);
