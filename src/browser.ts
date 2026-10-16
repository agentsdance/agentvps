import { chromium, type BrowserContext, type Page, type Download } from 'playwright';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { workloadEnv, type Config } from './config.js';
import { Workspace } from './workspace.js';
import { ToolError, validHttpUrl } from './util.js';

export class Browser {
  private context?: BrowserContext;
  private starting?: Promise<BrowserContext>;
  private pages = new Map<string, Page>();
  private downloads = new WeakMap<Download, Promise<{ path: string; name: string }>>();
  private recentDownloads: Array<{ path: string; name: string }> = [];
  private frames = new Map<string, { captured: number; pending: Promise<Buffer> }>();
  constructor(private config: Config, private workspace: Workspace) {}
  get ready() { return !!this.context; }
  async start(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const ctx = await chromium.launchPersistentContext(path.join(this.config.state, 'browser-profile'), {
        headless: !this.config.desktop, executablePath: this.config.browserExecutable, acceptDownloads: true,
        env: workloadEnv(this.config.workspace),
        viewport: this.config.desktop ? null : { width: 1440, height: 1000 },
        args: this.config.desktop ? ['--window-size=1240,760', '--window-position=100,45', '--hide-crash-restore-bubble'] : [],
        // Docker deployments use a separate OS/container boundary; Chromium sandbox availability varies.
        chromiumSandbox: process.env.AGENTVPS_CHROMIUM_SANDBOX === '1',
      });
      ctx.setDefaultTimeout(15000);
      ctx.setDefaultNavigationTimeout(30000);
      ctx.on('page', p => this.track(p));
      ctx.on('close', () => { this.context = undefined; this.pages.clear(); this.frames.clear(); });
      for (const p of ctx.pages()) this.track(p);
      this.context = ctx;
      return ctx;
    })();
    try { return await this.starting; } finally { this.starting = undefined; }
  }
  private track(p: Page) {
    if ([...this.pages.values()].includes(p)) return;
    const id = randomUUID(); this.pages.set(id, p);
    p.on('close', () => { this.pages.delete(id); this.frames.delete(id); });
    p.on('download', d => { void this.saveDownload(d).catch(() => {}); });
    p.on('dialog', d => { void d.dismiss().catch(() => {}); });
  }
  private get(id: string) { const p = this.pages.get(id); if (!p || p.isClosed()) throw new ToolError('Unknown browser tab. Open a new tab after a daemon restart.', 404); return p; }
  private saveDownload(d: Download) {
    let pending = this.downloads.get(d);
    if (!pending) {
      pending = (async () => {
        const name = path.basename(d.suggestedFilename()).replace(/[\x00-\x1f]/g, '_') || 'download';
        const relative = `downloads/${randomUUID()}-${name}`;
        const full = await this.workspace.resolve(relative, true);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await d.saveAs(full);
        const failure = await d.failure(); if (failure) throw new ToolError(failure);
        const receipt = { path: relative, name }; this.recentDownloads.unshift(receipt); this.recentDownloads.length = Math.min(100, this.recentDownloads.length);
        return receipt;
      })();
      this.downloads.set(d, pending);
    }
    return pending;
  }
  async list() { return { started: this.ready, tabs: await Promise.all([...this.pages].map(async ([id, p]) => ({ id, url: p.url(), title: await p.title().catch(() => '') }))), downloads: this.recentDownloads }; }
  async show(homeUrl: string) { const context = await this.start(); const page = context.pages().at(-1) || await context.newPage(); if (page.url() === 'about:blank') await page.goto(homeUrl); await page.bringToFront(); }
  async open(url: string) {
    const ctx = await this.start();
    if (this.pages.size >= 20) throw new ToolError('Maximum of twenty tabs reached; close unused tabs.', 429);
    const p = await ctx.newPage();
    if (this.config.desktop) await p.bringToFront();
    const id = [...this.pages].find(([, page]) => page === p)![0];
    try { await p.goto(validHttpUrl(url), { waitUntil: 'domcontentloaded' }); }
    catch (error) { await p.close(); throw error; }
    return this.snapshot(id);
  }
  async navigate(id: string, url: string) { const page = this.get(id); if (this.config.desktop) await page.bringToFront(); await page.goto(validHttpUrl(url), { waitUntil: 'domcontentloaded' }); return this.snapshot(id); }
  async snapshot(id: string) {
    const p = this.get(id);
    return { id, url: p.url(), title: await p.title(), snapshot: (await p.locator('body').ariaSnapshot()).slice(0, 60000) };
  }
  async action(args: { id: string; action: string; selector?: string; text?: string; key?: string; x?: number; y?: number; value?: string }) {
    const p = this.get(args.id);
    if (this.config.desktop) await p.bringToFront();
    const locator = () => { if (!args.selector) throw new ToolError('selector is required for this action.'); return p.locator(args.selector); };
    switch (args.action) {
      case 'click': await locator().click(); break;
      case 'fill': if (args.text === undefined) throw new ToolError('text is required.'); await locator().fill(args.text); break;
      case 'press': if (!args.key) throw new ToolError('key is required.'); if (args.selector) await locator().press(args.key); else await p.keyboard.press(args.key); break;
      case 'select': if (args.value === undefined) throw new ToolError('value is required.'); await locator().selectOption(args.value); break;
      case 'hover': await locator().hover(); break;
      case 'check': await locator().check(); break;
      case 'uncheck': await locator().uncheck(); break;
      case 'scroll': await p.mouse.wheel(args.x || 0, args.y ?? 800); break;
      case 'back': await p.goBack({ waitUntil: 'domcontentloaded' }); break;
      case 'forward': await p.goForward({ waitUntil: 'domcontentloaded' }); break;
      case 'reload': await p.reload({ waitUntil: 'domcontentloaded' }); break;
      default: throw new ToolError('Unknown browser action.');
    }
    return this.snapshot(args.id);
  }
  async evaluate(id: string, expression: string) { const p = this.get(id); if (this.config.desktop) await p.bringToFront(); return { id, result: await p.evaluate(expression) }; }
  async screenshot(id: string, file?: string, fullPage = false) {
    const relative = file || `artifacts/screenshot-${Date.now()}-${randomUUID().slice(0, 6)}.png`;
    const buffer = await this.get(id).screenshot({ type: 'png', fullPage, animations: 'disabled' });
    const receipt = await this.workspace.write(relative, buffer);
    return { ...receipt, mimeType: 'image/png', image: buffer.toString('base64') };
  }
  /** Transient desk frames are shared across viewers and never written to workspace artifacts. */
  async frame(id: string) {
    const p = this.get(id), cached = this.frames.get(id);
    if (cached && Date.now() - cached.captured < 750) return cached.pending;
    const frame = { captured: Infinity, pending: p.screenshot({ type: 'jpeg', quality: 65, timeout: 10000 }) };
    this.frames.set(id, frame);
    try { const buffer = await frame.pending; frame.captured = Date.now(); return buffer; }
    catch (error) { if (this.frames.get(id) === frame) this.frames.delete(id); throw error; }
  }
  async input(args: { id: string; action: string; x?: number; y?: number; button?: 'left' | 'middle' | 'right'; key?: string; text?: string }) {
    const p = this.get(args.id);
    if (this.config.desktop) await p.bringToFront();
    if (['click', 'double_click', 'move'].includes(args.action)) {
      const size = p.viewportSize() || await p.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      if (args.x === undefined || args.y === undefined || args.x < 0 || args.y < 0 || !size || args.x >= size.width || args.y >= size.height) throw new ToolError('Pointer coordinates must be inside the browser viewport.');
    }
    switch (args.action) {
      case 'click': await p.mouse.click(args.x!, args.y!, { button: args.button }); break;
      case 'double_click': await p.mouse.dblclick(args.x!, args.y!, { button: args.button }); break;
      case 'move': await p.mouse.move(args.x!, args.y!); break;
      case 'scroll': await p.mouse.wheel(args.x ?? 0, args.y ?? 0); break;
      case 'key': if (!args.key) throw new ToolError('A key is required.'); await p.keyboard.press(args.key); break;
      case 'text': if (args.text === undefined) throw new ToolError('Text is required.'); await p.keyboard.insertText(args.text); break;
      default: throw new ToolError('Unknown browser input action.');
    }
    this.frames.delete(args.id);
    return { id: args.id, action: args.action };
  }
  async download(id: string, selector: string) {
    const p = this.get(id);
    if (this.config.desktop) await p.bringToFront();
    const [d] = await Promise.all([p.waitForEvent('download'), p.locator(selector).click()]);
    return this.saveDownload(d);
  }
  async upload(id: string, selector: string, files: string[]) {
    const paths = await Promise.all(files.map(file => this.workspace.resolve(file)));
    const p = this.get(id); if (this.config.desktop) await p.bringToFront(); await p.locator(selector).setInputFiles(paths); return { id, files };
  }
  async closeTab(id: string) { await this.get(id).close(); return { id, closed: true }; }
  async close() { if (this.starting) await this.starting.catch(() => {}); await this.context?.close(); }
}
