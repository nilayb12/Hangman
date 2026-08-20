// Service worker for Hangman.
//
// Lives at the repo root on purpose: a worker can only control pages at or
// below its own directory, so scripts/sw.js would silently control nothing.
//
// Every path here is relative, so the whole thing keeps working whether it is
// served from nilayb12.github.io/Hangman/ or a local server on any port.

const VERSION = 'hangman-v1'

const SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './styles/styles.css',
    './styles/fonts.css',
    './scripts/hangman.js',
    './scripts/request.js',
    './scripts/app.js',
    './data/words.json',
    './fonts/barlow-condensed-400.woff2',
    './fonts/barlow-condensed-600.woff2',
    './fonts/space-mono-400.woff2',
    './fonts/space-mono-700.woff2',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png'
]

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(VERSION)
            .then((cache) => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    )
})

self.addEventListener('activate', (event) => {
    // GitHub Pages serves assets with a short max-age, so a stale worker plus
    // a stale cache can otherwise pin someone to an old build indefinitely.
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    )
})

self.addEventListener('fetch', (event) => {
    const request = event.request

    if (request.method !== 'GET') {
        return
    }

    // The word service is never cached: a stale phrase is a spoiled game, and
    // request.js already falls back to the bundled list when it fails.
    if (request.url.includes('random-word-api')) {
        return
    }

    // Cache-first for the shell. It is 100KB of static files that only change
    // when VERSION changes, so there is nothing to revalidate against.
    event.respondWith(
        caches.match(request).then((hit) => hit || fetch(request).then((response) => {
            if (response.ok && new URL(request.url).origin === self.location.origin) {
                const copy = response.clone()
                caches.open(VERSION).then((cache) => cache.put(request, copy))
            }
            return response
        }).catch(() => caches.match('./index.html')))
    )
})
