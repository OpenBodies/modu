// app/core/her-store.js: her phone: the user's own store beside his folders, the same record API, her backup.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { readText, VDir, RESERVED_TYPES, makeRecords, emit, store } = core;

// --- Her phone: the user's own store, beside his folders ---
// What is on HER phone (her 日历, her 清单, her own 朋友圈 posts) is hers, not any companion's: it lives here,
// once, whoever is open, and survives adding or switching companions. Same record API as `records`. Kept in
// this browser (the in-browser folder `modu-her`, beside `modu/<his name>`), or in memory for the visit when
// the core is ephemeral (the demo, tests). A companion never reads it: the core puts none of it in his prompt.
// He knows something of hers only through a knowledge path (shareWith, below).
const MY_ROOT = 'modu-her', MY_FORMAT = 'modu-her-store/0.1';
const myMem = new Map();
const mySide = () => ({ owner:'her', writable: !core.ephemeral, dir: new VDir(MY_ROOT), format: MY_FORMAT, mem: () => myMem, fill: man => { man.owner = 'her'; } });
const myRecords = makeRecords(mySide);
function myStoreInfo(){ return { owner:'her', where: core.ephemeral ? 'memory' : 'phone', format: MY_FORMAT }; }
// → Promise<{ path: text }>: her store as files (manifest.json, <type>/<id>.json), for the backup
async function myStoreFiles(){
  const out = {}, s = mySide(), man = { store: MY_FORMAT, owner:'her', records:{} };
  if (s.writable){
    const t = await readText(s.dir, 'manifest.json'); if (t) out['manifest.json'] = t;
    for (const type of await myRecords.types()){
      let d = null; try { d = await s.dir.getDirectoryHandle(type); } catch {}
      if (d) for await (const [n, h] of d.entries()) if (h.kind === 'file' && n.endsWith('.json')) out[type + '/' + n] = await (await h.getFile()).text();
    }
  } else {
    for (const [type, m] of myMem) if (m.size){ man.records[type] = { app: type, v: 1 }; for (const [id, r] of m) out[type + '/' + id + '.json'] = JSON.stringify(r, null, 2); }
  }
  if (Object.keys(out).length && !out['manifest.json']) out['manifest.json'] = JSON.stringify(man, null, 2);
  return out;
}
// { path: text } (as myStoreFiles gives) → Promise<{ added, kept }>. A record she already has (same type and
// id) is kept as it is on her phone now: a backup never writes over her phone.
async function restoreMyStore(files = {}){
  let man = {}; try { man = JSON.parse(files['manifest.json'] || '{}') || {}; } catch {}
  let added = 0, kept = 0, profileBack = false;
  for (const [p, text] of Object.entries(files || {})){
    const m = /^([a-z][a-z0-9-]{0,31})\/([A-Za-z0-9_-]{1,64})\.json$/.exec(p); if (!m || RESERVED_TYPES.includes(m[1])) continue;
    let r = null; try { r = JSON.parse(typeof text === 'string' ? text : new TextDecoder().decode(text)); } catch {}
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    if (await myRecords.get(m[1], m[2])) { kept++; continue; }
    await myRecords.put(m[1], Object.assign(r, { id: m[2] }), { app: man.records && man.records[m[1]] && man.records[m[1]].app });
    added++; if (p === PROFILE.join('/') + '.json') profileBack = true;
  }
  // her name, picture and pronoun from the backup apply at once, not after a reload (read through
  // tidyProfile like any other: a hostile picture in a backup is dropped)
  if (profileBack) await loadHerProfile();
  return { added, kept };
}

// --- Her own name, picture and pronoun: one record in her store, profile/me ---------------------------
// { name, avatar (a small picture, a data: address), pronouns ('she/her' | 'he/him' | 'they/them') }. Hers, on her phone,
// whoever is open (and in her backup with the rest of her store); never in his folder. Her name is the one his prompt
// uses for her (userName); her pronoun is the one he uses for her (context.js herPronouns). Read once at boot
// (loadHerProfile) and kept, so the prompt can read it at once; setHerProfile writes it and says so (event 'herprofile').
// A picture is only ever a plain base64 png / jpeg / webp / gif data: address, nothing that could close
// the url( ) or the style="…" it is put in (a restored backup is checked the same way)
const PROFILE = ['profile', 'me'], PRONOUN = /^(she\/her|he\/him|they\/them)$/, PICTURE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
let profile = { name:'', avatar:'', pronouns:'' };
const tidyProfile = r => ({ name: String((r && r.name) || '').replace(/\s+/g, ' ').trim().slice(0, 30),
  avatar: PICTURE.test(String((r && r.avatar) || '')) ? String(r.avatar) : '', pronouns: PRONOUN.test(String((r && r.pronouns) || '')) ? r.pronouns : '' });
function herProfile(){ return Object.assign({}, profile); }
async function loadHerProfile(){
  let r = null; try { r = await myRecords.get(...PROFILE); } catch {}
  profile = tidyProfile(r); emit('herprofile', herProfile()); return herProfile();
}
// patch: any of { name, avatar, pronouns }; '' clears one (her name goes back to the chat's own, his prompt to "the user")
async function setHerProfile(patch = {}){
  const next = tidyProfile(Object.assign({}, profile, patch || {}));
  await myRecords.put(PROFILE[0], Object.assign({ id: PROFILE[1] }, next), { app: 'profile' });
  profile = next; emit('herprofile', herProfile()); return herProfile();
}
// her name for his prompt: the one she gave here, else the one her imported chat had (user_name), else 'You'
function userName(){ return profile.name || (store.meta && store.meta.user_name) || 'You'; }

Object.assign(core, { myRecords, myStoreInfo, myStoreFiles, restoreMyStore, herProfile, loadHerProfile, setHerProfile, userName });
})(globalThis[Symbol.for('modu.core')]);
