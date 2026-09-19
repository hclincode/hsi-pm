import { test, expect, type Page } from "@playwright/test";
import { mock, initial, groups, fields } from "./fixtures/series";
import {
  makeSeriesRow,
  SERIES_HEADERS,
  seriesToCells,
  rowsToSeries,
} from "../src/series";
import {
  EMPTY_ORDER_FILTERS,
  filterOrders,
  ORDER_HEADERS,
  parseOrderRows,
} from "../src/orders";

test.use({ timezoneId: "UTC" });
async function setup(page: Page, count = 3, legacy = false) {
  await mock(page);
  const data =
    count === 3
      ? initial
      : Array.from({ length: count }, (_, i) =>
          makeSeriesRow(
            groups[0],
            fields,
            `Item${String(i).padStart(4, "0")}`,
            new Date(Date.UTC(2026, 8, i + 1)),
          ),
        );
  const state = {
    rows: [
      legacy ? SERIES_HEADERS : [...SERIES_HEADERS, ...ORDER_HEADERS],
      ...data.map((row, i) => [
        ...seriesToCells(row),
        ...(legacy
          ? []
          : [
              "",
              "",
              "",
              i === 1 ? "Y" : i === 2 ? "N" : "",
              i === 1 ? "2026-09-10T00:00:00.000Z" : "",
            ]),
      ]),
    ],
    columns: legacy ? 9 : 14,
    writes: [] as any[],
    fail: false,
    lost: false,
  };
  await page
    .context()
    .route(
      "https://sheets.googleapis.com/v4/spreadsheets/**",
      async (route) => {
        const req = route.request();
        const url = decodeURIComponent(req.url());
        if (req.method() === "POST") {
          if (state.fail) {
            await route.fulfill({
              status: 403,
              json: { error: { message: "Read only" } },
            });
            return;
          }
          const body = req.postDataJSON();
          state.writes.push(body);
          for (const item of body.requests) {
            if (item.appendDimension)
              state.columns += item.appendDimension.length;
            if (item.updateCells) {
              const { start, rows } = item.updateCells;
              rows.forEach((row: any, i: number) =>
                row.values.forEach((cell: any, j: number) => {
                  state.rows[start.rowIndex + i][start.columnIndex + j] =
                    String(
                      cell.userEnteredValue.stringValue ??
                        cell.userEnteredValue.numberValue,
                    );
                }),
              );
            }
          }
          if (state.lost) {
            state.lost = false;
            await route.abort("failed");
            return;
          }
          await route.fulfill({ json: { replies: [] } });
        } else if (url.includes("/values/")) {
          const end = url.includes("!A:I") ? 9 : 14;
          await route.fulfill({
            json: { values: state.rows.map((row) => row.slice(0, end)) },
          });
        } else
          await route.fulfill({
            json: {
              sheets: [
                {
                  properties: {
                    sheetId: 77,
                    title: "series-number-management",
                    gridProperties: { columnCount: state.columns },
                  },
                },
              ],
            },
          });
      },
    );
  await page.goto("./#orders");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.getByRole("button", { name: "Load orders", exact: true }).click();
  await expect(page.getByLabel("Sold status", { exact: true })).toBeVisible();
  return state;
}

test("status and all date ranges combine with AND, including retained sold times", () => {
  const values = [
    [...SERIES_HEADERS, ...ORDER_HEADERS],
    ...initial.map((row, i) => [
      ...seriesToCells(row),
      "",
      "10",
      "",
      i === 1 ? "Y" : i === 2 ? "N" : "",
      i === 0 ? "" : "2026-09-10T00:00:00Z",
    ]),
  ];
  const rows = parseOrderRows(values).rows;
  expect(
    filterOrders(rows, { ...EMPTY_ORDER_FILTERS, status: "unsold" }).map(
      (r) => r.seriesNumber,
    ),
  ).toEqual(["Older123", "Newest12"]);
  const combined = {
    ...EMPTY_ORDER_FILTERS,
    status: "unsold" as const,
    groupId: "group-1",
    createdFrom: "2026-09-05T00:00:00Z",
    createdTo: "2026-09-05T00:00:00Z",
    modifiedFrom: "2026-09-05T00:00:00Z",
    modifiedTo: "2026-09-05T00:00:00Z",
    saledFrom: "2026-09-10T00:00:00Z",
    saledTo: "2026-09-10T00:00:00Z",
  };
  expect(filterOrders(rows, combined).map((r) => r.seriesNumber)).toEqual([
    "Newest12",
  ]);
  expect(filterOrders(rows, { ...combined, status: "sold" })).toEqual([]);
  expect(
    filterOrders(rows, { ...combined, modifiedTo: "2026-09-04T00:00:00Z" }),
  ).toEqual([]);
  expect(rowsToSeries(values.map((row) => row.slice(0, 9)))).toEqual(initial);
});

test("paginates oldest first at 20 and resets page when filtering status", async ({
  page,
}) => {
  await setup(page, 25);
  await expect(page.getByRole("article")).toHaveCount(20);
  await expect(page.getByRole("article").first()).toHaveAccessibleName(
    "Order Item0000",
  );
  await page.getByRole("button", { name: "Next orders" }).click();
  await expect(page.getByRole("article")).toHaveCount(5);
  await page.getByLabel("Sold status", { exact: true }).selectOption("sold");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").first()).toHaveAccessibleName(
    "Order Item0001",
  );
  await page.getByLabel("Sold status", { exact: true }).selectOption("unsold");
  await expect(page.getByRole("article")).toHaveCount(20);
  await expect(
    page.getByRole("article", { name: "Order Item0001", exact: true }),
  ).toHaveCount(0);
});

test("UI filters status, group and dates together and clears them", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Sold status", { exact: true }).selectOption("unsold");
  await expect(page.getByRole("article")).toHaveCount(2);
  await page
    .getByLabel("Order model group", { exact: true })
    .selectOption("group-1");
  await page
    .getByLabel("Created from", { exact: true })
    .fill("2026-09-05T00:00");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page
    .getByLabel("Modified to", { exact: true })
    .fill("2026-09-04T00:00");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear order filters" }).click();
  await expect(page.getByRole("article")).toHaveCount(3);
  await page.getByLabel("Sold from", { exact: true }).fill("2026-09-10T00:00");
  await page.getByLabel("Sold to", { exact: true }).fill("2026-09-10T00:00");
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("legacy rows expand safely; toggle saves literal edits and retains sold time on unsold", async ({
  page,
}) => {
  const state = await setup(page, 3, true);
  const before = state.rows.map((row) => [...row]);
  const row = page.getByRole("article", {
    name: "Order Older123",
    exact: true,
  });
  await row
    .getByLabel("Order comments", { exact: true })
    .fill("=literal comment");
  await row.getByLabel("Price", { exact: true }).fill("12.50");
  await row.getByLabel("Sales channel", { exact: true }).selectOption("custom");
  await row.getByLabel("Custom sales channel", { exact: true }).fill("Web");
  expect(state.writes).toHaveLength(0);
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).toBeChecked();
  expect(state.columns).toBe(14);
  expect(state.rows[0].slice(9)).toEqual(ORDER_HEADERS);
  expect(state.rows[1].slice(9, 13)).toEqual([
    "=literal comment",
    "12.5",
    "Web",
    "Y",
  ]);
  expect(state.rows[1][0]).toBe(before[1][0]);
  expect(state.rows[1].slice(2, 9)).toEqual(before[1].slice(2, 9));
  expect(state.rows[2]).toEqual(before[2]);
  const soldAt = state.rows[1][13];
  expect(state.rows[1][1]).toBe(soldAt);
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).not.toBeChecked();
  expect(state.rows[1][12]).toBe("N");
  expect(state.rows[1][13]).toBe(soldAt);
  expect(Date.parse(state.rows[1][1])).toBeGreaterThanOrEqual(
    Date.parse(soldAt),
  );
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).toBeChecked();
  expect(Date.parse(state.rows[1][13])).toBeGreaterThan(Date.parse(soldAt));
});

test("conflict and write failure retain edits; moved rows and lost responses save correctly", async ({
  page,
}) => {
  const state = await setup(page);
  const row = page.getByRole("article", {
    name: "Order Older123",
    exact: true,
  });
  await row.getByLabel("Order comments", { exact: true }).fill("draft");
  state.rows[1][9] = "remote edit";
  await row.getByRole("switch").click();
  await expect(page.getByRole("alert")).toContainText(
    "changed in Google Sheets",
  );
  await expect(row.getByLabel("Order comments", { exact: true })).toHaveValue(
    "draft",
  );
  expect(state.writes).toHaveLength(0);
  state.rows[1][9] = "";
  state.fail = true;
  await row.getByRole("switch").click();
  await expect(page.getByRole("alert")).toContainText("not confirmed");
  await expect(row.getByRole("switch")).not.toBeChecked();
  state.fail = false;
  state.lost = true;
  [state.rows[1], state.rows[3]] = [state.rows[3], state.rows[1]];
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).toBeChecked();
  expect(state.writes).toHaveLength(1);
  expect(state.rows[3][9]).toBe("draft");
  expect(state.rows[3][12]).toBe("Y");
  expect(state.rows[1][12]).toBe("N");
});

test("invalid price blocks save and mobile controls fit screen", async ({
  page,
}, testInfo) => {
  await setup(page);
  const row = page.getByRole("article", {
    name: "Order Older123",
    exact: true,
  });
  await row.getByLabel("Price", { exact: true }).fill("-3");
  await expect(row.getByRole("switch")).toBeDisabled();
  await row.getByLabel("Price", { exact: true }).fill("0");
  await expect(row.getByRole("switch")).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/hsi-orders-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("sales channels are distinct across all rows and custom values become reusable on save", async ({
  page,
}) => {
  const state = await setup(page, 25);
  state.rows[1][11] = "Web";
  state.rows[2][11] = "Web";
  state.rows[25][11] = "Market";
  await page.getByRole("button", { name: "Reload orders" }).click();
  const row = page.getByRole("article", {
    name: "Order Item0000",
    exact: true,
  });
  const select = row.getByLabel("Sales channel", { exact: true });
  await expect(select).toHaveValue("existing:Web");
  await expect(select.locator("option")).toHaveText([
    "No sales channel",
    "Market",
    "Web",
    "Custom…",
  ]);
  await select.selectOption("existing:Market");
  expect(state.writes).toHaveLength(0);
  await select.selectOption("custom");
  await row.getByLabel("Custom sales channel", { exact: true }).fill("Direct");
  await row.getByRole("switch").click();
  await expect(select).toHaveValue("existing:Direct");
  expect(state.rows[1][11]).toBe("Direct");
  const other = page.getByRole("article", {
    name: "Order Item0002",
    exact: true,
  });
  await expect(
    other.getByLabel("Sales channel", { exact: true }).locator("option"),
  ).toHaveText(["No sales channel", "Direct", "Market", "Web", "Custom…"]);
  await select.selectOption("");
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).not.toBeChecked();
  expect(state.rows[1][11]).toBe("");
});
