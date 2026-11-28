const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const generatedBlock = /\/\/ BEGIN GENERATED SHELL[\s\S]*?\/\/ END GENERATED SHELL/;
const placeholder = '// BEGIN GENERATED SHELL\n// END GENERATED SHELL';
const textExtensions = new Set(['.html', '.css', '.js', '.mjs', '.cjs', '.svg', '.webmanifest', '.json', '.txt', '.map']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function discoverShellPaths(targetDir) {
    const discovered = [];
    function walk(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                const rel = path.relative(targetDir, fullPath).split(path.sep).join('/');
                if (rel === 'sw.js') continue;
                discovered.push(`./${rel}`);
            }
        }
    }
    if (fs.existsSync(targetDir)) walk(targetDir);
    return discovered.sort((a, b) => a.localeCompare(b, 'en'));
}

function hashFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (textExtensions.has(ext)) {
        return sha256(fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'));
    }
    return sha256(fs.readFileSync(filePath));
}

function generateWorker(targetDir) {
    const workerPath = path.join(targetDir, 'sw.js');
    const source = fs.readFileSync(workerPath, 'utf8').replace(/\r\n/g, '\n');
    if (!generatedBlock.test(source)) throw new Error('sw.js is missing its generated shell block');
    const shellPaths = discoverShellPaths(targetDir);
    if (!shellPaths.includes('./index.html')) throw new Error('Build output is missing index.html');
    // Every shell asset is hashed with canonical LF line endings for text files
    // so Windows CRLF checkouts match Linux CI builds.
    const assets = shellPaths.map((assetPath) => ({
        path: assetPath,
        sha256: hashFile(path.join(targetDir, assetPath)),
    }));
    const version = sha256(JSON.stringify(assets) + source.replace(generatedBlock, placeholder));
    const block = `// BEGIN GENERATED SHELL\nconst SHELL_VERSION = '${version}';\nconst APP_SHELL = ${JSON.stringify(assets, null, 4)};\n// END GENERATED SHELL`;
    return { source: source.replace(generatedBlock, block), version, assets };
}

function parseTargetDir(argv) {
    const dirIndex = argv.indexOf('--dir');
    if (dirIndex !== -1 && argv[dirIndex + 1]) {
        return path.resolve(argv[dirIndex + 1]);
    }
    return path.resolve(__dirname, '..', 'dist');
}

if (require.main === module) {
    const targetDir = parseTargetDir(process.argv.slice(2));
    const generated = generateWorker(targetDir);
    const workerPath = path.join(targetDir, 'sw.js');
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

module.exports = { generateWorker, discoverShellPaths };
