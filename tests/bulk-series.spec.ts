import { test, expect, type Page } from "@playwright/test";
import {
  generateSeriesBatch,
  validateBatchQuantity,
  validateSeriesBatch,
  rowsToSeries,
  makeSeriesRow,
  SERIES_HEADERS,
} from "../src/series";
import { addSeriesBatch } from "../src/seriesStore";
import { mock, groups, fields } from "./fixtures/series";

async function openBulk(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page
    .getByRole("link", { name: "Bulk generate series number", exact: true })
    .click();
  await expect(page).toHaveURL(/#bulk-series$/);
  await page
    .getByRole("button", { name: "Load bulk catalog", exact: true })
    .click();
  await page
    .getByLabel("Bulk model group", { exact: true })
    .selectOption("group-1");
  await page
    .getByLabel("Bulk value for color", { exact: true })
    .selectOption("1");
  await page
    .getByLabel("Bulk value for size", { exact: true })
    .selectOption("0");
}

test("quantity boundaries, generated alphabet, batch validation and service validation", async () => {
  for (const count of [1, 20]) {
    const numbers = generateSeriesBatch(count, ["Ab23Cd45"]);
    expect(numbers).toHaveLength(count);
    expect(new Set(numbers).size).toBe(count);
    for (const number of numbers) {
      expect(number).toMatch(/^[a-zA-Z0-9]{8}$/);
      expect(number).not.toMatch(/[0OliIwW]/);
    }
  }
  for (const count of [0, -1, 21, 1.5, NaN, Infinity]) {
    expect(validateBatchQuantity(count)).not.toBeNull();
    expect(() => generateSeriesBatch(count)).toThrow();
  }
  expect(
    validateSeriesBatch(groups[0], fields, ["Dup12345", "Dup12345"]),
  ).toContain("unique");
  expect(validateSeriesBatch(groups[0], fields, ["中文"])).toContain("ASCII");
  const snapshot = {
    spreadsheetId: "shared-sheet",
    sheetId: 77,
    hasHeader: true,
    rows: [],
  };
  const noToken = async () => {
    throw new Error("Validation must happen before requests.");
  };
  for (const values of [
    [],
    Array(21).fill("Ab23Cd45"),
    ["Dup12345", "Dup12345"],
  ]) {
    await expect(
      addSeriesBatch(
        snapshot,
        groups[0],
        fields,
        values,
        noToken,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/quantity|unique/);
  }
});

test("20-row preview uses all naming rules and saves in one append", async ({
  page,
}) => {
  const state = await mock(page);
  await openBulk(page);
  await page.getByLabel("Quantity (1–20)").fill("20");
  await expect(page.locator(".bulk-preview-row")).toHaveCount(20);
  const numbers = await page
    .locator(".bulk-preview input")
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).value),
    );
  expect(new Set(numbers).size).toBe(20);
  for (const [index, number] of numbers.entries()) {
    expect(number).toMatch(/^[a-zA-Z0-9]{8}$/);
    expect(number).not.toMatch(/[0OliIwW]/);
    await expect(
      page.getByLabel(`Full series name ${index + 1}`, { exact: true }),
    ).toHaveText(`mgn-b16-${number}`);
  }
  await page.getByLabel("Bulk value for size").selectOption("1");
  await expect(
    page.getByLabel("Full series name 20", { exact: true }),
  ).toHaveText(`mgn-b18-${numbers[19]}`);
  const existing = structuredClone(state.rows);
  await page.getByRole("button", { name: "Save batch", exact: true }).click();
  await expect(
    page.getByText("Saved 20 series numbers.", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].requests).toHaveLength(1);
  expect(state.writes[0].requests[0].appendCells.rows).toHaveLength(20);
  expect(state.rows.slice(0, existing.length)).toEqual(existing);
  const saved = rowsToSeries(state.rows).slice(-20);
  expect(saved.map((row) => row.seriesNumber)).toEqual(numbers);
  for (const row of saved) {
    expect(row.modelShortName).toBe("b18");
    expect(row.createdAt).toBe(row.modifiedAt);
    expect(row.createdAt).toBe(saved[0].createdAt);
  }
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Bulk generate series number",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load bulk catalog", exact: true })
    .click();
  await expect(page.locator(".series-table tbody tr")).toHaveCount(23);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("one-row batch supports custom values and manual ASCII overrides with missing sheet", async ({
  page,
}) => {
  const state = await mock(page, null);
  await openBulk(page);
  await page.getByLabel("Bulk value for color").selectOption("custom");
  await page.getByLabel("Bulk color custom name", { exact: true }).fill("紫色");
  await page
    .getByLabel("Bulk color custom short name", { exact: true })
    .fill("p");
  await page
    .getByLabel("Series number 1", { exact: true })
    .fill("=" + "A".repeat(31));
  await expect(
    page.getByLabel("Full series name 1", { exact: true }),
  ).toHaveText("mgn-p16-=" + "A".repeat(31));
  await page.getByRole("button", { name: "Save batch", exact: true }).click();
  await expect(
    page.getByText("Saved 1 series numbers.", { exact: true }),
  ).toBeVisible();
  expect(state.rows[0]).toEqual(SERIES_HEADERS);
  expect(state.rows).toHaveLength(2);
  expect(state.writes[0].requests[0].addSheet.properties.title).toBe(
    "series-number-management",
  );
  expect(rowsToSeries(state.rows)[0].fields[0].name).toBe("紫色");
});

test("invalid quantities and duplicate overrides block the entire batch", async ({
  page,
}) => {
  const state = await mock(page);
  await openBulk(page);
  for (const value of ["", "0", "21", "1.5", "-1"]) {
    await page.getByLabel("Quantity (1–20)").fill(value);
    await expect(
      page.getByRole("button", { name: "Save batch", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Enter a whole-number quantity from 1 to 20.", {
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.getByLabel("Quantity (1–20)").fill("2");
  await page.getByLabel("Series number 1", { exact: true }).fill("Dup12345");
  await page.getByLabel("Series number 2", { exact: true }).fill("Dup12345");
  await expect(
    page.getByText("Every series number in the batch must be unique.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save batch", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Series number 2", { exact: true }).fill("Other123");
  await expect(
    page.getByRole("button", { name: "Save batch", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Series number 2", { exact: true }).fill("中文");
  await expect(
    page.getByRole("button", { name: "Save batch", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Regenerate batch", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save batch", exact: true }),
  ).toBeEnabled();
  expect(state.writes).toHaveLength(0);
});

test("one remotely conflicting number rejects all rows without a partial append", async ({
  page,
}) => {
  const state = await mock(page);
  await openBulk(page);
  await page.getByLabel("Quantity (1–20)").fill("3");
  await page.getByLabel("Series number 2", { exact: true }).fill("Remote12");
  state.lateRow = makeSeriesRow(groups[0], fields, "Remote12");
  await page.getByRole("button", { name: "Save batch", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("just added");
  expect(state.writes).toHaveLength(0);
  await expect(page.getByLabel("Series number 2", { exact: true })).toHaveValue(
    "Remote12",
  );
  await expect(page.locator(".bulk-preview-row")).toHaveCount(3);
});

test("failed and uncertain saves preserve the batch and do not append twice", async ({
  page,
}) => {
  const state = await mock(page);
  await openBulk(page);
  await page.getByLabel("Quantity (1–20)").fill("2");
  const first = await page
    .getByLabel("Series number 1", { exact: true })
    .inputValue();
  state.failWrite = true;
  await page.getByRole("button", { name: "Save batch", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("read-only");
  await expect(page.getByLabel("Series number 1", { exact: true })).toHaveValue(
    first,
  );
  state.failWrite = false;
  state.loseResponse = true;
  await page.getByRole("button", { name: "Save batch", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save was not confirmed");
  expect(state.writes).toHaveLength(1);
  await page.getByRole("button", { name: "Save batch", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("just added");
  expect(state.writes).toHaveLength(1);
  expect(rowsToSeries(state.rows)).toHaveLength(5);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("button", { name: "Save batch", exact: true }),
  ).toHaveCount(0);
});
