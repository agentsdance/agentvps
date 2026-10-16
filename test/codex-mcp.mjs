// Exercises Codex's actual registered MCP connection. No model turn or sub-agent is started.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const child = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
const waiting = new Map(); let sequence = 0;
createInterface({ input: child.stdout }).on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  const request = waiting.get(message.id); if (!request) return;
  clearTimeout(request.timer); waiting.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
});
child.on('error', error => { for (const request of waiting.values()) request.reject(error); });
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { waiting.delete(id); reject(new Error('Codex RPC timed out: ' + method)); }, 60000);
  waiting.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const output = path.resolve('test-results/codex-desktop'); await fs.mkdir(output, { recursive: true });
try {
  await rpc('initialize', { clientInfo: { name: 'agentvps-desktop-acceptance', version: '0.0.1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
  const { thread } = await rpc('thread/start', { cwd: process.cwd(), ephemeral: true });
  const inventory = await rpc('mcpServerStatus/list', { threadId: thread.id, serverName: 'agentvps', detail: 'toolsAndAuthOnly' });
  assert.ok(JSON.stringify(inventory).includes('desktop_input'), 'Codex must discover the desktop tools');
  const raw = (tool, args = {}) => rpc('mcpServer/tool/call', { threadId: thread.id, server: 'agentvps', tool, arguments: args });
  const call = async (tool, args = {}) => { const result = await raw(tool, args); const text = result.content.find(c => c.type === 'text')?.text; if (result.isError) throw new Error(text); return JSON.parse(text); };
  const identity = await call('workspace_info'); assert.equal(identity.version, '0.0.1'); assert.equal(identity.platform, 'linux'); assert.equal(identity.desktop.ready, true);
  await call('file_write', { path: 'Welcome/README.md', content: '# Welcome to AgentVPS 0.0.1\n\nThis is your real Linux computer. Browser, Terminal and Files share this workspace.\n\nWatch the desktop or choose Take over to use its mouse and keyboard. Return control when finished.\n\nYour agent can connect through MCP and operate this same computer. The file codex-mcp.txt was created in a native terminal through Codex’s actual MCP connection.\n\nScreen resolutions and fullscreen are available in the toolbar. Background jobs remain visible under Commands.\n' });
  await call('desktop_resize', { width: 1440, height: 900 });
  await call('desktop_launch', { app: 'terminal' }); await new Promise(r => setTimeout(r, 1000));
  await call('desktop_input', { action: 'text', text: "export PS1='agentvps → '; clear; printf 'AgentVPS 0.0.1 — connected through Codex MCP\n\n'; printf 'Remote user: '; whoami; printf 'Workspace: '; pwd; printf '\nMCP → native terminal → shared file: verified\n' | tee Welcome/codex-mcp.txt" });
  await call('desktop_input', { action: 'key', key: 'Return' }); await new Promise(r => setTimeout(r, 600));
  const file = await call('file_read', { path: 'Welcome/codex-mcp.txt' }); assert.match(file.content, /verified/);
  const tab = await call('browser_open', { url: 'http://127.0.0.1:8080/desktop-home.html' });
  await call('browser_evaluate', { id: tab.id, expression: `document.querySelector('h1').innerHTML='Your computer.<br>Ready to work.'; document.querySelector('.label').textContent='AGENTVPS 0.0.1 · CONNECTED THROUGH CODEX'; document.querySelector('.intro').innerHTML='This browser, terminal and file manager are running on your VPS.<br>Codex operated them through MCP while the desktop streamed live.'; document.title='Your computer · AgentVPS 0.0.1'` });
  await call('desktop_launch', { app: 'files' }); await new Promise(r => setTimeout(r, 800));
  await call('desktop_input', { action: 'key', key: 'ctrl+l' });
  await call('desktop_input', { action: 'text', text: identity.workspace + '/Welcome' });
  await call('desktop_input', { action: 'key', key: 'Return' });
  const windows = await call('shell_run', { command: 'wmctrl -lx', waitMs: 1000 });
  const lines = windows.stdout.trim().split('\n');
  const terminal = lines.filter(line => /xfce4-terminal/i.test(line)).at(-1)?.split(/\s+/)[0];
  const chromium = lines.find(line => /chromium/i.test(line))?.split(/\s+/)[0];
  const files = lines.filter(line => /thunar/i.test(line)).at(-1)?.split(/\s+/)[0];
  assert.ok(terminal && chromium && files, 'all native app windows exist');
  assert.ok([terminal, chromium, files].every(id => /^0x[0-9a-f]+$/i.test(id)));
  await call('shell_run', { command: `wmctrl -ir ${chromium} -e 0,70,35,1250,735; wmctrl -ir ${terminal} -e 0,100,520,770,260; wmctrl -ir ${files} -e 0,900,425,490,355; wmctrl -ia ${chromium}; wmctrl -ia ${terminal}; wmctrl -ia ${files}`, waitMs: 1000 });
  await new Promise(r => setTimeout(r, 1000));
  const shot = await raw('desktop_screenshot', { path: 'Welcome/desktop.png' });
  const image = shot.content.find(c => c.type === 'image'); assert.ok(image); await fs.writeFile(path.join(output, 'desktop.png'), Buffer.from(image.data, 'base64'));
  await fs.writeFile(path.join(output, 'proof.json'), JSON.stringify({ testedAt: new Date().toISOString(), client: 'Codex app-server', transport: 'registered agentvps MCP stdio bridge', identity, nativeTerminalFile: file.path, browserTab: tab.id, checks: ['Codex discovered desktop tools', 'actual Codex MCP tool calls', 'visible native terminal input', 'file created by that terminal', 'visible shared Chromium operation', 'native file manager', 'desktop screenshot returned through MCP'] }, null, 2));
  console.log('PASS: Codex’s registered MCP connection operated the live Linux desktop, terminal, browser and files. Evidence: ' + output);
} finally { for (const request of waiting.values()) clearTimeout(request.timer); child.stdin.end(); child.kill('SIGTERM'); }
