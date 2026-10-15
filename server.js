// AppBacked static site server for Railway. Zero dependencies.
// - serves the built site from this folder, directory -> index.html, unknown -> 404.html (status 404)
// - redirects www.<host> to the bare domain, gzip for text assets, sane caching and security headers
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const PORT = +(process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.zip': 'application/zip',
};
const COMPRESS = /\.(html|css|js|json|xml|txt|svg)$/i;
const BLOCK = new Set(['server.js', 'package.json', 'package-lock.json', 'railway.json']);
const cache = new Map();

function headersFor(file) {
  const ext = path.extname(file).toLowerCase();
  const h = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  h['Cache-Control'] = ext === '.html' || ext === '.xml' || ext === '.txt' ? 'no-cache' : 'public, max-age=3600';
  return h;
}

function send(req, res, file, status) {
  const head = headersFor(file);
  const gz = COMPRESS.test(file) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const key = file + (gz ? ':gz' : '');
  let body = cache.get(key);
  if (!body) {
    const raw = fs.readFileSync(file);
    body = gz ? zlib.gzipSync(raw, { level: 9 }) : raw;
    if (body.length < 2e6) cache.set(key, body);
  }
  if (gz) { head['Content-Encoding'] = 'gzip'; head['Vary'] = 'Accept-Encoding'; }
  head['Content-Length'] = body.length;
  res.writeHead(status, head);
  res.end(req.method === 'HEAD' ? undefined : body);
}

http.createServer((req, res) => {
  try {
    const host = (req.headers.host || '').toLowerCase();
    if (host.startsWith('www.')) {
      res.writeHead(301, { Location: `https://${host.slice(4)}${req.url}` });
      return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    let p = decodeURIComponent(url.pathname);
    let file = path.resolve(ROOT, '.' + p);
    if (!(file === ROOT || file.startsWith(ROOT + path.sep)) || BLOCK.has(path.basename(file)) || p.includes('/.')) return send(req, res, path.join(ROOT, '404.html'), 404);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' + url.search }); return res.end(); }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) return send(req, res, path.join(ROOT, '404.html'), 404);
    send(req, res, file, 200);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
}).listen(PORT, '0.0.0.0', () => console.log(`AppBacked site on :${PORT}`));
