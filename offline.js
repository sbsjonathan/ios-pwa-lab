'use strict';

const scopeURL = new URL(self.registration.scope);
const profile = scopeURL.pathname.split('/').filter(Boolean).at(-1);
const profilePrefix = 'ios-pwa-lab:' + scopeURL.pathname + ':';
const cacheName = profilePrefix + self.LAB_BUILD;
const entry = new URL('index.html', scopeURL).href;
const urls = new Set([
  'index.html', 'manifest.webmanifest', '../lab.css', '../lab.js', '../glow.js',
  '../recorder.js', '../register.js',
  ...[180, 192, 512].map(size => '../assets/' + profile + '-' + size + '.png')
].map(path => new URL(path, scopeURL).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...urls].map(url => new Request(url, {cache: 'reload'})));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter(name => name.startsWith(profilePrefix) && name !== cacheName);
    await Promise.all(old.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const key = url.origin + url.pathname;
  const isEntry = event.request.mode === 'navigate' && (key === scopeURL.href || key === entry);
  if (!isEntry && !urls.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(isEntry ? entry : key)) || fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'LAB_VERSION') {
    event.ports[0]?.postMessage({type:'LAB_VERSION', build:self.LAB_BUILD, profile});
  }
});
