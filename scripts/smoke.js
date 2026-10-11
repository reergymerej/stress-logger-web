// Post-deploy check: the site is up and points at the API.
// Usage: node scripts/smoke.js https://<user>.github.io/stress-logger-web/
const base = process.argv[2];
if (!base) {
  console.error('Usage: node scripts/smoke.js <url>');
  process.exit(1);
}

const text = async (path) => {
  const res = await fetch(new URL(path, base.endsWith('/') ? base : `${base}/`));
  return res.ok ? res.text() : '';
};

const checks = [
  { name: 'serves the page', ok: (await text('')).includes('<title>Thought Logger</title>') },
  { name: 'serves the history page', ok: (await text('history')).includes('<title>History · Thought Logger</title>') },
  { name: 'points at the API', ok: (await text('config.js')).includes('https://stress-logger-reergymerej.fly.dev') },
];

for (const check of checks) console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
