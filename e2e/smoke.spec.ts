import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const smoke = (url: string) =>
  new Promise<number | null>((resolve) => spawn('node', ['scripts/smoke.js', url]).on('exit', resolve));

test('smoke passes against the site', async ({ baseURL }) => {
  expect(await smoke(baseURL!)).toBe(0);
});

test('smoke fails against something that is not the site', async () => {
  const server = createServer((_, res) => res.writeHead(404).end()).listen(0);
  const { port } = server.address() as { port: number };

  try {
    expect(await smoke(`http://localhost:${port}`)).not.toBe(0);
  } finally {
    server.close();
  }
});
