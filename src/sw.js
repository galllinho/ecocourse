// EcoCourse — service worker de la version web (iPhone) :
// fonctionnement hors ligne + notifications Firebase quand l'appli est fermée.
const CACHE = 'ecocourse-v1';
const SHELL = ['./', 'index.html', 'data.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png',
  'vendor/firebase-app-compat.js', 'vendor/firebase-auth-compat.js', 'vendor/firebase-database-compat.js', 'vendor/firebase-messaging-compat.js'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// Réseau d'abord (toujours la dernière version), cache si pas de réseau
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
// Notifications
importScripts('vendor/firebase-app-compat.js', 'vendor/firebase-messaging-compat.js', 'config.js');
try {
  firebase.initializeApp(self.ECOCOURSE_FIREBASE);
  firebase.messaging().onBackgroundMessage(() => {}); // l'affichage est automatique (champ notification)
} catch (e) {}
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].focus() : self.clients.openWindow('./')));
});
