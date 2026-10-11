// The days before today, newest first. Opening one (history?date=YYYY-MM-DD) shows that day's thoughts.
const loading = document.getElementById('loading');
const unreachable = document.getElementById('unreachable');
const all = document.getElementById('all');
const none = document.getElementById('none');
const daysList = document.getElementById('days');
const day = document.getElementById('day');
const dayName = document.getElementById('day-name');
const thoughtsList = document.getElementById('thoughts');

const date = new URLSearchParams(location.search).get('date');
const sentiments = { negative: 'Negative', neutral: 'Neutral', positive: 'Positive' };

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// Like Friday, October 9, 2026. Noon, so no time zone change can move it to another day.
const longDate = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// Signing in happens on the main page.
function signIn() {
  localStorage.removeItem('credentials');
  location.replace('./');
}

// The API's answer, or null when it can't be loaded.
async function get(path) {
  let res;
  try {
    res = await fetch(`${API_URL}/v1/${path}`, { headers: { authorization: `Basic ${localStorage.getItem('credentials')}` } });
  } catch {
    return null;
  }
  if (res.status === 401) {
    signIn();
    return null;
  }
  return res.ok ? res.json() : null;
}

function showDays(days) {
  const before = days.filter((d) => d.date < today);
  none.hidden = before.length > 0;
  daysList.replaceChildren(...before.map(({ date, count }) => {
    const link = document.createElement('a');
    link.href = `?date=${date}`;
    const name = document.createElement('span');
    name.textContent = longDate(date);
    const how = document.createElement('span');
    how.className = 'count';
    how.textContent = `${count} ${count === 1 ? 'thought' : 'thoughts'}`;
    link.append(name, ' ', how);
    const item = document.createElement('li');
    item.append(link);
    return item;
  }));
  all.hidden = false;
}

function showDay(thoughts) {
  dayName.textContent = longDate(date);
  thoughtsList.replaceChildren(...thoughts.map((thought) => {
    const head = document.createElement('div');
    head.className = 'head';
    const time = document.createElement('time');
    time.dateTime = thought.timestamp;
    time.textContent = new Date(thought.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    head.append(time);
    const sentiment = thought.analysis?.sentiment;
    if (sentiments[sentiment]) {
      const mood = document.createElement('span');
      mood.className = `mood ${sentiment}`;
      mood.textContent = sentiments[sentiment];
      head.append(' ', mood);
    }
    const text = document.createElement('p');
    if (thought.description) {
      text.textContent = thought.description;
    } else {
      text.className = 'none';
      text.textContent = 'No details';
    }
    const item = document.createElement('li');
    item.append(head, ' ', text);
    return item;
  }));
  day.hidden = false;
}

async function load() {
  // The server stops when idle, and waking it up can take a few seconds.
  unreachable.hidden = true;
  loading.hidden = false;
  const answer = await get(date ? `thoughts?date=${encodeURIComponent(date)}` : 'thoughts/days');
  if (!localStorage.getItem('credentials')) return;
  loading.hidden = true;
  if (!answer) {
    unreachable.hidden = false;
    return;
  }
  if (date) showDay(answer);
  else showDays(answer);
}

document.getElementById('retry').addEventListener('click', load);

if (localStorage.getItem('credentials')) load();
else signIn();
