import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createSiteServer } from './site-server.mjs';
const folder = path.resolve("website/dist");
let server,
  url = process.env.AGENTVPS_SITE_URL;
if (!url) {
  server = createSiteServer(folder);
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
    await page.locator('[data-copy="mcp-url"]').click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "http://YOUR_VPS_IP:8080/mcp",
    );
    assert.equal(await page.locator('[data-copy="client-install"]').count(), 0);
    await page.locator('[data-copy="codex-mcp"]').click();
    assert.match(
      await page.evaluate(() => navigator.clipboard.readText()),
      /bearer_token_env_var = "AGENTVPS_TOKEN"/,
    );
    await page.locator('[data-copy="mcp-config"]').click();
    const mcpConfig = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    assert.equal(mcpConfig.mcpServers.agentvps.type, "http");
    assert.equal(
      mcpConfig.mcpServers.agentvps.url,
      "http://YOUR_VPS_IP:8080/mcp",
    );
    assert.equal(mcpConfig.mcpServers.agentvps.command, undefined);
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
    // Follow the public entry point and check the distinction users rely on.
    await page.locator('.install-heading a[href$="/compatibility/"]').click();
    await page.waitForURL(url + route + "compatibility/");
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),
      "https://agentvps.ai-infra.org" + route + "compatibility/");
    const vps = page.locator('[data-verification="vps"]');
    assert.equal(await vps.count(), 1);
    assert.match(await vps.innerText(), /Debian 12/);
    assert.equal(await page.locator('[data-verification="container"]').count(), 7);
    assert.equal(await page.locator('[data-verification="pending"]').count(), 2);
    assert.match(await page.locator('.report-scope').innerText(), /SELinux/);
    for (const href of await page.locator('.report-sidebar nav a').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
      assert.equal(await page.locator(href).count(), 1, 'Report section ' + href);
    }
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, locale + ' report overflow at ' + width);
      await page.screenshot({ path: path.join(output, locale + '-compatibility-' + width + '.png'), fullPage: true });
    }
    for (const href of await page.locator('a[href^="/"]').evaluateAll(links => [...new Set(links.map(link => link.getAttribute('href')))])) {
      assert.equal((await fetch(url + href)).status, 200, href);
    }
    await page.locator('.language-link').click();
    await page.waitForURL(url + (chinese ? '/' : '/zh/') + 'compatibility/');
    assert.equal(await page.locator('html').getAttribute('lang'), chinese ? 'en' : 'zh-Hans');
    await page.goto(url + route + 'video/');
    await page.waitForFunction(() => document.querySelector('video').readyState > 0);
    assert.equal(await page.locator('video').evaluate(video => video.duration), 45);
    assert.equal(await page.locator('video').evaluate(video => video.videoWidth), 1920);
    await page.locator('[data-seek="18.0"]').click();
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video.currentTime >= 18 && video.currentTime < 22 && !video.paused;
    });
    await page.locator('video').evaluate(video => video.pause());
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, locale + ' video overflow at ' + width);
    }
    await page.locator('.language-link').click();
    await page.waitForURL(url + (chinese ? '/' : '/zh/') + 'video/');
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: English/Chinese desktop/mobile layouts, language switch, translated copy actions, guide tabs/deep links, keyboard access, metadata, links, pinned installer and compatibility report verification tiers.",
  );
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
