const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.BASE || "http://localhost:3200";
const creds = JSON.parse(
  fs.readFileSync(
    "/tmp/claude-0/-root-demo-dir/6b0d459f-f81b-45cd-ae00-f8558b730d47/scratchpad/creds.json",
    "utf8"
  )
);

const findings = [];
function log(section, status, note, errors) {
  findings.push({ section, status, note: note || "", errors: errors || [] });
  const tag = status === "PASS" ? "✅" : status === "WARN" ? "⚠️ " : "❌";
  console.log(`${tag} [${section}] ${note || ""}`);
  (errors || []).forEach((e) => console.log(`      · ${e}`));
}

function attachErrorCapture(page, bucket) {
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = m.text();
      // ignore benign missing-static-asset 404s + favicon
      if (/favicon|notification-sound|manifest|\.map\b/i.test(t)) return;
      bucket.push("console: " + t.slice(0, 180));
    }
  });
  page.on("pageerror", (e) => bucket.push("PAGEERROR: " + e.message.slice(0, 180)));
  page.on("response", (r) => {
    const s = r.status();
    const u = r.url();
    if (s >= 500) bucket.push(`HTTP ${s}: ${u.replace(BASE, "").slice(0, 120)}`);
    if (s === 400 && /\/api\//.test(u) && !/provision/.test(u)) bucket.push(`HTTP 400: ${u.replace(BASE, "").slice(0, 120)}`);
  });
}

async function loginAs(ctx, roleLabel, email, password, expectPath) {
  const page = await ctx.newPage();
  const errs = [];
  attachErrorCapture(page, errs);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.click(`.auth-role-btn:has-text("${roleLabel}")`, { timeout: 8000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`**${expectPath}**`, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const ok = page.url().includes(expectPath);
  log(`login:${roleLabel}`, ok ? "PASS" : "FAIL", ok ? "reached dashboard" : `stuck at ${page.url()}`, errs);
  return { page, errs };
}

async function clickSidebar(page, label) {
  const errs = [];
  attachErrorCapture(page, errs);
  try {
    await page.click(`aside button:has-text("${label}")`, { timeout: 8000 });
    await page.waitForTimeout(2500);
    const body = (await page.textContent("main").catch(() => "")) || "";
    const brokeUI = /Application error|Unhandled Runtime|Something went wrong/i.test(body);
    log(`admin:${label}`, brokeUI ? "FAIL" : errs.length ? "WARN" : "PASS",
      brokeUI ? "error UI shown" : `rendered (${body.length} chars)`, errs);
  } catch (e) {
    log(`admin:${label}`, "FAIL", "could not open: " + e.message.slice(0, 100), errs);
  }
}

async function testOrgTab(page, tab) {
  const errs = [];
  attachErrorCapture(page, errs);
  try {
    await page.click(`button:has-text("${tab}")`, { timeout: 6000 });
    await page.waitForTimeout(1500);
    const body = (await page.textContent("main").catch(() => "")) || "";
    log(`org:${tab}`, errs.length ? "WARN" : "PASS", `rendered (${body.length} chars)`, errs);
  } catch (e) {
    log(`org:${tab}`, "FAIL", "tab click failed: " + e.message.slice(0, 90), errs);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  // ---------- ADMIN ----------
  const adminCtx = await browser.newContext();
  const { page: aPage } = await loginAs(adminCtx, "Admin", creds.admin.email, creds.admin.password, "/admin/dashboard");
  if (aPage.url().includes("/admin/dashboard")) {
    for (const label of ["All Projects", "Task Reviews", "Developer Activity", "Add Developer", "View Developers", "Organization", "Overview"]) {
      await clickSidebar(aPage, label);
    }
    // Organization tabs + a real CREATE (department)
    await clickSidebar(aPage, "Organization");
    for (const tab of ["Departments", "Teams", "Members", "Invitations", "Settings"]) {
      await testOrgTab(aPage, tab);
    }
    // CRUD: create a QA department
    const crudErrs = [];
    attachErrorCapture(aPage, crudErrs);
    try {
      await aPage.click(`button:has-text("Departments")`);
      await aPage.waitForTimeout(800);
      const depName = "QA-Dept-" + Math.floor(Math.random() * 1e6);
      await aPage.fill('input[placeholder="Engineering"]', depName);
      await aPage.click('button:has-text("Add department")');
      await aPage.waitForTimeout(2500);
      const appeared = (await aPage.textContent("main")).includes(depName);
      log("org:create-department", appeared ? "PASS" : "FAIL", appeared ? `created "${depName}"` : "did not appear after add", crudErrs);
    } catch (e) {
      log("org:create-department", "FAIL", "exception: " + e.message.slice(0, 100), crudErrs);
    }
  }
  await adminCtx.close();

  // ---------- DEVELOPER ----------
  const devCtx = await browser.newContext();
  const { page: dPage } = await loginAs(devCtx, "Developer", creds.dev.email, creds.dev.password, "/developer/dashboard");
  if (dPage.url().includes("/developer/dashboard")) {
    for (const label of ["My Projects", "Account", "Dashboard"]) {
      await clickSidebar(dPage, label);
    }
  }
  await devCtx.close();

  await browser.close();

  // ---------- SUMMARY ----------
  const fail = findings.filter((f) => f.status === "FAIL");
  const warn = findings.filter((f) => f.status === "WARN");
  console.log("\n===== QA SUMMARY =====");
  console.log(`total: ${findings.length} | PASS: ${findings.filter(f=>f.status==="PASS").length} | WARN: ${warn.length} | FAIL: ${fail.length}`);
  if (fail.length) { console.log("\nFAILURES:"); fail.forEach(f => console.log(`  ❌ ${f.section}: ${f.note}`)); }
  if (warn.length) { console.log("\nWARNINGS (console/network errors):"); warn.forEach(f => console.log(`  ⚠️  ${f.section}: ${f.errors.join(" | ")}`)); }
  console.log(`\n===== OVERALL: ${fail.length === 0 ? "✅ NO FAILURES" : "❌ " + fail.length + " FAILURES"} =====`);
})();
