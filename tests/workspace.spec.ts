import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.google = { accounts: { oauth2: {
      initTokenClient: config => ({ requestAccessToken: () => {
        if (window.authError) config.error_callback({ type: 'popup_closed' });
        else config.callback({ access_token: 'test-token', expires_in: 3600, scope: config.scope });
      } }),
      hasGrantedAllScopes: () => !window.denyScope
    } } };`,
    }),
  );
});

test("login, list all pages, open file, and logout", async ({ page }) => {
  await page.route(
    "https://www.googleapis.com/drive/v3/files?**",
    async (route) => {
      const url = new URL(route.request().url());
      expect(route.request().headers().authorization).toBe("Bearer test-token");
      expect(url.searchParams.get("q")).toContain("trashed = false");
      await route.fulfill({
        json: url.searchParams.has("pageToken")
          ? { files: [{ id: "sheet-2", name: "Second spreadsheet" }] }
          : {
              files: [
                {
                  id: "sheet-1",
                  name: "Sales orders",
                  modifiedTime: "2026-09-01T00:00:00Z",
                },
              ],
              nextPageToken: "page-2",
            },
      });
    },
  );
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Log out" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.getByRole("button", { name: "List Google Sheets" }).click();
  await expect(
    page.getByRole("link", { name: "Sales orders" }),
  ).toHaveAttribute(
    "href",
    "https://docs.google.com/spreadsheets/d/sheet-1/edit",
  );
  await expect(
    page.getByRole("link", { name: "Second spreadsheet" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Sales orders" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});

test("empty results and expired session", async ({ page }) => {
  let expired = false;
  await page.route("https://www.googleapis.com/drive/v3/files?**", (route) =>
    route.fulfill({ status: expired ? 401 : 200, json: { files: [] } }),
  );
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.getByRole("button", { name: "List Google Sheets" }).click();
  await expect(page.getByText("No spreadsheets found")).toBeVisible();
  expired = true;
  await page.getByRole("button", { name: "List Google Sheets" }).click();
  await expect(page.getByRole("alert")).toContainText("session expired");
  await expect(page.getByRole("button", { name: "Log out" })).toBeDisabled();
});

test("cancelled login and denied permissions can be retried", async ({
  page,
}) => {
  await page.goto("./");
  await page.evaluate("window.authError = true");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  await page.evaluate("window.authError = false; window.denyScope = true");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await expect(page.getByRole("alert")).toContainText("Allow file metadata");
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeDisabled();
});

test("logout during a pending request keeps files cleared", async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "https://www.googleapis.com/drive/v3/files?**",
    async (route) => {
      await waiting;
      await route
        .fulfill({ json: { files: [{ id: "late", name: "Late file" }] } })
        .catch(() => {});
    },
  );
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  const request = page.waitForRequest(
    "https://www.googleapis.com/drive/v3/files?**",
  );
  await page.getByRole("button", { name: "List Google Sheets" }).click();
  await request;
  await page.getByRole("button", { name: "Log out" }).click();
  release();
  await expect(page.getByText("Your sheets start here")).toBeVisible();
  await expect(page.getByRole("link", { name: "Late file" })).toHaveCount(0);
});

test("API errors allow retry", async ({ page }) => {
  await page.route("https://www.googleapis.com/drive/v3/files?**", (route) =>
    route.fulfill({
      status: 403,
      json: { error: { message: "Google Drive API is disabled." } },
    }),
  );
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.getByRole("button", { name: "List Google Sheets" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Google Drive API is disabled.",
  );
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeEnabled();
});
