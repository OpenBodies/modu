// 草稿 (drafts): what she has typed and not sent yet, kept per companion and per box, so leaving a
// page (or reloading it) never loses it; sending clears it. Like WeChat keeps a half-typed message per
// chat and a mail app keeps a draft. window.ModuDrafts (apps get it as ctx.drafts).
// Kept in this browser (localStorage 'modu-draft:<contact id>:<field>'); in the demo, which saves nothing,
// only for this tab (sessionStorage), so a reload still finds it.
(function(){
'use strict';
const PREFIX = 'modu-draft:';
const core = () => window.ModuCore || {};
let tabOnly = false;   // the page sets it for the demo
function box(){ try { return tabOnly ? window.sessionStorage : window.localStorage; } catch { return null; } }
function who(){ return core().currentId || 'nobody'; }
function key(field, id){ return PREFIX + (id || who()) + ':' + String(field); }
// → the draft of this box for the companion open now ('' when there is none)
function get(field){ try { return (box() && box().getItem(key(field))) || ''; } catch { return ''; } }
// keeps text (an empty or blank text removes the draft)
function set(field, text){
  const b = box(); if (!b) return;
  try { if (String(text || '').trim()) b.setItem(key(field), String(text)); else b.removeItem(key(field)); } catch {}
}
function clear(field){ set(field, ''); }
// bind(el, field): fills an empty box with its draft and keeps what she types. → a function that unbinds.
function bind(el, field){
  if (!el) return () => {};
  const d = get(field); if (d && !el.value) el.value = d;
  const on = () => set(field, el.value);
  el.addEventListener('input', on);
  return () => el.removeEventListener('input', on);
}
// every draft of one companion (when she deletes him)
function forget(id){
  for (const b of [window.localStorage, window.sessionStorage]) {
    try { for (const k of Object.keys(b)) if (k.startsWith(PREFIX + id + ':')) b.removeItem(k); } catch {}
  }
}
window.ModuDrafts = { version: '0.1', get, set, clear, bind, forget, key,
  get tabOnly(){ return tabOnly; }, set tabOnly(v){ tabOnly = !!v; } };
})();
