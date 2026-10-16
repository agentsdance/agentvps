import { createDesktop } from './desktop.js';
const $ = id => document.getElementById(id);
let token = '', currentView = 'desk', currentPath = '.', selectedJob = '', selectedTab = '', selectedTerminal = '', terminalCursor = 0, toolCatalog = [], polling = false, desk, desktop, desktopEnabled = false;
const put = (id, value) => { $(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
function notice(message) { put('notice', message); $('notice').hidden = false; }
async function request(route, options = {}) {
  const res = await fetch(route, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  if (res.status === 401) { lock(); throw new Error('Access token was rejected.'); }
  if (!res.ok) { let error = await res.text(); try { error = JSON.parse(error).error; } catch {} throw new Error(error); }
  return res;
}
async function call(name, args = {}) { return (await (await request('/api/tools/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) })).json()).result; }
function bind(id, event, fn) { $(id).addEventListener(event, async e => { e.preventDefault(); const button = e.submitter || (e.currentTarget.tagName === 'BUTTON' ? e.currentTarget : null); if (button) button.disabled = true; $('notice').hidden = true; try { await fn(e); } catch (error) { notice(error.message); } finally { if (button) button.disabled = false; } }); }
function lock() { token = ''; desk?.lock(); desktop?.lock(); $('console').hidden = true; $('login').hidden = false; $('token').value = ''; selectedTerminal = ''; document.body.classList.remove('desk-open'); }
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function empty(container, text) { container.replaceChildren(element('p', text, 'empty')); }
async function refreshStatus() {
  const info = await call('workspace_info'); put('workspace-name', info.name); put('sidebar-host', info.hostname);
  desktopEnabled = !!info.desktop?.enabled;
  desk?.identity(info);
  put('stat-jobs', info.jobs); put('stat-terminals', info.terminals); put('stat-schedules', info.schedules); put('stat-browser', info.browserStarted ? 'Ready' : 'Standby');
  $('identity').replaceChildren(...[['HOST', info.hostname], ['WORKSPACE', info.workspace], ['IDENTITY', info.workspaceId], ['SYSTEM', `${info.platform} / ${info.arch}`]].map(([k, v]) => { const row = element('div'); row.append(element('dt', k), element('dd', v)); return row; }));
}
async function show(view) {
  currentView = view;
  document.body.classList.toggle('desk-open', view === 'desk' || view === 'desktop');
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== view; });
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  await desktop.activate(view === 'desktop');
  await refresh();
}
async function refresh() {
  await refreshStatus();
  if (currentView === 'desk') await desk.refresh();
  if (currentView === 'files') await loadFiles();
  if (currentView === 'jobs') { await loadJobs(); if (selectedJob) await loadJob(); }
  if (currentView === 'browser') await loadTabs();
  if (currentView === 'terminal') { await loadTerminals(); await readTerminal(); }
}
bind('login-form', 'submit', async () => {
  token = $('token').value.trim(); put('login-error', '');
  try { await refreshStatus(); } catch (e) { put('login-error', e.message); token = ''; return; }
  toolCatalog = (await (await request('/api/tools')).json()).tools;
  $('tool-select').replaceChildren(...toolCatalog.map(t => { const o = element('option', t.name); o.value = t.name; return o; })); chooseTool();
  // Reveal navigation only when the initial view is ready to be selected. A slow
  // catalog request must not overwrite a view the user has already clicked.
  $('login').hidden = true; $('console').hidden = false; $('token').value = '';
  await show(desktopEnabled ? 'desktop' : 'desk');
});
bind('logout', 'click', lock); bind('refresh', 'click', refresh);
const deskNav = element('button'); deskNav.dataset.view = 'desk'; deskNav.append(element('span', '↗'), document.createTextNode(' Remote desk')); document.querySelector('nav').prepend(deskNav);
const desktopNav = element('button'); desktopNav.dataset.view = 'desktop'; desktopNav.append(element('span', '▣'), document.createTextNode(' Desktop')); document.querySelector('nav').prepend(desktopNav);
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => show(el.dataset.view).catch(e => notice(e.message))));
bind('command-form', 'submit', async () => { put('quick-output', 'Running on VPS…'); const job = await call('shell_run', { command: $('command').value, waitMs: 1000 }); put('quick-output', `${job.stdout}${job.stderr}\n[${job.status}] ${job.id}`); selectedJob = job.id; await refreshStatus(); });
bind('check-readiness', 'click', async () => { $('readiness').hidden = false; put('readiness', 'Checking Python, Node, Bash and Chromium…'); const result = await call('health_check', { browser: true }); put('readiness', Object.entries(result.capabilities).map(([key, val]) => `${val.ready ? '✓' : '✕'} ${key}: ${val.version || val.error || 'ready'}`).join('\n')); await refreshStatus(); });
bind('show-connect', 'click', () => { $('connect-guide').hidden = !$('connect-guide').hidden; put('connect-guide', `MCP endpoint\n${location.origin}/mcp\nAuthorization: Bearer <your-token>\n\nLocal stdio bridge\nagentvps connect --url ${location.origin} --token-file /path/to/token\nagentvps mcp\n\nRegister the bridge as an MCP server in Claude Code or Codex.\nSee README for exact client commands and the bundled skill.`); });
async function loadFiles() {
  put('current-path', currentPath === '.' ? '/' : '/' + currentPath);
  const files = await call('file_list', { path: currentPath }); const list = $('file-list');
  if (!files.length) return empty(list, 'Nothing here yet. Upload a file or let your agent create one.');
  list.replaceChildren(...files.sort((a, b) => (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1) || a.name.localeCompare(b.name)).map(f => {
    const row = element('button', undefined, 'table-row'); row.append(element('span', `${f.type === 'directory' ? '▸' : '↓'}  ${f.name}`), element('small', f.type === 'directory' ? 'FOLDER' : `${(f.size / 1024).toFixed(1)} KB`), element('small', new Date(f.modified).toLocaleDateString()));
    row.addEventListener('click', async () => { try { if (f.type === 'directory') { currentPath = f.path; await loadFiles(); } else { const blob = await (await request(`/api/files?path=${encodeURIComponent(f.path)}`)).blob(); const url = URL.createObjectURL(blob); const a = element('a'); a.href = url; a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); } } catch (e) { notice(e.message); } }); return row;
  }));
}
bind('parent-dir', 'click', async () => { currentPath = currentPath.split('/').slice(0, -1).join('/') || '.'; await loadFiles(); });
bind('upload', 'change', async () => { const file = $('upload').files[0]; if (!file) return; await request(`/api/files?path=${encodeURIComponent((currentPath === '.' ? '' : currentPath + '/') + file.name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); $('upload').value = ''; await loadFiles(); });
async function loadJobs() {
  const jobs = await call('shell_list'), list = $('job-list'); if (!jobs.length) return empty(list, 'No commands yet. Start one from Overview or your agent.');
  list.replaceChildren(...jobs.map(j => { const row = element('button', undefined, 'table-row'); row.append(element('span', j.command), element('span', j.status, `badge ${j.status}`), element('small', new Date(j.startedAt).toLocaleTimeString())); row.addEventListener('click', () => { selectedJob = j.id; loadJob().catch(e => notice(e.message)); }); return row; }));
}
async function loadJob() { const j = await call('shell_status', { id: selectedJob, waitMs: 0 }); $('job-detail').hidden = false; put('job-title', `${j.status} · ${j.exitCode ?? '—'}`); $('cancel-job').hidden = j.status !== 'running'; put('job-output', `${j.command}\n\nSTDOUT\n${j.stdout}\nSTDERR\n${j.stderr}\n\nJob ${j.id}`); }
bind('cancel-job', 'click', async () => { await call('shell_cancel', { id: selectedJob }); await loadJob(); });
async function loadTerminals() { const sessions = await call('terminal_list'); const select = $('terminal-select'); select.replaceChildren(element('option', 'Select a terminal'), ...sessions.map(t => { const o = element('option', `${t.id.slice(0, 8)} · ${t.exited ? 'exited' : t.cwd}`); o.value = t.id; return o; })); select.options[0].value = ''; select.value = selectedTerminal; }
async function readTerminal() { if (!selectedTerminal) return; const t = await call('terminal_read', { id: selectedTerminal, cursor: terminalCursor }); terminalCursor = t.cursor; if (t.output) { const output = $('terminal-output'); output.textContent += t.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, ''); output.textContent = output.textContent.slice(-100000); output.scrollTop = output.scrollHeight; } }
bind('new-terminal', 'click', async () => { const t = await call('terminal_create'); selectedTerminal = t.id; terminalCursor = 0; put('terminal-output', ''); await loadTerminals(); await readTerminal(); });
bind('terminal-select', 'change', async () => { selectedTerminal = $('terminal-select').value; terminalCursor = 0; put('terminal-output', ''); await readTerminal(); });
bind('terminal-form', 'submit', async () => { if (!selectedTerminal) throw new Error('Create or select a terminal first.'); await call('terminal_write', { id: selectedTerminal, data: $('terminal-input').value + '\n' }); $('terminal-input').value = ''; setTimeout(() => readTerminal().catch(e => notice(e.message)), 150); });
bind('interrupt-terminal', 'click', () => call('terminal_write', { id: selectedTerminal, data: '\u0003' }));
bind('close-terminal', 'click', async () => { await call('terminal_close', { id: selectedTerminal }); await loadTerminals(); });
async function loadTabs() { const { tabs } = await call('browser_tabs'); const list = $('tab-list'); if (!tabs.length) return empty(list, 'Open a website to start the remote browser.'); list.replaceChildren(...tabs.map(t => { const button = element('button', t.title || 'Untitled', `tab-button ${selectedTab === t.id ? 'active' : ''}`); button.append(element('small', t.url)); button.addEventListener('click', () => selectTab(t.id).catch(e => notice(e.message))); return button; })); }
async function selectTab(id) { selectedTab = id; const tab = await call('browser_snapshot', { id }); $('browser-detail').hidden = false; $('browser-image').hidden = true; put('tab-title', tab.title); put('browser-snapshot', tab.snapshot); await loadTabs(); }
bind('browser-form', 'submit', async () => { const tab = await call('browser_open', { url: $('browser-url').value }); await selectTab(tab.id); });
bind('capture', 'click', async () => { const result = await call('browser_screenshot', { id: selectedTab }); $('browser-image').src = `data:image/png;base64,${result.image}`; $('browser-image').hidden = false; });
bind('close-tab', 'click', async () => { await call('browser_close', { id: selectedTab }); selectedTab = ''; $('browser-detail').hidden = true; await loadTabs(); });
function chooseTool() { const t = toolCatalog.find(t => t.name === $('tool-select').value); if (!t) return; put('tool-description', t.description); put('tool-schema', t.inputSchema); $('tool-args').value = '{}'; }
bind('tool-select', 'change', chooseTool);
bind('tool-form', 'submit', async () => { put('tool-result', 'Running…'); const result = await call($('tool-select').value, JSON.parse($('tool-args').value)); if (result?.image) { const { image, ...receipt } = result; put('tool-result', { ...receipt, image: '(PNG saved to workspace; use Files to download)' }); } else put('tool-result', result); });
setInterval(async () => { if (!token || polling || document.hidden) return; polling = true; try { if (currentView === 'terminal') await readTerminal(); else if (currentView === 'jobs') { await loadJobs(); if (selectedJob) await loadJob(); } } catch (e) { notice(e.message); } finally { polling = false; } }, 1500);
desk = window.createAgentVPSDesk({ call, request, notice, show, active: () => !!token && currentView === 'desk' });
desktop = createDesktop({ request, notice, clearNotice: () => { $('notice').hidden = true; } });
