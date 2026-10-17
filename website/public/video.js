const player = document.getElementById('intro-video');
document.querySelectorAll('[data-seek]').forEach(button => {
  button.addEventListener('click', () => {
    const seek = () => {
      player.currentTime = Number(button.dataset.seek);
      player.play().catch(() => player.focus());
    };
    if (player.readyState > 0) seek();
    else {
      player.addEventListener('loadedmetadata', seek, { once: true });
      player.load();
    }
    player.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});
