# Thought Logger Web

The web client for [Thought Logger](https://github.com/reergymerej/stress-logger): log your thoughts, then review the list and counts by hour of day and day of week. Each thought shows its sentiment once the server has analyzed it, and you can change it when the analysis got it wrong. Plain HTML, CSS and JS, mobile-first, with no build step.

## Run

```sh
npm install
npm start                    # http://localhost:8080, using a local API (npm run local in stress-logger)
npm start -- prod            # same site, using the live API
npm start -- https://my.api  # or any API URL
npm run dev                  # like npm start (same backend choices), and reloads the page when a file changes
colima start # once per boot: tests run in Docker
npm test     # Playwright in Chromium and WebKit, desktop and phone, with screenshots
npm test -- --update-snapshots   # after an intended visual change; review the new images
```

The deployed site's API URL is in `config.js`. `npm start` serves its own `config.js` for the API you pick. The API must allow the site's origin (`WEB_ORIGIN` on the server): `npm run dev` and `npm run local` allow `http://localhost:8080`, and production does once it's added to `WEB_ORIGIN` there.

## Deploy

```sh
npm run deploy   # pushes main and waits for the workflow below to pass
```

Every push to `main` runs a GitHub Actions workflow that:

1. runs the tests,
2. publishes `index.html`, `style.css`, `app.js` and `config.js` to GitHub Pages,
3. smoke-checks the live site (`scripts/smoke.js`): it serves the page and points at the API.

Live at https://reergymerej.github.io/stress-logger-web/.

## Decisions

- **Separate from the server,** in its own repo and deployed on its own. It talks to the API only through `/v1`.
- **Auth:** the server uses basic auth, but browsers don't show their password prompt for cross-origin requests. So the page asks for a username and password, keeps them in `localStorage`, and asks again on a 401.
- **IDs:** the page gives each thought a UUIDv7 when it's logged. If logging fails, the text stays, and logging it again resends the same id and timestamp, so the server sees a retry and never logs it twice.
- **Tests mock the API** with Playwright's `page.route`, so they don't depend on the server.
- **Tests run in Docker,** in Playwright's Linux image (`scripts/test.sh`), locally and in CI. Playwright's WebKit doesn't run on macOS 12, and one environment keeps screenshots identical everywhere. Playwright is pinned to 1.55.1, the image's version.
- **Screenshot tests** (`e2e/app.spec.ts-snapshots/`) catch pages that render wrong or not at all, in every browser and viewport.
- **Hosting:** GitHub Pages for now. The site is just static files, so it can move anywhere.
