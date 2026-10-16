import RFB from '/vendor/novnc/core/rfb.js';

export function createDesktop({ request, notice, clearNotice }) {
  const $ = id => document.getElementById(id);
  let rfb, mode = 'watch', active = false, generation = 0, retry, reconnecting = false;
  const status = text => { $('desktop-connection').textContent = text; };
  const post = async (route, body) => (await request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  function controls() {
    $('desktop-takeover').textContent = mode === 'control' ? 'Return control' : 'Take over';
    $('desktop-takeover').setAttribute('aria-pressed', String(mode === 'control'));
    $('desktop-owner').textContent = mode === 'control' ? 'You have control' : 'Watching your agent’s computer';
    $('desktop-hint').textContent = mode === 'control' ? 'Mouse and keyboard are yours. Background jobs continue.' : 'Watch live, or take over whenever you need to.';
    $('desktop-paste').hidden = mode !== 'control';
  }
  async function disconnect() {
    clearTimeout(retry); ++generation;
    const current = rfb; rfb = undefined;
    if (current) await new Promise(resolve => { const timeout = setTimeout(resolve, 1200); current.addEventListener('disconnect', () => { clearTimeout(timeout); resolve(); }, { once: true }); current.disconnect(); });
    $('desktop-screen').replaceChildren();
  }
  async function connect(nextMode = 'watch') {
    reconnecting = true; $('desktop-takeover').disabled = true;
    await disconnect(); mode = nextMode; controls();
    const epoch = generation;
    try {
      const state = await (await request('/api/desktop/status')).json();
      $('desktop-resolution').value = `${state.width}x${state.height}`;
      if (!active || epoch !== generation) return;
      if (!state.ready) { status(state.enabled ? 'Desktop is starting…' : 'Desktop requires the VPS installation'); $('desktop-empty').hidden = false; if (state.enabled) retry = setTimeout(() => void connect('watch'), 3000); return; }
      const grant = await post('/api/desktop/connect', { mode });
      if (!active || epoch !== generation) return;
      status('Connecting to your computer…');
      const url = new URL('/api/desktop/socket', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', grant.ticket);
      rfb = new RFB($('desktop-screen'), url.href, { shared: true });
      rfb.viewOnly = mode !== 'control'; rfb.scaleViewport = true; rfb.resizeSession = false; rfb.qualityLevel = 7; rfb.compressionLevel = 2; rfb.background = '#b7c2aa';
      rfb.addEventListener('connect', () => { if (epoch !== generation) return; clearNotice(); status('Live · Linux desktop'); $('desktop-empty').hidden = true; $('desktop-takeover').disabled = false; controls(); });
      rfb.addEventListener('disconnect', () => {
        if (epoch !== generation || !active) return;
        mode = 'watch'; controls(); status('Reconnecting…');
        retry = setTimeout(() => connect('watch').catch(error => notice(error.message)), 2000);
      });
      rfb.addEventListener('securityfailure', () => notice('Desktop authentication failed. Reconnect to request a new session.'));
    } catch (error) { mode = 'watch'; controls(); status('Disconnected · retrying'); notice(error.message); if (active && epoch === generation) retry = setTimeout(() => void connect('watch'), 3000); }
    finally { reconnecting = false; if (!rfb) $('desktop-takeover').disabled = false; }
  }
  $('desktop-takeover').addEventListener('click', () => { if (!reconnecting) void connect(mode === 'control' ? 'watch' : 'control'); });
  $('desktop-reconnect').addEventListener('click', () => void connect('watch'));
  $('desktop-resolution').addEventListener('change', async () => {
    try { const [width, height] = $('desktop-resolution').value.split('x').map(Number); await post('/api/desktop/resize', { width, height }); } catch (error) { notice(error.message); }
  });
  $('desktop-fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('desktop').requestFullscreen(); } catch (error) { notice(error.message); } });
  document.querySelectorAll('[data-desktop-app]').forEach(button => button.addEventListener('click', async () => {
    try { await post('/api/desktop/launch', { app: button.dataset.desktopApp }); } catch (error) { notice(error.message); }
  }));
  $('desktop-paste').addEventListener('click', () => { $('desktop-text-dialog').showModal(); $('desktop-text').focus(); });
  $('desktop-text-cancel').addEventListener('click', () => $('desktop-text-dialog').close());
  $('desktop-text-form').addEventListener('submit', event => { event.preventDefault(); if (mode === 'control') rfb?.clipboardPasteFrom($('desktop-text').value); $('desktop-text').value = ''; $('desktop-text-dialog').close(); rfb?.focus(); });
  window.addEventListener('pagehide', () => { active = false; void disconnect(); });
  let checking = false;
  setInterval(async () => {
    if (!active || !rfb || reconnecting || checking || document.hidden) return;
    checking = true;
    try {
      const state = await (await request('/api/desktop/status')).json();
      if (!active || reconnecting) return;
      $('desktop-resolution').value = `${state.width}x${state.height}`;
      if (mode === 'watch') { const occupied = state.control === 'human'; $('desktop-owner').textContent = occupied ? 'Someone is using the desktop' : 'Watching your agent’s computer'; $('desktop-takeover').disabled = occupied; }
    } catch {} finally { checking = false; }
  }, 3000);
  return {
    async activate(value) { if (active === value) return; active = value; if (value) await connect(); else { await disconnect(); mode = 'watch'; controls(); } },
    lock() { active = false; mode = 'watch'; void disconnect(); controls(); },
  };
}
