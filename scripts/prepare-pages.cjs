const fs = require('node:fs');
const path = require('node:path');
const { generateWorker, discoverShellPaths } = require('./generate-sw.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const distDirectory = path.join(repositoryRoot, 'dist');
const outputDirectory = process.argv[2] && path.resolve(process.argv[2]);

if (!outputDirectory || outputDirectory === repositoryRoot || outputDirectory === distDirectory) {
    throw new Error('Provide a separate empty deployment directory');
}
if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length) {
    throw new Error('Deployment directory must be empty');
}
if (!fs.existsSync(distDirectory)) {
    throw new Error('Build output dist/ does not exist; run npm run build first');
}

const generated = generateWorker(distDirectory);
const workerPath = path.join(distDirectory, 'sw.js');
if (fs.readFileSync(workerPath, 'utf8').replace(/\r\n/g, '\n') !== generated.source) {
    throw new Error('Service worker hashes in dist/sw.js are stale; run npm run build');
}

const releaseFiles = [...discoverShellPaths(distDirectory), './sw.js'];
for (const file of releaseFiles) {
    const destination = path.join(outputDirectory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(distDirectory, file), destination);
}
console.log(`Prepared ${releaseFiles.length} public application files in ${outputDirectory}`);
