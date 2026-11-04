// 朋友圈 (moments): his posts and hers, likes and comments.
// He posts on his own schedule: app/life.js (window.ModuLife) writes his posts, dated when he
// posted them, and his later comments and 赞 on her things. Nothing here makes him post. 写 is her own
// post; her posts and comments are saved and shown at once, and life.js gives him a reaction for later.
// Each post is a record of type 'moments' in his folder (moments/<id>.json), so posts, likes and
// comments go with him in 导出备份.
// Whose phone: HER posts are hers. Each is also a 'moments' record in her own store
// (myRecords: { id, at, by:'her', text }), so it stays in her 朋友圈 when she adds or switches
// companions. The companion open when she posts sees it (a post is shown to her friends): his copy, with the
// same id, in his folder, carries his side of it (his 赞, the thread with him, what life.js has planned).
// Another companion has no copy: he never saw it, and nothing of it reaches his prompt until she comments
// on it with him there. Older posts of hers kept only in his folder are copied to her store on the first load.
//
// Record: { type:'moments', v:1, id, date, at, by:'him'|'her', text, mood?, liked:<bool>, heLiked?:<bool>,
//           comments:[{ by:'her'|'him', text, at }], later?:[{ at, what }], from?:'life' }
(function(){
'use strict';
const TYPE = 'moments';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const life = () => window.ModuLife || null;
const M = () => window.ModuCore;
const iso = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const plain = t => String(t || '').replace(/\s+/g, ' ').trim();
const all = async () => M().records.list(TYPE);

// His comment under her post, his reply under his own: asked here, since the thread is 朋友圈's.
const COMMENT_RULE = `Now step out of the chat. She posted on her own 朋友圈 and you have just seen it. Write your comment under her post, the way you would in a comment thread: one short line in your own voice and the language you two chat in, no *actions*.`;
const REPLY_RULE = `Now step out of the chat. She commented on your 朋友圈 post and you have just seen it. Reply to her comment under the post, the way you would in a comment thread: one short line in your own voice and the language you two chat in, no *actions*.`;

// What 朋友圈 keeps of his own life (the `life` part of register): life.js says "he posted" and
// when he answers her; this app decides how that is kept (the record above).
const LIFE = {
  takes: ['post'],
  async kept(){ return (await all()).map(p => p.id); },
  async did(d){ await M().records.put(TYPE, { id: d.id, at: d.at, by: 'him', from: d.from || 'life', text: d.text, mood: d.mood, liked: false, comments: [] }, { app: 'moments' }); },
  async mine(){ return (await all()).filter(p => p.by === 'him'); },
  // for his diary: her posts that day with the comments, and the comments under his posts
  async today(day, upTo){
    const posts = await all(), seen = c => (c.at || 0) <= upTo && iso(c.at || 0) === day;
    const hers = posts.filter(p => p.by === 'her' && iso(p.at) === day && p.at <= upTo).map(p => `- ${hhmm(p.at)} she posted: ${p.text}` + (p.comments || []).filter(seen).map(c => ` / ${c.by === 'her' ? 'she' : 'you'}: ${c.text}`).join(''));
    const under = posts.filter(p => p.by === 'him').flatMap(p => (p.comments || []).filter(seen).map(c => `- under your post "${plain(p.text).slice(0, 30)}", ${c.by === 'her' ? 'she' : 'you'}: ${c.text}`));
    return { where: '朋友圈', lines: hers.concat(under) };
  },
  // for life.js's own small prompt block: his last 5 posts, with her 赞 and the comments
  async remember({ now, since, when }){
    const mine = (await all()).filter(p => p.by === 'him' && p.at <= now && p.at > since).sort((a, b) => b.at - a.at).slice(0, 5);
    return mine.map(p => {
      const her = (p.comments || []).filter(c => c.by === 'her').map(c => c.text), his = (p.comments || []).filter(c => c.by === 'him').map(c => c.text);
      return `- ${when(p.at)}, you posted on 朋友圈: ${p.text}` + (p.liked ? ' (she liked it)' : '') + (her.length ? ` (she commented: ${her.join(' / ')})` : '') + (his.length ? ` (you replied: ${his.join(' / ')})` : '');
    });
  },
  // his answers to her, planned by life.js (react) into the record's `later`, delivered here once due
  answers: {
    async get(id){ const r = await M().records.get(TYPE, id); return r ? { at: r.at, later: r.later || [], answered: (r.comments || []).filter(c => c.by === 'him').length, record: r } : null; },
    async plan(id, later){ const r = await M().records.get(TYPE, id); return r ? M().records.put(TYPE, Object.assign({}, r, { later }), { app: 'moments' }) : null; },
    async list(){ return (await all()).filter(r => (r.later || []).length).map(r => ({ id: r.id, at: r.at, later: r.later })); },
    async give(id, item, help){
      let rec = await M().records.get(TYPE, id); if (!rec) return;
      const first = (rec.later || [])[0];
      if (!first || first.at !== item.at) return;
      rec = Object.assign({}, rec, { later: (rec.later || []).slice(1) });
      if (first.what === 'like') rec.heLiked = true;
      else if (first.what === 'comment' || first.what === 'reply'){
        const seen = (rec.comments || []).filter(c => (c.at || 0) <= first.at);
        const thread = seen.map(c => `${c.by === 'her' ? '她' : '你'}: ${c.text}`).join('\n');
        const r = first.what === 'comment'
          ? await help.ask(COMMENT_RULE, `${help.clock(first.at)}\n\nHer post: ${rec.text}${thread ? `\n\nThe comments so far:\n${thread}` : ''}`)
          : await help.ask(REPLY_RULE, `${help.clock(first.at)}\n\nYour post: ${rec.text}\n\nThe comments so far:\n${thread}`);
        if (!help.still()) return;
        const fresh = (await M().records.get(TYPE, id)) || rec;
        rec = Object.assign({}, fresh, { later: (fresh.later || []).filter(l => l.at !== first.at) });
        rec.comments = (rec.comments || []).concat({ by: 'him', text: r.text, at: first.at }).sort((a, b) => (a.at || 0) - (b.at || 0));
      }
      if (!help.still()) return;
      await M().records.put(TYPE, rec, { app: 'moments' });
    },
  },
};

ModuApps.register({
  id: 'moments', version: '0.3', icon: 'i-moments', title: 'app.moments', status: 'ready', css: true, records: [TYPE],
  // what it writes, held to it by a static check
  writes: { records: ['moments'], mine: ['moments'], events: {}, chat: 'none' },
  life: LIFE,
  mount(el, ctx){
    const T = ctx.T, core = ctx.core;
    let posts = [];
    const mine = () => core.myRecords || core.records;   // her own store; an older core: his folder
    const name = () => core.store.name || '';
    // her half-written post or comment is kept for this companion (ctx.drafts, drafts.js); sending clears it
    const drafts = ctx.drafts || { get: () => '', set(){}, clear(){}, bind: () => () => {} };
    const nowMs = () => (core.now ? core.now() : new Date()).getTime();
    function when(at){
      const d = new Date(at), now = new Date(nowMs()), min = Math.round((now - d) / 60000);
      if (min < 1) return T('app.moments.now');
      if (min < 60) return T('app.moments.min', { n: min });
      if (sameDay(d, now)) return T('app.moments.hour', { n: Math.floor(min / 60) });
      const y = new Date(now); y.setDate(y.getDate() - 1);
      if (sameDay(d, y)) return T('app.moments.yesterday', { t: `${pad(d.getHours())}:${pad(d.getMinutes())}` });
      return T('app.moments.day', { m: d.getMonth() + 1, d: d.getDate() });
    }
    const who = by => by === 'her' ? T('app.moments.you') : name();
    function thread(p){
      const cs = p.comments || [], likes = [];
      if (p.by !== 'her' && p.liked) likes.push(T('app.moments.you'));
      if (p.by === 'her' && p.heLiked) likes.push(name());
      if (!likes.length && !cs.length) return '';
      return `<div class="a-moments-thread">
        ${likes.length ? `<div class="a-moments-likes">♡ ${esc(likes.join('，'))}</div>` : ''}
        ${cs.map((c, i) => { const to = cs.slice(0, i).some(x => x.by !== c.by) ? (c.by === 'her' ? 'him' : 'her') : null;
          return `<div class="a-moments-c"><b>${esc(who(c.by))}</b>${to ? `<span>${esc(T('app.moments.replyto'))}</span><b>${esc(who(to))}</b>` : ''}：${esc(c.text)}</div>`; }).join('')}
      </div>`;
    }
    function draw(){
      const av = core.store.avatarURL ? ` style="background-image:url('${core.store.avatarURL}')"` : '';
      // her own posts carry her own picture (聊天设置 → 我的头像), when she chose one
      // only a plain base64 picture, and escaped (quotes too) where it goes into style="…"
      const herPic = core.herProfile ? String(core.herProfile().avatar || '') : '', herAv = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(herPic) ? ` style="background-image:url('${esc(herPic).replace(/'/g, '&#39;')}')"` : '';
      const old = el.querySelector('.list'), top = old ? old.scrollTop : 0;
      el.innerHTML = `<div class="pad-top"></div>
        <div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(T('app.moments'))}</div>
          <div class="sp"><button id="a-moments-write" aria-label="${esc(T('app.moments.write'))}"><svg class="ic"><use href="#i-pen"/></svg></button></div></div>
        <div class="list a-moments">
          <div class="a-moments-head"><div class="av"${av}></div><b>${esc(name())}</b></div>
          ${posts.length ? posts.map(p => { const hers = p.by === 'her'; return `<article class="group a-moments-post${hers ? ' her' : ''}" data-id="${esc(p.id)}">
              <div class="a-moments-top"><div class="av sm"${hers ? herAv : av}></div><div class="a-moments-body"><b>${esc(who(p.by))}</b><p>${esc(p.text)}</p>
                <div class="a-moments-meta"><small>${esc(when(p.at))}</small><span class="a-moments-acts">
                  ${hers ? '' : `<button data-like="${esc(p.id)}" class="${p.liked ? 'on' : ''}">${esc(T(p.liked ? 'app.moments.liked' : 'app.moments.like'))}</button>`}
                  <button data-comment="${esc(p.id)}">${esc(T('app.moments.comment'))}</button></span></div>
                ${thread(p)}
              </div></div>
            </article>`; }).join('')
            : `<div class="empty a-moments-empty">${esc(T('app.moments.empty', { name: name() }))}</div>`}
        </div>`;
      const list = el.querySelector('.list'); if (list && top) list.scrollTop = top;
      el.querySelector('#a-moments-write').onclick = () => compose({ title: T('app.moments.write'), placeholder: T('app.moments.mine'), button: T('app.moments.publish'), draft: 'moments.post' }, async text => {
        // her own post: saved and shown at once; he sees it later, on his own time
        const at = nowMs(), rec = { id: at.toString(36) + Math.random().toString(36).slice(2, 6), by:'her', text, liked:false, comments:[], at };
        posts = [rec].concat(posts); draw();
        await mine().put(TYPE, { id: rec.id, at, by:'her', text }, { app:'moments' });   // hers, whoever is open
        if (!name()) return;                                                                // no one to see it yet
        const saved = await core.records.put(TYPE, rec, { app:'moments' });                  // his copy: he saw it
        if (life()) await life().react(saved.id, 'post', 'moments');
      });
      el.querySelectorAll('[data-like]').forEach(b => b.onclick = async () => {
        const p = posts.find(x => x.id === b.dataset.like); if (!p) return;
        p.liked = !p.liked; draw();
        const cur = (await core.records.get(TYPE, p.id)) || p;
        await core.records.put(TYPE, Object.assign({}, cur, { liked: p.liked }), { app:'moments' });
      });
      el.querySelectorAll('[data-comment]').forEach(b => b.onclick = () => {
        const p = posts.find(x => x.id === b.dataset.comment); if (!p) return;
        compose({ title: T('app.moments.comment'), placeholder: T('app.moments.placeholder'), button: T('app.moments.send'), rows: 3, draft: 'moments.comment.' + p.id }, async text => {
          // her comment: shown the moment she sends it; his answer, if any, comes later on its own
          const c = { by:'her', text, at: nowMs() };
          p.comments = (p.comments || []).concat(c); draw();
          // on her own post that he has no copy of (another companion was open when she posted): his copy starts now
          const cur = (await core.records.get(TYPE, p.id)) || (p.by === 'her' ? { id: p.id, at: p.at, by:'her', text: p.text, liked:false, comments:[] } : p);
          const has = (cur.comments || []).some(x => x.by === 'her' && x.at === c.at && x.text === text);
          const saved = await core.records.put(TYPE, Object.assign({}, cur, { comments: has ? cur.comments : (cur.comments || []).concat(c) }), { app:'moments' });
          if (life()) await life().react(saved.id, p.by === 'her' ? 'post' : 'comment', 'moments');
        });
      });
    }
    function compose(o, done){
      ctx.sheet(`<h3>${esc(o.title)}</h3><textarea id="a-moments-text" rows="${o.rows || 5}" placeholder="${esc(o.placeholder)}"></textarea>
        <button class="btn" id="a-moments-send">${esc(o.button)}</button><button class="btn2" data-close>${esc(T('cancel'))}</button>`, s => {
        const ta = s.querySelector('#a-moments-text'); if (o.draft) drafts.bind(ta, o.draft); ta.focus();
        s.querySelector('#a-moments-send').onclick = async () => {
          const text = ta.value.trim(); if (!text) { ta.focus(); return; }
          ctx.closeSheet();
          if (o.draft) drafts.clear(o.draft);
          try { await done(text); } catch(e){ ctx.toast(T('app.moments.notsaved')); await load(); }
        };
      });
    }
    // his posts and his side of hers from his folder; her posts from her own store, with his side of each
    async function load(){
      let his = [], hers = [];
      try { his = (await core.records.list(TYPE)) || []; } catch { his = []; }
      try { hers = mine().list ? (await mine().list(TYPE)) || [] : []; } catch { hers = []; }
      const mineIds = new Set(hers.map(p => p.id));
      // her posts kept only in his folder (older data) are hers: copy each to her store, once
      for (const p of his) if (p && p.by === 'her' && p.text && !mineIds.has(p.id) && mine().put){
        try { hers.push(await mine().put(TYPE, { id: p.id, at: p.at, by:'her', text: p.text }, { app:'moments' })); mineIds.add(p.id); } catch {}
      }
      const side = new Map(his.filter(p => p && p.by === 'her').map(p => [p.id, p]));
      const all = his.filter(p => p && p.by !== 'her').concat(hers.map(p => Object.assign({ liked:false, comments:[] }, p, side.get(p.id) || {}, { by:'her', text: p.text, at: p.at })));
      posts = all.filter(p => p && p.text && (p.at || 0) <= nowMs()).sort((a, b) => (b.at || 0) - (a.at || 0));
      draw();
    }
    // his posts and his later answers arrive on their own (life.js), while she looks or the next time; another
    // companion opened: his posts, and his side of hers
    const off = core.on((ev, data) => { if ((ev === 'records' && data && data.type === TYPE) || ev === 'loaded') { clearTimeout(load.t); load.t = setTimeout(load, 120); } });
    draw(); load();
    if (life()) life().wake();
    return () => { off(); clearTimeout(load.t); };
  },
});
})();
