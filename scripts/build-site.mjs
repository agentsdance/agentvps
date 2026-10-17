import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildCompatibilityPages } from './render-compatibility.mjs';
const root = new URL('../', import.meta.url), target = new URL('../website/dist/', import.meta.url);
const pkg = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8'));
const filename = `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`;
const tarball = new URL(filename, root);
const sha = createHash('sha256').update(await fs.readFile(tarball)).digest('hex');
await fs.rm(target, { recursive: true, force: true });
await fs.cp(new URL('website/public/', root), target, { recursive: true });
await fs.copyFile(new URL('docs/install-compatibility-report.md', root), new URL('install-compatibility-report.md', target));
await fs.copyFile(new URL('docs/install-compatibility-report.zh-CN.md', root), new URL('zh/install-compatibility-report.md', target));
await buildCompatibilityPages(root, target);
// Returning visitors must receive new styles/scripts after a deployment.
for (const asset of ['style.css', 'compatibility.css', 'video.css', 'app.js', 'video.js', 'favicon.svg', 'media/agentvps-intro-zh-CN.mp4', 'media/agentvps-intro-poster.jpg', 'media/agentvps-intro.zh-CN.srt']) {
  const digest = createHash('sha256').update(await fs.readFile(new URL(asset, target))).digest('hex').slice(0, 12);
  for (const page of ['index.html', 'zh/index.html', 'compatibility/index.html', 'zh/compatibility/index.html', 'video/index.html', 'zh/video/index.html']) {
    const file = new URL(page, target);
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replaceAll(`/${asset}"`, `/${asset}?v=${digest}"`));
  }
}
const installer = new URL('install.sh', target);
await fs.writeFile(installer, (await fs.readFile(installer, 'utf8')).replace('@PACKAGE_SHA256@', sha));
await fs.writeFile(new URL('SHA256SUMS', target), `${sha}  ${filename}\n`);
console.log(`Website built for AgentVPS ${pkg.version}; release SHA-256 ${sha}`);
