const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.BASE || "http://localhost:3200";
const creds = JSON.parse(
  fs.readFileSync(
    "/tmp/claude-0/-root-demo-dir/6b0d459f-f81b-45cd-ae00-f8558b730d47/scratchpad/creds.json",
    "utf8"
  )
);

async function testLogin(browser, kind, roleLabel, email, password, expectPath) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 160));
  });
  page.on("pageerror", (e) => errors.push("PAGEERR: " + e.message.slice(0, 160)));

  const out = { kind, ok: false, url: "", errors: [], note: "" };
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
    // pick the role (Developer/Admin toggle)
    await page.click(`.auth-role-btn:has-text("${roleLabel}")`, { timeout: 8000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    // wait for redirect to the dashboard
    await page.waitForURL(`**${expectPath}**`, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(3500);
    out.url = page.url();
    out.ok = out.url.includes(expectPath);
    // basic content sanity
    const body = (await page.textContent("body").catch(() => "")) || "";
    out.note = out.ok
      ? `dashboard loaded (${body.length} chars)`
      : `still at ${out.url} — check for login error`;
    // capture any visible error text
    const errBox = await page.textContent(".auth-error-box").catch(() => null);
    if (errBox) out.note += ` | error box: ${errBox.trim().slice(0, 120)}`;
    out.errors = errors.slice(0, 6);
  } catch (e) {
    out.note = "exception: " + e.message.slice(0, 160);
    out.errors = errors.slice(0, 6);
  } finally {
    await ctx.close();
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const results = [];
  results.push(await testLogin(browser, "ADMIN", "Admin", creds.admin.email, creds.admin.password, "/admin/dashboard"));
  results.push(await testLogin(browser, "DEVELOPER", "Developer", creds.dev.email, creds.dev.password, "/developer/dashboard"));
  await browser.close();
  console.log("\n===== LOGIN TEST RESULTS =====");
  for (const r of results) {
    console.log(`\n[${r.kind}] ${r.ok ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`  url: ${r.url}`);
    console.log(`  note: ${r.note}`);
    if (r.errors.length) console.log(`  console errors:\n    - ${r.errors.join("\n    - ")}`);
    else console.log("  console errors: none");
  }
  const allPass = results.every((r) => r.ok);
  console.log(`\n===== OVERALL: ${allPass ? "✅ ALL PASS" : "❌ SOME FAILED"} =====`);
})();
