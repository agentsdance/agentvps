import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import net from 'node:net';
import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { workloadEnv, type Config } from './config.js';
import type { Workspace } from './workspace.js';
import { ToolError, delay } from './util.js';

type Mode = 'watch' | 'control';
type Ticket = { mode: Mode; expires: number; session: string };
const assets = fileURLToPath(new URL('../deploy/desktop/', import.meta.url));
const run = promisify(execFile);

/** One owner, one X display. VNC ports are loopback-only; the public stream uses one-use tickets. */
export class Desktop {
  private children: ChildProcess[] = [];
  private tickets = new Map<string, Ticket>();
  private sockets = new Set<WebSocket>();
  private lastPong = new WeakMap<WebSocket, number>();
  private controller?: { session: string; expires: number; socket?: WebSocket };
  private vnc = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  private initialized = false;
  private closing = false;
  private timer?: NodeJS.Timeout;
  width = 1440; height = 900;
  constructor(private config: Config, private workspace: Workspace) {}
  get enabled() { return !!this.config.desktop; }
  get ready() { return this.initialized && this.children.every(c => c.exitCode === null && c.signalCode === null); }
  private prune() {
    for (const [key, ticket] of this.tickets) if (ticket.expires < Date.now()) this.tickets.delete(key);
    if (this.controller && this.controller.expires < Date.now()) { this.controller.socket?.terminate(); this.controller = undefined; }
  }
  status() {
    this.prune();
    return { enabled: this.enabled, ready: this.ready, width: this.width, height: this.height,
      control: this.controller ? 'human' : 'agent', viewers: this.sockets.size,
      applications: ['browser', 'terminal', 'files'], workspace: this.config.workspace,
      note: 'Take over blocks new browser and desktop tool mutations. Already running actions, shell jobs and schedules continue.' };
  }
  assertAgentControl() { this.prune(); if (this.controller) throw new ToolError('A person has taken over the desktop. Wait until they return control before sending browser or desktop input.', 409); }
  private requireReady() { if (!this.ready) throw new ToolError(this.enabled ? 'The Linux desktop is not ready.' : 'The Linux desktop is disabled. Use the Ubuntu installer or AGENTVPS_DESKTOP=1.', 503); }
  private start(command: string, args: string[]) {
    const child = spawn(command, args, { env: workloadEnv(this.config.workspace), cwd: this.config.workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.push(child);
    child.on('error', e => console.error(`Desktop ${command}: ${e.message}`));
    child.stderr?.resume(); // Never log window titles, clipboard data, cookies or display credentials.
    child.stdout?.resume();
    child.on('exit', () => { if (!this.closing) console.error(`Desktop component exited: ${command}`); });
    return child;
  }
  private async command(command: string, args: string[]) { return run(command, args, { env: workloadEnv(this.config.workspace), timeout: 10000, maxBuffer: 1024 * 1024 }); }
  async init() {
    if (!this.enabled) return;
    if (process.platform !== 'linux') throw new Error('The graphical desktop requires Linux.');
    const state = path.join(this.config.state, 'desktop'); await fs.mkdir(state, { recursive: true, mode: 0o700 });
    process.env.DISPLAY = ':99'; process.env.XAUTHORITY = path.join(state, 'Xauthority');
    process.env.XDG_RUNTIME_DIR = path.join(state, 'run'); await fs.mkdir(process.env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
    try {
      await this.command('xauth', ['-f', process.env.XAUTHORITY, 'add', ':99', '.', randomBytes(16).toString('hex')]);
      this.start('Xtigervnc', [':99', '-geometry', `${this.width}x${this.height}`, '-depth', '24', '-nolisten', 'tcp', '-auth', process.env.XAUTHORITY, '-localhost', 'yes', '-rfbport', '5900', '-SecurityTypes', 'None', '-AlwaysShared', '-AcceptSetDesktopSize=0', '-desktop', 'AgentVPS']);
      let displayReady = false;
      for (let i = 0; i < 40; i++) { try { await this.command('xdpyinfo', []); displayReady = true; break; } catch { await delay(100); } }
      if (!displayReady) throw new Error('The Linux display did not become ready.');
      const bus = this.start('dbus-daemon', ['--session', '--nofork', '--print-address=1']);
      process.env.DBUS_SESSION_BUS_ADDRESS = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Desktop D-Bus startup timed out.')), 5000);
        bus.stdout!.once('data', chunk => { clearTimeout(timeout); resolve(String(chunk).trim().split('\n')[0]); });
        bus.once('error', error => { clearTimeout(timeout); reject(error); });
      });
      await this.command('rsvg-convert', ['-o', path.join(state, 'wallpaper.png'), path.join(assets, 'wallpaper.svg')]);
      await this.command('feh', ['--no-fehbg', '--bg-fill', path.join(state, 'wallpaper.png')]);
      const theme = path.join(process.env.HOME || this.config.home, '.themes', 'AgentVPS', 'openbox-3');
      await fs.mkdir(theme, { recursive: true }); await fs.copyFile(path.join(assets, 'themerc'), path.join(theme, 'themerc'));
      const terminal = path.join(process.env.HOME || this.config.home, '.config', 'xfce4', 'terminal'); await fs.mkdir(terminal, { recursive: true });
      try { await fs.writeFile(path.join(terminal, 'terminalrc'), '[Configuration]\nFontName=DejaVu Sans Mono 12\nColorForeground=#d8e1cd\nColorBackground=#202a23\nColorCursor=#d8e1cd\nMiscMenubarDefault=FALSE\nMiscToolbarDefault=FALSE\nScrollingBar=TERMINAL_SCROLLBAR_NONE\n', { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      this.start('openbox', ['--config-file', path.join(assets, 'openbox.xml')]);
      this.start('tigervncconfig', ['-nowin']);
      const tint = (await fs.readFile(path.join(assets, 'tint2rc'), 'utf8')).replaceAll('@ASSETS@', assets);
      await fs.writeFile(path.join(state, 'tint2rc'), tint);
      this.start('tint2', ['-c', path.join(state, 'tint2rc')]);
      for (const port of [5901]) {
        this.start('x11vnc', ['-display', ':99', '-auth', process.env.XAUTHORITY, '-rfbport', String(port), '-listen', '127.0.0.1', '-forever', '-shared', '-nopw', '-noxdamage', '-quiet', '-nocursorshape', '-viewonly', '-no6', '-xrandr', 'resize']);
        let listening = false;
        for (let i = 0; i < 40; i++) {
          listening = await new Promise<boolean>(resolve => { const socket = net.connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
          if (listening) break; await delay(100);
        }
        if (!listening) throw new Error(`Desktop VNC service on ${port} did not become ready.`);
      }
      this.initialized = true;
      this.timer = setInterval(() => { this.prune(); for (const socket of this.sockets) { if (Date.now() - (this.lastPong.get(socket) || 0) > 45000) socket.terminate(); else socket.ping(); } }, 15000); this.timer.unref();
    } catch (error) { await this.close(); throw error; }
  }
  ticket(mode: Mode) {
    this.requireReady(); this.prune();
    if (this.sockets.size + this.tickets.size >= 8) throw new ToolError('Desktop viewer limit reached.', 429);
    if (mode === 'control' && this.controller) throw new ToolError('Another tab has control. Return control there first.', 409);
    const ticket = randomBytes(32).toString('base64url'), session = randomUUID(), expires = Date.now() + 30000;
    this.tickets.set(ticket, { mode, expires, session });
    if (mode === 'control') this.controller = { session, expires };
    return { ticket, mode, expiresAt: new Date(expires).toISOString() };
  }
  attach(server: http.Server) {
    server.on('upgrade', (request, socket, head) => {
      const reject = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
      let url: URL; try { url = new URL(request.url || '/', 'http://localhost'); } catch { reject(400); return; } this.prune();
      const origin = request.headers.origin;
      const expected = this.config.publicUrl ? new URL(this.config.publicUrl).origin : `http://${request.headers.host}`;
      if (origin && origin !== expected && origin !== `http://${request.headers.host}`) { reject(403); return; }
      const key = url.searchParams.get('ticket') || '', ticket = this.tickets.get(key);
      if (url.pathname !== '/api/desktop/socket' || !ticket || !this.ready) { reject(401); return; }
      this.tickets.delete(key);
      this.vnc.handleUpgrade(request, socket, head, ws => {
        this.sockets.add(ws);
        this.lastPong.set(ws, Date.now());
        if (ticket.mode === 'control') this.controller = { session: ticket.session, expires: Date.now() + 45000, socket: ws };
        const tcp = net.connect(ticket.mode === 'control' ? 5900 : 5901, '127.0.0.1');
        const cleanup = () => { tcp.destroy(); this.sockets.delete(ws); if (this.controller?.session === ticket.session) this.controller = undefined; };
        ws.on('pong', () => { this.lastPong.set(ws, Date.now()); if (this.controller?.session === ticket.session) this.controller.expires = Date.now() + 45000; });
        ws.on('message', (data, binary) => {
          if (!binary || tcp.writableLength > 4 * 1024 * 1024) { ws.close(1008); return; }
          tcp.write(data as Buffer);
        });
        tcp.on('data', data => { if (ws.readyState !== WebSocket.OPEN) return; if (ws.bufferedAmount > 8 * 1024 * 1024) { ws.close(1013); return; } ws.send(data); });
        tcp.on('error', () => ws.close(1011)); tcp.on('close', () => ws.close());
        ws.on('error', cleanup); ws.on('close', cleanup);
      });
    });
  }
  async launch(app: 'terminal' | 'files') {
    this.requireReady();
    const command = app === 'terminal' ? 'xfce4-terminal' : 'thunar';
    const child = spawn(command, app === 'terminal' ? ['--disable-server', `--working-directory=${this.config.workspace}`, '--title=AgentVPS Terminal', '--geometry=94x24'] : [this.config.workspace], { env: workloadEnv(this.config.workspace), detached: false, stdio: 'ignore' });
    child.on('error', () => {});
    // GUI apps may hand off to an existing instance, so they are not readiness components.
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    return { app, opened: true };
  }
  async resize(width: number, height: number) {
    this.requireReady();
    // Named modes advertised by TigerVNC's RandR output. No app or desktop restart.
    if (![[1280, 720], [1440, 900], [1680, 1050], [1920, 1080]].some(([w, h]) => w === width && h === height)) throw new ToolError('Choose 1280x720, 1440x900, 1680x1050 or 1920x1080.');
    const { stdout } = await this.command('xrandr', ['--query']);
    const output = stdout.match(/^(\S+) connected/m)?.[1]; if (!output) throw new ToolError('No resizable display found.');
    await this.command('xrandr', ['--output', output, '--mode', `${width}x${height}`]);
    this.width = width; this.height = height;
    return this.status();
  }
  async screenshot(file?: string) {
    this.requireReady();
    const relative = file || `artifacts/desktop-${Date.now()}-${randomUUID().slice(0, 6)}.png`;
    const temporary = path.join(this.config.state, `desktop-${randomUUID()}.png`);
    try { await this.command('scrot', [temporary]); const buffer = await fs.readFile(temporary); return { ...await this.workspace.write(relative, buffer), mimeType: 'image/png', image: buffer.toString('base64') }; }
    finally { await fs.rm(temporary, { force: true }); }
  }
  async input(args: { action: string; x?: number; y?: number; button?: number; key?: string; text?: string; amount?: number }) {
    this.requireReady(); this.assertAgentControl();
    const move = async () => {
      if (args.x === undefined || args.y === undefined || args.x < 0 || args.y < 0 || args.x >= this.width || args.y >= this.height) throw new ToolError('Coordinates must be inside the desktop.');
      await this.command('xdotool', ['mousemove', '--sync', String(args.x), String(args.y)]);
    };
    switch (args.action) {
      case 'move': await move(); break;
      case 'click': case 'double_click': await move(); await this.command('xdotool', ['click', '--repeat', args.action === 'double_click' ? '2' : '1', '--delay', '100', String(args.button || 1)]); break;
      case 'key': if (!args.key || !/^[a-zA-Z0-9_+ -]{1,100}$/.test(args.key) || args.key.startsWith('-')) throw new ToolError('Use an X11 key name such as Return, ctrl+l or Alt+F4.'); await this.command('xdotool', ['key', '--clearmodifiers', args.key]); break;
      case 'text': if (args.text === undefined) throw new ToolError('text is required.'); await this.command('xdotool', ['type', '--clearmodifiers', '--delay', '1', '--', args.text]); break;
      case 'scroll': await this.command('xdotool', ['click', '--repeat', String(Math.abs(args.amount || 1)), (args.amount || 1) > 0 ? '5' : '4']); break;
      default: throw new ToolError('Unknown desktop action.');
    }
    return { action: args.action, executed: true };
  }
  async close() {
    this.closing = true; this.initialized = false; clearInterval(this.timer); this.tickets.clear(); this.controller = undefined;
    for (const socket of this.sockets) socket.terminate(); this.vnc.close();
    for (const child of [...this.children].reverse()) child.kill('SIGTERM');
    await Promise.all(this.children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolve => { const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000); child.once('exit', () => { clearTimeout(timeout); resolve(); }); })));
  }
}
