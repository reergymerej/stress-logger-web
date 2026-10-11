import { test, expect, type Page } from '@playwright/test';

const API = 'https://stress-logger-reergymerej.fly.dev/v1/thoughts';
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

type Thought = { id: string; description: string | null; timestamp: string; analysis?: object };

// A stand-in for the API: the days, and each day's thoughts. dates records which days were asked for.
// down makes the server unreachable, and status makes it answer with that error.
async function fakeApi(page: Page, days: { date: string; count: number }[] = [], thoughts: Record<string, Thought[]> = {}) {
  const fake = { dates: [] as string[], down: false, status: 200 };
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' };
  const answer = (handle: (url: URL) => object) => async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    if (fake.down) return route.abort('connectionrefused');
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.headers().authorization !== basic('alice', 'secret')) return route.fulfill({ status: 401, headers });
    if (fake.status !== 200) return route.fulfill({ status: fake.status, headers, json: { error: 'boom' } });
    return route.fulfill({ headers, json: handle(new URL(req.url())) });
  };
  // Anything else on the API host is a 404, so calling the wrong path fails fast instead of waiting on the network.
  await page.route(`${new URL(API).origin}/**`, (route) => route.fulfill({ status: 404, headers }));
  await page.route(`${API}/days`, answer(() => days));
  await page.route((url) => url.href.startsWith(`${API}?date=`), answer((url) => {
    const date = url.searchParams.get('date')!;
    fake.dates.push(date);
    return thoughts[date] ?? [];
  }));
  return fake;
}

// Signed in as alice, as the main page leaves it, unless other credentials are given.
async function signedIn(page: Page, credentials = 'alice:secret') {
  await page.goto('/history');
  await page.evaluate((c) => localStorage.setItem('credentials', btoa(c)), credentials);
}

const days = [
  { date: '2026-10-10', count: 2 },
  { date: '2026-10-09', count: 3 },
  { date: '2026-10-07', count: 1 },
];
const dayLinks = (page: Page) => page.locator('#days a');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-10T16:00:00Z'));
});

test('lists the days before today, newest first, with how many thoughts each', async ({ page }) => {
  await fakeApi(page, days);
  await signedIn(page);
  await page.goto('/history');

  await expect(dayLinks(page)).toHaveText(['Friday, October 9, 2026 3 thoughts', 'Wednesday, October 7, 2026 1 thought']);
});

test.describe('in New York', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('today is the local day', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-10T02:30:00Z')); // Still the 9th in New York.
    await fakeApi(page, days);
    await signedIn(page);
    await page.goto('/history');

    await expect(dayLinks(page)).toHaveText(['Wednesday, October 7, 2026 1 thought']);
  });
});

test('says so when there is nothing before today', async ({ page }) => {
  await fakeApi(page, [{ date: '2026-10-10', count: 2 }]);
  await signedIn(page);
  await page.goto('/history');

  await expect(page.getByText('Nothing before today yet.')).toBeVisible();
  await expect(dayLinks(page)).toHaveCount(0);
});

test("opening a day shows that day's thoughts, with their times and sentiments", async ({ page }) => {
  const api = await fakeApi(page, days, {
    '2026-10-09': [
      { id: '3', description: 'Shipped it', timestamp: '2026-10-09T17:15:00Z', analysis: { sentiment: 'positive' } },
      { id: '2', description: null, timestamp: '2026-10-09T12:00:00Z', analysis: {} },
      { id: '1', description: 'Traffic', timestamp: '2026-10-09T08:00:00Z', analysis: {} },
    ],
  });
  await signedIn(page);
  await page.goto('/history');

  await dayLinks(page).first().click();

  await expect(page).toHaveURL(/history\?date=2026-10-09$/);
  await expect(page.getByRole('heading', { name: 'Friday, October 9, 2026' })).toBeVisible();
  await expect(page.locator('#thoughts li')).toHaveText(['5:15 PM Positive Shipped it', '12:00 PM No details', '8:00 AM Traffic']);
  expect(api.dates).toEqual(['2026-10-09']);
});

test('goes back from a day to all the days', async ({ page }) => {
  await fakeApi(page, days);
  await signedIn(page);
  await page.goto('/history?date=2026-10-09');

  await page.getByRole('link', { name: 'All days' }).click();

  await expect(page).toHaveURL(/history$/);
  await expect(dayLinks(page)).toHaveCount(2);
});

test('the main page links here, and back', async ({ page }) => {
  await fakeApi(page, days);
  await signedIn(page);
  await page.goto('/');

  await page.getByRole('link', { name: 'History' }).click();
  await expect(dayLinks(page)).toHaveCount(2);

  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByLabel("What's on your mind?")).toBeVisible();
});

test('sends you to sign in on the main page without credentials', async ({ page }) => {
  await fakeApi(page, days);
  await page.goto('/history');

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page).not.toHaveURL(/history/);
});

test('sends you to sign in on the main page when the server turns the credentials down', async ({ page }) => {
  await fakeApi(page, days);
  await signedIn(page, 'alice:wrong');
  await page.goto('/history');

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page).not.toHaveURL(/history/);
});

for (const [what, path] of [['the days', '/history'], ['a day', '/history?date=2026-10-09']]) {
  test(`says so, and tries again, when ${what} can't be loaded`, async ({ page }) => {
    const api = await fakeApi(page, days, { '2026-10-09': [{ id: '1', description: 'Traffic', timestamp: '2026-10-09T08:00:00Z' }] });
    api.down = true;
    await signedIn(page);
    await page.goto(path);
    await expect(page.getByText("Couldn't load it.")).toBeVisible();

    api.down = false;
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByText("Couldn't load it.")).toBeHidden();
    await expect(path.includes('date') ? page.getByText('Traffic') : page.getByRole('link', { name: /October 9/ })).toBeVisible();
  });
}

test("says so when the server answers with an error", async ({ page }) => {
  const api = await fakeApi(page, days);
  api.status = 500;
  await signedIn(page);
  await page.goto('/history');

  await expect(page.getByText("Couldn't load it.")).toBeVisible();
});

test('fits the screen', async ({ page }) => {
  await fakeApi(page, days, { '2026-10-09': [{ id: '1', description: 'x'.repeat(300), timestamp: '2026-10-09T08:00:00Z' }] });
  await signedIn(page);
  await page.goto('/history?date=2026-10-09');
  await expect(page.locator('#thoughts li')).toHaveCount(1);

  const scrollsSideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(scrollsSideways).toBe(false);
});

test.describe('looks right', () => {
  test('the days', async ({ page }) => {
    await fakeApi(page, days);
    await signedIn(page);
    await page.goto('/history');
    await expect(dayLinks(page)).toHaveCount(2);

    await expect(page).toHaveScreenshot('days.png');
  });

  test('a day', async ({ page }) => {
    await fakeApi(page, days, {
      '2026-10-09': [
        { id: '3', description: 'Shipped it', timestamp: '2026-10-09T17:15:00Z', analysis: { sentiment: 'positive' } },
        { id: '2', description: 'Neutral thought', timestamp: '2026-10-09T13:00:00Z', analysis: { sentiment: 'neutral' } },
        { id: '1', description: 'Car broke down on the way to work', timestamp: '2026-10-09T08:00:00Z', analysis: { sentiment: 'negative' } },
      ],
    });
    await signedIn(page);
    await page.goto('/history?date=2026-10-09');
    await expect(page.locator('#thoughts li')).toHaveCount(3);

    await expect(page).toHaveScreenshot('day.png');
  });
});
