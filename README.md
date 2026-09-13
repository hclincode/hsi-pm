# HSI sales workspace

A responsive React + TypeScript frontend built with Vite. This first version supports Google login, local logout, and listing Google Sheets files (with links to open them). Sales order features can be added once their requirements are defined.

## Run locally

Use Node.js 22.12+ (or a newer supported LTS release).

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:5173/hsi-pm/. `.env.example` contains the public OAuth client ID from `examples/google-sheets-editor-demo.html`. Replace it with your own web client ID if needed. Restart Vite after changing the environment file. No client secret or API key is needed.

## Google Cloud setup

In the Cloud project that owns your OAuth client:

1. Enable **Google Drive API**. File discovery uses Drive, even though the results are Google Sheets.
2. Configure the OAuth consent screen and add your account as a test user if the app is in testing mode.
3. Configure the OAuth client as a **Web application**. Add `http://localhost:5173` to **Authorized JavaScript origins**, plus your exact production origin when deploying. For localhost setup, also add `http://localhost` as recommended by Google. Origins do not include a URL path.
4. Add `https://www.googleapis.com/auth/drive.metadata.readonly` to the consent screen's data access scopes. This permission reads metadata for Drive files; the app filters its requests to non-trashed Google Sheets. It does not read or write cell contents. A public release may require Google's scope verification.

The Google Sheets API and spreadsheet write permission will be needed when cell editing is implemented.

For iPhone testing, serve the app at an HTTPS origin registered on the OAuth client; an arbitrary LAN HTTP address is not a valid production OAuth origin. Buttons use a user-triggered Google popup, so popups must be allowed.

## Session behavior

Access tokens stay in memory, never in local storage. Reloading or logging out clears the local session. Logout does not sign out of Google in other tabs or revoke the account's consent. Expired tokens require another login. File requests are paginated and aborted on logout so late responses cannot restore a previous session's files.

## Build and test

```sh
npm run build
npm run preview
npx playwright install chromium webkit
npm test
```

The static build is in `dist/`, configured to be served at `/hsi-pm/` (for example, `https://YOURNAME.github.io/hsi-pm/`). Asset URLs and the app's home link use this base path. Preview locally at http://localhost:4173/hsi-pm/. OAuth authorized origins remain origin-only, without `/hsi-pm/`. Set `VITE_GOOGLE_CLIENT_ID` when building in CI.

Browser tests mock Google OAuth and Drive responses; a real login still requires the Cloud configuration above and an interactive Google account.

## Deploy to GitHub Pages

In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. Commit and push the project, including `.github/workflows/deploy.yml`, to `main`. The workflow installs dependencies, builds the app, and publishes `dist/` at https://hclincode.github.io/hsi-pm/. You can also run it manually from the Actions tab after pushing.

The workflow uses the public OAuth client ID in `.env.example`; update that file if the deployment should use a different client. Add `https://hclincode.github.io` to that client's authorized JavaScript origins. Standalone examples are copied unchanged into the published site.

Do not publish the repository root directly: its `index.html` loads TypeScript source that needs Vite compilation. The source entry stays `/src/main.tsx`; Vite adds `/hsi-pm/` automatically and replaces it with a compiled JavaScript asset during the build. See [Vite's GitHub Pages deployment guide](https://vite.dev/guide/static-deploy.html#github-pages).

## Structure

- `src/App.tsx`: connection state and responsive workspace UI.
- `src/google.ts`: Google Identity loading and paginated Drive file listing.
- `src/styles.css`: desktop and mobile layout, safe-area padding, keyboard focus, and reduced-motion support.
- `examples/`: original standalone demo, retained for reference.

References: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [Google OAuth setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid).
