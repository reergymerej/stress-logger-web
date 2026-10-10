// Serves the site locally, pointed at the backend you pick: local (the default), prod, or any URL.
// Usage: npm start -- [local|prod|<url>]. PORT overrides 8080.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const backends = { local: 'http://localhost:3000', prod: 'https://stress-logger-reergymerej.fly.dev' };
const choice = process.argv[2] ?? 'local';
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

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end(`// Where the Thought Logger API lives (set by npm start).\nconst API_URL = ${JSON.stringify(api)};\n`);
  }
  const file = files[path];
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' });
  res.end(await readFile(join(root, file[0])));
}).listen(port, () => console.log(`Thought Logger on http://localhost:${port}, using the API at ${api}`));
