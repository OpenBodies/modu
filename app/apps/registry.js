// Modu app modules: the registry. Plain script, no build step: it defines
// window.ModuApps. Each page-2 app lives in its own folder, apps/<id>/, and registers itself here; the
// page draws its tile and gives it a screen. Apps reach the core only through window.ModuCore.
// Loaded by index.html after core.js. The list of apps to load is apps/index.json.
(function(){
'use strict';

const apps = new Map(), order = [], unmounts = new Map(), listeners = new Set();
const base = (document.currentScript && document.currentScript.src || location.href).replace(/[^/]*$/, '');
function emit(ev, data){ for (const f of listeners) { try { f(ev, data); } catch(e){ console.error(e); } } }

// icons: { 'i-diary': '<path …/>' } → <symbol id="i-diary" viewBox="0 0 24 24"> in a sprite of its own
function addIcons(icons){
  if (!icons) return;
  let sprite = document.getElementById('modu-app-icons');
  if (!sprite){
    sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sprite.id = 'modu-app-icons'; sprite.setAttribute('aria-hidden', 'true'); sprite.style.display = 'none';
    document.body.appendChild(sprite);
  }
  for (const [id, body] of Object.entries(icons)){
    if (document.getElementById(id)) continue;   // the page's own icon wins
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    s.id = id; s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = body; sprite.appendChild(s);
  }
}

// writes: { records: [his folder's types], mine: [her phone's types], events: { kind: label }, chat:
// 'none' | 'summary' | 'cards' }. Missing parts come from records / myRecords, {} and 'none'. declared: the app
// said it itself (a static check holds every listed app to it).
const CHAT_WRITES = ['none', 'summary', 'cards'];
function writesOf(a){
  const w = a.writes && typeof a.writes === 'object' ? a.writes : {};
  const types = x => (Array.isArray(x) ? x : []).filter(t => typeof t === 'string');
  const ev = w.events && typeof w.events === 'object' && !Array.isArray(w.events) ? w.events : {};
  return { records: types(w.records || a.records), mine: types(w.mine || a.myRecords),
    events: Object.fromEntries(Object.entries(ev).filter(([k, v]) => k && typeof v === 'string')),
    chat: CHAT_WRITES.includes(w.chat) ? w.chat : 'none', declared: !!a.writes };
}
function register(app){
  const bad = !app || typeof app.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(app.id) ? 'id (lowercase ASCII)'
    : typeof app.mount !== 'function' ? 'mount' : apps.has(app.id) ? 'a new id (this one is taken)' : '';
  if (bad){ console.error(`ModuApps.register: refused, needs ${bad}`, app); return false; }
  const a = Object.assign({ version:'0.1', icon:'i-dots', title:'app.' + app.id, page:2, status:'building', records:[] }, app);
  // who it is for, how it shows, what it writes; an unknown value is the default
  a.scope = a.scope === 'contact' ? 'contact' : 'phone';
  a.surface = a.surface === 'session' ? 'session' : 'screen';
  a.contactActions = (Array.isArray(a.contactActions) ? a.contactActions : []).filter(x => x && typeof x.id === 'string' && x.id);
  a.writes = writesOf(a);
  addIcons(a.icons);
  apps.set(a.id, a); if (!order.includes(a.id)) order.push(a.id);
  emit('apps', list());
  return true;
}
// An app held back for this build. It registered as ready, but while held it is 'building' to everyone
// who reads it (the page draws its 开发中 tile and no screen; no ＋ action, no ··· entry, no invite from him, not on his
// phone, no watch); hold(id, false) gives it back the status it registered with (the developer switch). → true if it changed.
const held = new Map();   // id → the status it registered with
function hold(id, on = true){
  const a = apps.get(id); if (!a) return false;
  if (on && !held.has(id)){ held.set(id, a.status); a.status = 'building'; a.held = true; }
  else if (!on && held.has(id)){ a.status = held.get(id); held.delete(id); delete a.held; }
  else return false;
  emit('apps', list());
  return true;
}
function list(page){ return order.filter(id => apps.has(id)).map(id => apps.get(id)).filter(a => page === undefined || a.page === page); }
function get(id){ return apps.get(id) || null; }
function open(id, el, ctx){
  const a = apps.get(id); if (!a) return false;
  close(id);
  try { const u = a.mount(el, ctx); if (typeof u === 'function') unmounts.set(id, u); }
  catch(e){ console.error(`app ${id}:`, e); return false; }
  return true;
}
function close(id){ const u = unmounts.get(id); unmounts.delete(id); if (u) { try { u(); } catch(e){ console.error(`app ${id}:`, e); } } }

// a draft build names its commit, so a browser never pairs a new page with old apps
const build = document.querySelector('meta[name="modu-build"]');
const fresh = build ? `?v=${encodeURIComponent(build.content)}` : '';
// Load apps/index.json, then each app's app.js (and app.css if it says so). A missing or broken app is
// skipped; the rest still load.
function load(){
  return fetch(base + 'index.json', { cache:'no-cache' }).then(r => r.ok ? r.json() : []).catch(() => []).then(ids => {
    ids = Array.isArray(ids) ? ids.filter(x => typeof x === 'string') : [];
    for (const id of ids) if (!order.includes(id)) order.push(id);
    return Promise.all(ids.map(id => new Promise(res => {
      const s = document.createElement('script'); s.src = `${base}${id}/app.js${fresh}`;
      s.onload = () => { const a = apps.get(id); if (a && a.css){ const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `${base}${id}/app.css${fresh}`; document.head.appendChild(l); } res(); };
      s.onerror = () => { console.error(`app ${id}: apps/${id}/app.js did not load`); res(); };
      document.head.appendChild(s);
    })));
  }).then(() => list());
}

window.ModuApps = {
  version: '0.1', register, list, get, open, close, hold,
  on(f){ listeners.add(f); return () => listeners.delete(f); },
  ready: load(),
};
})();
