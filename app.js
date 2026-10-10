const signin = document.getElementById('signin');
const signinError = document.getElementById('signin-error');
const app = document.getElementById('app');
const loading = document.getElementById('loading');
const unreachable = document.getElementById('unreachable');
const form = document.getElementById('log');
const logButton = form.querySelector('button');
const logError = document.getElementById('log-error');
const list = document.getElementById('thoughts');
const today = document.getElementById('today');
const byHour = document.getElementById('by-hour');
const byDay = document.getElementById('by-day');
const patterns = document.getElementById('patterns');
const patternsError = document.getElementById('patterns-error');

const timeFormat = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' };

function show(signedIn) {
  signin.hidden = signedIn;
  app.hidden = !signedIn;
  loading.hidden = true;
  unreachable.hidden = true;
}

// Thrown after a 401, once the sign-in form is showing again.
class SignedOut extends Error {}

const pad = (n) => String(n).padStart(2, '0');

// The current time in ISO 8601 with the local UTC offset, like 2026-10-01T08:30:05-05:00.
function localTimestamp() {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${date}T${time}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

// A UUIDv7: the time in milliseconds, then random bits.
function uuidv7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = Date.now();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const hourName = (hour) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A bar per bucket, labeled for screen readers with its name and count.
function chart(element, counts, name, label) {
  const max = Math.max(1, ...counts);
  element.replaceChildren(...counts.map((count, i) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${name(i)}: ${count}`);
    const number = document.createElement('span');
    number.textContent = count || '';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.height = `${(count / max) * 100}%`;
    const track = document.createElement('div');
    track.className = 'track';
    track.append(fill);
    const axis = document.createElement('span');
    axis.textContent = label(i);
    bar.append(number, track, axis);
    return bar;
  }));
}

// counts is null when they couldn't be loaded; the rest of the page still works.
function showCounts(counts) {
  patterns.hidden = !counts;
  patternsError.hidden = !!counts;
  if (!counts) return;
  chart(byHour, counts.byHour, hourName, (hour) => (hour % 6 ? '' : hourName(hour).replace(' ', '').toLowerCase().slice(0, -1)));
  chart(byDay, counts.byDayOfWeek, (day) => days[day], (day) => days[day].slice(0, 3));
}

async function api(path, options = {}) {
  const res = await fetch(`${API_URL}/v1/${path}`, {
    ...options,
    headers: { ...options.headers, authorization: `Basic ${localStorage.getItem('credentials')}` },
  });
  if (res.status === 401) {
    localStorage.removeItem('credentials');
    signinError.hidden = false;
    show(false);
    throw new SignedOut();
  }
  return res;
}

// How today's analyzed thoughts went, in local time. Left out if it can't be loaded.
async function showToday() {
  const res = await api(`thoughts/sentiment-counts?date=${localTimestamp().slice(0, 10)}`);
  const counts = res.ok ? await res.json() : null;
  today.hidden = !counts;
  if (counts) today.textContent = `Today: ${counts.positive} positive, ${counts.negative} negative, ${counts.neutral} neutral`;
}

// The server analyzes new thoughts in the background, so check back on ones still waiting, every 5 seconds for a
// minute, and update today's counts as their analyses arrive.
const POLL_MS = 5000;
const POLL_TRIES = 12;
let pollTimer;
function pollAnalyses(thoughts) {
  clearTimeout(pollTimer);
  let waiting = thoughts
    .filter((t) => t.description && t.analysis && Object.keys(t.analysis).length === 0)
    .map((t) => t.id)
    .slice(0, 100);
  let tries = 0;
  const next = () => {
    if (waiting.length === 0 || tries++ >= POLL_TRIES) return;
    pollTimer = setTimeout(async () => {
      try {
        const res = await api(`thoughts/analyses?ids=${waiting.join(',')}`);
        if (res.ok) {
          const analyses = await res.json();
          const arrived = waiting.filter((id) => Object.keys(analyses[id] ?? {}).length > 0);
          waiting = waiting.filter((id) => !arrived.includes(id));
          if (arrived.length > 0) await showToday();
        }
      } catch (error) {
        if (error instanceof SignedOut) return;
      }
      next();
    }, POLL_MS);
  };
  next();
}

async function load() {
  // The server stops when idle, and waking it up can take a few seconds.
  const appearing = app.hidden;
  if (appearing) {
    signin.hidden = true;
    unreachable.hidden = true;
    loading.hidden = false;
  }
  let thoughts, counts;
  try {
    [thoughts, counts] = await Promise.all([
      api('thoughts').then((res) => res.json()),
      api('thoughts/counts').then((res) => (res.ok ? res.json() : null)),
      showToday(),
    ]);
  } catch (error) {
    if (error instanceof SignedOut) return;
    loading.hidden = true;
    unreachable.hidden = false;
    return;
  }
  show(true);
  // Ready to type as soon as the app shows.
  if (appearing) form.description.focus();
  showCounts(counts);
  list.replaceChildren(...thoughts.map((thought) => {
    const item = document.createElement('li');
    const entry = document.createElement('div');
    const time = document.createElement('time');
    time.dateTime = thought.timestamp;
    time.textContent = new Date(thought.timestamp).toLocaleString(undefined, timeFormat);
    if (thought.description) {
      entry.append(time, thought.description);
    } else {
      const none = document.createElement('span');
      none.className = 'none';
      none.textContent = 'No details';
      entry.append(time, none);
    }
    const remove = document.createElement('button');
    remove.className = 'delete';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      const what = thought.description ? `"${thought.description}"` : `the thought from ${time.textContent}`;
      if (!confirm(`Delete ${what}?`)) return;
      await api(`thoughts/${thought.id}`, { method: 'DELETE' });
      await load();
    });
    item.append(entry);
    item.append(remove);
    return item;
  }));
  pollAnalyses(thoughts);
}

signin.addEventListener('submit', async (event) => {
  event.preventDefault();
  localStorage.setItem('credentials', btoa(`${signin.username.value}:${signin.password.value}`));
  signin.reset();
  await load();
});

// The thought being logged, kept until the server has it. Logging the same text again after a failure resends it
// with the same id and timestamp, so the server sees a retry and never logs it twice.
let pending = null;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  // One log at a time, so a double tap doesn't log twice.
  if (logButton.disabled) return;
  const text = form.description.value;
  // A thought needs words, so there's something to analyze.
  if (!text.trim()) {
    form.description.focus();
    return;
  }
  logButton.disabled = true;
  logButton.textContent = 'Logging…';
  if (pending?.text !== text) {
    pending = { text, body: { id: uuidv7(), timestamp: localTimestamp(), description: text } };
  }
  let logged = false;
  try {
    const res = await api('thoughts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pending.body),
    });
    logged = res.ok;
  } catch (error) {
    if (error instanceof SignedOut) return;
  } finally {
    logButton.disabled = false;
    logButton.textContent = 'Log';
  }
  logError.hidden = logged;
  // Ready for the next thought, or to try this one again.
  form.description.focus();
  if (!logged) return;
  pending = null;
  form.reset();
  await load();
});

document.getElementById('retry').addEventListener('click', load);

if (localStorage.getItem('credentials')) load();
else show(false);
