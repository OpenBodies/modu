// app/core/prompts.js: side-call prompts: the text of every side call lives in app/prompts/<name>.txt, never in code.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { hostFetch } = core;

// app/prompts/<name>.txt: leading lines that start with "# " are the header, never sent: `# <name> v<n>` (or
// `# version: <v>`) and `# vars: a, b` (the vars it reads); then the prompt. {{var}} is
// filled from vars ({{char}}, {{user}}, anything the caller passes); an unknown {{var}} stays as written.
// prompt(name, vars) fetches the file once (through the host's fetch, so it works in the page and headless) and
// keeps it; a missing file (or no fetch) falls back to the built-in text given with prompts.fallback(name, text),
// else ''. Never throws for a missing prompt.
const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const cache = new Map(), fallbacks = new Map();
// where app/prompts/ is: beside core.js in a page (its own script address), else 'prompts/'; a host or test sets it
let base = (() => {
  try {
    const s = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
    if (s) return new URL(/\/core\/[^/]+\.js(\?.*)?$/.test(s) ? '../prompts/' : 'prompts/', s).href;
  } catch {}
  return 'prompts/';
})();
function parsePrompt(text){
  const lines = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  let version = '', vars = [], i = 0;
  for (; i < lines.length && /^#(\s|$)/.test(lines[i]); i++){
    const h = lines[i].replace(/^#\s*/, ''); let m;
    if ((m = h.match(/^version\s*:\s*(.*)$/i))) version = m[1].trim();
    else if ((m = h.match(/^vars\s*:\s*(.*)$/i))) vars = m[1].split(/[,，\s]+/).filter(Boolean);
    else if (!version && (m = h.match(/^\S+\s+v(\S+)\s*$/))) version = m[1];
  }
  return { version, vars, text: lines.slice(i).join('\n').replace(/\s+$/, '') };
}
function fill(text, vars){ const v = vars || {}; return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (all, k) => Object.prototype.hasOwnProperty.call(v, k) && v[k] != null ? String(v[k]) : all); }
async function load(name){
  if (!NAME.test(String(name))) throw new Error(`提示「${name}」无法使用`);
  if (cache.has(name)) return cache.get(name);
  let p = null;
  try { const r = await hostFetch(base + name + '.txt'); if (r && r.ok) p = Object.assign(parsePrompt(await r.text()), { from: 'file' }); } catch {}
  if (!p) p = fallbacks.has(name) ? Object.assign(parsePrompt(fallbacks.get(name)), { from: 'fallback' }) : { version: '', vars: [], text: '', from: 'none' };
  if (p.from === 'file') cache.set(name, p);
  return p;
}
async function prompt(name, vars){ return fill((await load(name)).text, vars); }
const prompts = {
  base(url){ if (url != null){ base = String(url); if (base && !base.endsWith('/')) base += '/'; cache.clear(); } return base; },
  fallback(name, text){ if (!NAME.test(String(name))) throw new Error(`提示「${name}」无法使用`); fallbacks.set(name, String(text)); cache.delete(name); },
  // → { version, vars, text, from: 'file' | 'fallback' | 'none' }, unfilled
  info: load,
  parse: parsePrompt, fill,
  forget(){ cache.clear(); },
};

Object.assign(core, { prompt, prompts });
})(globalThis[Symbol.for('modu.core')]);
