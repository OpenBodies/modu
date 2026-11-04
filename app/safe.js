// Modu safe mode: the way back to the default look when a look breaks the page.
// Plain script, loaded in <head> before anything draws; it defines window.ModuSafe and works even if
// the page's own script never runs. It builds on look.js (window.ModuLook): `?safe=1`
// and `<html data-safe>` already switch her own CSS off for the visit; this file adds the ways in and
// the reset.
//
// Ways in: open the page with ?safe=1, tap the time in the status bar 5 times within 3 s, or
// 设置 → 安全模式. For that visit the page also ignores her saved look (skin, night, wallpaper,
// bubbles, font in localStorage 'modu-look') and offers 恢复默认外观:
//   reset() = those look fields removed from 'modu-look' (voice choices kept, they are not a look),
//             and her own CSS switched off with ModuLook.setUserCSSOn(false) (kept, never deleted,
//             so she can fix it and switch it back on in 美化).
//
// Written in the oldest JavaScript (ES5: var, function, no arrow, no `catch {}`), on purpose. This is
// the file that has to run when every other file could not: an engine too old for core.js (optional chaining
// is Chrome 80; Huawei Browser 11 is Chrome 83, UC and QQ bundle Chrome 100, an old WebView can be anything)
// must still get the note below. Nothing here needs more than Chrome 49 / iOS 10.
(function(){
'use strict';
var LOOK_KEY = 'modu-look';
var LOOK_FIELDS = ['skin', 'night', 'wall', 'bubble', 'font', 'sticker', 'chatBg'];   // sticker: 颜文字; chatBg: 聊天背景
var on = /(?:^\?|&)safe=1(?:&|$)/.test(location.search);   // the same test as ModuLook.safeMode(): ?safe=1
if (on) document.documentElement.setAttribute('data-safe', '1');

function read(){ try { return JSON.parse(localStorage.getItem(LOOK_KEY) || 'null') || {}; } catch (e) { return {}; } }
function without(o){ var r = {}, k; for (k in o) if (Object.prototype.hasOwnProperty.call(o, k) && LOOK_FIELDS.indexOf(k) < 0) r[k] = o[k]; return r; }
// The saved look the page should use: all of it normally; in safe mode none of the look fields.
function saved(){ return on ? without(read()) : read(); }
// 恢复默认外观, for good.
function reset(){
  try { var rest = without(read()); if (Object.keys(rest).length) localStorage.setItem(LOOK_KEY, JSON.stringify(rest)); else localStorage.removeItem(LOOK_KEY); } catch (e) {}
  if (window.ModuLook) window.ModuLook.setUserCSSOn(false);
}
// this address with safe / skin / night / wall taken out of the query (a look in the address is dropped too), the hash kept
function url(safe){
  var href = location.href, hash = '', i = href.indexOf('#');
  if (i >= 0) { hash = href.slice(i); href = href.slice(0, i); }
  var q = href.indexOf('?'), path = q >= 0 ? href.slice(0, q) : href, parts = q >= 0 ? href.slice(q + 1).split('&') : [], keep = [], j;
  for (j = 0; j < parts.length; j++) if (parts[j] && !/^(safe|skin|night|wall)=/.test(parts[j])) keep.push(parts[j]);
  if (safe) keep.push('safe=1');
  return path + (keep.length ? '?' + keep.join('&') : '') + hash;
}
function enter(){ location.href = url(true); }
function leave(clear){ if (clear) reset(); location.href = url(false); }

// 5 taps on the status bar time within 3 s; heard on the document before the page's own handlers.
var taps = [];
document.addEventListener('pointerdown', function(e){
  var t = e.target;
  if (!(t && t.closest && t.closest('#sbTime, .status'))) return;
  var now = Date.now(), kept = [], i;
  for (i = 0; i < taps.length; i++) if (now - taps[i] < 3000) kept.push(taps[i]);
  kept.push(now); taps = kept;
  if (taps.length >= 5) { taps = []; if (!on) enter(); }
}, true);

// Never a blank phone. The phone shows itself (.phone.ready) once the page's start-up has opened a screen;
// if a script fails on the way (it would not load, or it stopped on an error), that never happens and all she had was
// the wallpaper. So the errors are kept, and if the phone is still not shown a while later, a plain note says so, with
// the error's own words (to send to the developers) and ways on: open again, copy the words, open in safe mode, the self-check page.
// Its words are written here, not in words.txt: words.txt may be the very thing that did not load.
//
// The note does not wait for the page's `load` event: a load that never ends (one file that never arrives, a
// script added by another script that hangs) would leave the phone blank with no note at all (seen in Huawei
// Browser). So the note comes 12 s after this file ran if the page has loaded or something failed, and 25 s after
// whatever happens. It says which browser engine
// this is (the one fact that decides whether core.js can run here), the build, and each error with its file and
// line. Old engines draw it too: no `inset`, no flex `gap`, no arrow functions in this file.
var errors = [], t0 = Date.now();
function where(e){
  var f = String(e.filename || '').split('/').pop();
  return f ? ' (' + f + (e.lineno ? ':' + e.lineno + (e.colno ? ':' + e.colno : '') : '') + ')' : '';
}
window.addEventListener('error', function(e){
  if (errors.length >= 6) return;
  var t = e.target;
  if (t && t !== window && t.tagName){   // a file that would not load: only a script or a style sheet stops the start
    if (t.tagName === 'SCRIPT' || t.tagName === 'LINK') errors.push('not loaded: ' + String(t.src || t.href || '').split('/').pop());
    return;
  }
  errors.push(String(e.message || e.error || 'error') + where(e));
  later(4000, true);
}, true);
window.addEventListener('unhandledrejection', function(e){
  if (errors.length < 6) errors.push('promise: ' + String(e.reason && (e.reason.message || e.reason) || 'error'));
});
// the engine, from the UA: 华为浏览器 x · Chrome n (the number that decides what runs) · the system
function engine(){
  var ua = navigator.userAgent || '', out = [], m;
  if ((m = /HuaweiBrowser\/([\d.]+)/.exec(ua))) out.push('华为浏览器 ' + m[1]);
  if ((m = /ArkWeb\/([\d.]+)/.exec(ua))) out.push('ArkWeb ' + m[1]);
  if ((m = /(?:UCBrowser|UBrowser)\/([\d.]+)/.exec(ua))) out.push('UC ' + m[1]);
  if ((m = /MQQBrowser\/([\d.]+)/.exec(ua))) out.push('QQ浏览器 ' + m[1]);
  if ((m = /MicroMessenger\/([\d.]+)/.exec(ua))) out.push('微信 ' + m[1]);
  if ((m = /(?:Chrome|CriOS)\/(\d+)/.exec(ua))) out.push('Chrome ' + m[1]);
  else if ((m = /Version\/([\d.]+)/.exec(ua))) out.push('Safari ' + m[1]);
  if ((m = /(HarmonyOS[^;)]*|Android[^;)]*|iPhone OS [\d_]+|CPU OS [\d_]+)/.exec(ua))) out.push(m[1].replace(/_/g, '.'));
  return out.join(' · ') || ua.slice(0, 90);
}
function ready(){ var p = document.getElementById('phone'); return p && (p.classList ? p.classList.contains('ready') : /\bready\b/.test(p.className)); }
function stuck(){
  if (!document.body) { setTimeout(stuck, 1000); return; }
  if (ready() || document.getElementById('bootFail') || document.getElementById('bootStuck')) return;   // bootFail: index.html's own line for a file that did not arrive
  var phone = document.getElementById('phone');
  if (!phone && document.readyState === 'loading' && Date.now() - t0 < 25000) { setTimeout(stuck, 1000); return; }   // the page is still being read
  var meta = document.querySelector('meta[name="modu-version"]'), ver = meta && meta.content || '?';
  var facts = 'Modu ' + ver + ' · ' + engine() + ' · ' + Math.round((Date.now() - t0) / 1000) + 's' +
    (document.readyState === 'complete' ? '' : ' · 文件还没有全部到齐 (' + document.readyState + ')') + (phone ? '' : ' · 页面没有读完');
  var text = facts + '\n' + (errors.length ? errors.join('\n') : '没有报错，只是一直没有打开');
  var d = document.createElement('div');
  d.id = 'bootStuck'; d.setAttribute('role', 'alert');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;flex-direction:column;justify-content:center;padding:28px 24px;' +
    'background:#262628;color:#f3efe8;font:16px/1.6 system-ui,-apple-system,sans-serif;text-align:center;overflow:auto;-webkit-overflow-scrolling:touch';
  function p(txt, css){ var el = document.createElement('p'); el.textContent = txt; el.style.cssText = 'margin:7px 0;' + (css || ''); d.appendChild(el); return el; }
  function b(txt, fn){ var el = document.createElement('button'); el.type = 'button'; el.textContent = txt; el.onclick = fn;
    el.style.cssText = 'display:block;width:100%;margin:7px 0;font:inherit;padding:12px;border-radius:14px;border:1px solid rgba(243,239,232,.3);background:rgba(243,239,232,.08);color:inherit'; d.appendChild(el); return el; }
  p('小手机没有打开', 'font-size:19px;font-weight:600');
  p('你的聊天和设置都还在这台手机上。可以再打开一次；还不行的话，把下面几行发给我们（点「复制」就行）。', 'opacity:.8');
  var pre = p(text, 'font:13px/1.5 ui-monospace,Menlo,monospace;opacity:.7;white-space:pre-wrap;word-break:break-all;user-select:text;-webkit-user-select:text;text-align:left');
  b('再打开一次', function(){ location.reload(); });
  var copy = b('复制这几行', function(){
    var done = function(){ copy.textContent = '复制好了'; };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; } } catch (e) {}
    fallback();
    function fallback(){
      try { var r = document.createRange(); r.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); if (document.execCommand('copy')) done(); } catch (e) {}
    }
  });
  b('用安全模式打开', function(){ enter(); });
  b('看看这台手机能不能跑小手机', function(){ location.href = 'check.html'; });   // the self-check page, beside this page
  document.body.appendChild(d);
  // a slow start that gets there after all: the note goes away by itself
  var watch = setInterval(function(){ if (ready()) { clearInterval(watch); if (d.parentNode) d.parentNode.removeChild(d); } }, 500);
}
// once: 12 s after this file ran if the page has loaded or something failed (long enough for a slow phone's first start),
// 4 s after an error, and 25 s after whatever happens (a load that never ends is itself the finding)
var timers = {};
function later(ms, onlyIfFailed){
  if (timers[ms]) return;
  timers[ms] = setTimeout(function(){ if (!onlyIfFailed || errors.length) stuck(); }, ms);
}
setTimeout(function(){ if (document.readyState === 'complete' || errors.length) stuck(); else later(13000); }, 12000);
window.addEventListener('load', function(){ later(12000); });

window.ModuSafe = { version:'0.1', on:on, LOOK_KEY:LOOK_KEY, LOOK_FIELDS:LOOK_FIELDS, saved:saved, reset:reset, enter:enter, leave:leave, errors:errors, engine:engine };
})();
