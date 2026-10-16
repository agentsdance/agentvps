/* The desk uses the same authenticated workspace, PTYs and Chromium tabs as MCP. */
window.createAgentVPSDesk = ({ call, request, notice, show, active }) => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const on = (id, event, fn) => $(id).addEventListener(event, async e => { e.preventDefault(); $('notice').hidden = true; try { await fn(e); } catch (error) { notice(error.message); } });
  let directory = '.', files = [], file = null, mode = 'browser', fileUrl = '', frameUrl = '';
  let tabId = '', tabs = [], paused = false, controlling = false, frameBusy = false, lastFrame = 0, lastRefresh = 0;
  let terminal, fit, terminalId = '', cursor = 0, exited = false, readBusy = false, writeBusy = false, terminalInput = [], writeTimer, inputQueue = Promise.resolve();
  let refreshBusy = false, generation = 0, fileGeneration = 0, lastFiles = '', lastTabs = '', lastTerminals = '', dialogAction;
  const dirty = () => file?.editable && $('desk-file-text').value !== file.content;
  const discard = () => !dirty() || confirm('Discard your unsaved file edits?');
  const pathFor = name => directory === '.' ? name : `${directory}/${name}`;
  const revoke = name => { if (name) URL.revokeObjectURL(name); };
  const usable = () => active() && !document.hidden;
  function identity(info) {
    $('desk-host').textContent = `${info.hostname} / ${info.platform}`;
    $('desk-workspace').textContent = info.workspace;
    $('desk-workspace').title = `Workspace ${info.workspaceId}`;
    $('desk-job-count').textContent = `${info.jobs} running command${info.jobs === 1 ? '' : 's'}`;
  }
  function changeMode(next) {
    if (next === 'editor' && !file) return;
    mode = next; $('desk-browser').hidden = mode !== 'browser'; $('desk-editor').hidden = mode !== 'editor';
    $('desk-browser-mode').classList.toggle('active', mode === 'browser'); $('desk-editor-mode').classList.toggle('active', mode === 'editor');
    lastFrame = 0;
  }
  on('desk-browser-mode', 'click', () => changeMode('browser'));
  on('desk-editor-mode', 'click', () => changeMode('editor'));
  on('desk-toggle-files', 'click', () => { document.querySelector('.desk-grid').classList.toggle('show-files'); resizeTerminal(); });
  on('desk-expand', 'click', async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await $('desk').requestFullscreen(); });
  on('desk-jobs', 'click', () => show('jobs'));
  function renderFiles() {
    const filter = $('desk-filter').value.toLowerCase(), list = $('desk-file-list');
    const visible = files.filter(f => f.name.toLowerCase().includes(filter)).sort((a,b) => (a.type !== 'directory') - (b.type !== 'directory') || a.name.localeCompare(b.name));
    list.replaceChildren(...visible.map(f => {
      const button = el('button', undefined, `desk-file-row ${file?.path === f.path ? 'selected' : ''}`); button.title = f.path;
      button.append(el('span', f.type === 'directory' ? '▸' : f.type === 'symlink' ? '↗' : '·', 'file-icon'), el('span', f.name));
      if (f.type !== 'directory') button.append(el('small', f.size > 1024 * 1024 ? `${(f.size/1048576).toFixed(1)}m` : f.size > 1024 ? `${Math.ceil(f.size/1024)}k` : `${f.size}b`));
      button.addEventListener('click', () => { $('notice').hidden = true; (f.type === 'directory' ? browse(f.path) : openFile(f.path)).catch(e => notice(e.message)); }); return button;
    }));
    if (!visible.length) list.append(el('p', filter ? 'No matching files.' : 'Your workspace is ready. Create a file or upload something to begin.', 'empty'));
  }
  async function loadFiles() {
    const path = directory, state = generation;
    const result = await call('file_list', { path });
    if (path !== directory || state !== generation) return;
    const signature = JSON.stringify(result);
    if (signature !== lastFiles) { files = result; lastFiles = signature; renderFiles(); }
    $('desk-path').textContent = path === '.' ? '/' : '/' + path; $('desk-path').title = $('desk-path').textContent;
  }
  async function browse(path) { directory = path; lastFiles = ''; $('desk-filter').value = ''; await loadFiles(); }
  on('desk-parent', 'click', () => browse(directory.split('/').slice(0,-1).join('/') || '.'));
  on('desk-files-refresh', 'click', loadFiles);
  $('desk-filter').addEventListener('input', renderFiles);
  function updateDirty() {
    const changed = dirty(); $('desk-file-save').disabled = !file?.editable || !changed;
    $('desk-file-state').textContent = changed ? 'Unsaved changes' : 'Saved on VPS'; $('desk-file-state').classList.toggle('dirty', changed);
  }
  async function openFile(path, reload = false) {
    if (!discard()) return;
    const sequence = ++fileGeneration, state = generation;
    $('desk-file-text').disabled = true; $('desk-file-save').disabled = true;
    let result;
    try { result = await call('file_read', { path, limit: 1048576, encoding: 'base64' }); }
    finally { if (sequence === fileGeneration) { $('desk-file-text').disabled = false; updateDirty(); } }
    if (sequence !== fileGeneration || state !== generation) return;
    const bytes = Uint8Array.from(atob(result.content), c => c.charCodeAt(0));
    let content = '', editable = !result.truncated;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (content.includes('\0')) editable = false; } catch { editable = false; }
    file = { path, content, sha256: result.sha256, editable };
    revoke(fileUrl); fileUrl = ''; $('desk-file-preview').replaceChildren();
    $('desk-file-title').textContent = path; $('desk-file-title').title = path; $('desk-file-text').value = editable ? content : '';
    $('desk-file-text').hidden = !editable; $('desk-file-preview').hidden = editable; $('desk-editor-mode').disabled = false;
    if (!editable) {
      if (/\.(png|jpg|jpeg|gif|webp)$/i.test(path) && !result.truncated) {
        fileUrl = URL.createObjectURL(new Blob([bytes], { type: /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : /\.gif$/i.test(path) ? 'image/gif' : 'image/jpeg' }));
        const image = el('img'); image.src = fileUrl; image.alt = path; $('desk-file-preview').append(image);
      } else $('desk-file-preview').append(el('p', result.truncated ? 'This file is larger than the 1 MiB editor limit. Download it to view the complete file.' : 'Binary file. Download to open it on your computer.', 'empty'));
    }
    updateDirty(); renderFiles(); changeMode('editor');
  }
  $('desk-file-text').addEventListener('input', updateDirty);
  $('desk-file-text').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile().catch(error => notice(error.message)); }
    if (e.key === 'Tab') { e.preventDefault(); const input = e.currentTarget; input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end'); updateDirty(); }
  });
  async function saveFile() {
    if (!file?.editable || !dirty()) return;
    const current = file, content = $('desk-file-text').value;
    const result = await call('file_write', { path: current.path, content, expectedSha256: current.sha256 });
    if (file === current) { current.content = content; current.sha256 = result.sha256; updateDirty(); }
    await loadFiles();
  }
  on('desk-file-save', 'click', saveFile);
  on('desk-file-reload', 'click', () => file && openFile(file.path, true));
  on('desk-file-download', 'click', async () => {
    if (!file) return; const current = file, blob = await (await request(`/api/files?path=${encodeURIComponent(current.path)}`)).blob();
    const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = current.path.split('/').at(-1); a.click(); setTimeout(() => revoke(url), 1000);
  });
  function askName(title, initial, action) {
    $('desk-dialog-title').textContent = title; $('desk-dialog-input').value = initial; $('desk-dialog-error').textContent = ''; dialogAction = action; $('desk-dialog').showModal(); $('desk-dialog-input').focus(); $('desk-dialog-input').select();
  }
  on('desk-dialog-cancel', 'click', () => $('desk-dialog').close());
  on('desk-dialog-form', 'submit', async () => {
    const name = $('desk-dialog-input').value.trim(); if (!name || name.startsWith('/') || name.split('/').includes('..')) { $('desk-dialog-error').textContent = 'Use a name or relative path inside this folder.'; return; }
    const button = $('desk-dialog-form').querySelector('[type=submit]'); button.disabled = true;
    try { await dialogAction(name); $('desk-dialog').close(); } catch (e) { $('desk-dialog-error').textContent = e.message; } finally { button.disabled = false; }
  });
  on('desk-new-file', 'click', () => { if (discard()) askName('Create a file', 'untitled.txt', async name => { const path = pathFor(name); await call('file_write', { path, content: '', createOnly: true }); if (file) file.content = $('desk-file-text').value; await loadFiles(); await openFile(path); }); });
  on('desk-new-folder', 'click', () => askName('Create a folder', 'new-folder', async name => { await call('file_mkdir', { path: pathFor(name) }); await loadFiles(); }));
  on('desk-file-rename', 'click', () => { if (file && discard()) askName('Rename file', file.path.split('/').at(-1), async name => {
    const parent = file.path.split('/').slice(0,-1).join('/'), to = parent ? `${parent}/${name}` : name;
    await call('file_move', { from: file.path, to }); file.content = $('desk-file-text').value; await loadFiles(); await openFile(to);
  }); });
  on('desk-file-trash', 'click', async () => {
    if (!file || !discard()) return;
    const result = await call('file_trash', { path: file.path }); file = null; ++fileGeneration; revoke(fileUrl); fileUrl = ''; $('desk-file-text').value = ''; $('desk-editor-mode').disabled = true; changeMode('browser'); await loadFiles(); notice(`Moved to ${result.trashedTo}. You can recover it from .trash.`);
  });
  on('desk-upload', 'change', async () => {
    for (const upload of $('desk-upload').files) {
      if (upload.size > 20 * 1024 * 1024) throw new Error('Uploads are limited to 20 MiB per file.');
      if (files.some(f => f.name === upload.name)) throw new Error(`${upload.name} already exists. Rename it before uploading.`);
      const data = new Uint8Array(await upload.arrayBuffer());
      let binary = ''; for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i,i+32768));
      await call('file_write', { path: pathFor(upload.name), content: btoa(binary), encoding: 'base64', createOnly: true });
    }
    $('desk-upload').value = ''; await loadFiles();
  });
  async function loadTabs() {
    const state = generation, result = await call('browser_tabs'); if (state !== generation) return;
    tabs = result.tabs; const signature = JSON.stringify(tabs);
    if (signature !== lastTabs) {
      lastTabs = signature; $('desk-tabs').replaceChildren(...tabs.map(t => { const option = el('option', t.title || t.url || 'Untitled'); option.value = t.id; return option; }));
      if (!tabs.length) { const option = el('option', 'No open tabs'); option.value = ''; $('desk-tabs').append(option); }
    }
    if (!tabs.some(t => t.id === tabId)) selectTab(tabs.find(t => t.url !== 'about:blank')?.id || tabs[0]?.id || '');
    $('desk-tabs').value = tabId;
    if (document.activeElement !== $('desk-address')) $('desk-address').value = tabs.find(t => t.id === tabId)?.url.replace(/^about:blank$/, '') || '';
  }
  function selectTab(id) {
    if (id === tabId) return; tabId = id; lastFrame = 0; setControl(false); revoke(frameUrl); frameUrl = ''; $('desk-frame').removeAttribute('src'); $('desk-frame').hidden = true; $('desk-browser-empty').hidden = !!id; $('desk-frame-status').textContent = id ? 'Connecting to tab…' : 'Waiting for a tab';
    const tab = tabs.find(t => t.id === id); if (tab) $('desk-address').value = tab.url === 'about:blank' ? '' : tab.url;
  }
  on('desk-tabs', 'change', () => selectTab($('desk-tabs').value));
  async function navigate(newTab = false) {
    const url = $('desk-address').value.trim(); if (!url) { $('desk-address').focus(); return; }
    $('desk-frame-status').textContent = 'Loading page…';
    const result = await call(!tabId || newTab ? 'browser_open' : 'browser_navigate', !tabId || newTab ? { url } : { id: tabId, url });
    selectTab(result.id); await loadTabs(); lastFrame = 0; await capture();
  }
  on('desk-address-form', 'submit', () => navigate()); on('desk-new-tab', 'click', () => navigate(true));
  on('desk-close-tab', 'click', async () => { if (tabId) await call('browser_close', { id: tabId }); selectTab(''); await loadTabs(); });
  for (const [id, action] of [['desk-back','back'], ['desk-reload','reload']]) on(id, 'click', async () => { if (tabId) { await call('browser_action', { id: tabId, action }); lastFrame = 0; await loadTabs(); } });
  function setControl(enabled) { controlling = enabled; $('desk-control').setAttribute('aria-pressed', String(enabled)); $('desk-control').textContent = enabled ? 'View only' : 'Interact'; $('desk-screen').classList.toggle('interacting', enabled); $('desk-type-form').hidden = !enabled; if (enabled) $('desk-screen').focus(); }
  on('desk-control', 'click', () => { if (tabId) setControl(!controlling); });
  on('desk-pause', 'click', () => { paused = !paused; $('desk-pause').setAttribute('aria-pressed', String(paused)); $('desk-pause').textContent = paused ? 'Resume view' : 'Pause view'; if (paused) setControl(false); lastFrame = 0; });
  async function capture() {
    if (!usable() || mode !== 'browser' || !tabId || paused || frameBusy) return;
    const id = tabId, state = generation; frameBusy = true;
    try {
      const blob = await (await request(`/api/browser/${encodeURIComponent(id)}/frame`)).blob();
      if (id !== tabId || state !== generation || !active()) return;
      const next = URL.createObjectURL(blob), old = frameUrl; frameUrl = next;
      $('desk-frame').src = next; $('desk-frame').hidden = false; $('desk-browser-empty').hidden = true; revoke(old);
      $('desk-frame-status').textContent = `${controlling ? 'Shared control' : 'Live view'} · ${new Date().toLocaleTimeString()}`;
      $('desk-frame-status').title = 'This is the same Chromium tab used by your agent. The agent can still interact with it.';
    } catch (e) { if (state === generation) $('desk-frame-status').textContent = `Reconnecting · ${e.message}`; }
    finally { frameBusy = false; lastFrame = Date.now(); }
  }
  function sendInput(args) {
    if (!tabId || !controlling || paused) return;
    const id = tabId, state = generation;
    inputQueue = inputQueue.then(async () => { if (state !== generation || id !== tabId || !controlling) return; await call('browser_input', { id, ...args }); lastFrame = 0; }).catch(e => notice(e.message));
  }
  $('desk-screen').addEventListener('click', e => {
    if (!controlling || $('desk-frame').hidden) return;
    const image = $('desk-frame'), rect = image.getBoundingClientRect();
    const x = (e.clientX - rect.left) * image.naturalWidth / rect.width, y = (e.clientY - rect.top) * image.naturalHeight / rect.height;
    if (x >= 0 && y >= 0 && x < image.naturalWidth && y < image.naturalHeight) { e.preventDefault(); $('desk-screen').focus(); sendInput({ action: e.detail === 2 ? 'double_click' : 'click', x, y }); }
  });
  let wheelX = 0, wheelY = 0, wheelTimer;
  $('desk-screen').addEventListener('wheel', e => {
    if (!controlling || paused) return; e.preventDefault(); wheelX += e.deltaX; wheelY += e.deltaY;
    if (!wheelTimer) wheelTimer = setTimeout(() => { sendInput({ action:'scroll', x:Math.max(-10000,Math.min(10000,wheelX)), y:Math.max(-10000,Math.min(10000,wheelY)) }); wheelX = wheelY = 0; wheelTimer = null; }, 80);
  }, { passive:false });
  $('desk-screen').addEventListener('keydown', e => {
    if (!controlling || paused || e.isComposing || ['Shift','Alt','Control','Meta'].includes(e.key)) return;
    if (e.key === 'Escape') { e.preventDefault(); setControl(false); $('desk-control').focus(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return;
    e.preventDefault();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) sendInput({ action:'text', text:e.key });
    else sendInput({ action:'key', key:[e.ctrlKey?'Control':'',e.metaKey?'Meta':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.key === ' ' ? 'Space' : e.key].filter(Boolean).join('+') });
  });
  $('desk-screen').addEventListener('paste', e => { if (controlling) { e.preventDefault(); sendInput({ action:'text', text:e.clipboardData.getData('text/plain') }); } });
  on('desk-type-form', 'submit', () => { sendInput({ action:'text', text:$('desk-type-text').value }); $('desk-type-text').value = ''; });
  function initTerminal() {
    if (terminal) return;
    terminal = new Terminal({ cursorBlink:true, fontFamily:'"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize:12, lineHeight:1.25, scrollback:5000, disableStdin:true, theme:{ background:'#202a23', foreground:'#d5dfcc', cursor:'#d7a374', selectionBackground:'#546d4f80', green:'#a8c48c', blue:'#91b9ba' } });
    fit = new FitAddon.FitAddon(); terminal.loadAddon(fit); terminal.open($('desk-terminal-host'));
    terminal.writeln('\x1b[38;5;108mYour agent’s shell, within reach.\x1b[0m\r\n\r\nSelect a session or press + to open a terminal.');
    terminal.onData(data => {
      if (!terminalId || exited) return;
      for (let offset = 0; offset < data.length; offset += 100000) {
        const part = data.slice(offset, offset + 100000), last = terminalInput.at(-1);
        if (last && last.id === terminalId && last.state === generation && last.data.length + part.length <= 100000) last.data += part;
        else terminalInput.push({ id:terminalId, state:generation, data:part });
      }
      if (!writeTimer) writeTimer = setTimeout(flushTerminal, 20);
    });
    new ResizeObserver(() => resizeTerminal()).observe($('desk-terminal-host'));
  }
  async function flushTerminal() {
    writeTimer = null; if (writeBusy) return; writeBusy = true;
    try { while (terminalInput.length) { const chunk = terminalInput.shift(); if (chunk.state === generation) await call('terminal_write',{ id:chunk.id, data:chunk.data }); } }
    catch (error) { terminalInput = []; notice(error.message); }
    finally { writeBusy = false; }
  }
  let resizeTimer;
  function resizeTerminal() {
    clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
      if (!terminal || !active() || $('desk-terminal-host').clientWidth < 50) return;
      fit.fit();
      if (terminalId && !exited) call('terminal_resize', { id:terminalId, cols:Math.max(20,Math.min(400,terminal.cols)), rows:Math.max(5,Math.min(200,terminal.rows)) }).catch(e => notice(e.message));
    }, 100);
  }
  async function attach(id) {
    terminalId = id; cursor = 0; terminal?.reset(); terminal.options.disableStdin = !id; exited = false;
    $('desk-terminal-state').textContent = id ? `/ ${id.slice(0,8)}` : '/ no session'; $('desk-terminal-select').value = id;
    if (id) { await readTerminal(); resizeTerminal(); terminal.focus(); }
  }
  async function loadTerminals() {
    const state = generation, sessions = await call('terminal_list'); if (state !== generation) return;
    const signature = JSON.stringify(sessions);
    if (signature !== lastTerminals) { lastTerminals = signature; const empty = el('option','Select a session'); empty.value = ''; $('desk-terminal-select').replaceChildren(empty,...sessions.map(t => { const o = el('option', `${t.id.slice(0,8)} · ${t.exited ? 'exited' : t.cwd}`); o.value = t.id; return o; })); }
    if (terminalId && !sessions.some(t => t.id === terminalId)) { await attach(''); terminal.writeln('Session ended after a service restart. Open a new terminal.'); }
    if (!terminalId && sessions.some(t => !t.exited)) await attach(sessions.find(t => !t.exited).id);
    $('desk-terminal-select').value = terminalId;
  }
  async function readTerminal() {
    if (!terminalId || readBusy || !usable()) return;
    const id = terminalId, state = generation; readBusy = true;
    try {
      const result = await call('terminal_read',{ id,cursor }); if (id !== terminalId || state !== generation) return;
      if (result.truncated) terminal.writeln('\r\n[Earlier output was truncated on the VPS]\r\n');
      if (result.output) terminal.write(result.output); cursor = result.cursor; exited = result.exited; terminal.options.disableStdin = exited;
      $('desk-terminal-state').textContent = exited ? `/ exited ${result.exitCode ?? ''}` : `/ ${id.slice(0,8)}`;
    } finally { readBusy = false; }
  }
  on('desk-terminal-new','click',async () => { const t = await call('terminal_create',{ cwd:directory }); await attach(t.id); await loadTerminals(); });
  on('desk-terminal-select','change',() => attach($('desk-terminal-select').value));
  on('desk-terminal-interrupt','click',() => terminalId && !exited && call('terminal_write',{ id:terminalId,data:'\u0003' }));
  on('desk-terminal-close','click',async () => { if (terminalId) { await call('terminal_close',{ id:terminalId }); await readTerminal(); } });
  async function refresh() {
    if (!active() || refreshBusy) return; initTerminal(); refreshBusy = true;
    try { const results = await Promise.allSettled([loadFiles(),loadTabs(),loadTerminals()]); const failed = results.find(r=>r.status==='rejected'); if (failed) throw failed.reason; lastRefresh = Date.now(); resizeTerminal(); await capture(); }
    finally { refreshBusy = false; }
  }
  setInterval(() => {
    if (!usable()) return;
    readTerminal().catch(e => { $('desk-terminal-state').textContent = '/ reconnecting'; });
    if (Date.now()-lastFrame > 1000) void capture();
    if (Date.now()-lastRefresh > 4000) refresh().catch(e => notice(e.message));
  }, 400);
  window.addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  function lock() {
    generation++; fileGeneration++; tabId = ''; terminalId = ''; file = null; directory = '.'; lastFiles = lastTabs = lastTerminals = ''; files = []; tabs = []; terminalInput = []; cursor = 0;
    setControl(false); paused = false; $('desk-pause').textContent = 'Pause view'; $('desk-pause').setAttribute('aria-pressed','false');
    revoke(fileUrl); revoke(frameUrl); fileUrl = frameUrl = ''; terminal?.reset(); $('desk-frame').removeAttribute('src'); $('desk-frame').hidden = true; $('desk-browser-empty').hidden = false;
    $('desk-file-text').value = ''; $('desk-file-preview').replaceChildren(); $('desk-file-list').replaceChildren(); $('desk-editor-mode').disabled = true; $('desk-dialog').close(); changeMode('browser');
  }
  return { refresh, identity, lock };
};
