const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const shellPaths = [
    './index.html', './styles.css', './app.js', './vault-core.js', './sync-core.js',
    './ui-helpers.js', './manifest.webmanifest', './icon.svg', './vendor/lucide-0.468.0.min.js'
];
const generatedBlock = /\/\/ BEGIN GENERATED SHELL[\s\S]*?\/\/ END GENERATED SHELL/;
const placeholder = '// BEGIN GENERATED SHELL\n// END GENERATED SHELL';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function generateWorker(repositoryRoot) {
    const workerPath = path.join(repositoryRoot, 'sw.js');
    const source = fs.readFileSync(workerPath, 'utf8').replace(/\r\n/g, '\n');
    if (!generatedBlock.test(source)) throw new Error('sw.js is missing its generated shell block');
    // Every shell asset is UTF-8 text. Canonical line endings keep the release
    // valid when Git checks the same source out as CRLF on Windows and LF in CI.
    const assets = shellPaths.map((assetPath) => ({ path: assetPath, sha256: sha256(fs.readFileSync(path.join(repositoryRoot, assetPath), 'utf8').replace(/\r\n/g, '\n')) }));
    const version = sha256(JSON.stringify(assets) + source.replace(generatedBlock, placeholder));
    const block = `// BEGIN GENERATED SHELL\nconst SHELL_VERSION = '${version}';\nconst APP_SHELL = ${JSON.stringify(assets, null, 4)};\n// END GENERATED SHELL`;
    return { source: source.replace(generatedBlock, block), version, assets };
}

if (require.main === module) {
    const repositoryRoot = path.resolve(__dirname, '..');
    const generated = generateWorker(repositoryRoot);
    const workerPath = path.join(repositoryRoot, 'sw.js');
    if (process.argv.includes('--check')) {
        if (fs.readFileSync(workerPath, 'utf8').replace(/\r\n/g, '\n') !== generated.source) {
            throw new Error('Service worker hashes are stale; run node scripts/generate-sw.cjs');
        }
        console.log(`Service worker hashes verified: ${generated.version.slice(0, 12)}`);
    } else {
        fs.writeFileSync(workerPath, generated.source);
        console.log(`Prepared offline shell: ${generated.version.slice(0, 12)} (${generated.assets.length} assets)`);
    }
}

module.exports = { generateWorker, shellPaths };
