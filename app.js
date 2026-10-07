const signin = document.getElementById('signin');
const signinError = document.getElementById('signin-error');
const app = document.getElementById('app');
const form = document.getElementById('log');
const list = document.getElementById('stressors');

const timeFormat = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' };

function show(signedIn) {
  signin.hidden = signedIn;
  app.hidden = !signedIn;
}

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

async function api(options = {}) {
  const res = await fetch(`${API_URL}/v1/stressors`, {
    ...options,
    headers: { ...options.headers, authorization: `Basic ${localStorage.getItem('credentials')}` },
  });
  if (res.status === 401) {
    localStorage.removeItem('credentials');
    signinError.hidden = false;
    show(false);
    throw new Error('wrong password');
  }
  return res;
}

async function load() {
  const stressors = await (await api()).json();
  show(true);
  list.replaceChildren(...stressors.map((stressor) => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = stressor.timestamp;
    time.textContent = new Date(stressor.timestamp).toLocaleString(undefined, timeFormat);
    item.append(time, stressor.description);
    return item;
  }));
}

signin.addEventListener('submit', async (event) => {
  event.preventDefault();
  localStorage.setItem('credentials', btoa(`${signin.username.value}:${signin.password.value}`));
  signin.reset();
  await load();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.description.value.trim()) return;
  await api({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: form.description.value, timestamp: localTimestamp() }),
  });
  form.reset();
  await load();
});

if (localStorage.getItem('credentials')) load();
else show(false);
