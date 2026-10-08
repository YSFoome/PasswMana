const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webcrypto } = require('node:crypto');

globalThis.crypto = webcrypto;
const helpersPromise = import(pathToFileURL(path.join(__dirname, '..', 'ui-helpers.js')).href);

function fakeClock() {
    let now = 0;
    let nextId = 0;
    const timers = new Map();
    return {
        schedule(callback, delay) { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id; },
        cancel(id) { timers.delete(id); },
        async advance(milliseconds) {
            const target = now + milliseconds;
            while (true) {
                const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((left, right) => left[1].at - right[1].at)[0];
                if (!next) break;
                const [id, timer] = next;
                timers.delete(id);
                now = timer.at;
                await timer.callback();
            }
            now = target;
        },
    };
}

test('copying another password resets the 30 second clipboard window', async () => {
    const { createClipboardManager } = await helpersPromise;
    const clock = fakeClock();
    let contents = '';
    const manager = createClipboardManager({ async writeText(value) { contents = value; }, async readText() { return contents; } }, clock.schedule, clock.cancel);
    await manager.copy('synthetic-password-A');
    await clock.advance(20000);
    await manager.copy('synthetic-password-B');
    await clock.advance(10000);
    assert.equal(contents, 'synthetic-password-B', 'The first copy timer must not clear the second password');
    await clock.advance(19999);
    assert.equal(contents, 'synthetic-password-B');
    await clock.advance(1);
    assert.equal(contents, '');
});

test('clipboard cleanup preserves contents copied by another application', async () => {
    const { createClipboardManager } = await helpersPromise;
    const clock = fakeClock();
    let contents = '';
    const manager = createClipboardManager({ async writeText(value) { contents = value; }, async readText() { return contents; } }, clock.schedule, clock.cancel);
    await manager.copy('synthetic-app-password');
    contents = 'synthetic-other-application-text';
    await clock.advance(30000);
    assert.equal(contents, 'synthetic-other-application-text');
});

test('a failed newer copy preserves cleanup of the previous password', async () => {
    const { createClipboardManager } = await helpersPromise;
    const clock = fakeClock();
    let contents = '';
    const manager = createClipboardManager({
        async writeText(value) {
            if (value === 'synthetic-rejected-password') throw new DOMException('Synthetic denial', 'NotAllowedError');
            contents = value;
        },
        async readText() { return contents; },
    }, clock.schedule, clock.cancel);
    await manager.copy('synthetic-previous-password');
    await clock.advance(20000);
    await assert.rejects(manager.copy('synthetic-rejected-password'), { name: 'NotAllowedError' });
    await clock.advance(10000);
    assert.equal(contents, '', 'A denied copy must not disable cleanup of the existing password');
});

test('clipboard cleanup does not erase content when read access is denied or unavailable', async () => {
    const { createClipboardManager } = await helpersPromise;
    for (const readText of [undefined, async () => { throw new DOMException('Synthetic denial', 'NotAllowedError'); }]) {
        const clock = fakeClock();
        let contents = '';
        const manager = createClipboardManager({ async writeText(value) { contents = value; }, ...(readText ? { readText } : {}) }, clock.schedule, clock.cancel);
        await manager.copy('synthetic-protected-clipboard');
        await clock.advance(30000);
        assert.equal(contents, 'synthetic-protected-clipboard');
    }
});

test('an old asynchronous clipboard read cannot clear a newer copy', async () => {
    const { createClipboardManager } = await helpersPromise;
    const callbacks = [];
    let contents = '';
    let resolveRead;
    const manager = createClipboardManager({
        async writeText(value) { contents = value; },
        readText() { return new Promise((resolve) => { resolveRead = resolve; }); },
    }, (callback) => { callbacks.push(callback); return callbacks.length; }, () => {});
    await manager.copy('synthetic-password-A');
    const cleanup = callbacks[0]();
    await manager.copy('synthetic-password-B');
    resolveRead('synthetic-password-A');
    await cleanup;
    assert.equal(contents, 'synthetic-password-B');
});

test('password generation uses rejection sampling rather than modulo-biased bytes', async () => {
    const { generatePassword } = await helpersPromise;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_+';
    const limit = Math.floor(256 / alphabet.length) * alphabet.length;
    let calls = 0;
    const random = (bytes) => {
        calls += 1;
        if (calls === 1) bytes.fill(limit);
        else for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % alphabet.length;
        return bytes;
    };
    assert.equal(generatePassword(20, random), alphabet.slice(0, 20));
    assert.equal(calls, 2, 'Bytes in the incomplete modulo range must be discarded');
    assert.equal(generatePassword(1).length, 12);
    assert.equal(generatePassword(999).length, 64);
    assert.match(generatePassword(32), /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*\-_+]{32}$/);
});

test('website links allow HTTP(S) and refuse scripts, local files and embedded credentials', async () => {
    const { safeWebUrl } = await helpersPromise;
    assert.equal(safeWebUrl('https://example.invalid/path?q=synthetic#section'), 'https://example.invalid/path?q=synthetic#section');
    assert.equal(safeWebUrl('http://example.invalid'), 'http://example.invalid/');
    for (const value of ['javascript:alert(1)', 'data:text/html,<script>test</script>', 'file:///synthetic.txt', 'ftp://example.invalid', '//example.invalid', '/relative', 'https://user:password@example.invalid', 'not a URL']) {
        assert.equal(safeWebUrl(value), null, value);
    }
});

test('GitHub repository parsing validates the full URL before wizard navigation', async () => {
    const { parseGithubRepository } = await helpersPromise;
    assert.deepEqual(parseGithubRepository('https://github.com/synthetic-owner/synthetic-private-vault.git'), { owner: 'synthetic-owner', repo: 'synthetic-private-vault' });
    for (const value of ['http://github.com/test/repo', 'https://github.com/test', 'https://github.com/test/repo/tree/main', 'https://github.com.evil.invalid/test/repo', 'https://user:password@github.com/test/repo']) {
        assert.throws(() => parseGithubRepository(value), /仓库地址/);
    }
});
