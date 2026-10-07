# Stress Logger Web

The web client for [Stress Logger](https://github.com/reergymerej/stress-logger): log what stresses you, then review the list and counts by hour of day and day of week. Plain HTML, CSS and JS, mobile-first, with no build step.

## Run

```sh
npm install
npm start    # http://localhost:3000
colima start # once per boot: tests run in Docker
npm test     # Playwright in Chromium and WebKit, desktop and phone, with screenshots
npm test -- --update-snapshots   # after an intended visual change; review the new images
```

The API URL is in `config.js`. The API must allow this site's origin (`WEB_ORIGIN` on the server).

## Deploy

Every push to `main` runs a GitHub Actions workflow that:

1. runs the tests,
2. publishes `index.html`, `style.css`, `app.js` and `config.js` to GitHub Pages,
3. smoke-checks the live site (`scripts/smoke.js`): it serves the page and points at the API.

Live at https://reergymerej.github.io/stress-logger-web/.

## Decisions

- **Separate from the server,** in its own repo and deployed on its own. It talks to the API only through `/v1`.
- **Auth:** the server uses basic auth, but browsers don't show their password prompt for cross-origin requests. So the page asks for a username and password, keeps them in `localStorage`, and asks again on a 401.
- **Tests mock the API** with Playwright's `page.route`, so they don't depend on the server.
- **Tests run in Docker,** in Playwright's Linux image (`scripts/test.sh`), locally and in CI. Playwright's WebKit doesn't run on macOS 12, and one environment keeps screenshots identical everywhere. Playwright is pinned to 1.55.1, the image's version.
- **Screenshot tests** (`e2e/app.spec.ts-snapshots/`) catch pages that render wrong or not at all, in every browser and viewport.
- **Hosting:** GitHub Pages for now. The site is just static files, so it can move anywhere.
