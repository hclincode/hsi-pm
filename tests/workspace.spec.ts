import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.google = { accounts: { oauth2: {
      initTokenClient: config => ({ requestAccessToken: () => {
        window.authCalls = (window.authCalls || 0) + 1;
        if (window.deferAuth) { window.completeAuth = () => config.callback({ access_token: "late-token", expires_in: 3600, scope: config.scope }); return; }
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
  await expect(page.getByRole("button", { name: "Log out" })).toBeEnabled();
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

test("persists login on reload until logout", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("hsi-pm.google-auth.v1")!).accessToken,
    ),
  ).toBe("test-token");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeEnabled();
  expect(await page.evaluate("window.authCalls || 0")).toBe(0);
  await page.getByRole("button", { name: "Log out" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeDisabled();
});

test("renews on expiry and stops renewing after logout", async ({ page }) => {
  await page.clock.install();
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.clock.fastForward(3600001);
  await expect.poll(() => page.evaluate("window.authCalls")).toBe(2);
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.clock.fastForward(3600001);
  expect(await page.evaluate("window.authCalls")).toBe(2);
});

test("blocked renewal shows reconnect without a retry loop", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.evaluate("window.authError = true");
  await page.clock.fastForward(3600001);
  await expect(page.getByRole("alert")).toContainText("Reconnect Google");
  await expect(
    page.getByRole("button", { name: "Reconnect Google" }),
  ).toBeEnabled();
  await page.clock.fastForward(120000);
  expect(await page.evaluate("window.authCalls")).toBe(2);
  await page.evaluate("window.authError = false");
  await page.getByRole("button", { name: "Reconnect Google" }).click();
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeEnabled();
});

test("expired saved session renews on reload", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("hsi-pm.google-auth.v1")!);
    value.expiresAt = Date.now() - 1;
    localStorage.setItem("hsi-pm.google-auth.v1", JSON.stringify(value));
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeEnabled();
  expect(await page.evaluate("window.authCalls")).toBe(1);
});

test("logout ignores a late OAuth callback and syncs other tabs", async ({
  page,
  context,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  const other = await context.newPage();
  await other.goto("/hsi-pm/");
  await expect(
    other.getByRole("button", { name: "List Google Sheets" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    other.getByRole("button", { name: "List Google Sheets" }),
  ).toBeDisabled();
  await page.evaluate("window.deferAuth = true");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.evaluate("window.completeAuth()");
  await expect(
    page.getByRole("button", { name: "List Google Sheets" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem("hsi-pm.google-auth.v1")),
  ).toBeNull();
});

test("401 renews once and retries the file request", async ({ page }) => {
  let calls = 0;
  await page.route("https://www.googleapis.com/drive/v3/files?**", (route) => {
    calls++;
    return route.fulfill({
      status: calls === 1 ? 401 : 200,
      json: { files: [{ id: "retry", name: "Renewed file" }] },
    });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Log in with Google" }).click();
  await page.getByRole("button", { name: "List Google Sheets" }).click();
  await expect(page.getByRole("link", { name: "Renewed file" })).toBeVisible();
  expect(calls).toBe(2);
  expect(await page.evaluate("window.authCalls")).toBe(2);
});
