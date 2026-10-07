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

async function api(options = {}) {
  const res = await fetch(`${API_URL}/v1/stressors`, {
    ...options,
    headers: { ...options.headers, authorization: `Basic ${btoa(`web:${localStorage.getItem('password')}`)}` },
  });
  if (res.status === 401) {
    localStorage.removeItem('password');
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
  localStorage.setItem('password', signin.password.value);
  signin.reset();
  await load();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.description.value.trim()) return;
  await api({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: form.description.value }),
  });
  form.reset();
  await load();
});

if (localStorage.getItem('password')) load();
else show(false);
