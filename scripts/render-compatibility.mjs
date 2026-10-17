import fs from 'node:fs/promises';

const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// These repository-owned reports use only headings, paragraphs, lists and tables.
// Escape source HTML and render their small Markdown subset without a runtime dependency.
function inline(text) {
  return escape(text).replace(/`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
    (_, code, strong, label, url) => code ? `<code>${code}</code>` : strong ? `<strong>${strong}</strong>` : `<a href="${url}">${label}</a>`);
}

function renderBody(source, { results, chinese, counts }) {
  const lines = source.trim().split('\n');
  const html = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('### ')) { html.push(`<h3>${inline(line.slice(4))}</h3>`); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++].slice(1, -1).split('|').map(cell => cell.trim()));
      const [headings, separator, ...body] = rows;
      if (!separator?.every(cell => /^:?-+:?$/.test(cell))) throw new Error('Invalid report table');
      const labels = chinese ? ['VPS 实机通过', '容器验证通过', '尚未实测'] : ['VPS verified', 'Container verified', 'Not tested'];
      html.push(`<table role="table" class="report-table${results ? ' results-table' : ''}"><thead><tr role="row">${headings.map(h => `<th scope="col" role="columnheader">${inline(h)}</th>`).join('')}</tr></thead><tbody>`);
      for (const cells of body) {
        if (cells.length !== headings.length) throw new Error('Report table column mismatch');
        // Explicit evidence is required: unknown result rows fail the build.
        const tier = !results ? undefined : /^(RHEL|ARM64)/.test(cells[0]) ? 'pending' : /container|容器/.test(cells[1]) ? 'container' : /VPS/.test(cells[1]) ? 'vps' : undefined;
        if (results && !tier) throw new Error(`Missing verification tier: ${cells[0]}`);
        if (tier) counts[tier]++;
        html.push(`<tr role="row"${tier ? ` data-verification="${tier}"` : ''}>${cells.map((cell, index) => {
          const tag = index === 0 ? 'th' : 'td';
          const badge = results && index === 1 ? `<span class="verification-badge ${tier}">${labels[{ vps: 0, container: 1, pending: 2 }[tier]]}</span>` : '';
          return `<${tag} role="${index === 0 ? 'rowheader' : 'cell'}"${index === 0 ? ' scope="row"' : ''} data-label="${escape(headings[index])}">${badge}${inline(cell)}</${tag}>`;
        }).join('')}</tr>`);
      }
      html.push('</tbody></table>');
      continue;
    }
    if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^(### |\||- )/.test(lines[i])) paragraph.push(lines[i++]);
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('\n');
}

export async function buildCompatibilityPages(root, target) {
  for (const chinese of [false, true]) {
    const prefix = chinese ? '/zh/' : '/', route = `${prefix}compatibility/`;
    const alternate = chinese ? '/compatibility/' : '/zh/compatibility/';
    const source = await fs.readFile(new URL(`docs/install-compatibility-report${chinese ? '.zh-CN' : ''}.md`, root), 'utf8');
    const [intro, ...chunks] = source.split(/^## /m);
    const sections = chunks.map((chunk, index) => {
      const end = chunk.indexOf('\n'), title = chunk.slice(0, end), body = chunk.slice(end + 1);
      const results = title === (chinese ? '结果' : 'Results');
      return { title: results ? (chinese ? '操作系统验证结果' : 'Operating system results') : title, body, results, id: results ? 'systems' : `report-${index + 1}` };
    });
    sections.sort((a, b) => Number(b.results) - Number(a.results));
    if (sections.filter(section => section.results).length !== 1) throw new Error('Missing report results section');
    const counts = { vps: 0, container: 0, pending: 0 };
    for (const section of sections) section.html = renderBody(section.body, { results: section.results, chinese, counts });
    const version = source.match(/^# AgentVPS (\d+\.\d+\.\d+)/)?.[1];
    if (!version) throw new Error('Missing compatibility report version');
    const title = chinese ? 'Linux 系统兼容性与安装报告' : 'Linux compatibility & installation report';
    const description = chinese ? '查看 AgentVPS 已验证的 Linux 系统、测试范围、安装问题和修复方法。明确区分 VPS 实机验证、容器验证与尚未验证的平台。' : 'See which Linux systems AgentVPS has tested, what passed, and how installation issues were fixed. VPS, container and untested results are clearly separated.';
    const home = await fs.readFile(new URL(`website/public${prefix}index.html`, root), 'utf8');
    const localizeLinks = html => html.replaceAll('href="#', `href="${prefix}#`).replace(`href="${chinese ? '/' : '/zh/'}"`, `href="${alternate}"`);
    const header = localizeLinks(home.match(/<header\b[\s\S]*?<\/header>/)[0]).replace(`href="${route}"`, `href="${route}" aria-current="page"`);
    const footer = localizeLinks(home.match(/<footer\b[\s\S]*?<\/footer>/)[0]);
    const scope = chinese
      ? '<strong>验证范围不同，请按需选择。</strong>Debian 12 已通过完整安装、systemd 与真实重启测试。容器结果验证原生依赖和桌面工作流，不代表该系统的开机启动、云防火墙或 SELinux 已通过实机测试。'
      : '<strong>Each result has a specific scope.</strong> Debian 12 passed the complete installer, systemd and a real reboot. Container results verify native dependencies and desktop workflows, not VM startup, cloud firewalls or host SELinux policy.';
    const html = `<!doctype html>
<html lang="${chinese ? 'zh-Hans' : 'en'}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — AgentVPS</title><meta name="description" content="${description}">
  <link rel="canonical" href="https://agentvps.ai-infra.org${route}">
  <link rel="alternate" hreflang="en" href="https://agentvps.ai-infra.org/compatibility/">
  <link rel="alternate" hreflang="zh-Hans" href="https://agentvps.ai-infra.org/zh/compatibility/">
  <link rel="alternate" hreflang="x-default" href="https://agentvps.ai-infra.org/compatibility/">
  <meta property="og:title" content="${title} — AgentVPS"><meta property="og:description" content="${description}">
  <meta property="og:type" content="article"><meta property="og:url" content="https://agentvps.ai-infra.org${route}">
  <meta name="theme-color" content="#fbfaf8"><link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/compatibility.css">
</head>
<body class="compatibility-page">
<a class="skip" href="#systems">${chinese ? '跳转到系统验证结果' : 'Skip to system results'}</a>
${header}
<main class="wrap">
  <section class="report-hero" aria-labelledby="report-title">
    <div>
      <span class="eyebrow">${chinese ? '安装兼容性报告' : 'INSTALLATION COMPATIBILITY REPORT'} / ${version}</span>
      <h1 id="report-title">${chinese ? 'Linux 兼容性。<br><span>已验证，范围清晰。</span>' : 'Linux compatibility.<br><span>Tested. Documented.</span>'}</h1>
      <p>${description}</p>
    </div>
    <div class="report-actions">
      <a class="button dark" href="${prefix}#install">${chinese ? '安装 AgentVPS' : 'Install AgentVPS'} <span aria-hidden="true">↗</span></a>
      <a class="text-link" href="${prefix}install-compatibility-report.md">${chinese ? '阅读原始 Markdown 报告' : 'Read the Markdown report'} <span aria-hidden="true">↗</span></a>
    </div>
  </section>
  <div class="report-overview" aria-label="${chinese ? '验证概览' : 'Verification overview'}">
    <div><span class="overview-number">${String(counts.vps).padStart(2, '0')}</span><p><strong>${chinese ? '个 VPS 实机验证版本' : 'version verified on a VPS'}</strong><span>Debian 12 · x64</span></p></div>
    <div><span class="overview-number">${String(counts.container).padStart(2, '0')}</span><p><strong>${chinese ? '个容器验证版本' : 'versions verified in containers'}</strong><span>${chinese ? '原生依赖、桌面、MCP 与工作流' : 'Native packages, desktop, MCP & workflows'}</span></p></div>
    <div><span class="overview-number architecture">x64</span><p><strong>${chinese ? '本轮已验证架构' : 'architecture tested this release'}</strong><span>${chinese ? 'ARM64 与 RHEL 9 尚未实测' : 'ARM64 and RHEL 9 remain untested'}</span></p></div>
  </div>
  <div class="report-layout">
    <aside class="report-sidebar">
      <nav aria-label="${chinese ? '报告目录' : 'Report contents'}">
        <span class="eyebrow">${chinese ? '报告目录' : 'IN THIS REPORT'}</span>
        ${sections.map((section, index) => `<a href="#${section.id}"><span>${String(index + 1).padStart(2, '0')}</span>${escape(section.title)}</a>`).join('\n')}
      </nav>
      <a class="text-link" href="${prefix}linux-support.md">${chinese ? '安装要求与版本范围' : 'Requirements & supported versions'} ↗</a>
    </aside>
    <article class="report-content">
      ${sections.map((section, index) => `<section class="report-section" id="${section.id}" aria-labelledby="${section.id}-title">
        <div class="report-section-heading"><span class="eyebrow">${String(index + 1).padStart(2, '0')}</span><h2 id="${section.id}-title">${escape(section.title)}</h2></div>
        ${section.results ? `<p class="report-scope">${scope}</p><p class="report-date">${inline(intro.split('\n').slice(1).join(' ').trim())}</p>` : ''}
        ${section.html}
      </section>`).join('\n')}
    </article>
  </div>
</main>
${footer}
</body></html>\n`;
    await fs.mkdir(new URL(`.${route}`, target), { recursive: true });
    await fs.writeFile(new URL(`.${route}index.html`, target), html);
  }
}
