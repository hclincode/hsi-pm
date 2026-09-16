import { test, expect, type Page } from "@playwright/test";
import {
  groupsToRows,
  modelName,
  rowsToGroups,
  spreadsheetId,
  validateGroups,
  type ModelGroup,
} from "../src/models";

const fixture: ModelGroup = {
  id: "group-1",
  name: "model_group_name",
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
};
const url = "https://docs.google.com/spreadsheets/d/models-test/edit#gid=0";

async function mockSheets(
  page: Page,
  initial: ModelGroup[] | null = [fixture],
) {
  const state = {
    rows: initial === null ? [] : groupsToRows(initial),
    exists: initial !== null,
    sheetId: 42,
    writes: [] as any[],
    failWrite: false,
    unauthorized: 0,
  };
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    window.google = { accounts: { oauth2: {
      initTokenClient: config => ({ requestAccessToken: () => {
        window.scopesRequested = config.scope;
        config.callback({ access_token: 'models-token', expires_in: 3600, scope: config.scope });
      } }),
      hasGrantedAllScopes: (response, scope) => !(window.denySheets && scope.includes('/spreadsheets')) && response.scope.split(' ').includes(scope)
    } } };
  `,
    }),
  );
  await page.route(
    "https://sheets.googleapis.com/v4/spreadsheets/**",
    async (route) => {
      const request = route.request();
      expect(request.headers().authorization).toBe("Bearer models-token");
      expect(request.url()).toContain("/spreadsheets/models-test");
      if (state.unauthorized > 0) {
        state.unauthorized--;
        await route.fulfill({ status: 401, json: {} });
        return;
      }
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        if (state.failWrite) {
          await route.fulfill({
            status: 403,
            json: { error: { message: "You do not have edit access." } },
          });
          return;
        }
        state.writes.push(body);
        expect(request.url()).toContain(":batchUpdate");
        const add = body.requests.find((item: any) => item.addSheet)?.addSheet;
        if (add) {
          expect(add.properties.title).toBe("model-management");
          state.sheetId = add.properties.sheetId;
          state.exists = true;
        }
        const update = body.requests.find(
          (item: any) => item.updateCells,
        ).updateCells;
        expect(update.range.sheetId).toBe(state.sheetId);
        expect(update.range.startColumnIndex).toBe(0);
        expect(update.range.endColumnIndex).toBe(4);
        expect(update.fields).toBe("userEnteredValue");
        state.rows = update.rows.map((row: any) =>
          row.values.map((cell: any) => cell.userEnteredValue.stringValue),
        );
        await route.fulfill({ json: { replies: [] } });
      } else if (decodeURIComponent(request.url()).includes("/values/")) {
        expect(decodeURIComponent(request.url())).toContain(
          "'model-management'!A:D",
        );
        await route.fulfill({ json: { values: state.rows } });
      } else {
        await route.fulfill({
          json: {
            sheets: [
              {
                properties: {
                  sheetId: 9,
                  title: "orders",
                  gridProperties: { rowCount: 2000 },
                },
              },
              ...(state.exists
                ? [
                    {
                      properties: {
                        sheetId: state.sheetId,
                        title: "model-management",
                        gridProperties: { rowCount: 1000 },
                      },
                    },
                  ]
                : []),
            ],
          },
        });
      }
    },
  );
  return state;
}
async function openModels(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page
    .getByRole("link", { name: "Models management", exact: true })
    .click();
  await expect(page).toHaveURL(/#models$/);
  await page.getByLabel("Google Sheets link").fill(url);
  await page.getByRole("button", { name: "Load models", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add model group" }),
  ).toBeVisible();
}

test("naming, ordered serialization, ASCII validation and link parsing", () => {
  expect(modelName(fixture, [1, 0])).toBe("mgn-b16");
  expect(rowsToGroups(groupsToRows([fixture]))).toEqual([fixture]);
  expect(validateGroups([{ ...fixture, shortName: "中文" }])).toContain(
    "ASCII",
  );
  expect(
    validateGroups([
      {
        ...fixture,
        fields: [
          {
            fieldName: "color",
            candidates: [
              { name: "blue", shortName: "b" },
              { name: "red", shortName: "b" },
            ],
          },
        ],
      },
    ]),
  ).toContain("unique");
  expect(spreadsheetId(url)).toBe("models-test");
  expect(spreadsheetId("https://example.com/spreadsheets/d/bad/edit")).toBe("");
  const rows = groupsToRows([fixture]);
  rows[1][3] = JSON.stringify([
    { name: "size", candidates: [{ name: "16cm", shortName: "16" }] },
  ]);
  expect(rowsToGroups(rows)[0].fields[0].fieldName).toBe("size");
});

test("tab navigation, editable group, ordered fields, preview, save and reload", async ({
  page,
}) => {
  const state = await mockSheets(page);
  await openModels(page);
  expect(await page.evaluate("window.scopesRequested")).toContain(
    "auth/spreadsheets",
  );
  await page.getByLabel("color", { exact: true }).selectOption("1");
  await expect(page.getByLabel("Generated model name")).toHaveText("mgn-b16");
  await page
    .getByRole("button", { name: "Move field 2 up", exact: true })
    .click();
  await page.getByLabel("color", { exact: true }).selectOption("1");
  await expect(page.getByLabel("Generated model name")).toHaveText("mgn-16b");
  await page.getByLabel("Group name", { exact: true }).fill("Updated goods");
  await page.getByRole("button", { name: "Save to Google Sheets" }).click();
  await expect(
    page.getByText("Models saved to model-management.", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(JSON.parse(state.rows[1][3])[0].fieldName).toBe("size");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Models management", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load models", exact: true }).click();
  await expect(page.getByLabel("Group name", { exact: true })).toHaveValue(
    "Updated goods",
  );
  await expect(
    page
      .getByRole("region", { name: "Field 1", exact: true })
      .getByLabel("Field name", { exact: true }),
  ).toHaveValue("size");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("creates missing worksheet with new groups, fields and candidate values", async ({
  page,
}) => {
  const state = await mockSheets(page, null);
  await openModels(page);
  await page.getByRole("button", { name: "Add model group" }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Goods");
  await page.getByLabel("Group short name", { exact: true }).fill("mgp");
  const first = page.getByRole("region", { name: "Field 1", exact: true });
  await first.getByLabel("Field name", { exact: true }).fill("color");
  await first.getByLabel("Candidate name", { exact: true }).fill("blue");
  await first.getByLabel("Candidate short name", { exact: true }).fill("b");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  const second = page.getByRole("region", { name: "Field 2", exact: true });
  await second.getByLabel("Field name", { exact: true }).fill("size");
  await second.getByLabel("Candidate name", { exact: true }).fill("16cm");
  await second.getByLabel("Candidate short name", { exact: true }).fill("16");
  await second.getByRole("button", { name: "Add candidate" }).click();
  await second
    .getByLabel("Candidate name", { exact: true })
    .nth(1)
    .fill("18cm");
  await second
    .getByLabel("Candidate short name", { exact: true })
    .nth(1)
    .fill("18");
  await expect(page.getByLabel("Generated model name")).toHaveText("mgp-b16");
  await page.getByRole("button", { name: "Save to Google Sheets" }).click();
  await expect(
    page.getByText("Models saved to model-management.", { exact: true }),
  ).toBeVisible();
  expect(state.rows).toHaveLength(2);
  expect(state.writes[0].requests[0].addSheet.properties.title).toBe(
    "model-management",
  );
  await page.getByRole("button", { name: "Delete group", exact: true }).click();
  await page.getByRole("button", { name: "Save to Google Sheets" }).click();
  await expect(
    page.getByText("Models saved to model-management.", { exact: true }),
  ).toBeVisible();
  expect(state.rows).toHaveLength(1);
  expect(state.writes[1].requests.at(-1).updateCells.range.endRowIndex).toBe(2);
});

test("invalid inputs block saving and removing fields/candidates updates draft", async ({
  page,
}) => {
  const state = await mockSheets(page);
  await openModels(page);
  await page.getByLabel("Group short name", { exact: true }).fill("模型");
  await expect(
    page.getByRole("button", { name: "Save to Google Sheets" }),
  ).toBeDisabled();
  await expect(page.getByText(/use non-empty ASCII/)).toBeVisible();
  await page.getByLabel("Group short name", { exact: true }).fill("mgn");
  await page
    .getByRole("button", {
      name: "Remove candidate 1 from field 1",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Generated model name")).toHaveText("mgn-b16");
  await page
    .getByRole("button", { name: "Remove field 2", exact: true })
    .click();
  await expect(page.getByLabel("Generated model name")).toHaveText("mgn-b");
  await page.getByRole("button", { name: "Save to Google Sheets" }).click();
  await expect(
    page.getByText("Models saved to model-management.", { exact: true }),
  ).toBeVisible();
  expect(JSON.parse(state.rows[1][3])).toHaveLength(1);
});

test("write failures retain draft; remote edits and target changes cannot be overwritten", async ({
  page,
}) => {
  const state = await mockSheets(page);
  await openModels(page);
  await page.getByLabel("Group name", { exact: true }).fill("My unsaved draft");
  state.failWrite = true;
  await page.getByRole("button", { name: "Save to Google Sheets" }).click();
  await expect(
    page.getByText("You do not have edit access.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Group name", { exact: true })).toHaveValue(
    "My unsaved draft",
  );
  state.failWrite = false;
  state.rows[1][1] = "Edited by another user";
  await page.getByRole("button", { name: "Save to Google Sheets" }).click();
  await expect(page.getByText(/sheet changed since you loaded/)).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await page.getByLabel("Google Sheets link").fill("another-sheet");
  await expect(
    page.getByRole("button", { name: "Save to Google Sheets" }),
  ).toBeDisabled();
});

test("unrecognized sheet contents are protected", async ({ page }) => {
  const state = await mockSheets(page);
  state.rows = [["Existing financial data"]];
  await page.goto("./#models");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.getByLabel("Google Sheets link").fill(url);
  await page.getByRole("button", { name: "Load models", exact: true }).click();
  await expect(page.getByText(/unrecognized format/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save to Google Sheets" }),
  ).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test("denied Sheets scope can be granted on retry; rejected tokens renew", async ({
  page,
}) => {
  const state = await mockSheets(page);
  await page.goto("./#models");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.evaluate("window.denySheets = true");
  await page.getByLabel("Google Sheets link").fill(url);
  await page.getByRole("button", { name: "Load models", exact: true }).click();
  await expect(
    page.getByText(/Allow Google Sheets edit access/).first(),
  ).toBeVisible();
  await page.evaluate("window.denySheets = false");
  state.unauthorized = 1;
  await page.getByRole("button", { name: "Load models", exact: true }).click();
  await expect(page.getByLabel("Group name", { exact: true })).toHaveValue(
    "model_group_name",
  );
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByLabel("Group name", { exact: true })).toHaveCount(0);
});
