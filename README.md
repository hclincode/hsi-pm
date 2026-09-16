# HSI sales workspace

A responsive React + TypeScript frontend built with Vite. Supports persistent Google login, logout, spreadsheet file listing, and model group management backed by Google Sheets. Sales order features can be added once their requirements are defined.

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

5. Enable **Google Sheets API** and add `https://www.googleapis.com/auth/spreadsheets` to the consent screen scopes for Models management. This scope allows reading and editing spreadsheets the user can access; the app writes only the chosen spreadsheet's `model-management` worksheet. Users with an existing file-listing session are prompted for this additional permission when they load models.

For iPhone testing, serve the app at an HTTPS origin registered on the OAuth client; an arbitrary LAN HTTP address is not a valid production OAuth origin. Buttons use a user-triggered Google popup, so popups must be allowed.

## Models management

Open the **Models management** navigation tab (direct link: `/hsi-pm/#models`). Paste a Google Sheets URL or spreadsheet ID and click **Load models**. The selected link is remembered in this browser. Optionally set `VITE_MODELS_SPREADSHEET_URL` in `.env.local` for local development or `.env.example` for the deployment workflow's default. The account needs edit access to the chosen spreadsheet.

- Add, edit, or delete model groups with a display name and unique ASCII short name.
- Add fields, name them, and move them up/down to define their order. Optional field short names are stored as metadata; they are not included in generated model names.
- Add or remove candidate values, each with a display name and ASCII short name. Display names can contain Unicode; short names use printable ASCII without spaces. Candidate names and short names must be unique within their field.
- Use the preview selectors to generate `${group.shortName}-${orderedCandidateShortNames.join('')}`. For `mgn`, blue (`b`), and 16cm (`16`), the result is **mgn-b16**. Changing the field order changes the generated code. Choose short names that keep concatenated codes unambiguous.
- Click **Save to Google Sheets** to persist all groups. Edits and deletions remain drafts until saved. Switching navigation tabs retains the draft; reloading with unsaved changes triggers the browser's leave-page warning. **Discard changes** restores the last loaded/saved data.

The app creates `model-management` on the first save if it does not exist. Rows use these four columns, with one group per row:

| Column | Header       | Value                                        |
| ------ | ------------ | -------------------------------------------- |
| A      | `groupId`    | Stable group identifier                      |
| B      | `groupName`  | Display name                                 |
| C      | `shortName`  | ASCII group short name                       |
| D      | `fieldsJson` | Ordered array of fields and their candidates |

Example `fieldsJson`:

```json
[
  {
    "fieldName": "color",
    "candidates": [
      { "name": "red", "shortName": "r" },
      { "name": "blue", "shortName": "b" }
    ]
  },
  {
    "fieldName": "size",
    "candidates": [
      { "name": "16cm", "shortName": "16" },
      { "name": "18cm", "shortName": "18" }
    ]
  }
]
```

The reader also accepts `name` in place of `fieldName` for compatibility with the supplied example. Generated model names are derived from group definitions; they do not need separate spreadsheet rows.

Saves atomically update managed cells A:D, including clearing deleted group rows, using literal string values (never formulas). Other worksheets and columns are untouched. Unrecognized sheet contents are rejected rather than overwritten. The app re-reads data before saving and reports intervening edits while retaining the draft. Google Sheets does not provide a conditional-write transaction, so simultaneous saves between that check and the write remain last-writer-wins. Avoid editing the same catalog simultaneously from multiple sessions.

## Session behavior

The app stores the access token, expiry, scope, and client ID in `localStorage` under `hsi-pm.google-auth.v1`. Login survives page reloads and browser restarts until logout (or browser data is cleared). Logout removes this record, cancels pending work, and propagates to other open tabs. Browser storage failures fall back to a page-only session. Stored tokens are accessible to JavaScript on the same origin, including other apps on the same GitHub Pages domain.

At expiry, or when reopening an expired session, the app attempts to obtain another token through Google Identity Services. Returning to a backgrounded tab also checks expiry. A Drive 401 triggers one renewal and one retry. Expired tokens are never reused. If Google requires interaction or blocks the popup, the remembered session remains and a **Reconnect Google** button lets you continue; automatic attempts do not loop.

This is browser token renewal, not a refresh-token exchange. Google Identity Services uses a popup and does not guarantee silent renewal without a user gesture. Truly unattended refresh requires a backend using Google's authorization-code flow with server-side refresh-token storage. Logout only clears this app's session; it does not sign out of Google in other tabs or revoke consent.

## Build and test

```sh
npm run build
npm run preview
npx playwright install chromium webkit
npm test
```

The static build is in `dist/`, configured to be served at `/hsi-pm/` (for example, `https://YOURNAME.github.io/hsi-pm/`). Asset URLs and the app's home link use this base path. Preview locally at http://localhost:4173/hsi-pm/. OAuth authorized origins remain origin-only, without `/hsi-pm/`. Set `VITE_GOOGLE_CLIENT_ID` when building in CI.

Browser tests mock Google OAuth, Drive, and Sheets responses; a real login still requires the Cloud configuration above and an interactive Google account.

## Deploy to GitHub Pages

In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. Commit and push the project, including `.github/workflows/deploy.yml`, to `main`. The workflow installs dependencies, builds the app, and publishes `dist/` at https://hclincode.github.io/hsi-pm/. You can also run it manually from the Actions tab after pushing.

The workflow uses the public OAuth client ID in `.env.example`; update that file if the deployment should use a different client. Add `https://hclincode.github.io` to that client's authorized JavaScript origins. Standalone examples are copied unchanged into the published site.

Do not publish the repository root directly: its `index.html` loads TypeScript source that needs Vite compilation. The source entry stays `/src/main.tsx`; Vite adds `/hsi-pm/` automatically and replaces it with a compiled JavaScript asset during the build. See [Vite's GitHub Pages deployment guide](https://vite.dev/guide/static-deploy.html#github-pages).

## Structure

- `src/App.tsx`: connection state and responsive workspace UI.
- `src/google.ts`: Google Identity loading and paginated Drive file listing.
- `src/ModelsManagement.tsx`: model group editor and live code preview.
- `src/models.ts`: model schema, validation, naming, and row serialization.
- `src/modelStore.ts`: Sheets loading, conflict checks, and atomic saves.
- `src/styles.css`: desktop and mobile layout, safe-area padding, keyboard focus, and reduced-motion support.
- `examples/`: original standalone demo, retained for reference.

References: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [Google OAuth setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid).
