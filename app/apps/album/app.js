// 相册 (album): the pictures she adds, kept with him. Each picture is
// a record of type 'album' in his folder (album/<id>.json), made smaller first (at most 1280 px
// on the long side, JPEG), so it is light enough to keep, and goes with him in 导出备份.
// In the demo it is kept for the visit only.
// The photos he sends in the chat (a tag in his text, core photoTags) show here too, as what he said
// the picture shows (there is no picture file); they are read from the chat each time, so nothing is written for them.
//
// Record: { type:'album', v:1, id, date:'YYYY-MM-DD', at, src:'data:image/jpeg;base64,…', w, h, name }
(function(){
'use strict';
const TYPE = 'album', MAX = 1280;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

// A picture file → { src, w, h }, shrunk to MAX on the long side.
function shrink(file){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res({ src: c.toDataURL('image/jpeg', .85), w: c.width, h: c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('not a picture')); };
    img.src = url;
  });
}

ModuApps.register({
  id: 'album', version: '0.1', icon: 'i-album', title: 'app.album', status: 'ready', css: true, records: [TYPE],
  // what it writes, held to it by a static check
  writes: { records: ['album'], events: {}, chat: 'none' },
  mount(el, ctx){
    const T = ctx.T, core = ctx.core;
    let pics = [], his = [];
    const dayText = k => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ''); return m ? T('app.album.day', { m: Number(m[2]), d: Number(m[3]) }) : ''; };
    function draw(){
      el.innerHTML = `<div class="pad-top"></div>
        <div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(T('app.album'))}</div>
          <div class="sp"><button id="a-album-add" aria-label="${esc(T('app.album.add'))}"><svg class="ic"><use href="#i-plus"/></svg></button></div></div>
        <div class="list a-album">
          ${pics.length || his.length ? `<div class="a-album-grid">${his.map(h => `<button class="a-album-pic a-album-his" data-his="${esc(h.id)}" aria-label="${esc(dayText(h.date))}"><span>${esc(h.cap || T('chat.photo'))}</span></button>`).join('')}${pics.map(p => `<button class="a-album-pic" data-id="${esc(p.id)}" style="background-image:url('${p.src}')" aria-label="${esc(dayText(p.date))}"></button>`).join('')}</div>`
            : `<button class="empty a-album-empty" id="a-album-first">${esc(T('app.album.empty'))}</button>`}
          ${pics.length || his.length ? `<div class="foot">${esc(T('app.album.foot', { name: core.store.name, n: pics.length + his.length }))}</div>` : ''}
        </div>
        <input type="file" id="a-album-file" accept="image/*" multiple hidden>`;
      const file = el.querySelector('#a-album-file');
      el.querySelector('#a-album-add').onclick = () => file.click();
      const first = el.querySelector('#a-album-first'); if (first) first.onclick = () => file.click();
      file.onchange = async () => {
        const files = [...file.files]; file.value = ''; let n = 0;
        for (const f of files){
          try { const s = await shrink(f); await core.records.put(TYPE, { src: s.src, w: s.w, h: s.h, name: f.name }, { app: 'album' }); n++; }
          catch { ctx.toast(T('app.album.bad')); }
        }
        if (n) ctx.toast(T('app.album.added', { n }));
        await load();
      };
      el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => view(b.dataset.id));
      el.querySelectorAll('[data-his]').forEach(b => b.onclick = () => viewHis(b.dataset.his));
    }
    // one he sent: what he said it shows, from whom and when; it stays in the chat, so there is no 删除 here
    function viewHis(id){
      const h = his.find(x => x.id === id); if (!h) return;
      ctx.sheet(`<p class="a-album-said" style="font-size:16px;line-height:1.6;margin:4px 0 10px">${esc(h.cap || T('chat.photo'))}</p><p class="a-album-when" style="color:var(--m-muted);font-size:13px;margin:0 0 6px">${esc(T('app.album.his', { name: core.store.name || '' }))} · ${esc(dayText(h.date))}</p>
        <button class="btn2" data-close>${esc(T('done'))}</button>`);
    }
    // his photos in the chat, newest first: [{ id, cap, date }]
    function fromChat(){
      const out = [], pad = n => String(n).padStart(2, '0');
      (core.store.msgs || []).forEach((m, i) => {
        if (!m || m.is_user || !m.mes || typeof core.photoTags !== 'function') return;
        const d = core.msgDate && core.msgDate(m), date = d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
        core.photoTags(m.mes).photos.forEach((cap, k) => out.push({ id: `${i}-${k}`, cap, date }));
      });
      return out.reverse();
    }
    function view(id){
      const p = pics.find(x => x.id === id); if (!p) return;
      // the sheet is the page's, outside this app's screen: so its few styles are inline
      ctx.sheet(`<div class="a-album-view" style="margin:0 -6px 8px;text-align:center"><img src="${p.src}" alt="" style="max-width:100%;max-height:58vh;border-radius:14px;display:inline-block"></div><p class="a-album-when" style="text-align:center;color:var(--m-muted);font-size:13px;margin:0 0 6px">${esc(dayText(p.date))}</p>
        <button class="btn2" id="a-album-del">${esc(T('app.album.delete'))}</button><button class="btn2" data-close>${esc(T('done'))}</button>`, s => {
        s.querySelector('#a-album-del').onclick = async () => { await core.records.remove(TYPE, id); ctx.closeSheet(); ctx.toast(T('app.album.deleted')); await load(); };
      });
    }
    async function load(){ his = fromChat(); try { pics = (await core.records.list(TYPE)).filter(p => p && typeof p.src === 'string' && p.src.startsWith('data:image/')).reverse(); } catch { pics = []; } draw(); }
    draw(); load();
  },
});
})();
