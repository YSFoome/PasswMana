import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    createClipboardManager,
    parseGithubRepository,
    safeWebUrl,
    sortEntries,
} from '../src/core/ui-helpers';

function fakeClock() {
    let now = 0;
    let nextId = 0;
    const timers = new Map<number, { at: number; callback: () => Promise<void> | void }>();
    return {
        schedule(callback: () => void, delay: number) {
            const id = ++nextId;
            timers.set(id, { at: now + delay, callback });
            return id;
        },
        cancel(id: number | undefined) {
            if (id !== undefined) timers.delete(id);
        },
        async advance(milliseconds: number) {
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
    const clock = fakeClock();
    let contents = '';
    const manager = createClipboardManager(
        { async writeText(value) { contents = value; }, async readText() { return contents; } },
        clock.schedule,
        clock.cancel,
    );
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
    const clock = fakeClock();
    let contents = '';
    const manager = createClipboardManager(
        { async writeText(value) { contents = value; }, async readText() { return contents; } },
        clock.schedule,
        clock.cancel,
    );
    await manager.copy('synthetic-app-password');
    contents = 'synthetic-other-application-text';
    await clock.advance(30000);
    assert.equal(contents, 'synthetic-other-application-text');
});

test('a failed newer copy preserves cleanup of the previous password', async () => {
    const clock = fakeClock();
    let contents = '';
    const manager = createClipboardManager(
        {
            async writeText(value) {
                if (value === 'synthetic-rejected-password') throw new DOMException('Synthetic denial', 'NotAllowedError');
                contents = value;
            },
            async readText() { return contents; },
        },
        clock.schedule,
        clock.cancel,
    );
    await manager.copy('synthetic-previous-password');
    await clock.advance(20000);
    await assert.rejects(manager.copy('synthetic-rejected-password'), { name: 'NotAllowedError' });
    await clock.advance(10000);
    assert.equal(contents, '', 'A denied copy must not disable cleanup of the existing password');
});

test('clipboard cleanup does not erase content when read access is denied or unavailable', async () => {
    for (const readText of [undefined, async () => { throw new DOMException('Synthetic denial', 'NotAllowedError'); }]) {
        const clock = fakeClock();
        let contents = '';
        const manager = createClipboardManager(
            { async writeText(value) { contents = value; }, ...(readText ? { readText } : {}) },
            clock.schedule,
            clock.cancel,
        );
        await manager.copy('synthetic-protected-clipboard');
        await clock.advance(30000);
        assert.equal(contents, 'synthetic-protected-clipboard');
    }
});

test('a copy that opts out of cleanup cancels the previous password timer', async () => {
    const clock = fakeClock();
    let contents = '';
    const manager = createClipboardManager(
        { async writeText(value) { contents = value; }, async readText() { return contents; } },
        clock.schedule,
        clock.cancel,
    );
    await manager.copy('synthetic-password');
    await clock.advance(10000);
    await manager.copy('synthetic-account-name', { clearAfter: 0 });
    await clock.advance(60000);
    assert.equal(contents, 'synthetic-account-name', 'a non-secret copy must not inherit the password cleanup timer');
});

test('a copy can use a longer cleanup window', async () => {
    const clock = fakeClock();
    let contents = '';
    const manager = createClipboardManager(
        { async writeText(value) { contents = value; }, async readText() { return contents; } },
        clock.schedule,
        clock.cancel,
    );
    await manager.copy('synthetic-recovery-code', { clearAfter: 120000 });
    await clock.advance(119999);
    assert.equal(contents, 'synthetic-recovery-code');
    await clock.advance(1);
    assert.equal(contents, '');
});

test('an old asynchronous clipboard read cannot clear a newer copy', async () => {
    const callbacks: Array<() => Promise<void> | void> = [];
    let contents = '';
    let resolveRead!: (value: string) => void;
    const manager = createClipboardManager(
        {
            async writeText(value) { contents = value; },
            readText() { return new Promise((resolve) => { resolveRead = resolve; }); },
        },
        (callback) => { callbacks.push(callback); return callbacks.length; },
        () => {},
    );
    await manager.copy('synthetic-password-A');
    const cleanup = callbacks[0]();
    await manager.copy('synthetic-password-B');
    resolveRead('synthetic-password-A');
    await cleanup;
    assert.equal(contents, 'synthetic-password-B');
});

test('sortEntries pins favorites in the default order and sorts by title or creation date', () => {
    const entries = [
        { id: 'a', title: 'Alpha', favorite: true, updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'b', title: 'Bravo', favorite: false, updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-02T00:00:00Z' },
        { id: 'c', title: 'Charlie', favorite: false, updatedAt: '2026-01-03T00:00:00Z', createdAt: '2026-01-03T00:00:00Z' },
    ];
    assert.deepEqual(sortEntries(entries, 'updated').map((entry) => entry.id), ['a', 'c', 'b']);
    assert.deepEqual(sortEntries(entries, 'title').map((entry) => entry.id), ['a', 'b', 'c']);
    assert.deepEqual(sortEntries(entries, 'created').map((entry) => entry.id), ['c', 'b', 'a']);
    assert.deepEqual(entries.map((entry) => entry.id), ['a', 'b', 'c'], 'sorting must not mutate the vault array');
});

test('website links allow HTTP(S) and refuse scripts, local files and embedded credentials', () => {
    assert.equal(safeWebUrl('https://example.invalid/path?q=synthetic#section'), 'https://example.invalid/path?q=synthetic#section');
    assert.equal(safeWebUrl('http://example.invalid'), 'http://example.invalid/');
    for (const value of ['javascript:alert(1)', 'data:text/html,<script>test</script>', 'file:///synthetic.txt', 'ftp://example.invalid', '//example.invalid', '/relative', 'https://user:password@example.invalid', 'not a URL']) {
        assert.equal(safeWebUrl(value), null, value);
    }
});

test('GitHub repository parsing validates the full URL before wizard navigation', () => {
    assert.deepEqual(parseGithubRepository('https://github.com/synthetic-owner/synthetic-private-vault.git'), { owner: 'synthetic-owner', repo: 'synthetic-private-vault' });
    for (const value of ['http://github.com/test/repo', 'https://github.com/test', 'https://github.com/test/repo/tree/main', 'https://github.com.evil.invalid/test/repo', 'https://user:password@github.com/test/repo']) {
        assert.throws(() => parseGithubRepository(value), /仓库地址/);
    }
});
