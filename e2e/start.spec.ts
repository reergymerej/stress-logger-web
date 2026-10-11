import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';

// Runs `npm start -- <backend>` on a free port, and stops it after the test.
async function start(backend?: string) {
  const port = 4000 + Math.floor(Math.random() * 1000);
  const proc = spawn('node', ['scripts/start.js', ...(backend ? [backend] : [])], { env: { ...process.env, PORT: String(port) } });
  let output = '';
  proc.stdout.on('data', (chunk) => (output += chunk));
  proc.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise<number | null>((resolve) => proc.on('exit', resolve));
  const url = `http://localhost:${port}`;
  // Waits for the server to say it's listening, however long a busy machine takes to start it, but fails as soon
  // as it exits, and gives up after 10 seconds.
  const listening = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`not serving at ${url} after 10s: ${output}`)), 10_000);
    proc.stdout.on('data', () => output.includes(`on ${url}`) && (clearTimeout(timer), resolve()));
    proc.on('exit', (code) => (clearTimeout(timer), reject(new Error(`exited with ${code} before serving: ${output}`))));
  });
  listening.catch(() => {});
  const ready = async () => {
    await listening;
    return fetch(url);
  };
  return { url, ready, exited, output: () => output, stop: () => proc.kill() };
}

for (const [backend, api] of [
  [undefined, 'http://localhost:3000'],
  ['local', 'http://localhost:3000'],
  ['prod', 'https://stress-logger-reergymerej.fly.dev'],
  ['https://dev.example', 'https://dev.example'],
]) {
  test(`npm start ${backend ?? '(no backend)'} serves the site, pointed at ${api}`, async () => {
    const server = await start(backend);
    try {
      expect(await (await server.ready()).text()).toContain('<title>Thought Logger</title>');
      expect(await (await fetch(`${server.url}/config.js`)).text()).toContain(`const API_URL = "${api}";`);
      expect(server.output()).toContain(api);
    } finally {
      server.stop();
    }
  });
}

test('npm start with a backend URL sends API requests there', async ({ page }) => {
  const server = await start('https://dev.example');
  try {
    await server.ready();
    const requests: string[] = [];
    await page.route('https://dev.example/**', (route) => {
      requests.push(route.request().url());
      return route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' } });
    });

    await page.goto(server.url);
    await page.evaluate(() => localStorage.setItem('credentials', btoa('u:p')));
    await page.reload();

    await expect.poll(() => requests.some((url) => url.startsWith('https://dev.example/v1/thoughts'))).toBe(true);
  } finally {
    server.stop();
  }
});

test('npm start serves only the site files', async () => {
  const server = await start('local');
  try {
    await server.ready();
    expect((await fetch(`${server.url}/package.json`)).status).toBe(404);
    expect((await fetch(`${server.url}/style.css`)).headers.get('content-type')).toContain('text/css');
    expect((await fetch(`${server.url}/app.js`)).headers.get('content-type')).toContain('javascript');
  } finally {
    server.stop();
  }
});

test('npm start refuses a backend that is neither a name nor a URL', async () => {
  const server = await start('staging');

  expect(await server.exited).not.toBe(0);
  expect(server.output()).toContain('Unknown backend "staging". Use local, prod or a URL.');
});
