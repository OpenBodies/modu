// 锁屏密码: the phone's passcode, like the one on her real phone. COSMETIC, NOT SECURITY:
// it only makes Modu open like a phone. It does not encrypt anything, and anyone with the browser's
// developer tools can read his folder.
// Kept in this browser only: localStorage['modu-lock'] = { v:1, on, salt, hash } with hash =
// SHA-256(salt + code) in hex; her code itself is never stored. No record = on, with the first code (DEFAULT).
// window.ModuLock: on(), isDefault(), check(code), set(code), reset(), setOn(bool), unlocked(), markUnlocked(), markLocked().
(function(){
'use strict';
const KEY = 'modu-lock', VISIT = 'modu-unlocked', DEFAULT = '261105', LEN = 6;  // the first code: its one place (words.txt shows it as {code})

// SHA-256 in plain JS (the same everywhere: crypto.subtle is missing on a plain-http LAN address)
function sha256(str){
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bytes = Array.from(new TextEncoder().encode(str)), bits = bytes.length * 8;
  bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bits >>> (i * 8)) & 0xff);
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Array(64);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < bytes.length; o += 64){
    for (let i = 0; i < 16; i++) w[i] = (bytes[o + i*4] << 24) | (bytes[o + i*4 + 1] << 16) | (bytes[o + i*4 + 2] << 8) | bytes[o + i*4 + 3];
    for (let i = 16; i < 64; i++){ const s0 = rr(w[i-15], 7) ^ rr(w[i-15], 18) ^ (w[i-15] >>> 3), s1 = rr(w[i-2], 17) ^ rr(w[i-2], 19) ^ (w[i-2] >>> 10); w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++){
      const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
function read(){ try { const r = JSON.parse(localStorage.getItem(KEY) || 'null'); return r && typeof r === 'object' ? r : null; } catch { return null; } }
function write(r){ try { localStorage.setItem(KEY, JSON.stringify(r)); } catch {} }
function salt(){ const a = new Uint8Array(8); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256); return Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); }
const valid = code => typeof code === 'string' && new RegExp('^\\d{' + LEN + '}$').test(code);

function on(){ const r = read(); return !r || r.on !== false; }
function isDefault(){ const r = read(); return !r || !r.hash; }
function check(code){ const r = read(); if (!r || !r.hash) return code === DEFAULT; return sha256(String(r.salt || '') + code) === r.hash; }
function set(code){ if (!valid(code)) return false; const s = salt(); write({ v:1, on:true, salt:s, hash:sha256(s + code) }); return true; }
// 忘记密码. Back to the first code: the record keeps only its switch (no salt, no hash), nothing else changes
function reset(){ const r = read(); write({ v:1, on: !r || r.on !== false }); }
function setOn(v){ const r = read() || { v:1 }; r.on = !!v; write(r); }
// Unlocked for this visit, until the phone has been put down for AWAY (like a real phone: put down a
// while, it asks again). The time she was last here is kept with it (Date, so a test clock moves it too).
const AWAY = 5 * 60 * 1000;
function unlocked(){ try { const at = Number(sessionStorage.getItem(VISIT)) || 0; return at > 0 && Date.now() - at < AWAY; } catch { return false; } }
function markUnlocked(){ try { sessionStorage.setItem(VISIT, String(Date.now())); } catch {} }
function seen(){ try { if (sessionStorage.getItem(VISIT) && unlocked()) markUnlocked(); } catch {} }
if (typeof document !== 'undefined'){
  // on the one clock's beat (app/core/clock.js) when the core is there; a timer of its own only without it
  const C = typeof window !== 'undefined' && window.ModuCore && window.ModuCore.clock;
  if (C) C.on(() => { if (!document.hidden) seen(); }); else setInterval(() => { if (!document.hidden) seen(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) seen(); });
  addEventListener('pagehide', seen);
}
function markLocked(){ try { sessionStorage.removeItem(VISIT); } catch {} }

window.ModuLock = { version:'0.1', KEY, DEFAULT, LEN, AWAY, on, isDefault, check, set, reset, setOn, unlocked, markUnlocked, markLocked, sha256 };
})();
