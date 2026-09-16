import { expect, type Page } from "@playwright/test";
import { groupsToRows, type ModelGroup } from "../../src/models";
import {
  makeSeriesRow,
  SERIES_HEADERS,
  seriesToCells,
  type SeriesRow,
} from "../../src/series";

export const groups: ModelGroup[] = [
  {
    id: "group-1",
    name: "Goods",
    shortName: "mgn",
    fields: [
      {
        fieldName: "color",
        candidates: [
          { name: "red", shortName: "r" },
          { name: "blue", shortName: "b" },
        ],
      },
      {
        fieldName: "size",
        candidates: [
          { name: "16cm", shortName: "16" },
          { name: "18cm", shortName: "18" },
        ],
      },
    ],
  },
  {
    id: "group-2",
    name: "Accessories",
    shortName: "acc",
    fields: [
      { fieldName: "finish", candidates: [{ name: "matte", shortName: "m" }] },
    ],
  },
];
export const fields = [
  { fieldName: "color", name: "blue", shortName: "b" },
  { fieldName: "size", name: "16cm", shortName: "16" },
];
const otherFields = [{ fieldName: "finish", name: "matte", shortName: "m" }];
const sheetLink = "https://docs.google.com/spreadsheets/d/shared-sheet/edit";
export const initial: SeriesRow[] = [
  makeSeriesRow(
    groups[0],
    fields,
    "Older123",
    new Date("2026-09-01T00:00:00Z"),
  ),
  makeSeriesRow(
    groups[1],
    otherFields,
    "Other123",
    new Date("2026-09-03T00:00:00Z"),
  ),
  makeSeriesRow(
    groups[0],
    fields,
    "Newest12",
    new Date("2026-09-05T00:00:00Z"),
  ),
];

export async function mock(
  page: Page,
  rows: SeriesRow[] | null = initial,
  shared = true,
) {
  const state = {
    rows: rows === null ? [] : [SERIES_HEADERS, ...rows.map(seriesToCells)],
    exists: rows !== null,
    sheetId: 77,
    writes: [] as any[],
    methods: [] as string[],
    modelRows: groupsToRows(groups),
    failWrite: false,
    failRead: false,
    unauthorized: 0,
    lateRow: null as SeriesRow | null,
    loseResponse: false,
    requests: [] as string[],
  };
  if (shared)
    await page.addInitScript((link) => {
      if (!localStorage.getItem("hsi-pm.models-spreadsheet"))
        localStorage.setItem("hsi-pm.models-spreadsheet", link);
    }, sheetLink);
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page
    .context()
    .route("https://accounts.google.com/gsi/client", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.google = { accounts: { oauth2: {
    initTokenClient: config => ({ requestAccessToken: () => { window.authCalls = (window.authCalls || 0) + 1; config.callback({ access_token: 'series-token', expires_in: 3600, scope: config.scope }); } }),
    hasGrantedAllScopes: (response, scope) => response.scope.split(' ').includes(scope)
  } } };`,
      }),
    );
  await page
    .context()
    .route(
      "https://sheets.googleapis.com/v4/spreadsheets/**",
      async (route) => {
        const request = route.request();
        const url = decodeURIComponent(request.url());
        state.requests.push(url);
        expect(request.headers().authorization).toBe("Bearer series-token");
        if (state.unauthorized) {
          state.unauthorized--;
          await route.fulfill({ status: 401, json: {} });
          return;
        }
        if (request.method() === "POST") {
          if (state.failWrite) {
            await route.fulfill({
              status: 403,
              json: { error: { message: "Sheet is read-only." } },
            });
            return;
          }
          const body = request.postDataJSON();
          state.writes.push(body);
          state.methods.push(request.method());
          expect(url).toContain("/shared-sheet:batchUpdate");
          expect(
            body.requests.every(
              (item: any) => item.addSheet || item.appendCells,
            ),
          ).toBe(true);
          const add = body.requests.find(
            (item: any) => item.addSheet,
          )?.addSheet;
          if (add) {
            expect(add.properties.title).toBe("series-number-management");
            state.sheetId = add.properties.sheetId;
            state.exists = true;
          }
          const append = body.requests.find(
            (item: any) => item.appendCells,
          ).appendCells;
          expect(append.sheetId).toBe(state.sheetId);
          expect(append.fields).toBe("userEnteredValue");
          const added = append.rows.map((row: any) =>
            row.values.map((cell: any) => cell.userEnteredValue.stringValue),
          );
          state.rows.push(...added);
          if (state.loseResponse) {
            state.loseResponse = false;
            await route.abort("failed");
            return;
          }
          await route.fulfill({ json: { replies: [] } });
        } else if (url.includes("/values/")) {
          if (url.includes("'model-management'!A:D"))
            await route.fulfill({ json: { values: state.modelRows } });
          else {
            expect(url).toContain("'series-number-management'!A:I");
            if (state.failRead) {
              await route.fulfill({
                status: 503,
                json: { error: { message: "Temporarily unavailable." } },
              });
              return;
            }
            if (state.lateRow) {
              state.rows.push(seriesToCells(state.lateRow));
              state.lateRow = null;
            }
            await route.fulfill({ json: { values: state.rows } });
          }
        } else
          await route.fulfill({
            json: {
              sheets: [
                {
                  properties: {
                    sheetId: 11,
                    title: "model-management",
                    gridProperties: { rowCount: 1000 },
                  },
                },
                ...(state.exists
                  ? [
                      {
                        properties: {
                          sheetId: state.sheetId,
                          title: "series-number-management",
                          gridProperties: { rowCount: 1000 },
                        },
                      },
                    ]
                  : []),
              ],
            },
          });
      },
    );
  return state;
}
