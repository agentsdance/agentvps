import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
const folder = path.resolve("website/dist");
let server,
  url = process.env.AGENTVPS_SITE_URL;
if (!url) {
  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const file = path.join(
        folder,
        pathname.endsWith("/") ? pathname + "index.html" : pathname,
      );
      if (!file.startsWith(folder + "/")) {
        res.writeHead(403).end();
        return;
      }
      const types = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      res.setHeader("Content-Type", types[path.extname(file)] || "text/plain");
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
}
const browser = await chromium.launch();
const output = path.resolve("test-results/site");
await fs.mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const locale of ["en", "zh"]) {
    const chinese = locale === "zh",
      route = chinese ? "/zh/" : "/";
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(url + route);
    await page.locator(".screen-frame img").waitFor();
    assert.equal(
      await page.locator("html").getAttribute("lang"),
      chinese ? "zh-Hans" : "en",
    );
    assert.match(
      await page.locator("h1").innerText(),
      chinese ? /让任何 VPS/ : /Turn any VPS/,
    );
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://agentvps.ai-infra.org" + route,
    );
    assert.equal(
      await page
        .locator(".screen-frame img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
      true,
    );
    await page.locator(".screen-top [data-open-desktop]").click();
    assert.equal(await page.getByRole("dialog").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").isVisible(), false);
    await page.locator('[data-copy="vps-install"]').click();
    assert.match(
      await page.evaluate(() => navigator.clipboard.readText()),
      /sudo bash install-agentvps.sh/,
    );
    assert.equal(
      await page.locator("#copy-status").textContent(),
      chinese ? "已复制到剪贴板" : "Copied to clipboard",
    );
    await page.locator('[data-step="connect"] > summary').click();
    await page.locator('[data-copy="client-install"]').click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "npm install -g https://github.com/agentsdance/agentvps/releases/download/v0.0.1/agentsdance-agentvps-0.0.1.tgz",
    );
    await page.locator("#agent-tab").click();
    assert.equal(await page.locator("#manual-guide").isVisible(), false);
    await page.locator('[data-copy="agent-prompt"]').click();
    assert.ok(
      (await page.evaluate(() => navigator.clipboard.readText())).includes(
        "https://agentvps.ai-infra.org" + route + "agent-guide.md",
      ),
    );
    await page.locator("#agent-tab").press("ArrowLeft");
    assert.equal(await page.locator("#manual-guide").isVisible(), true);
    const internal = await page
      .locator('a[href^="/"]')
      .evaluateAll((links) => [
        ...new Set(links.map((a) => a.getAttribute("href"))),
      ]);
    for (const href of internal)
      assert.equal((await fetch(url + href)).status, 200, href);
    const installer = await (await fetch(url + "/install.sh")).text();
    assert.match(installer, /package_sha=[a-f0-9]{64}/);
    assert.doesNotMatch(installer, /@PACKAGE_SHA256@/);
    await page.waitForFunction(
      () => document.getElementById("copy-status").textContent === "",
    );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(output, locale + "-desktop.png"),
      fullPage: true,
    });
    await page.screenshot({ path: path.join(output, locale + "-hero.png") });
    for (const width of [1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        locale + " overflow at " + width,
      );
      assert.equal(await page.locator(".language-link").isVisible(), true);
      await page.screenshot({
        path: path.join(output, locale + "-mobile-" + width + ".png"),
        fullPage: true,
      });
      if (width === 390)
        await page.screenshot({
          path: path.join(output, locale + "-phone-hero.png"),
        });
    }
    await page.locator(".language-link").click();
    await page.waitForURL(url + (chinese ? "/" : "/zh/"));
    assert.equal(
      await page.locator("html").getAttribute("lang"),
      chinese ? "en" : "zh-Hans",
    );
    await page.goto(url + route + "#agents");
    assert.equal(await page.locator("#agent-guide").isVisible(), true);
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: English/Chinese desktop/mobile layouts, language switch, translated copy actions, guide tabs/deep links, keyboard access, metadata, links and pinned installer.",
  );
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
