# HSI sales workspace

A responsive React + TypeScript frontend built with Vite. Supports persistent Google login, logout, spreadsheet file listing, model group management, and series number registration backed by Google Sheets. Sales order features can be added once their requirements are defined.

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

## Series number management

Open **Series number management** (`/hsi-pm/#series`). It shares the spreadsheet last successfully loaded in Models management, including the remembered link and optional `VITE_MODELS_SPREADSHEET_URL` default. Changing the selected spreadsheet clears the old series catalog and pending entry. Click **Load series catalog** to load saved model groups and existing series rows.

To add a series:

1. Choose a saved model group.
2. Choose a candidate for **every** field, in the order defined by the group. To enter a value outside the candidates, choose **Custom value…** and supply a display name and printable ASCII short name without spaces. Custom values are saved with the series entry, without changing the group's candidate definitions.
3. Keep the generated series number, click **Generate another**, or overwrite it. The full name updates live at every step. For group `mgn`, blue (`b`), size 16cm (`16`), and `Ab23Cd45`, the result is **mgn-b16-Ab23Cd45**. The group prefix appears once.
4. Click **Save new series**. The app appends the row and verifies it by reading the sheet again. The creation and modification times are equal on creation. It then generates another number for the next entry.

Generated numbers use cryptographic randomness, are exactly eight characters, and use `[a-zA-Z0-9]` excluding `0`, `O`, `l`, `i`, `I`, `w`, and `W`. Manual numbers can use 1–32 printable ASCII characters, including those excluded from generation and spaces (but not only spaces). Manual values are preserved exactly. Series-number uniqueness is case-sensitive, global across all groups in this worksheet, and independent of the active list filter.

The saved list can be filtered by model group and is always sorted by **modification time descending**. Historical groups remain available in the filter even if subsequently removed from Models management. Records retain their model names and field values as they were when created. There are no edit or delete actions.

The app creates `series-number-management` on the first save if missing, using these columns:

| Column | Header                | Value                                                                     |
| ------ | --------------------- | ------------------------------------------------------------------------- |
| A      | `createdAt`           | Creation time, ISO 8601 UTC                                               |
| B      | `modifiedAt`          | Modification time, ISO 8601 UTC                                           |
| C      | `modelGroupName`      | Group display name                                                        |
| D      | `modelShortName`      | Concatenated ordered field short names, e.g. `b16`                        |
| E      | `seriesNumber`        | Unique series number                                                      |
| F      | `fullSeriesName`      | Group short name + model short name + series number, separated by hyphens |
| G      | `modelGroupId`        | Stable group ID for filtering                                             |
| H      | `modelGroupShortName` | Group short name at creation                                              |
| I      | `fieldsJson`          | Ordered snapshots of `{fieldName, name, shortName}`                       |

Uniqueness is checked against the loaded, unfiltered rows and again against a fresh read immediately before saving. The group definition is also rechecked before saving to prevent registering against outdated fields. Writes append literal string cells and do not overwrite existing rows or treat custom values as formulas. After saving, the app reads the rows back and checks for duplicates. Failed or uncertain writes preserve the pending number: reload to inspect the saved catalog before retrying.

Web Locks serialize saves across tabs on the same browser origin where supported. Google Sheets has no server-side uniqueness constraint or atomic check-and-append operation, so simultaneous writes from separate browsers can still race. A strict global guarantee would need a backend with a lock or unique database constraint. Existing duplicate or malformed rows block new registrations until corrected in Google Sheets.

## Bulk generate series number

Open **Bulk generate series number** (`/hsi-pm/#bulk-series`) and click **Load bulk catalog**. This uses the same spreadsheet selection, saved model groups, and `series-number-management` worksheet as the single-series page.

1. Choose one model group and every field value, including custom values if needed. These model choices apply to the whole batch.
2. Enter a whole-number **Quantity (1–20)**. The preview adds or removes rows immediately; increasing quantity keeps existing entries and generates new unique numbers. **Regenerate batch** replaces all numbers.
3. Review each full series name. Individual numbers can be overridden using the same 1–32 printable ASCII rule. All full names update when model choices or numbers change.
4. Click **Save batch** to append all rows in one Sheets request. Each row includes creation/modification times, model details, its number, and its full name. A fresh batch is generated after the saved rows are verified.

Generated values follow the existing eight-character alphabet and avoid both saved numbers and other numbers in the batch. Invalid quantities, invalid overrides, or any duplicate block the entire batch. Immediately before the append, the app rechecks the saved model definition and all series numbers from Google Sheets. One conflict rejects the whole batch before writing. Failed or uncertain saves retain the batch; a retry checks for previously saved numbers before writing again. The same browser-tab locking and cross-browser concurrency limitation documented above apply.

The saved list on this tab supports the same model-group filter and descending modification-time order. Drafts remain separate between the single and bulk tabs. Use **Reload series catalog** or **Reload bulk catalog** to see rows added from the other tab.

## Order management

Open **Order management** (`/hsi-pm/#orders`) and select **Load orders**. It uses the shared spreadsheet and existing `series-number-management` worksheet. Records are sorted by creation time, oldest first, with at most 20 per page.

Filter by model group, **All / Sold / Unsold**, and created, modified, or sold time ranges. All active filters combine with AND. Date boundaries are inclusive and use your browser’s local time. Blank status and `N` both count as unsold; `Y` means sold. An unsold record with a retained sold time can still match the sold-time range.

Edit comments, price, and sales channel, then toggle **Mark sold & save** or **Mark unsold & save** to save that row. Price can be blank or a non-negative decimal. Every toggle updates modification time. Marking sold sets a new sold time; marking unsold retains the previous sold time. Draft edits persist while switching tabs but are not saved until toggled.

On the first save, the app adds headers in J:N: `orderComments`, `price`, `salesChannel`, `saled`, `saledAt`, expanding legacy nine-column worksheets if necessary. Existing series/model cells and creation times stay intact. Single and bulk registration remain compatible and new records default to unsold.

Before saving, the app rereads the row by series number and rejects conflicting changes. Writes are atomic and verified afterward; failed saves retain drafts. Same-browser saves share the series lock. Google Sheets cannot prevent another browser from changing the row between the conflict check and write.

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
- `src/modelStore.ts`: model loading, conflict checks, and atomic saves.
- `src/SeriesManagement.tsx`: shared single/bulk creation forms, filtering, and responsive record lists.
- `src/series.ts` and `src/seriesStore.ts`: number generation, validation, serialization, uniqueness checks, and append-only Sheets writes.
- `src/sheetsApi.ts`: shared Sheets API requests with token renewal on 401.
- `src/spreadsheetLink.ts`: shared saved spreadsheet selection.
- `src/styles.css`: desktop and mobile layout, safe-area padding, keyboard focus, and reduced-motion support.
- `examples/`: original standalone demo, retained for reference.

References: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [Google OAuth setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid).
