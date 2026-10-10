import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const API = 'https://stress-logger-reergymerej.fly.dev/v1/thoughts';
const USER = 'alice';
const PASSWORD = 'secret';
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// The time embedded in a UUIDv7.
const v7Time = (id: string) => new Date(parseInt(id.slice(0, 8) + id.slice(9, 13), 16)).toISOString();
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

type Thought = { id: string; description: string | null; timestamp: string; analysis?: object };

// A stand-in for the API, so these tests don't depend on the server repo.
type Counts = { byHour: number[]; byDayOfWeek: number[] };

async function fakeApi(page: Page, thoughts: Thought[] = [], counts: Counts = { byHour: Array(24).fill(0), byDayOfWeek: Array(7).fill(0) }) {
  // hold keeps POSTs waiting until it resolves, and listHold the list. down makes the server unreachable.
  // postFails fails the next POSTs: 'down' never reaches the server, 'lost' saves the thought but loses the response,
  // and a number is that status.
  const fake = {
    posts: [] as { id?: string; description?: string; timestamp?: string }[],
    postFails: null as null | 'down' | 'lost' | number,
    deletes: [] as string[],
    // Sentiments set by hand, and the status the next ones answer with.
    sentimentPuts: [] as { id: string; sentiment: string }[],
    sentimentStatus: 200,
    today: { status: 200, json: { positive: 0, negative: 0, neutral: 0 } as object },
    todayDates: [] as string[],
    // What GET /analyses answers, by id, and the ids each poll asked for.
    analyses: {} as Record<string, object>,
    analysisPolls: [] as string[][],
    counts,
    countsStatus: 200,
    hold: null as Promise<void> | null,
    listHold: null as Promise<void> | null,
    down: false,
  };
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' };
  // Anything else on the API host is a 404, so calling the wrong path fails fast instead of waiting on the network.
  await page.route(`${new URL(API).origin}/**`, (route) => route.fulfill({ status: 404, headers }));
  await page.route(`${API}/counts`, async (route) => {
    if (fake.down) return route.abort('connectionrefused');
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().headers().authorization !== basic(USER, PASSWORD)) return route.fulfill({ status: 401, headers });
    if (fake.countsStatus !== 200) return route.fulfill({ status: fake.countsStatus, headers, json: { error: 'boom' } });
    return route.fulfill({ headers, json: fake.counts });
  });
  const oneThought = (url: URL) => url.href.startsWith(`${API}/`) && url.href !== `${API}/counts`;
  await page.route(oneThought, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.headers().authorization !== basic(USER, PASSWORD)) return route.fulfill({ status: 401, headers });
    const [id, sub] = req.url().slice(`${API}/`.length).split('/');
    const index = thoughts.findIndex((s) => s.id === id);
    if (sub === 'sentiment' && req.method() === 'PUT' && index !== -1) {
      const { sentiment } = req.postDataJSON();
      fake.sentimentPuts.push({ id, sentiment });
      if (fake.sentimentStatus !== 200) return route.fulfill({ status: fake.sentimentStatus, headers, json: { error: 'boom' } });
      thoughts[index].analysis = { sentiment };
      return route.fulfill({ headers, json: { sentiment } });
    }
    if (sub) return route.fulfill({ status: 404, headers });
    if (req.method() !== 'DELETE' || index === -1) return route.fulfill({ status: 404, headers });
    fake.deletes.push(id);
    thoughts.splice(index, 1);
    return route.fulfill({ status: 204, headers });
  });
  // Registered after oneThought, so it wins for this path.
  await page.route((url) => url.href.startsWith(`${API}/sentiment-counts?`), async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().headers().authorization !== basic(USER, PASSWORD)) return route.fulfill({ status: 401, headers });
    const date = new URL(route.request().url()).searchParams.get('date')!;
    fake.todayDates.push(date);
    return route.fulfill({ status: fake.today.status, headers, json: { date, ...fake.today.json } });
  });
  // Registered after oneThought, so it wins for this path.
  await page.route((url) => url.href.startsWith(`${API}/analyses?`), async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().headers().authorization !== basic(USER, PASSWORD)) return route.fulfill({ status: 401, headers });
    const ids = new URL(route.request().url()).searchParams.get('ids')!.split(',');
    fake.analysisPolls.push(ids);
    return route.fulfill({ headers, json: Object.fromEntries(ids.map((id) => [id, fake.analyses[id] ?? {}])) });
  });
  await page.route(API, async (route) => {
    if (fake.down) return route.abort('connectionrefused');
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.headers().authorization !== basic(USER, PASSWORD)) return route.fulfill({ status: 401, headers });
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      fake.posts.push(body);
      await fake.hold;
      if (fake.postFails === 'down') return route.abort('connectionrefused');
      if (typeof fake.postFails === 'number') return route.fulfill({ status: fake.postFails, headers, json: { error: 'boom' } });
      // Like the server: the same id again is a retry, and gets the saved thought back.
      const saved = thoughts.find((t) => t.id === body.id);
      if (saved) return route.fulfill({ status: 200, headers, json: saved });
      const thought = {
        id: body.id ?? randomUUID(),
        description: body.description?.trim() ? body.description : null,
        timestamp: new Date(body.timestamp ?? Date.now()).toISOString(),
        analysis: {},
      };
      thoughts.unshift(thought);
      if (fake.postFails === 'lost') return route.abort('connectionreset');
      return route.fulfill({ status: 201, headers, json: thought });
    }
    await fake.listHold;
    return route.fulfill({ headers, json: thoughts });
  });
  return fake;
}

async function signIn(page: Page, password = PASSWORD, user = USER) {
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const log = async (page: Page, description: string) => {
  await page.getByLabel("What's on your mind?").fill(description);
  await page.getByRole('button', { name: 'Log' }).click();
};

test('is called Thought Logger', async ({ page }) => {
  await fakeApi(page);
  await page.goto('/');

  await expect(page).toHaveTitle('Thought Logger');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thought Logger');
});

test('asks for a username and password, then lists thoughts newest first, in local time', async ({ page }) => {
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

test.describe('focuses the input, ready to type', () => {
  test('after signing in', async ({ page }) => {
    await fakeApi(page);
    await page.goto('/');

    await signIn(page);

    await expect(page.getByLabel("What's on your mind?")).toBeFocused();
  });

  test('when the app loads signed in, once the server is awake', async ({ page }) => {
    const api = await fakeApi(page);
    let release!: () => void;
    api.listHold = new Promise((resolve) => (release = resolve));
    await page.addInitScript(() => localStorage.setItem('credentials', btoa('alice:secret')));
    await page.goto('/');
    await expect(page.getByText('Loading…')).toBeVisible();

    release();

    await expect(page.getByLabel("What's on your mind?")).toBeFocused();
  });

  test('when the server is reached after trying again', async ({ page }) => {
    const api = await fakeApi(page);
    api.down = true;
    await page.goto('/');
    await signIn(page);
    await expect(page.getByText("Couldn't reach the server.")).toBeVisible();

    api.down = false;
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByLabel("What's on your mind?")).toBeFocused();
  });
});

test.describe('asks again', () => {
  for (const [what, password, user] of [['when the password is wrong', 'wrong', USER], ['for an unknown user', PASSWORD, 'bob']]) {
    test(what, async ({ page }) => {
      await fakeApi(page);
      await page.goto('/');

      await signIn(page, password, user);

      await expect(page.getByText('Wrong username or password')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByLabel("What's on your mind?")).toBeHidden();
    });
  }
});


test.describe('after logging, focuses the input again, ready for the next one', () => {
  test('once the thought is logged', async ({ page }) => {
    await fakeApi(page);
    await page.goto('/');
    await signIn(page);

    await log(page, 'Traffic jam');

    await expect(page.getByRole('listitem')).toContainText('Traffic jam');
    await expect(page.getByLabel("What's on your mind?")).toBeFocused();
  });

  test('when logging fails, with the text kept to try again', async ({ page }) => {
    const api = await fakeApi(page);
    await page.goto('/');
    await signIn(page);
    api.postFails = 500;

    await log(page, 'Traffic jam');

    await expect(page.getByText("Couldn't log it. Try again.")).toBeVisible();
    await expect(page.getByLabel("What's on your mind?")).toBeFocused();
    await expect(page.getByLabel("What's on your mind?")).toHaveValue('Traffic jam');
  });
});

test('logging a thought shows it and clears the input', async ({ page }) => {
  const { posts } = await fakeApi(page);
  await page.goto('/');
  await signIn(page);

  await log(page, 'Traffic jam');

  await expect(page.getByRole('listitem')).toContainText('Traffic jam');
  await expect(page.getByLabel("What's on your mind?")).toHaveValue('');
  expect(posts).toMatchObject([{ description: 'Traffic jam' }]);
});

for (const [timezoneId, timestamp] of [
  ['America/Chicago', '2026-10-01T08:30:05-05:00'],
  ['Asia/Kolkata', '2026-10-01T19:00:05+05:30'],
  ['UTC', '2026-10-01T13:30:05+00:00'],
]) {
  test.describe(`in ${timezoneId}`, () => {
    test.use({ timezoneId });

    test('logging sends the local time, with its UTC offset', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-01T13:30:05Z'));
      const { posts } = await fakeApi(page);
      await page.goto('/');
      await signIn(page);

      await log(page, 'Late for standup');

      await expect(page.getByRole('listitem')).toContainText('Late for standup');
      expect(posts).toEqual([{ id: expect.stringMatching(V7), description: 'Late for standup', timestamp }]);
    });
  });
}

for (const [what, description] of [['an empty', ''], ['a blank', '   ']]) {
  test(`logging with ${what} description sends nothing: a thought needs words`, async ({ page }) => {
    const { posts } = await fakeApi(page);
    await page.goto('/');
    await signIn(page);

    await log(page, description);
    await expect(page.getByLabel("What's on your mind?")).toBeFocused();
    await log(page, 'Traffic jam');

    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem')).toContainText('Traffic jam');
    expect(posts.map((post) => post.description)).toEqual(['Traffic jam']);
  });
}

test('each thought gets its own UUIDv7, made when it is logged', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T13:30:05.123Z'));
  const { posts } = await fakeApi(page);
  await page.goto('/');
  await signIn(page);

  await log(page, 'Traffic jam');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await log(page, 'Traffic jam');
  await expect(page.getByRole('listitem')).toHaveCount(2);

  expect(posts.map((p) => p.id)).toEqual([expect.stringMatching(V7), expect.stringMatching(V7)]);
  expect(posts[0].id).not.toBe(posts[1].id);
  expect(v7Time(posts[0].id!)).toBe('2026-10-01T13:30:05.123Z');
});

test.describe('when logging fails', () => {
  for (const [what, failure] of [["the server can't be reached", 'down'], ['the server errors', 500]] as const) {
    test(`when ${what}, it says so, keeps the text, and logging again retries the same thought`, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-01T13:30:05Z'));
      const api = await fakeApi(page);
      await page.goto('/');
      await signIn(page);
      api.postFails = failure;

      await log(page, 'Traffic jam');

      await expect(page.getByText("Couldn't log it. Try again.")).toBeVisible();
      await expect(page.getByLabel("What's on your mind?")).toHaveValue('Traffic jam');
      await expect(page.getByRole('button', { name: 'Log' })).toBeEnabled();
      api.postFails = null;
      await page.clock.setFixedTime(new Date('2026-10-01T13:31:00Z'));
      await page.getByRole('button', { name: 'Log' }).click();

      await expect(page.getByRole('listitem')).toContainText('Traffic jam');
      await expect(page.getByText("Couldn't log it. Try again.")).toBeHidden();
      await expect(page.getByLabel("What's on your mind?")).toHaveValue('');
      expect(api.posts).toHaveLength(2);
      expect(api.posts[1]).toEqual(api.posts[0]);
    });
  }

  test('when the server saved it but the answer was lost, logging again shows it once', async ({ page }) => {
    const api = await fakeApi(page);
    await page.goto('/');
    await signIn(page);
    api.postFails = 'lost';

    await log(page, 'Traffic jam');
    await expect(page.getByText("Couldn't log it. Try again.")).toBeVisible();
    api.postFails = null;
    await page.getByRole('button', { name: 'Log' }).click();

    await expect(page.getByLabel("What's on your mind?")).toHaveValue('');
    await expect(page.getByRole('listitem')).toHaveCount(1);
    expect(api.posts[1].id).toBe(api.posts[0].id);
  });

  test('changing the text after a failure logs a new thought, with a new id', async ({ page }) => {
    const api = await fakeApi(page);
    await page.goto('/');
    await signIn(page);
    api.postFails = 'down';
    await log(page, 'Traffic jam');
    await expect(page.getByText("Couldn't log it. Try again.")).toBeVisible();
    api.postFails = null;

    await log(page, 'Traffic jam on I-95');

    await expect(page.getByRole('listitem')).toContainText('Traffic jam on I-95');
    expect(api.posts[1].id).not.toBe(api.posts[0].id);
  });
});

test('lists thoughts without a description as having no details', async ({ page }) => {
  await fakeApi(page, [{ id: '1', description: null, timestamp: '2026-10-01T13:30:00Z' }]);
  await page.goto('/');

  await signIn(page);

  await expect(page.getByRole('listitem')).toContainText('10/1/2026, 1:30 PM');
  await expect(page.getByRole('listitem')).toContainText('No details');
});

test('logging shows it is busy and ignores more submits until done', async ({ page }) => {
  const api = await fakeApi(page);
  let release = () => {};
  api.hold = new Promise((resolve) => (release = resolve));
  await page.goto('/');
  await signIn(page);
  const button = page.locator('#log button');

  await log(page, 'Traffic jam');
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Logging…');
  await page.locator('#log').evaluate((form: HTMLFormElement) => form.requestSubmit());
  release();

  await expect(page.getByRole('listitem')).toContainText('Traffic jam');
  await expect(button).toBeEnabled();
  await expect(button).toHaveText('Log');
  expect(api.posts).toHaveLength(1);
});

test.describe("today's sentiment", () => {
  test.use({ timezoneId: 'America/New_York' });

  test("shows today's counts at the top, for the local day", async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-10T02:30:00Z')); // Still the 9th in New York.
    const api = await fakeApi(page);
    api.today.json = { positive: 1, negative: 2, neutral: 3 };
    await page.goto('/');
    await signIn(page);

    await expect(page.locator('#today')).toHaveText('Today: 1 positive, 2 negative, 3 neutral');
    expect(api.todayDates).toEqual(['2026-10-09']);
  });

  test("leaves it out, and still shows the list, when today's counts fail to load", async ({ page }) => {
    const api = await fakeApi(page, [{ id: 'train', description: 'Missed the train', timestamp: '2026-10-02T13:30:00Z' }]);
    api.today = { status: 500, json: { error: 'boom' } };
    await page.goto('/');
    await signIn(page);

    await expect(page.getByRole('listitem')).toContainText('Missed the train');
    await expect(page.locator('#today')).toBeHidden();
  });
});

test.describe('waiting for analysis', () => {
  test.use({ timezoneId: 'America/New_York' });

  test("checks back for a new thought's analysis, and updates today's counts when it arrives", async ({ page }) => {
    await page.clock.install();
    const api = await fakeApi(page);
    await page.goto('/');
    await signIn(page);
    await log(page, 'Missed the train');
    await expect(page.getByRole('listitem')).toContainText('Missed the train');
    const id = api.posts[0].id!;

    await page.clock.runFor(5000);
    await expect.poll(() => api.analysisPolls).toEqual([[id]]);
    await expect(page.locator('#today')).toHaveText('Today: 0 positive, 0 negative, 0 neutral');

    api.analyses[id] = { sentiment: 'negative' };
    api.today.json = { positive: 0, negative: 1, neutral: 0 };
    await page.clock.runFor(5000);

    await expect(page.locator('#today')).toHaveText('Today: 0 positive, 1 negative, 0 neutral');
    // Nothing is waiting now, so it stops checking.
    await page.clock.runFor(60_000);
    expect(api.analysisPolls).toHaveLength(2);
  });

  test('gives up after a minute', async ({ page }) => {
    await page.clock.install();
    const api = await fakeApi(page);
    await page.goto('/');
    await signIn(page);
    await log(page, 'Missed the train');
    await expect(page.getByRole('listitem')).toContainText('Missed the train');

    // Each check is scheduled after the last one comes back, so wait for each before moving the clock on.
    for (let i = 1; i <= 12; i++) {
      await page.clock.runFor(5000);
      await expect.poll(() => api.analysisPolls).toHaveLength(i);
    }
    await page.clock.runFor(60_000);

    expect(api.analysisPolls).toHaveLength(12);
  });

  test("only checks on thoughts still waiting: not analyzed ones, or ones without details", async ({ page }) => {
    await page.clock.install();
    const api = await fakeApi(page, [
      { id: 'waiting', description: 'Waiting', timestamp: '2026-10-03T13:30:00Z', analysis: {} },
      { id: 'done', description: 'Analyzed', timestamp: '2026-10-02T13:30:00Z', analysis: { sentiment: 'positive' } },
      { id: 'blank', description: null, timestamp: '2026-10-01T13:30:00Z', analysis: {} },
    ]);
    await page.goto('/');
    await signIn(page);
    await expect(page.getByRole('listitem')).toHaveCount(3);

    await page.clock.runFor(5000);

    await expect.poll(() => api.analysisPolls).toEqual([['waiting']]);
  });
});

const itemWith = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text });
const sentimentButton = (page: Page, text: string, name: string) =>
  itemWith(page, text).getByRole('group', { name: 'Sentiment' }).getByRole('button', { name, exact: true });
const sentimentNames = ['Negative', 'Neutral', 'Positive'];

test.describe("each thought's sentiment", () => {
  test('shows it, and is disabled while the thought is still being analyzed', async ({ page }) => {
    await fakeApi(page, [
      { id: 'waiting', description: 'Waiting', timestamp: '2026-10-03T13:30:00Z', analysis: {} },
      { id: 'done', description: 'Analyzed', timestamp: '2026-10-02T13:30:00Z', analysis: { sentiment: 'negative' } },
      { id: 'blank', description: null, timestamp: '2026-10-01T13:30:00Z', analysis: {} },
    ]);
    await page.goto('/');
    await signIn(page);

    await expect(sentimentButton(page, 'Analyzed', 'Negative')).toHaveAttribute('aria-pressed', 'true');
    await expect(sentimentButton(page, 'Analyzed', 'Neutral')).toHaveAttribute('aria-pressed', 'false');
    await expect(sentimentButton(page, 'Analyzed', 'Positive')).toHaveAttribute('aria-pressed', 'false');
    for (const name of sentimentNames) {
      await expect(sentimentButton(page, 'Analyzed', name)).toBeEnabled();
      await expect(sentimentButton(page, 'Waiting', name)).toBeDisabled();
      await expect(sentimentButton(page, 'Waiting', name)).toHaveAttribute('aria-pressed', 'false');
    }
    // Without words, there's nothing to analyze.
    await expect(itemWith(page, 'No details').getByRole('group', { name: 'Sentiment' })).toHaveCount(0);
  });

  test('shows the analysis once it arrives', async ({ page }) => {
    await page.clock.install();
    const api = await fakeApi(page);
    await page.goto('/');
    await signIn(page);
    await log(page, 'Missed the train');
    await expect(sentimentButton(page, 'Missed the train', 'Negative')).toBeDisabled();

    api.analyses[api.posts[0].id!] = { sentiment: 'negative' };
    await page.clock.runFor(5000);

    await expect(sentimentButton(page, 'Missed the train', 'Negative')).toHaveAttribute('aria-pressed', 'true');
    await expect(sentimentButton(page, 'Missed the train', 'Positive')).toBeEnabled();
  });

  test("one tap changes it and saves it, and today's counts follow", async ({ page }) => {
    const api = await fakeApi(page, [
      { id: 'done', description: 'Analyzed', timestamp: '2026-10-02T13:30:00Z', analysis: { sentiment: 'negative' } },
    ]);
    await page.goto('/');
    await signIn(page);
    await expect(page.locator('#today')).toHaveText('Today: 0 positive, 0 negative, 0 neutral');
    api.today.json = { positive: 1, negative: 0, neutral: 0 };

    await sentimentButton(page, 'Analyzed', 'Positive').click();

    await expect(page.locator('#today')).toHaveText('Today: 1 positive, 0 negative, 0 neutral');
    expect(api.sentimentPuts).toEqual([{ id: 'done', sentiment: 'positive' }]);
    await expect(sentimentButton(page, 'Analyzed', 'Positive')).toHaveAttribute('aria-pressed', 'true');
    await expect(sentimentButton(page, 'Analyzed', 'Negative')).toHaveAttribute('aria-pressed', 'false');
  });

  test('tapping the one already chosen saves nothing', async ({ page }) => {
    const api = await fakeApi(page, [
      { id: 'done', description: 'Analyzed', timestamp: '2026-10-02T13:30:00Z', analysis: { sentiment: 'negative' } },
    ]);
    await page.goto('/');
    await signIn(page);

    await sentimentButton(page, 'Analyzed', 'Negative').click();
    await sentimentButton(page, 'Analyzed', 'Neutral').click();

    await expect.poll(() => api.sentimentPuts).toEqual([{ id: 'done', sentiment: 'neutral' }]);
  });

  test("when saving fails, puts it back and says it couldn't", async ({ page }) => {
    const api = await fakeApi(page, [
      { id: 'done', description: 'Analyzed', timestamp: '2026-10-02T13:30:00Z', analysis: { sentiment: 'negative' } },
    ]);
    api.sentimentStatus = 500;
    await page.goto('/');
    await signIn(page);

    await sentimentButton(page, 'Analyzed', 'Positive').click();

    await expect(itemWith(page, 'Analyzed')).toContainText("Couldn't change it");
    await expect(sentimentButton(page, 'Analyzed', 'Negative')).toHaveAttribute('aria-pressed', 'true');
    await expect(sentimentButton(page, 'Analyzed', 'Positive')).toHaveAttribute('aria-pressed', 'false');
  });
});

test('puts the time and the controls in a header above the thought, with the controls on the right', async ({ page }) => {
  await fakeApi(page, [
    { id: 'done', description: 'Analyzed', timestamp: '2026-10-02T13:30:00Z', analysis: { sentiment: 'negative' } },
  ]);
  await page.goto('/');
  await signIn(page);

  const item = itemWith(page, 'Analyzed');
  const time = (await item.locator('time').boundingBox())!;
  const group = (await item.getByRole('group', { name: 'Sentiment' }).boundingBox())!;
  const remove = (await item.getByRole('button', { name: 'Delete' }).boundingBox())!;
  const text = (await item.getByText('Analyzed', { exact: true }).boundingBox())!;
  const itemBox = (await item.boundingBox())!;
  // All on one row, the controls together at the right end.
  expect(Math.abs(group.y + group.height / 2 - (time.y + time.height / 2))).toBeLessThan(4);
  expect(group.x).toBeGreaterThan(time.x + time.width);
  expect(remove.x).toBeGreaterThanOrEqual(group.x + group.width);
  expect(remove.x + remove.width).toBeCloseTo(itemBox.x + itemBox.width, 0);
  // The thought below.
  expect(text.y).toBeGreaterThanOrEqual(Math.max(time.y + time.height, group.y + group.height));
  await expect(item.getByRole('button', { name: 'Delete' })).toHaveText('✕');
});

test.describe('deleting', () => {
  const thoughts = () => [
    { id: 'keep', description: 'Keep me', timestamp: '2026-10-02T13:30:00Z' },
    { id: 'oops', description: 'Logged by mistake', timestamp: '2026-10-01T13:30:00Z' },
  ];
  const deleteButton = (page: Page, description: string) =>
    page.getByRole('listitem').filter({ hasText: description }).getByRole('button', { name: 'Delete' });

  test('deletes a thought after confirming', async ({ page }) => {
    const api = await fakeApi(page, thoughts());
    await page.goto('/');
    await signIn(page);
    let message = '';
    page.once('dialog', (dialog) => {
      message = dialog.message();
      dialog.accept();
    });

    await deleteButton(page, 'Logged by mistake').click();

    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem')).toContainText('Keep me');
    expect(message).toBe('Delete "Logged by mistake"?');
    expect(api.deletes).toEqual(['oops']);
  });

  test('keeps the thought when not confirmed', async ({ page }) => {
    const api = await fakeApi(page, thoughts());
    await page.goto('/');
    await signIn(page);
    page.once('dialog', (dialog) => dialog.dismiss());

    await deleteButton(page, 'Logged by mistake').click();

    await expect(page.getByRole('listitem')).toHaveCount(2);
    expect(api.deletes).toEqual([]);
  });

  test('asks about a thought with no details by its time', async ({ page }) => {
    await fakeApi(page, [{ id: 'blank', description: null, timestamp: '2026-10-01T13:30:00Z' }]);
    await page.goto('/');
    await signIn(page);
    let message = '';
    page.once('dialog', (dialog) => {
      message = dialog.message();
      dialog.dismiss();
    });

    await deleteButton(page, 'No details').click();

    await expect.poll(() => message).toBe('Delete the thought from 10/1/2026, 1:30 PM?');
  });
});

test('says it is loading until the thoughts arrive, since the server can be slow to wake up', async ({ page }) => {
  const api = await fakeApi(page, [{ id: '1', description: 'Flight delayed', timestamp: '2026-10-01T13:30:00Z' }]);
  let release = () => {};
  api.listHold = new Promise((resolve) => (release = resolve));
  await page.goto('/');

  await signIn(page);

  const loading = page.getByRole('status');
  await expect(loading).toHaveText('Loading… The server can take a few seconds to wake up.');
  await expect(page.getByLabel('Password')).toBeHidden();
  release();
  await expect(page.getByRole('listitem')).toContainText('Flight delayed');
  await expect(loading).toBeHidden();
});

test('says when it cannot reach the server, and tries again', async ({ page }) => {
  const api = await fakeApi(page, [{ id: '1', description: 'Flight delayed', timestamp: '2026-10-01T13:30:00Z' }]);
  api.down = true;
  await page.goto('/');

  await signIn(page);

  await expect(page.getByText("Couldn't reach the server.")).toBeVisible();
  await expect(page.getByRole('status')).toBeHidden();
  api.down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('listitem')).toContainText('Flight delayed');
  await expect(page.getByText("Couldn't reach the server.")).toBeHidden();
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
  const fontSize = await page.getByLabel("What's on your mind?").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
});

const bar = (page: Page, name: string) => page.getByRole('img', { name, exact: true });
const openPatterns = (page: Page) => page.getByText('Patterns', { exact: true }).click();

test('keeps the counts tucked away under Patterns until opened', async ({ page }) => {
  await fakeApi(page);
  await page.goto('/');
  await signIn(page);
  await expect(page.getByLabel("What's on your mind?")).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By hour of day' })).toBeHidden();

  await openPatterns(page);

  await expect(page.getByRole('heading', { name: 'By hour of day' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By day of week' })).toBeVisible();
});
const fillHeight = async (page: Page, name: string) => (await bar(page, name).locator('.fill').boundingBox())!.height;

test('charts the counts by hour of day and day of week from the API', async ({ page }) => {
  const byHour = Array(24).fill(0);
  byHour[8] = 2;
  byHour[21] = 1;
  await fakeApi(page, [], { byHour, byDayOfWeek: [0, 0, 0, 0, 3, 0, 1] });
  await page.goto('/');

  await signIn(page);
  await openPatterns(page);

  await expect(bar(page, '12 AM: 0')).toBeVisible();
  await expect(bar(page, '8 AM: 2')).toBeVisible();
  await expect(bar(page, '12 PM: 0')).toBeVisible();
  await expect(bar(page, '9 PM: 1')).toBeVisible();
  await expect(page.getByRole('img', { name: /^\d+ [AP]M: \d+$/ })).toHaveCount(24);
  await expect(bar(page, 'Sunday: 0')).toBeVisible();
  await expect(bar(page, 'Thursday: 3')).toBeVisible();
  await expect(bar(page, 'Saturday: 1')).toBeVisible();
  await expect(page.getByRole('img', { name: /day: \d+$/ })).toHaveCount(7);
  expect(await fillHeight(page, '8 AM: 2')).toBeCloseTo(2 * await fillHeight(page, '9 PM: 1'), 0);
});

test('still shows the list when the counts fail to load', async ({ page }) => {
  const api = await fakeApi(page, [{ id: '1', description: 'Flight delayed', timestamp: '2026-10-01T13:30:00Z' }]);
  api.countsStatus = 500;
  await page.goto('/');

  await signIn(page);

  await expect(page.getByRole('listitem')).toContainText('Flight delayed');
  await expect(page.getByText("Couldn't load the counts")).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By hour of day' })).toBeHidden();
});

test('fetches the counts again after logging', async ({ page }) => {
  const api = await fakeApi(page);
  await page.goto('/');
  await signIn(page);
  await openPatterns(page);
  await expect(bar(page, 'Thursday: 0')).toBeVisible();
  api.counts = { byHour: Array(24).fill(0), byDayOfWeek: [0, 0, 0, 0, 1, 0, 0] };

  await log(page, 'Traffic jam');

  await expect(bar(page, 'Thursday: 1')).toBeVisible();
});

test.describe('looks right', () => {
  const byHour = Array(24).fill(0);
  byHour[8] = 4;
  byHour[9] = 2;
  byHour[17] = 3;
  byHour[22] = 1;
  const counts = { byHour, byDayOfWeek: [1, 2, 3, 0, 2, 1, 1] };
  const thoughts = [
    { id: '2', description: 'Car broke down on the way to work', timestamp: '2026-10-02T13:05:00Z', analysis: { sentiment: 'negative' } },
    { id: '1', description: 'Flight delayed', timestamp: '2026-10-01T13:30:00Z', analysis: {} },
  ];

  test('signed out', async ({ page }) => {
    await fakeApi(page);
    await page.goto('/');

    await expect(page).toHaveScreenshot('signed-out.png');
  });

  test('signed in, with thoughts and counts', async ({ page }) => {
    await fakeApi(page, thoughts, counts);
    await page.goto('/');
    await signIn(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);

    await expect(page).toHaveScreenshot('signed-in.png', { fullPage: true });
  });

  test('signed in, with Patterns open', async ({ page }) => {
    await fakeApi(page, thoughts, counts);
    await page.goto('/');
    await signIn(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);
    await openPatterns(page);

    await expect(page).toHaveScreenshot('patterns-open.png', { fullPage: true });
  });

  test('cannot reach the server', async ({ page }) => {
    const api = await fakeApi(page);
    api.down = true;
    await page.goto('/');
    await signIn(page);
    await expect(page.getByText("Couldn't reach the server.")).toBeVisible();

    await expect(page).toHaveScreenshot('unreachable.png');
  });

  test('wrong password', async ({ page }) => {
    await fakeApi(page);
    await page.goto('/');
    await signIn(page, 'wrong');
    await expect(page.getByText('Wrong username or password')).toBeVisible();

    await expect(page).toHaveScreenshot('wrong-password.png');
  });
});
