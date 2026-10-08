const fs = require('node:fs');
const path = require('node:path');
const { shellPaths } = require('./generate-sw.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const outputDirectory = process.argv[2] && path.resolve(process.argv[2]);
if (!outputDirectory || outputDirectory === repositoryRoot) throw new Error('Provide a separate empty deployment directory');
if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length) throw new Error('Deployment directory must be empty');
const releaseFiles = [...shellPaths, './sw.js', './vendor/lucide-LICENSE', './vendor/README.md'];
for (const file of releaseFiles) {
    const destination = path.join(outputDirectory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, file), destination);
}
console.log(`Prepared ${releaseFiles.length} public application files in ${outputDirectory}`);
