// Local signed navigation cookie and mocked data only; no live data mutations.
const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  crypto = require("node:crypto");
(async () => {
  const env = Object.fromEntries(
    fs
      .readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [
          l.slice(0, i),
          l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
  const base = process.env.E2E_BASE_URL || "http://127.0.0.1:3131";
  const org = "11111111-1111-4111-8111-111111111111",
    id = "22222222-2222-4222-8222-222222222222";
  const payload = Buffer.from(
    JSON.stringify({
      t: "developer",
      r: "developer",
      o: org,
      e: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const cookie =
    payload +
    "." +
    crypto
      .createHmac(
        "sha256",
        env.SESSION_COOKIE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY,
      )
      .update(payload)
      .digest("base64url");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(90000);
    await page
      .context()
      .addCookies([
        { name: "dt_session", value: cookie, url: base, httpOnly: true },
      ]);
    const user = {
      id,
      organization_id: org,
      name: "Alex Developer",
      email: "alex@example.test",
      role: "developer",
      membership_role: "developer",
      organization_name: "Northstar Studio",
      organization_timezone: "UTC",
      loginTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    await page.addInitScript((user) => {
      sessionStorage.setItem("developerUser", JSON.stringify(user));
      localStorage.setItem("devtrack.theme", "dark");
    }, user);
    const authKey = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
    const authUser = {
      id,
      email: user.email,
      aud: "authenticated",
      app_metadata: {
        organization_id: org,
        app_user_id: id,
        user_type: "developer",
        role: "developer",
      },
      user_metadata: {},
    };
    const token =
      Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url") +
      "." +
      Buffer.from(
        JSON.stringify({
          sub: id,
          app_metadata: authUser.app_metadata,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url") +
      ".mock";
    await page.addInitScript(
      ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
      {
        key: authKey,
        value: {
          access_token: token,
          refresh_token: "mock",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user: authUser,
        },
      },
    );
    await page.route("**/auth/v1/**", (route) =>
      route.fulfill({ json: authUser }),
    );
    let seconds = 3661,
      fail = false;
    const today = new Date().toISOString().slice(0, 10);
    const tasks = [
      {
        id: "task1",
        organization_id: org,
        developer_id: id,
        task_title: "Review login experience",
        status: "rejected",
        end_date: today,
      },
      {
        id: "task2",
        organization_id: org,
        developer_id: id,
        task_title: "Finish dashboard",
        status: "in_progress",
        end_date: today,
      },
    ];
    await page.route("**/api/**", (route) =>
      route.fulfill({
        json:
          new URL(route.request().url()).pathname === "/api/me/permissions"
            ? {
                success: true,
                permissions: [
                  "task.view_own",
                  "project.view_own",
                  "timesheet.view_own",
                ],
              }
            : { success: true, data: [] },
      }),
    );
    await page.route("**/rest/v1/**", (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        table = url.pathname.split("/").pop();
      let rows = [];
      if (table === "developer_tasks") rows = tasks;
      if (table === "productivity_sessions") {
        if (fail)
          return route.fulfill({
            status: 500,
            json: { message: "Simulated unavailable" },
          });
        if (url.searchParams.get("user_id") !== "is.null")
          rows = [
            {
              session_id: "session1",
              organization_id: org,
              user_id: id,
              user_email: user.email,
              start_time: today + "T00:00:00Z",
              total_duration: seconds,
            },
          ];
      }
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "content-range",
          "content-range": rows.length
            ? `0-${rows.length - 1}/${rows.length}`
            : "*/0",
        },
        body: req.method() === "HEAD" ? "" : JSON.stringify(rows),
      });
    });

    await page.goto(base + "/developer/dashboard", {
      waitUntil: "domcontentloaded",
    });

    await page
      .getByText("01:01:01", { exact: true })
      .waitFor({ timeout: 15000 });
    await page.getByText("Review login experience", { exact: true }).waitFor();
    const nav = page.locator("#app-sidebar");
    for (const button of await nav.locator("nav button").all())
      assert.equal(
        await button.evaluate((el) => getComputedStyle(el).color),
        "rgb(255, 255, 255)",
      );
    assert.equal(
      await nav
        .locator('svg rect[fill="white"].dark\\:block')
        .first()
        .evaluate((el) => getComputedStyle(el).display),
      "block",
    );
    const selected = nav.locator('[aria-current="page"]');
    assert.equal(
      await selected.evaluate((el) => getComputedStyle(el).color),
      "rgb(255, 255, 255)",
    );
    seconds = 7205;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByText("02:00:05", { exact: true }).waitFor();
    fail = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page
      .getByRole("button", { name: "Retry time", exact: true })
      .waitFor();
    assert.equal(await page.getByText("02:00:05", { exact: true }).count(), 0);
    fail = false;
    await page.getByRole("button", { name: "Retry time", exact: true }).click();
    await page.getByText("02:00:05", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Open My Work", exact: true })
      .click();
    await page.waitForURL("**section=my-work");
    await page.getByRole("heading", { name: "My Work", exact: true }).waitFor();
    await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.getByText("02:00:05", { exact: true }).waitFor();
    fs.mkdirSync("test-results/developer-overview", { recursive: true });
    await page.screenshot({
      path: "test-results/developer-overview/dark.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Mobile overflow",
    );
    await page.screenshot({
      path: "test-results/developer-overview/mobile.png",
      fullPage: true,
    });
    console.log(
      "PASS dashboard data refresh, unavailable time, dark sidebar/logo, mobile width",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
