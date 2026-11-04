// Modu look: her own CSS and saved looks. Plain script, no build step: it
// defines window.ModuLook. The page (美化) calls it; it holds the rules, the page only draws.
//
// Her CSS is what other 小手机 users share. It is cleaned before it touches the page, so it can only
// change what is inside the phone (.phone): every selector is rewritten under .phone, html / :root may
// stay only as a condition (e.g. :root[data-night="on"]), body and anything else outside are refused,
// @import and every other @-rule that loads or registers something are dropped, url() may point only
// to this page's own files or to a data: picture, and position:fixed becomes absolute (so it stays in
// the frame). Saved in this browser (localStorage 'modu-css'). Safe mode switches it off: ?safe=1, or
// <html data-safe>, or setUserCSSOn(false).
(function(){
'use strict';

const CSS_KEY = 'modu-css', LOOKS_KEY = 'modu-looks', STYLE_ID = 'modu-user-css';
const FORMAT = 'modu-look/0.1', MAX_CSS = 100000, MAX_LOOKS = 20;
// The look fields a snapshot keeps (the page's 美化 choices).
const LOOK_FIELDS = ['skin', 'night', 'wall', 'bubble', 'font', 'sticker'];   // sticker: 美化 → 表情

// The skin contract a theme may use (the variables and classes every skin styles), for the brief she copies to an AI.
const BRIEF_TOKENS = ['--m-bg','--m-fg','--m-fg2','--m-muted','--m-me','--m-me-fg','--m-ta','--m-ta-fg','--m-soft','--m-line','--m-ink','--m-wall','--m-dock','--m-radius','--m-bubble-radius','--m-display','--m-body','--m-font','--m-shade','--m-scrim','--m-frame',
  '--m-glass','--m-glass-fg','--m-glass-line','--m-blur','--m-on-wall','--m-on-wall2','--m-label-shadow','--m-accent','--m-accent-fg','--m-clock','--m-chat','--m-call-bg','--m-call-bg-solid','--m-call-fg','--m-here','--m-asleep','--m-busy','--m-danger','--m-art','--m-art-disc','--m-art-ring'];
const BRIEF_CLASSES = {
  frame: '.screen .bar .title .back .glass .wp .wp-img .av',
  lock: '.lk .presence .pdot .lk-date .lk-time .lk-note .lk-hint .lk-bar',
  home: '.wall .page .w .w.big .w.him .clock .greet .sub .days .grid .app .tag .dots .dock',
  chat: '.chat .b.me .b.ta .act .stamp .sticker .typing .sysline .inp .send',
  memory: '.mem .mcard .mcard.sum .hint .empty',
  lists: '.list .group .gtitle .opt .val .switch .foot',
  sheets: '.sheet .opts .btn .btn2 .toast',
};

// ---------- cleaning ----------
// Split at a top-level separator (outside quotes, (), []).
function splitTop(s, sep){
  const out = []; let depth = 0, q = '', cur = '';
  for (let i = 0; i < s.length; i++){
    const c = s[i];
    if (q){ cur += c; if (c === q) q = ''; continue; }
    if (c === '"' || c === "'"){ q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    if (c === sep && depth === 0){ out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const OUTSIDE = /(^|[\s>~+(,])(html|body)(?![\w-])|:root|:host|::backdrop|::view-transition/i;
// One selector → the same selector under .phone, or null (refused). selfPhone: it styles .phone itself.
function scopeSelector(sel){
  sel = sel.trim(); if (!sel) return null;
  let prefix = '', m;
  // html / :root may stay as a condition only (the switches live there: data-night, data-skin, …)
  if ((m = /^(?:html|:root)((?:\[[^\]]*\]|\.[\w-]+)*)/i.exec(sel))){ prefix = ':root' + m[1]; sel = sel.slice(m[0].length).replace(/^\s*[>~+]?\s*/, ''); }
  // body is the desk around the phone: a body step is dropped, never styled
  if ((m = /^body((?:\[[^\]]*\]|\.[\w-]+)*)(?![\w-])/i.exec(sel))) sel = sel.slice(m[0].length).replace(/^\s*[>~+]?\s*/, '');
  if (OUTSIDE.test(sel)) return null;
  if (/^[>~+]/.test(sel)) return null;
  if (/^(\.phone|#phone)(?![\w-])[^\s>~+]*\s*[~+]/.test(sel)) return null;   // .phone ~ x: a sibling outside the phone
  const rest = !sel ? '.phone' : /^(\.phone|#phone)(?![\w-])/.test(sel) ? sel : '.phone ' + sel;
  return { sel: (prefix ? prefix + ' ' : '') + rest, selfPhone: /^(\.phone|#phone)(?![\w-])[^\s>~+]*$/.test(rest) };
}

const URL_OK = /^(?:data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]|(?![a-z][a-z0-9+.-]*:)(?!\/\/)[^\s]*$)/i;
// On .phone itself only paint may change (its size, place and frame are the page's).
const SELF_OK = /^(--|color$|background|font|letter-spacing|line-height|accent-color|caret-color)/i;
// One declaration (from the browser's own serialisation) → cleaned text, or null with a reason.
function cleanDecl(d, selfPhone, dropped){
  const i = d.indexOf(':'); if (i < 0) return null;
  const prop = d.slice(0, i).trim(), low = prop.toLowerCase(); let val = d.slice(i + 1).trim();
  if (!/^(--[\w-]+|-?[a-z][a-z-]*)$/i.test(prop)) { dropped.push(prop); return null; }
  const bare = val.replace(/"[^"]*"|'[^']*'/g, '""');   // outside quoted strings (a data: picture has a ;)
  if (/\\/.test(val) || /[{};<]/.test(bare) || /expression\s*\(|javascript:|-moz-binding|behavior|image-set\s*\(|(^|[^\w-])src\s*\(|@import/i.test(val)){ dropped.push(prop); return null; }
  const urls = val.match(/url\(/gi) || [], good = [...val.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)];
  if (urls.length !== good.length || good.some(u => !URL_OK.test(u[2].trim()))){ dropped.push(prop + ' url()'); return null; }
  if (selfPhone && !SELF_OK.test(low)){ dropped.push('.phone ' + prop); return null; }
  if (low === 'position' && /fixed/i.test(val)){ val = val.replace(/fixed/ig, 'absolute'); dropped.push('position:fixed→absolute'); }
  return `${prop}: ${val}`;
}
function cleanBlock(cssText, selfPhone, dropped){
  return splitTop(cssText, ';').map(d => cleanDecl(d.trim(), selfPhone, dropped)).filter(Boolean).join('; ');
}
function cleanRules(rules, dropped){
  const out = [];
  for (const r of rules){
    const type = r.constructor && r.constructor.name;
    if (type === 'CSSStyleRule'){
      const sels = splitTop(r.selectorText, ',').map(scopeSelector);
      const ok = sels.filter(Boolean);
      if (sels.length !== ok.length) dropped.push(r.selectorText);
      if (r.cssRules && r.cssRules.length) dropped.push(r.selectorText + ' { … }');   // nested rules: not taken
      if (!ok.length) continue;
      const selfPhone = ok.some(s => s.selfPhone);
      const body = cleanBlock(r.style.cssText, selfPhone, dropped);
      if (body) out.push(`${ok.map(s => s.sel).join(', ')} { ${body} }`);
    } else if (type === 'CSSMediaRule' || type === 'CSSSupportsRule' || type === 'CSSContainerRule'){
      const kw = type === 'CSSMediaRule' ? '@media' : type === 'CSSSupportsRule' ? '@supports' : '@container';
      const cond = type === 'CSSMediaRule' ? r.media.mediaText : r.conditionText;
      if (/[{};\\]|url\(/i.test(cond)) { dropped.push(kw); continue; }
      const inner = cleanRules(r.cssRules, dropped);
      if (inner.length) out.push(`${kw} ${cond} { ${inner.join(' ')} }`);
    } else if (type === 'CSSKeyframesRule'){
      if (!/^[\w-]+$/.test(r.name)) { dropped.push('@keyframes'); continue; }
      const frames = [...r.cssRules].map(k => `${k.keyText} { ${cleanBlock(k.style.cssText, false, dropped)} }`);
      out.push(`@keyframes ${r.name} { ${frames.join(' ')} }`);
    } else {
      // @import, @font-face, @namespace, @property, @page, @layer, @scope, …: not taken
      dropped.push('@' + String(r.cssText || type).replace(/^@/, '').split(/[\s{(]/)[0]);
    }
  }
  return out;
}
// cleanCSS(text) → { css, dropped }: pure (it parses with a detached style sheet, which loads nothing).
function cleanCSS(text){
  const dropped = [];
  text = String(text || '');
  if (text.length > MAX_CSS) return { css: '', dropped: ['too long'] };
  // an @import never reaches the parser (a detached sheet would ignore it anyway)
  text = text.replace(/@import[^;]*;?/gi, () => { dropped.push('@import'); return ''; });
  let rules;
  try {
    if (typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype){ const sh = new CSSStyleSheet(); sh.replaceSync(text); rules = sh.cssRules; }
    else { const doc = document.implementation.createHTMLDocument(''); const st = doc.createElement('style'); st.textContent = text; doc.head.appendChild(st); rules = st.sheet.cssRules; }
  } catch(e){ return { css: '', dropped: ['parse'] }; }
  return { css: cleanRules(rules, dropped).join('\n'), dropped };
}

// ---------- her CSS, saved in this browser ----------
function read(k, d){ try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } }
function write(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function safeMode(){
  try { if (new URLSearchParams(location.search).get('safe') === '1') return true; } catch {}
  return document.documentElement.hasAttribute('data-safe');
}
function userCSS(){ const v = read(CSS_KEY, {}); return { css: typeof v.css === 'string' ? v.css : '', on: v.on !== false }; }
// ---------- keeping text readable ----------
// Her CSS can change a background and leave the text colour as the skin set it (a light bubble with
// his white night text). After it is applied, each part below is measured: text colour against the
// background behind it (translucent layers blended down to the first solid colour; a gradient counts
// as each of its stops; a picture counts as its fallback colour). Under 3:1, the text of that part becomes near-black or near-white,
// whichever reads better, in a second style (FIX_ID) after hers. Her text is never changed.
const FIX_ID = 'modu-user-css-fix', MIN_CONTRAST = 3;
const READABLE = [
  { id: 'ta', sel: '.b.ta', fix: '.b.ta, .phone .b.ta .act', probe: '<div class="chat"><div class="b ta">字</div></div>' },
  { id: 'me', sel: '.b.me', fix: '.b.me, .phone .b.me .act', probe: '<div class="chat"><div class="b me">字</div></div>' },
  { id: 'card', sel: '.mcard', fix: '.mcard', probe: '<div class="mem"><div class="mcard">字</div></div>' },
  { id: 'list', sel: '.group .opt > span:first-child', fix: '.group .opt > span:first-child', probe: '<div class="list"><div class="group"><button class="opt"><span>字</span></button></div></div>' },
];
function rgba(s){ const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
function over(top, under){ const a = top.a; return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 }; }
function lum(c){ const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
function contrast(a, b){ const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
// the colours behind an element: its own background and its ancestors', blended down to solid ones.
// A gradient (background-image) is drawn over its element's background colour; each of
// its stops counts as one colour behind the text, so the text must read on all of them (lightest and
// darkest). A url() picture still counts as its fallback colour (it cannot be measured).
function stops(img){ return (String(img || '').match(/rgba?\([^)]+\)/g) || []).map(rgba).filter(c => c && c.a > 0); }
function behind(el){
  const layers = [];   // innermost first; each { color, stops }
  for (let n = el; n && n.nodeType === 1; n = n.parentElement){
    const cs = getComputedStyle(n), c = rgba(cs.backgroundColor), g = /gradient\(/.test(cs.backgroundImage) ? stops(cs.backgroundImage) : [];
    if ((c && c.a > 0) || g.length) layers.push({ color: c && c.a > 0 ? c : null, stops: g });
    if ((c && c.a >= 1) || (g.length && g.every(x => x.a >= 1))) break;
    if (n.matches('.phone')) break;
  }
  let base = [{ r: 255, g: 255, b: 255, a: 1 }];
  for (let i = layers.length - 1; i >= 0; i--){
    const L = layers[i];
    if (L.color) base = base.map(b => over(L.color, b));
    if (L.stops.length){ const nb = []; for (const b of base) for (const s of L.stops) nb.push(over(s, b)); base = nb.slice(0, 24); }
  }
  return base;
}
// measure each part (a real one on the page, else a hidden probe inside the phone) → the parts under 3:1
function unreadable(){
  const phone = document.querySelector('.phone'); if (!phone) return [];
  const probe = document.createElement('div'); probe.id = 'modu-look-probe'; probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;inset:0;visibility:hidden;pointer-events:none;z-index:-1;overflow:hidden';
  phone.appendChild(probe);
  const bad = [];
  try {
    for (const p of READABLE){
      let el = phone.querySelector(p.sel + ':not(#modu-look-probe *)');
      if (!el){ const box = document.createElement('div'); box.innerHTML = p.probe; probe.appendChild(box); el = box.querySelector(p.sel); }
      const fg = rgba(getComputedStyle(el).color); if (!fg) continue;
      const bgs = behind(el), k = Math.min(...bgs.map(bg => contrast(over(fg, bg), bg)));
      if (k < MIN_CONTRAST) bad.push({ id: p.id, contrast: Math.round(k * 100) / 100, bgs });
    }
  } finally { probe.remove(); }
  return bad;
}
function keepReadable(){
  let fix = document.getElementById(FIX_ID); if (fix) fix.remove();
  if (!document.getElementById(STYLE_ID)) return [];
  const bad = unreadable(); if (!bad.length) return [];
  const dark = { r: 29, g: 27, b: 25 }, light = { r: 250, g: 248, b: 245 };
  fix = document.createElement('style'); fix.id = FIX_ID;
  fix.textContent = bad.map(b => {
    const worst = c => Math.min(...b.bgs.map(bg => contrast(c, bg)));   // the colour that reads best on its hardest stop
    const p = READABLE.find(x => x.id === b.id), c = worst(dark) >= worst(light) ? dark : light;
    return `.phone ${p.fix} { color: rgb(${c.r}, ${c.g}, ${c.b}) !important; }`;
  }).join('\n');
  document.head.appendChild(fix);
  return bad.map(b => b.id);
}
// a skin switch loads a new skin file: measure again once it has arrived
function watchSkin(){ const s = document.getElementById('skin'); if (s && !s.__moduLook){ s.__moduLook = true; s.addEventListener('load', () => keepReadable()); } }

// Puts the cleaned CSS into the page (after the skin), or takes it out. Returns what was dropped and
// `fixed`: the parts whose text colour was changed so it stays readable.
function applyUserCSS(){
  const { css, on } = userCSS();
  let el = document.getElementById(STYLE_ID);
  const clean = on && css && !safeMode() ? cleanCSS(css) : { css: '', dropped: [] };
  watchSkin();
  if (!clean.css){ if (el) el.remove(); keepReadable(); clean.fixed = []; return clean; }
  if (!el){ el = document.createElement('style'); el.id = STYLE_ID; }
  document.head.appendChild(el);   // always last, so it follows the skin even after a skin switch
  el.textContent = clean.css;
  clean.fixed = keepReadable();
  return clean;
}
function setUserCSS(text){ write(CSS_KEY, { css: String(text || ''), on: true }); return applyUserCSS(); }
function setUserCSSOn(on){ const v = userCSS(); write(CSS_KEY, { css: v.css, on: !!on }); return applyUserCSS(); }

// ---------- saved looks (snapshots) ----------
// A snapshot: { format:'modu-look/0.1', id, name, at, look:{skin,night,wall,bubble,font}, css, cssOn }
function looks(){ const v = read(LOOKS_KEY, []); return Array.isArray(v) ? v.filter(x => x && x.id && x.look) : []; }
function pickLook(look){ const o = {}; for (const k of LOOK_FIELDS) if (look && k in look) o[k] = look[k]; return o; }
function saveLookSnapshot(name, look){
  const list = looks(), c = userCSS();
  const snap = { format: FORMAT, id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(name || '').trim().slice(0, 30), at: Date.now(), look: pickLook(look), css: c.css, cssOn: c.on };
  list.unshift(snap);
  if (list.length > MAX_LOOKS) list.length = MAX_LOOKS;
  return write(LOOKS_KEY, list) ? snap : null;   // null: the browser's storage is full (a big photo wallpaper)
}
function getLookSnapshot(id){ return looks().find(x => x.id === id) || null; }
function renameLookSnapshot(id, name){ const list = looks(), s = list.find(x => x.id === id); if (!s) return false; s.name = String(name || '').trim().slice(0, 30); return write(LOOKS_KEY, list); }
function removeLookSnapshot(id){ return write(LOOKS_KEY, looks().filter(x => x.id !== id)); }
// Restores a snapshot's CSS and returns its look fields; the page applies those (it owns the 美化 state).
function useLookSnapshot(id){
  const s = getLookSnapshot(id); if (!s) return null;
  write(CSS_KEY, { css: s.css || '', on: s.cssOn !== false }); applyUserCSS();
  return pickLook(s.look);
}

// ---------- the brief she copies to an AI ----------
// brief(T): the words line 'beauty.css.brief.text' with {tokens} and {classes} filled in.
function brief(T){
  const classes = Object.entries(BRIEF_CLASSES).map(([k, v]) => `${T('beauty.css.brief.' + k)}: ${v}`).join('\n');
  return T('beauty.css.brief.text', { tokens: BRIEF_TOKENS.join(' '), classes });
}

window.ModuLook = {
  version: '0.4', FORMAT, CSS_KEY, FIX_ID, MIN_CONTRAST, keepReadable, LOOKS_KEY, LOOK_FIELDS, BRIEF_TOKENS, BRIEF_CLASSES,
  cleanCSS, userCSS, setUserCSS, setUserCSSOn, applyUserCSS, safeMode, brief,
  looks, saveLookSnapshot, getLookSnapshot, renameLookSnapshot, removeLookSnapshot, useLookSnapshot,
};
})();
