// Generated asset hashes are refreshed by node scripts/generate-sw.cjs.
// BEGIN GENERATED SHELL
// END GENERATED SHELL

const scopeUrl = new URL(self.registration.scope);
const CACHE_PREFIX = `passwmana-shell-${encodeURIComponent(scopeUrl.pathname)}-`;
const CACHE_NAME = `${CACHE_PREFIX}${SHELL_VERSION}`;
const shellUrls = new Map(APP_SHELL.map((asset) => [new URL(asset.path, scopeUrl).pathname, new URL(asset.path, scopeUrl).href]));
const legacyUrls = new Set([
    './index.html', './styles.css', './app.js', './vault-core.js', './sync-core.js',
    './ui-helpers.js', './manifest.webmanifest', './icon.svg', './vendor/lucide-0.468.0.min.js',
].map((asset) => new URL(asset, scopeUrl).pathname));
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
        return url.origin === scopeUrl.origin && (url.pathname === scopeUrl.pathname || shellUrls.has(url.pathname) || legacyUrls.has(url.pathname));
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
