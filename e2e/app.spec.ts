import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const API = 'https://stress-logger-reergymerej.fly.dev/v1/stressors';
const USER = 'alice';
const PASSWORD = 'secret';
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

type Stressor = { id: string; description: string; timestamp: string };

// A stand-in for the API, so these tests don't depend on the server repo.
async function fakeApi(page: Page, stressors: Stressor[] = []) {
  const posts: unknown[] = [];
  await page.route(API, async (route) => {
    const req = route.request();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.headers().authorization !== basic(USER, PASSWORD)) return route.fulfill({ status: 401, headers });
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      posts.push(body);
      const stressor = { id: randomUUID(), description: body.description, timestamp: new Date().toISOString() };
      stressors.unshift(stressor);
      return route.fulfill({ status: 201, headers, json: stressor });
    }
    return route.fulfill({ headers, json: stressors });
  });
  return { posts };
}

async function signIn(page: Page, password = PASSWORD, user = USER) {
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const log = async (page: Page, description: string) => {
  await page.getByLabel('What stressed you?').fill(description);
  await page.getByRole('button', { name: 'Log' }).click();
};

test('asks for a username and password, then lists stressors newest first, in local time', async ({ page }) => {
  await fakeApi(page, [
    { id: '2', description: 'Car broke down', timestamp: '2026-10-02T09:05:00Z' },
    { id: '1', description: 'Flight delayed', timestamp: '2026-10-01T13:30:00Z' },
  ]);
  await page.goto('/');

  await signIn(page);

  const items = page.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Car broke down');
  await expect(items.nth(0)).toContainText('10/2/2026, 9:05 AM');
  await expect(items.nth(1)).toContainText('Flight delayed');
});

test('remembers the sign-in', async ({ page }) => {
  await fakeApi(page, [{ id: '1', description: 'Remembered', timestamp: '2026-10-01T13:30:00Z' }]);
  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('listitem')).toContainText('Remembered');

  await page.reload();

  await expect(page.getByRole('listitem')).toContainText('Remembered');
  await expect(page.getByLabel('Password')).toBeHidden();
});

test.describe('asks again', () => {
  for (const [what, password, user] of [['when the password is wrong', 'wrong', USER], ['for an unknown user', PASSWORD, 'bob']]) {
    test(what, async ({ page }) => {
      await fakeApi(page);
      await page.goto('/');

      await signIn(page, password, user);

      await expect(page.getByText('Wrong username or password')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByLabel('What stressed you?')).toBeHidden();
    });
  }
});


test('logging a stressor shows it and clears the input', async ({ page }) => {
  const { posts } = await fakeApi(page);
  await page.goto('/');
  await signIn(page);

  await log(page, 'Traffic jam');

  await expect(page.getByRole('listitem')).toContainText('Traffic jam');
  await expect(page.getByLabel('What stressed you?')).toHaveValue('');
  expect(posts).toEqual([{ description: 'Traffic jam' }]);
});

test('blank descriptions are not logged', async ({ page }) => {
  const { posts } = await fakeApi(page);
  await page.goto('/');
  await signIn(page);
  await expect(page.getByLabel('What stressed you?')).toBeVisible();

  await log(page, '   ');
  await page.waitForLoadState('networkidle');

  expect(posts).toEqual([]);
});

test('descriptions are shown as text, not HTML', async ({ page }) => {
  await fakeApi(page);
  await page.goto('/');
  await signIn(page);

  await log(page, '<b>bold</b>');

  await expect(page.getByRole('listitem')).toContainText('<b>bold</b>');
});

test('fits the screen, with touch-friendly controls', async ({ page }) => {
  await fakeApi(page, [{ id: '1', description: 'x'.repeat(300), timestamp: '2026-10-01T13:30:00Z' }]);
  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('listitem')).toBeVisible();

  const scrollsSideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(scrollsSideways).toBe(false);
  const button = await page.getByRole('button', { name: 'Log' }).boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
  // Below 16px, iOS zooms in when the input is focused.
  const fontSize = await page.getByLabel('What stressed you?').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
});
