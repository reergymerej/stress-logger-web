// Serves the site locally, pointed at the backend you pick: local (the default), prod, or any URL.
// Usage: npm start -- [local|prod|<url>]. PORT overrides 8080.
// npm run dev (--watch) does the same, and reloads the page whenever a site file changes.
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const backends = { local: 'http://localhost:3000', prod: 'https://stress-logger-reergymerej.fly.dev' };
const args = process.argv.slice(2);
const watching = args.includes('--watch');
const choice = args.find((arg) => arg !== '--watch') ?? 'local';
const api = backends[choice] ?? (URL.canParse(choice) ? choice.replace(/\/$/, '') : undefined);
if (!api) {
  console.error(`Unknown backend "${choice}". Use local, prod or a URL.`);
  process.exit(1);
}
const port = Number(process.env.PORT ?? 8080);

// Only the files GitHub Pages publishes. config.js is generated, pointing at the chosen backend.
const files = {
  '/': ['index.html', 'text/html'],
  '/index.html': ['index.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
};
const root = join(import.meta.dirname, '..');

// Pages open in watch mode listen on /reload, and get an event whenever a site file changes.
const listeners = new Set();
const reloader = `<script>new EventSource('/reload').onmessage = () => location.reload();</script>\n`;
// The folder is watched, not each file, so edits survive editors that save by replacing the file.
const siteFiles = new Set(Object.values(files).map(([file]) => file));
if (watching) {
  watch(root, (_, file) => {
    if (!siteFiles.has(file)) return;
    console.log(`${time()} ${file} changed, reloading ${listeners.size} page${listeners.size === 1 ? '' : 's'}`);
    for (const res of listeners) res.write('data: reload\n\n');
  });
}

const time = () => new Date().toLocaleTimeString();

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.on('finish', () => console.log(`${time()} ${req.method} ${path} ${res.statusCode}`));
  if (watching && path === '/reload') console.log(`${time()} page listening for changes`);
  if (path === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end(`// Where the Thought Logger API lives (set by npm start).\nconst API_URL = ${JSON.stringify(api)};\n`);
  }
  if (watching && path === '/reload') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    // Sent now, so the browser knows it's connected before anything changes.
    res.write(': connected\n\n');
    listeners.add(res);
    return req.on('close', () => listeners.delete(res));
  }
  const file = files[path];
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' });
  const body = await readFile(join(root, file[0]));
  res.end(watching && file[1] === 'text/html' ? body.toString().replace('</body>', `${reloader}</body>`) : body);
}).listen(port, () => {
  console.log(`Thought Logger on http://localhost:${port}, using the API at ${api}${watching ? '. The page reloads on changes.' : ''}`);
});
