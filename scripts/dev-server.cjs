// Static preview server for built dist/ output.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist');
const port = Number(process.env.PORT) || 4173;
const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.cjs': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

http.createServer((request, response) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
        response.writeHead(400).end();
        return;
    }
    const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end();
        return;
    }
    fs.readFile(filename, (error, content) => {
        response.writeHead(error ? 404 : 200, {
            'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        response.end(error ? '' : content);
    });
}).listen(port, '127.0.0.1', () => console.log(`PasswMana preview on http://localhost:${port}`));
