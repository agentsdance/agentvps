// node-pty 1.1.0's macOS prebuilt helper is shipped without an executable bit.
// Linux builds do not use this helper. Repair only this package-owned binary.
import { createRequire } from 'node:module';
import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('node-pty/package.json'));
  const helper = path.join(root, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
