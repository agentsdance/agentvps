import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const target = new URL('../public/vendor/', import.meta.url);
await fs.mkdir(target, { recursive: true });
for (const [pkg, files] of [
  ['@xterm/xterm', ['lib/xterm.js', 'css/xterm.css', 'LICENSE']],
  ['@xterm/addon-fit', ['lib/addon-fit.js', 'LICENSE']],
]) {
  const root = path.dirname(path.dirname(require.resolve(pkg)));
  for (const file of files) {
    const name = file === 'LICENSE' ? `${pkg.split('/')[1]}-LICENSE` : path.basename(file);
    await fs.copyFile(path.join(root, file), new URL(name, target));
  }
}
// Keep noVNC source modules unmodified and ship their license notices with the served files.
const novnc = path.dirname(path.dirname(require.resolve('@novnc/novnc')));
for (const name of ['core', 'vendor', 'docs', 'AUTHORS', 'LICENSE.txt']) {
  await fs.cp(path.join(novnc, name), new URL(`novnc/${name}`, target), { recursive: true });
}
