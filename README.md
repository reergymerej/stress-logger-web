# Stress Logger Web

The web client for [Stress Logger](https://github.com/reergymerej/stress-logger): log what stresses you, then review the list and counts by hour of day and day of week. Plain HTML, CSS and JS, mobile-first, with no build step.

## Run

```sh
npm install
npx playwright install chromium   # once
npm start    # http://localhost:3000
npm test     # Playwright, desktop and mobile viewports
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
- **Playwright is pinned to 1.55.1,** the newest version that supports macOS 12, and runs Chromium only.
- **Hosting:** GitHub Pages for now. The site is just static files, so it can move anywhere.
