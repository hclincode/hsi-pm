import { test, expect, type Page } from "@playwright/test";
import {
  filterSeries,
  fullSeriesName,
  generateSeriesNumber,
  makeSeriesRow,
  rowsToSeries,
  SERIES_ALPHABET,
  SERIES_HEADERS,
  seriesToCells,
  validateSeriesNumber,
} from "../src/series";

import { groups, fields, initial, mock } from "./fixtures/series";
const sheetLink = "https://docs.google.com/spreadsheets/d/shared-sheet/edit";
const otherFields = [{ fieldName: "finish", name: "matte", shortName: "m" }];

async function open(page: Page) {
  await page.goto("./#series");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page
    .getByRole("button", { name: "Load series catalog", exact: true })
    .click();
  await expect(page.getByLabel("Model group", { exact: true })).toBeVisible();
  expect(
    (await page.getByLabel("Model group", { exact: true }).boundingBox())!
      .height,
  ).toBeGreaterThanOrEqual(44);
}
async function choose(page: Page, number = "Ab23Cd45") {
  await page.getByLabel("Model group", { exact: true }).selectOption("group-1");
  await page.getByLabel("Value for color", { exact: true }).selectOption("1");
  await page.getByLabel("Value for size", { exact: true }).selectOption("0");
  await page.getByLabel("Series number", { exact: true }).fill(number);
}

test("random alphabet, ASCII overrides, names, serialization and ordering", () => {
  const used = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const number = generateSeriesNumber(used);
    expect(number).toMatch(/^[a-zA-Z0-9]{8}$/);
    expect(number).not.toMatch(/[0OliIwW]/);
    expect([...number].every((char) => SERIES_ALPHABET.includes(char))).toBe(
      true,
    );
    expect(used.has(number)).toBe(false);
    used.add(number);
  }
  expect(validateSeriesNumber("A".repeat(32))).toBeNull();
  expect(validateSeriesNumber("0OliIwW-_=")).toBeNull();
  for (const invalid of ["", " ", "A".repeat(33), "中文", "bad\nvalue"])
    expect(validateSeriesNumber(invalid)).not.toBeNull();
  expect(fullSeriesName(groups[0], fields, "Ab23Cd45")).toBe(
    "mgn-b16-Ab23Cd45",
  );
  expect(rowsToSeries([SERIES_HEADERS, ...initial.map(seriesToCells)])).toEqual(
    initial,
  );
  expect(
    filterSeries(initial, "group-1").map((row) => row.seriesNumber),
  ).toEqual(["Newest12", "Older123"]);
  expect(
    filterSeries(
      [{ ...initial[0], modifiedAt: "2026-09-10T00:00:00Z" }, initial[2]],
      "",
    )[0].seriesNumber,
  ).toBe("Older123");
});

test("shared sheet selection, tab navigation, timestamps and filtered descending list", async ({
  page,
}) => {
  const state = await mock(page, initial, false);
  await page.goto("./#series");
  await expect(
    page.getByRole("button", { name: "Load series catalog" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page
    .getByRole("link", { name: "Models management", exact: true })
    .first()
    .click();
  await page.getByLabel("Google Sheets link").fill(sheetLink);
  await page.getByRole("button", { name: "Load models", exact: true }).click();
  await expect(page.getByLabel("Group name", { exact: true })).toHaveValue(
    "Goods",
  );
  await page
    .getByRole("link", { name: "Series number management", exact: true })
    .click();
  await expect(page.getByRole("link", { name: sheetLink })).toBeVisible();
  await page
    .getByRole("button", { name: "Load series catalog", exact: true })
    .click();
  await expect(page.locator(".series-table tbody tr")).toHaveCount(3);
  expect(
    await page.locator(".series-table tbody tr code").allTextContents(),
  ).toEqual(["Newest12", "Other123", "Older123"]);
  await page.getByLabel("Filter by model group").selectOption("group-1");
  expect(
    await page.locator(".series-table tbody tr code").allTextContents(),
  ).toEqual(["Newest12", "Older123"]);
  await expect(
    page.locator(".series-table tbody tr").first().locator("time").first(),
  ).toHaveAttribute("datetime", initial[2].createdAt);
  await expect(
    page.getByRole("button", { name: /edit|delete|remove/i }),
  ).toHaveCount(0);
  expect(state.requests.every((url) => url.includes("/shared-sheet"))).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("three steps update preview and append unique row with timestamps", async ({
  page,
}) => {
  const state = await mock(page);
  await open(page);
  await expect(page.getByLabel("Series number", { exact: true })).toHaveValue(
    /^[a-zA-Z0-9]{8}$/,
  );
  expect(
    await page.getByLabel("Series number", { exact: true }).inputValue(),
  ).not.toMatch(/[0OliIwW]/);
  await expect(
    page.getByRole("button", { name: "Save new series" }),
  ).toBeDisabled();
  await choose(page);
  await expect(page.getByLabel("Full series name")).toHaveText(
    "mgn-b16-Ab23Cd45",
  );
  await page.getByLabel("Value for size", { exact: true }).selectOption("1");
  await expect(page.getByLabel("Full series name")).toHaveText(
    "mgn-b18-Ab23Cd45",
  );
  await page.getByRole("button", { name: "Save new series" }).click();
  await expect(
    page.getByText("Saved mgn-b18-Ab23Cd45.", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  const saved = rowsToSeries(state.rows).at(-1)!;
  expect(saved.modelGroupName).toBe("Goods");
  expect(saved.modelShortName).toBe("b18");
  expect(saved.createdAt).toBe(saved.modifiedAt);
  expect(Number.isFinite(Date.parse(saved.createdAt))).toBe(true);
  expect(saved.fields[1].name).toBe("18cm");
  expect(state.rows.slice(1, 4)).toEqual(initial.map(seriesToCells));
  await expect(page.locator(".series-table tbody tr code").first()).toHaveText(
    "Ab23Cd45",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Load series catalog", exact: true })
    .click();
  await expect(page.locator(".series-table tbody tr")).toHaveCount(4);
});

test("custom field values, 32-character override, group changes and missing sheet creation", async ({
  page,
}) => {
  const state = await mock(page, null);
  await open(page);
  await choose(page, "=Custom_0OliIwW" + "x".repeat(17));
  await page
    .getByLabel("Value for color", { exact: true })
    .selectOption("custom");
  await expect(
    page.getByRole("button", { name: "Save new series" }),
  ).toBeDisabled();
  await page.getByLabel("color custom name", { exact: true }).fill("紫色");
  await page.getByLabel("color custom short name", { exact: true }).fill("p");
  await expect(page.getByLabel("Full series name")).toHaveText(
    "mgn-p16-=Custom_0OliIwW" + "x".repeat(17),
  );
  await page.getByLabel("Model group", { exact: true }).selectOption("group-2");
  await expect(page.getByLabel("Full series name")).toHaveText(
    "acc--=Custom_0OliIwW" + "x".repeat(17),
  );
  await expect(
    page.getByRole("button", { name: "Save new series" }),
  ).toBeDisabled();
  await page.getByLabel("Value for finish").selectOption("0");
  await page.getByRole("button", { name: "Save new series" }).click();
  await expect(page.getByText(/^Saved acc-m-/)).toBeVisible();
  expect(state.writes[0].requests[0].addSheet.properties.title).toBe(
    "series-number-management",
  );
  expect(state.rows[0]).toEqual(SERIES_HEADERS);
  expect(rowsToSeries(state.rows)[0].seriesNumber.length).toBe(32);
  expect(
    state.writes[0].requests[1].appendCells.rows[1].values[4].userEnteredValue,
  ).toEqual({ stringValue: "=Custom_0OliIwW" + "x".repeat(17) });
});

test("duplicates checked across groups locally and against fresh remote rows", async ({
  page,
}) => {
  const state = await mock(page);
  await open(page);
  await page.getByLabel("Filter by model group").selectOption("group-1");
  await choose(page, "Other123");
  await expect(
    page.getByText(
      "This series number already exists. Enter or generate a different number.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save new series" }),
  ).toBeDisabled();
  await page.getByLabel("Series number", { exact: true }).fill("Remote12");
  state.lateRow = makeSeriesRow(groups[1], otherFields, "Remote12");
  await page.getByRole("button", { name: "Save new series" }).click();
  await expect(page.getByRole("alert")).toContainText("just added");
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Generate another" }).click();
  expect(
    await page.getByLabel("Series number", { exact: true }).inputValue(),
  ).not.toBe("Remote12");
});

test("invalid overrides, write failure, changed models and logout do not lose or save drafts", async ({
  page,
}) => {
  const state = await mock(page);
  await open(page);
  await choose(page, "中文");
  await expect(
    page.getByRole("button", { name: "Save new series" }),
  ).toBeDisabled();
  await page.getByLabel("Series number", { exact: true }).fill("Retry123");
  state.failWrite = true;
  await page.getByRole("button", { name: "Save new series" }).click();
  await expect(page.getByRole("alert")).toContainText("Sheet is read-only");
  await expect(page.getByLabel("Series number", { exact: true })).toHaveValue(
    "Retry123",
  );
  state.failWrite = false;
  state.modelRows[1][1] = "Renamed remotely";
  await page.getByRole("button", { name: "Save new series" }).click();
  await expect(page.getByRole("alert")).toContainText("model group changed");
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("button", { name: "Save new series" }),
  ).toHaveCount(0);
  await expect(page.locator(".series-table")).toHaveCount(0);
});

test("unrecognized or duplicate stored rows are rejected without writing", async ({
  page,
}) => {
  const state = await mock(page);
  state.rows.push(seriesToCells(initial[0]));
  await page.goto("./#series");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page
    .getByRole("button", { name: "Load series catalog", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Duplicate series number",
  );
  state.rows = [["Unrelated existing data"]];
  await page
    .getByRole("button", { name: "Load series catalog", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("unrecognized format");
  expect(state.writes).toHaveLength(0);
});

test("lost save response is not blindly retried and cannot create duplicate on retry", async ({
  page,
}) => {
  const state = await mock(page);
  await open(page);
  await choose(page, "Lost1234");
  state.loseResponse = true;
  await page.getByRole("button", { name: "Save new series" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.writes).toHaveLength(1);
  await page.getByRole("button", { name: "Save new series" }).click();
  await expect(page.getByRole("alert")).toContainText("just added");
  expect(state.writes).toHaveLength(1);
  expect(
    rowsToSeries(state.rows).filter((row) => row.seriesNumber === "Lost1234"),
  ).toHaveLength(1);
});

test("shared spreadsheet changes invalidate the old series catalog", async ({
  page,
}) => {
  const state = await mock(page);
  await open(page);
  await choose(page);
  await page
    .getByRole("link", { name: "Models management", exact: true })
    .first()
    .click();
  await page.getByLabel("Google Sheets link").fill("new-sheet");
  await page.getByRole("button", { name: "Load models", exact: true }).click();
  await expect(page.getByLabel("Group name", { exact: true })).toHaveValue(
    "Goods",
  );
  await page
    .getByRole("link", { name: "Series number management", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save new series" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "new-sheet", exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(0);
});

test("custom values persist and unauthorized reads renew auth", async ({
  page,
}) => {
  const state = await mock(page);
  state.unauthorized = 1;
  await open(page);
  await choose(page, "Custom12");
  await page
    .getByLabel("Value for color", { exact: true })
    .selectOption("custom");
  await page.getByLabel("color custom name", { exact: true }).fill("紫色");
  await page.getByLabel("color custom short name", { exact: true }).fill("p");
  await page.getByRole("button", { name: "Save new series" }).click();
  await expect(
    page.getByText("Saved mgn-p16-Custom12.", { exact: true }),
  ).toBeVisible();
  expect(rowsToSeries(state.rows).at(-1)?.fields[0]).toEqual({
    fieldName: "color",
    name: "紫色",
    shortName: "p",
  });
  expect(await page.evaluate("window.authCalls")).toBeGreaterThan(2);
});

test("same-browser tabs serialize duplicate saves", async ({
  page,
  context,
}) => {
  const state = await mock(page);
  await open(page);
  const other = await context.newPage();
  await other.goto("./#series");
  await other
    .getByRole("button", { name: "Load series catalog", exact: true })
    .click();
  await expect(other.getByLabel("Model group", { exact: true })).toBeVisible();
  await choose(page, "Race1234");
  await choose(other, "Race1234");
  await Promise.all([
    page.getByRole("button", { name: "Save new series" }).click(),
    other.getByRole("button", { name: "Save new series" }).click(),
  ]);
  await expect
    .poll(
      async () =>
        (await page
          .getByText("Saved mgn-b16-Race1234.", { exact: true })
          .count()) +
        (await other
          .getByText("Saved mgn-b16-Race1234.", { exact: true })
          .count()),
    )
    .toBe(1);
  await expect
    .poll(
      async () =>
        (await page.getByText(/just added to Google Sheets/).count()) +
        (await other.getByText(/just added to Google Sheets/).count()),
    )
    .toBe(1);
  expect(state.writes).toHaveLength(1);
  expect(
    rowsToSeries(state.rows).filter((row) => row.seriesNumber === "Race1234"),
  ).toHaveLength(1);
});
