// Modu 颜文字 (kaomoji): his mood as a kaomoji under his bubbles.
// Plain script, no build step: it defines window.ModuKaomoji. The mapping is data, not
// code: app/kaomoji.txt, one `mood = kaomoji` per line, edited by hand, read again on each load.
(function(){
'use strict';
const MOODS = ['joy', 'sadness', 'anger', 'surprise', 'relief', 'neutral'];
let map = {};
const base = (document.currentScript && document.currentScript.src || location.href).replace(/[^/]*$/, '');

// text of kaomoji.txt → { mood: [kaomoji…] }. `#` at the start of a line is a note; the first ` = `
// splits (a kaomoji may hold '=' itself); unknown moods are kept, so the file can grow.
function parse(text){
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)){
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k && v) (out[k] = out[k] || []).push(v);
  }
  return out;
}
// Read the mapping (never cached, so her edit shows on the next reload). → Promise<map>
function load(url = base + 'kaomoji.txt'){
  return fetch(url, { cache:'no-cache' }).then(r => r.ok ? r.text() : '').catch(() => '').then(t => (map = parse(t)));
}
function list(mood){ return (map[mood] || []).slice(); }
// One kaomoji for a mood, the same for the same seed (a message's date and text), '' if none.
function pick(mood, seed = ''){
  const l = map[mood] || []; if (!l.length) return '';
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return l[h % l.length];
}
window.ModuKaomoji = { version:'0.1', MOODS, parse, load, list, pick, get map(){ return map; } };
})();
