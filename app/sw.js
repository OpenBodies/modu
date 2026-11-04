// Modu has no service worker. An earlier do-nothing one made the page it controlled come up blank in Safari on
// iPhone (the wallpaper and nothing else). Chrome and iPhone install the page from the manifest alone, so the phone
// app needs none. This file stays at its old address only to take the old one away: a phone that still has it fetches this on its next visit, and this one removes itself, with no fetch
// handler, so nothing it controls in the meantime goes anywhere but the network. index.html also removes any left.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.registration.unregister()));
