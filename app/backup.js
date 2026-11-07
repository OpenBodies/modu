// Modu backup: his whole folder as one .zip file, and back.
// Plain script, no build step, no library: it defines window.ModuBackup. Loaded after core.js.
//
// Why a .zip: it is one file a phone can save (下载 / 文件 app) and pick again, and on a computer it
// unzips into his folder as it is (card.json, chat.jsonl, memory/…), which 打开已有的文件夹 then reads.
// Written "stored" (no compression; his files are small text), read stored or deflated (a zip made
// again by Windows or macOS), so it needs nothing outside the browser.
//
// What goes in: every file in his folder (card, chat, memory, avatar, manifest, records <type>/…, including the
// day, job, state and facts records, params.json and pronouns.json; a demo companion's too),
// under one top folder named after him. What never goes in: keys and settings. Those live only in this
// browser (localStorage `modu-settings`), never in his folder; the export also
// refuses any file in the folder whose name looks like settings or a key, in case one was put there.
//
// Her phone: her own store (her 日历, her 清单, her own 朋友圈 posts) is not in
// his folder, so the zip carries it beside his, under its own top folder `my-phone/` (its manifest says
// owner: her). Importing restores what her phone does not have yet, and never writes over what it has.
(function(){
'use strict';

// --- CRC-32 (the zip checksum) ---------------------------------------------------------------
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
function crc32(b){ let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

const enc = new TextEncoder(), dec = new TextDecoder();
const bytes = v => v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : enc.encode(String(v));

// Files that never leave the browser, wherever they sit in the folder.
const NEVER = /(^|\/)(modu-settings[^/]*|settings(\.[^/]*)?|[^/]*\.key|keys?\.json|secrets?(\.[^/]*)?|\.env[^/]*)$/i;
// Litter some systems add to a folder or a zip (and the note a save in progress keeps in his folder).
const SAVING = '.modu-saving.json';
const LITTER = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX\/.*|\.modu-saving\.json)$/i;
function allowed(path){ return !NEVER.test(path) && !LITTER.test(path); }

// --- write a zip -----------------------------------------------------------------------------
// files: { 'path/in/zip': Uint8Array | ArrayBuffer | string } → Blob (application/zip)
function zip(files){
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = []; let off = 0;
  for (const [path, v] of Object.entries(files)){
    const name = enc.encode(path), data = bytes(v), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);   // UTF-8 names
    h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0), count = Object.keys(files).length;
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true);
  e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type:'application/zip' });
}

// --- read a zip ------------------------------------------------------------------------------
async function inflate(data){
  if (typeof DecompressionStream !== 'function') throw new Error('这个浏览器打不开压缩过的 zip');
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}
// Blob | ArrayBuffer → { path: Uint8Array } (folders and litter left out). Every file's CRC is checked (a zip
// cut short or changed on the way is refused, never restored with lines missing: err.code 'zip-broken'), and a path
// written with \ (Windows PowerShell's Compress-Archive) is read as /.
const broken = () => Object.assign(new Error('备份文件坏了（可能没有下载完整），请重新导出一份'), { code: 'zip-broken' });
async function unzip(src){
  try { return await unzipped(src); } catch(e){ throw e instanceof RangeError ? broken() : e; }
}
async function unzipped(src){
  const buf = new Uint8Array(src instanceof Blob ? await src.arrayBuffer() : src), v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('不是 zip 文件');
  const count = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true);
  const out = {};
  for (let k = 0; k < count; k++){
    if (v.getUint32(p, true) !== 0x02014b50) throw broken();
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), loc = v.getUint32(p + 42, true);
    const crc = v.getUint32(p + 16, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');   // UTF-8 (ours sets the flag; others are read the same)
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || !allowed(name)) continue;
    if (loc + 30 > buf.length || v.getUint32(loc, true) !== 0x04034b50) throw broken();
    const start = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true), raw = buf.subarray(start, start + csize);
    if (start + csize > buf.length) throw broken();
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) { try { data = await inflate(raw); } catch(e){ if (e.code) throw e; throw broken(); } }
    else throw new Error('zip 的压缩方式不支持');
    if (crc32(data) !== crc) throw broken();
    out[name] = data;
  }
  return out;
}

// --- his folder → files ----------------------------------------------------------------------
async function walk(dir, pre, out){
  for await (const [n, h] of dir.entries()){
    const path = pre + n;
    if (h.kind === 'directory') await walk(h, path + '/', out);
    else if (allowed(path)) out[path] = new Uint8Array(await (await h.getFile()).arrayBuffer());
  }
  return out;
}
// a name that is a safe folder and file name everywhere (the core's folderName, the same rule)
function safeName(s){
  let n = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  n = Array.from(n).slice(0, 60).join('').replace(/[\s.]+$/, '') || 'companion';
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(n) ? '_' + n : n;
}
function day(){ const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; }

// The loaded companion's folder as files. A demo companion (no folder) is built from what is loaded.
async function folderFiles(core){
  const S = core.store;
  if (!S.name) throw new Error('还没有打开角色');
  if (S.dir) return walk(S.dir, '', {});
  const files = core.buildStoreFiles({ name:S.name, card:S.card, cardSource:S.cardSource, meta:S.meta, msgs:S.msgs, memory:S.memory, source:S.source });
  const out = {}; for (const [p, c] of Object.entries(files)) if (allowed(p)) out[p] = enc.encode(c);
  // what a demo companion keeps beside the card goes too, as a folder would hold it: every record
  // (day, job, state, facts, … one file each under <type>/), his params and his pronoun note
  if (core.records){
    try { for (const t of await core.records.types()) for (const r of await core.records.list(t)) if (r && r.id && allowed(`${t}/${r.id}.json`)) out[`${t}/${r.id}.json`] = enc.encode(JSON.stringify(r, null, 2)); }
    catch(e){ console.error(e); }
  }
  { const pm = core.params && core.params.get && core.params.get(); if (pm) out['params.json'] = enc.encode(JSON.stringify(pm, null, 2)); }
  if (S.pronounNote) out['pronouns.json'] = enc.encode(JSON.stringify(S.pronounNote, null, 2));
  if (S.avatarURL) { try { out['avatar.png'] = new Uint8Array(await (await fetch(S.avatarURL)).arrayBuffer()); } catch {} }
  return out;
}
// → { blob, filename, paths, mine }. His files sit under one folder named after him (`paths`); her phone's
// under `my-phone/` beside it (`mine`, its paths; none when her phone holds nothing, or opts.mine === false).
const MINE = 'my-phone';
async function exportCompanion(core = window.ModuCore, opts = {}){
  const files = await folderFiles(core), top = safeName(core.store.folderName || core.store.name);
  const inZip = {}; for (const [p, b] of Object.entries(files)) inZip[top + '/' + p] = b;
  let mine = {};
  if (opts.mine !== false && core.myStoreFiles && top !== MINE) { try { mine = (await core.myStoreFiles()) || {}; } catch(e){ console.error(e); mine = {}; } }
  for (const [p, t] of Object.entries(mine)) if (allowed(p)) inZip[MINE + '/' + p] = t;
  return { blob: zip(inZip), filename: `${top}-modu-${day()}.zip`, paths: Object.keys(files), mine: Object.keys(mine).filter(allowed) };
}
// Take her phone's top folder out of a zip's files: the one whose manifest.json says owner: her.
function takeMine(files){
  const tops = new Set(Object.keys(files).map(p => p.split('/')[0]));
  for (const t of tops){
    let man = null; try { man = JSON.parse(dec.decode(files[t + '/manifest.json'])); } catch {}
    if (!man || man.owner !== 'her' || tops.size < 2) continue;
    const mine = {};
    for (const p of Object.keys(files)) if (p.startsWith(t + '/')) { mine[p.slice(t.length + 1)] = dec.decode(files[p]); delete files[p]; }
    return mine;
  }
  return null;
}

// --- files → a folder ------------------------------------------------------------------------
// a zip of the folder around ours (two levels deep): drop top folders while every file sits in the same one and
// his card.json / chat.jsonl is not right inside it.
function unwrap(files){
  for (;;){
    const ps = Object.keys(files); if (!ps.length) return files;
    const top = ps[0].split('/')[0];
    if (!ps.every(p => p.startsWith(top + '/') && p.length > top.length + 1) || ps.includes(top + '/card.json') || ps.includes(top + '/chat.jsonl')) return files;
    const out = {}; for (const p of ps) out[p.slice(top.length + 1)] = files[p];
    files = out;
  }
}
// Drop the one top folder a zip of a folder has (ours, or one made by hand), if every file is in it.
function strip(files){
  const ps = Object.keys(files); if (!ps.length) return files;
  const top = ps[0].split('/')[0];
  if (!ps.every(p => p.startsWith(top + '/'))) return files;
  const out = {}; for (const p of ps) out[p.slice(top.length + 1)] = files[p];
  out[''] = top; return out;
}
async function exists(root, n){ try { await root.getDirectoryHandle(n); return true; } catch { return false; } }
async function write(dir, path, data){
  const parts = path.split('/'); let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create:true });
  const w = await (await d.getFileHandle(parts[parts.length - 1], { create:true })).createWritable(); await w.write(data); await w.close();
}
// zip → { all: his files, mine: her phone's or null, name } (refused with no card and no chat)
async function open(src){
  const files = unwrap(await unzip(src)), mine = takeMine(files);
  const all = strip(files), top = all['']; delete all[''];
  if (!all['card.json'] && !all['chat.jsonl']) throw Object.assign(new Error('这个文件里没有角色'), { code: 'no-companion' });
  let name = top;
  try { name = JSON.parse(dec.decode(all['card.json'])).data.name || name; } catch {}
  if (!name) { try { name = JSON.parse(dec.decode(all['manifest.json'])).name; } catch {} }
  return { all, mine, name: name || '' };
}
// the same save rules as the core's saveImport: one save at a time across her tabs, his
// files in one write in the in-browser folder (all or nothing), else the note says 'saving' first and 'saved' last, so a
// closed tab never leaves a hidden or half companion; a failed write takes the new folder away again.
function lock(fn){ const L = typeof navigator !== 'undefined' && navigator.locks; return L && L.request ? L.request('modu-save', fn) : fn(); }
async function noteOf(dir){ try { const t = await (await (await dir.getFileHandle(SAVING)).getFile()).text(); try { return JSON.parse(t) || { state:'saving' }; } catch { return { state:'saving' }; } } catch { return null; } }
async function writeHim(root, n, all, core){
  const at = () => core && core.now ? core.now().getTime() : Date.now();
  const note = state => enc.encode(JSON.stringify({ v: 1, writer: 'modu', state, at: at() }));
  let one = null;
  try { one = root.writeFolder ? await root.writeFolder(n, Object.assign({ [SAVING]: note('saved') }, all), { saving: { file: SAVING, text: note('saving') } }) : null; }
  catch(e){ if (plainWrite(e).code === 'storage-full') throw e; console.error('one write refused, file by file:', e); try { await root.removeEntry(n, { recursive:true }); } catch {} }
  if (one) return one;
  const dir = await root.getDirectoryHandle(n, { create:true });
  await write(dir, SAVING, note('saving'));
  for (const [p, b] of Object.entries(all)){
    try { await write(dir, p, b); }
    catch(e){ try { e.file = p; e.size = b.byteLength; } catch {} throw e; }
  }
  await write(dir, SAVING, note('saved'));
  return dir;
}
// a browser's DOMException has a number in .code; only our own words have a string there
function plainWrite(e){
  if (!e || typeof e.code === 'string') return e;
  if (e.name === 'QuotaExceededError' || /quota/i.test(e.message || '')) return Object.assign(new Error('手机的存储空间不够了，没有存上。清理一些空间后再试一次'), { code: 'storage-full', cause: e, step: 'write' });
  if (['AbortError', 'UnknownError', 'InvalidStateError', 'TransactionInactiveError'].includes(e.name)) return Object.assign(new Error('没有存上（这次保存被打断了），请再试一次'), { code: 'storage-lost', cause: e, step: 'write' });
  return e;
}
// Blob → his folder, written inside `root` (a picked folder, or core.phoneRoot()) as <name> or <name>-2…,
// never over someone. Then loads him. → Promise<{ dir, name, paths }>
async function importCompanion(src, root, core = window.ModuCore){
  const { all, mine: mineFiles, name: found } = await open(src);
  const name = safeName(found);
  return lock(async () => {
    let n = name;
    for (let i = 2; await exists(root, n); i++){
      // a folder an unfinished save of ours left (the tab was closed): cleared and used; any other is never written over
      const left = await noteOf(await root.getDirectoryHandle(n));
      if (left && left.state !== 'saved'){ try { await root.removeEntry(n, { recursive:true }); } catch {} break; }
      let empty = true; try { for await (const x of (await root.getDirectoryHandle(n)).entries()){ void x; empty = false; break; } } catch { empty = false; }
      if (empty) break;
      n = `${name}-${i}`;
    }
    let dir;
    try { dir = await writeHim(root, n, all, core); }
    catch(e){ try { await root.removeEntry(n, { recursive:true }); } catch {} throw plainWrite(e); }
    let mine = null;
    if (mineFiles && core && core.restoreMyStore) { try { mine = await core.restoreMyStore(mineFiles); } catch(e){ console.error(e); } }
    if (core && core.loadFromDir) await core.loadFromDir(dir);
    // a backup restored into this phone (换手机): ask the browser to keep it, as after her own import
    let persisted = null;
    if (root.writeFolder && typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist){
      try { persisted = (navigator.storage.persisted && await navigator.storage.persisted()) || !!(await navigator.storage.persist()); } catch { persisted = false; }
    }
    return { dir, name:n, paths:Object.keys(all), mine, persisted };
  });
}
// before restoring, what is in the zip and whether she already has him from this same backup (a contact
// whose card.json is the same and whose manifest says the same move-in). → { name, same: { id, name } | null }
async function peek(src, core = window.ModuCore){
  const { all, name } = await open(src);
  const text = p => all[p] ? dec.decode(all[p]) : null, card = text('card.json');
  let at = null; try { at = JSON.parse(text('manifest.json')).imported_at || null; } catch {}
  let same = null;
  for (const c of (core && core.contacts) || []){
    let dir = null;
    try {
      if (c.where === 'phone' && c.vpath && core.phoneRoot){ dir = core.phoneRoot(); for (const part of c.vpath.split('/').slice(1)) dir = await dir.getDirectoryHandle(part); }
      else if (c.where === 'folder' && c.dir && (await c.dir.queryPermission({ mode:'readwrite' })) === 'granted') dir = c.dir;
    } catch { dir = null; }
    if (!dir) continue;
    const read = async n => { try { return await (await (await dir.getFileHandle(n)).getFile()).text(); } catch { return null; } };
    let theirAt = null; try { theirAt = JSON.parse(await read('manifest.json')).imported_at || null; } catch {}
    // with no move-in time (no manifest, a folder from her computer) one card can have several chats: the chat's first line
    // (its meta, with create_date) must be the same too
    const head = t => t == null ? null : String(t).split('\n')[0];
    if ((await read('card.json')) === card && theirAt === at && (at || card) && (at || head(await read('chat.jsonl')) === head(text('chat.jsonl')))){ same = { id: c.id, name: c.name }; break; }
  }
  return { name: safeName(name), same };
}

// Hand the file to her as a download (phones put it in 下载 / 文件).
function save(blob, filename){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

window.ModuBackup = { version:'0.2', zip, unzip, crc32, allowed, exportCompanion, importCompanion, peek, save };
})();
