const status = document.getElementById('copy-status'); let noticeTimer;
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const field = document.createElement('textarea'); field.value = text; field.setAttribute('readonly', ''); document.body.append(field); field.select(); const copied = document.execCommand('copy'); field.remove(); if (!copied) throw new Error('Select and copy the text manually.'); }
}
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  try { await copy(document.getElementById(button.dataset.copy).textContent.trim()); const label = button.textContent; button.textContent = 'Copied ✓'; setTimeout(() => { button.textContent = label; }, 1800); status.textContent = 'Copied to clipboard'; }
  catch (error) { status.textContent = error.message; }
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { status.textContent = ''; }, 3000);
}));
function selectGuide(guide) {
  document.querySelectorAll('[data-guide]').forEach(tab => { const active = tab.dataset.guide === guide; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
  document.getElementById('manual-guide').hidden = guide !== 'manual'; document.getElementById('agent-guide').hidden = guide !== 'agent';
}
document.querySelectorAll('[data-guide]').forEach(tab => {
  tab.addEventListener('click', () => selectGuide(tab.dataset.guide));
  tab.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const guide = event.key === 'Home' ? 'manual' : event.key === 'End' ? 'agent' : tab.dataset.guide === 'manual' ? 'agent' : 'manual'; selectGuide(guide); document.getElementById(guide + '-tab').focus(); } });
});
document.querySelectorAll('[data-go-agent]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); selectGuide('agent'); document.getElementById('install').scrollIntoView({ behavior: 'smooth' }); history.replaceState(null, '', '#agents'); }));
if (location.hash === '#agents') { selectGuide('agent'); document.getElementById('install').scrollIntoView(); }
