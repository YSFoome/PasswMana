// Generated asset hashes are refreshed by node scripts/generate-sw.cjs.
// BEGIN GENERATED SHELL
const SHELL_VERSION = 'c06e1f1ce533be9cb815f2b392e1c5a88539bdb00990bebd617c5b6768a7eb6b';
const APP_SHELL = [
    {
        "path": "./index.html",
        "sha256": "66ffa6d4890b83b6902eab1cd007d68d19bde1e53237aa761cd67de74a4ae284"
    },
    {
        "path": "./styles.css",
        "sha256": "a6973d785e30cd193f7338ac505de576333210819d9620a83b0e9aa9a1c6c7a5"
    },
    {
        "path": "./app.js",
        "sha256": "78347c09657704511c2e664ffe8572920c1d3821184d46cbc24511ae46855710"
    },
    {
        "path": "./vault-core.js",
        "sha256": "624876da782d834383635b87bf5624ed7b08d544deeac802506d8a5b9d19a90a"
    },
    {
        "path": "./sync-core.js",
        "sha256": "02274982d96efabb23c4055a42125ae58d66380261b49d6fe99f4b791b9a482c"
    },
    {
        "path": "./ui-helpers.js",
        "sha256": "ca9f84d0386c92a8a0f2229dd2abde342ad4d6d6ad37e52f96d81946f21a98b2"
    },
    {
        "path": "./manifest.webmanifest",
        "sha256": "2b91246ad2f2eec46811ddc150b620f6c09153d03b2c4cfcd1a64dc243fedeb5"
    },
    {
        "path": "./icon.svg",
        "sha256": "ac57f5d5ed3e598fc87c7d2ba38eba1e88fd6f4651ce9be7c8759fc2742e37f6"
    },
    {
        "path": "./vendor/lucide-0.468.0.min.js",
        "sha256": "3411692820cb8d47543f69496aa25fd603a358f4498046f41c508a5a3342210e"
    }
];
// END GENERATED SHELL

const scopeUrl = new URL(self.registration.scope);
const CACHE_PREFIX = `passwmana-shell-${encodeURIComponent(scopeUrl.pathname)}-`;
const CACHE_NAME = `${CACHE_PREFIX}${SHELL_VERSION}`;
const shellUrls = new Map(APP_SHELL.map((asset) => [new URL(asset.path, scopeUrl).pathname, new URL(asset.path, scopeUrl).href]));
const indexUrl = new URL('./index.html', scopeUrl).href;

async function verifyAsset(response, expectedHash) {
    if (!response.ok || response.type === 'opaque') throw new Error('Application resource unavailable');
    const canonicalText = (await response.clone().text()).replace(/\r\n/g, '\n');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalText));
    const actualHash = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actualHash !== expectedHash) throw new Error('Application resource changed during deployment');
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        if (!APP_SHELL.length) throw new Error('Run scripts/generate-sw.cjs before deployment');
        try {
            const cache = await caches.open(CACHE_NAME);
            await Promise.all(APP_SHELL.map(async (asset) => {
                const url = new URL(asset.path, scopeUrl).href;
                const response = await fetch(url, { cache: 'reload' });
                await verifyAsset(response, asset.sha256);
                await cache.put(url, response);
            }));
        } catch (error) {
            await caches.delete(CACHE_NAME);
            throw error;
        }
        // A new version waits until the user chooses to reload the application.
    })());
});

async function cleanLegacyCaches() {
    // v12 used one cache across an origin. Remove only this app's records when
    // another deployment still shares it; never delete unrelated origin caches.
    const legacyCacheName = 'passwmana-static-v12';
    if (!(await caches.keys()).includes(legacyCacheName)) return;
    const cache = await caches.open(legacyCacheName);
    const requests = await cache.keys();
    const belongsToApp = (request) => {
        const url = new URL(request.url);
        return url.origin === scopeUrl.origin && (url.pathname === scopeUrl.pathname || shellUrls.has(url.pathname));
    };
    if (requests.every(belongsToApp)) {
        await caches.delete(legacyCacheName);
    } else {
        await Promise.all(requests.filter(belongsToApp).map((request) => cache.delete(request)));
    }
}

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
        await cleanLegacyCaches();
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== scopeUrl.origin) return;
    const isNavigation = event.request.mode === 'navigate'
        && (url.pathname === scopeUrl.pathname || url.href.split('?')[0] === indexUrl);
    const cacheKey = isNavigation ? indexUrl : shellUrls.get(url.pathname);
    if (!cacheKey) return;

    // Network-first also discovers manually deployed changes if someone omits
    // generation. Successful online resources replace the offline fallback.
    const responsePromise = (async () => {
        try {
            const response = await fetch(event.request, { cache: 'no-cache' });
            // Clone before respondWith starts consuming the original body.
            return { response, cacheCopy: response.ok && response.type !== 'opaque' ? response.clone() : null };
        } catch (error) {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(cacheKey);
            if (cached) return { response: cached, cacheCopy: null };
            throw error;
        }
    })();
    event.respondWith(responsePromise.then(({ response }) => response));
    event.waitUntil(responsePromise.then(async ({ cacheCopy }) => {
        if (!cacheCopy) return;
        const cache = await caches.open(CACHE_NAME);
        await cache.put(cacheKey, cacheCopy);
    }).catch(() => {}));
});
