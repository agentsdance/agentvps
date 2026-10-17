"""Prepare public video assets and bilingual watch pages; does not deploy them."""
from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parents[1] / 'website/public'
scenes = json.loads((ROOT / 'storyboard.json').read_text())
duration = sum(s['duration'] for s in scenes)
media = SITE / 'media'
media.mkdir(exist_ok=True)
for name in ['agentvps-intro-zh-CN.mp4', 'agentvps-intro.zh-CN.srt', 'agentvps-intro.zh-CN.vtt']:
    shutil.copyfile(ROOT / 'output' / name, media / name)
shutil.copyfile(ROOT / 'output/poster.jpg', media / 'agentvps-intro-poster.jpg')
english = [
    'Turn the server you already own into a working computer for your personal agent.',
    'One command installs the desktop, browser and tools.',
    'Connect the agent you already use, directly through MCP.',
    'Browser, terminal and files share one workspace. Watch the desktop or take control.',
    'Download data, process it with Python, then build a webpage. The entire workflow runs on your server.',
    'See exactly which operating systems have been tested in the public compatibility report.',
    'Free and open source. Start with your own server today.',
]
for chinese in [False, True]:
    prefix = '/zh/' if chinese else '/'
    route, alternate = prefix + 'video/', '/video/' if chinese else '/zh/video/'
    home = (SITE / (prefix.strip('/') + '/index.html').lstrip('/')).read_text()
    header = re.search(r'<header\b[\s\S]*?</header>', home)[0].replace('href="#', f'href="{prefix}#')
    header = header.replace(f'href="{"/" if chinese else "/zh/"}"', f'href="{alternate}"')
    footer = re.search(r'<footer\b[\s\S]*?</footer>', home)[0].replace('href="#', f'href="{prefix}#')
    title = '45 秒了解 AgentVPS' if chinese else 'Meet AgentVPS in 45 seconds'
    description = '复用已有 VPS，连接已有智能体。在一台真实的远程电脑上，使用浏览器、终端与文件。' if chinese else 'Reuse your VPS and connect the agent you already use. Work with a real desktop, browser, terminal and shared files.'
    names = ['你的 VPS', '一行安装', '连接 MCP', '共享桌面', '完整工作流', 'Linux 验证', '现在开始'] if chinese else ['Your VPS', 'Install', 'Connect MCP', 'Shared desktop', 'The workflow', 'Linux checks', 'Get started']
    buttons, transcript, elapsed = [], [], 0
    for i, scene in enumerate(scenes):
        clock = f'{int(elapsed)//60:02}:{int(elapsed)%60:02}'
        buttons.append(f'<button type="button" data-seek="{elapsed}"><span>{clock}</span>{names[i]}</button>')
        transcript.append(f'<li><time>{clock}</time><span>{scene["caption"] if chinese else english[i]}</span></li>')
        elapsed += scene['duration']
    page = f'''<!doctype html>
<html lang="{'zh-Hans' if chinese else 'en'}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{title} — AgentVPS</title><meta name="description" content="{description}">
  <link rel="canonical" href="https://agentvps.ai-infra.org{route}">
  <link rel="alternate" hreflang="en" href="https://agentvps.ai-infra.org/video/">
  <link rel="alternate" hreflang="zh-Hans" href="https://agentvps.ai-infra.org/zh/video/">
  <link rel="alternate" hreflang="x-default" href="https://agentvps.ai-infra.org/video/">
  <meta property="og:title" content="{title} — AgentVPS"><meta property="og:description" content="{description}">
  <meta property="og:type" content="video.other"><meta property="og:url" content="https://agentvps.ai-infra.org{route}">
  <meta property="og:image" content="https://agentvps.ai-infra.org/media/agentvps-intro-poster.jpg">
  <meta name="theme-color" content="#fbfaf8"><link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/video.css"><script defer src="/video.js"></script>
</head>
<body class="video-page">
<a class="skip" href="#intro-video">{'跳转到视频' if chinese else 'Skip to video'}</a>
{header}
<main class="wrap">
  <section class="video-intro">
    <div><span class="eyebrow">{'产品介绍' if chinese else 'PRODUCT INTRODUCTION'} / AGENTVPS 0.0.3</span>
    <h1>{title}。</h1><p>{description}</p></div>
    <a class="button dark" download href="/media/agentvps-intro-zh-CN.mp4">{'下载 MP4' if chinese else 'Download MP4'} <span aria-hidden="true">↓</span></a>
  </section>
  <div class="intro-player">
    <video id="intro-video" controls playsinline preload="metadata" poster="/media/agentvps-intro-poster.jpg" width="1920" height="1080" aria-label="{title}">
      <source src="/media/agentvps-intro-zh-CN.mp4" type="video/mp4">
      <p>{'浏览器无法播放时，可下载 MP4 文件。' if chinese else 'Download the MP4 if your browser cannot play the video.'}</p>
    </video>
  </div>
  <div class="video-details"><span>{'45 秒 · 1080p · 中文配音与字幕' if chinese else '45 seconds · 1080p · Mandarin narration & Chinese captions'}</span>
    <a download href="/media/agentvps-intro.zh-CN.srt">{'下载 SRT 字幕' if chinese else 'Download Chinese SRT captions'} ↗</a></div>
  <nav class="video-chapters" aria-label="{'视频章节' if chinese else 'Video chapters'}">{''.join(buttons)}</nav>
  <div class="video-reference">
    <section><h2>{'从你已有的 VPS 开始。' if chinese else 'Start with the VPS you own.'}</h2>
      <p>{'视频使用实机桌面截图和受控演示数据，通过动画介绍工作流程；安装画面为操作指引示意。' if chinese else 'Animated compositions use real VPS screenshots and controlled demo data. The installation scene illustrates the command to run.'}</p>
      <p>{'当前版本提供远程工具与 Linux 桌面，内置自主智能体循环仍在规划中。' if chinese else 'The current release provides remote tools and a Linux desktop. The built-in autonomous agent loop remains planned.'}</p>
      <p><a href="{prefix}#install">{'查看安装指南' if chinese else 'Installation guide'} ↗</a> · <a href="{prefix}compatibility/">{'已验证系统与兼容性报告' if chinese else 'Verified systems & compatibility report'} ↗</a></p>
    </section>
    <section><h2>{'视频文稿' if chinese else 'English transcript'}</h2><ol class="video-transcript">{''.join(transcript)}</ol></section>
  </div>
</main>
{footer}
</body></html>
'''
    page = page.replace(f'{title}。</h1>', f'{title}{"。" if chinese else "."}</h1>')
    dest = SITE / route.strip('/')
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'index.html').write_text(page)
print(f'Prepared {duration:g}s video, subtitles, poster and English/Chinese watch pages')
