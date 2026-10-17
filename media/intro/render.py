"""Render the 1080p Chinese product introduction from owned artwork and real screenshots.

Requires macOS say, FFmpeg, Python 3, Pillow and NumPy. Prepared font/icon assets
come from the website's licensed originals; see README.md for reproducible setup.
"""
from pathlib import Path
from functools import lru_cache
import argparse
import json
import math
import subprocess
import wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
ASSETS, OUT = ROOT / 'assets', ROOT / 'output'
W, H, FPS, SR = 1920, 1080, 24, 48000
PAPER, INK, MUTED = '#fbfaf8', '#202b23', '#697361'
GREEN, ACCENT, LINE = '#8b9b7b', '#ed5c35', '#dedfd6'
SCENES = json.loads((ROOT / 'storyboard.json').read_text())
ZH = '/System/Library/Fonts/STHeiti Medium.ttc'


@lru_cache(maxsize=80)
def font(size, face='zh'):
    path = ZH if face == 'zh' else str(ASSETS / ('plex-mono.ttf' if face == 'mono' else 'manrope.ttf'))
    result = ImageFont.truetype(path, size, index=1 if face == 'zh' else 0)
    if face == 'sans':
        result.set_variation_by_axes([560])
    return result


def text(im, xy, value, size, color=INK, face='zh', anchor=None):
    ImageDraw.Draw(im).text(xy, value, font=font(size, face), fill=color, anchor=anchor, stroke_width=0)


def ease(value):
    value = min(1, max(0, value))
    return 1 - (1 - value) ** 3


def reveal(im, xy, value, size, color, t, delay=0, face='zh'):
    p = ease((t - delay) / .65)
    if not p:
        return
    layer = Image.new('RGBA', im.size)
    text(layer, (xy[0], xy[1] + int(22 * (1-p))), value, size, color, face)
    layer.putalpha(layer.getchannel('A').point(lambda a: int(a*p)))
    im.alpha_composite(layer)


def line(im, points, fill=LINE, width=2):
    ImageDraw.Draw(im).line(points, fill=fill, width=width)


def logo(im, xy=(96, 54), light=False, scale=1):
    x, y = xy
    color = PAPER if light else INK
    d = ImageDraw.Draw(im)
    n = int(46*scale)
    d.rounded_rectangle((x, y, x+n, y+n), radius=int(10*scale), fill=ACCENT)
    d.rounded_rectangle((x+10*scale, y+10*scale, x+36*scale, y+29*scale), radius=3, outline=INK, width=max(2,int(2*scale)))
    line(im, [(x+23*scale,y+29*scale),(x+23*scale,y+36*scale)], INK, max(2,int(2*scale)))
    line(im, [(x+17*scale,y+36*scale),(x+29*scale,y+36*scale)], INK, max(2,int(2*scale)))
    text(im, (x+n+13*scale, y-5*scale), 'agentvps', int(40*scale), color, 'sans')
    text(im, (x+n+194*scale, y-5*scale), '.', int(40*scale), ACCENT, 'sans')


@lru_cache(maxsize=20)
def photo(name, width, crop=None):
    im = Image.open(ASSETS / name).convert('RGBA')
    if crop:
        im = im.crop(crop)
    return im.resize((width, round(im.height * width / im.width)), Image.Resampling.LANCZOS)


def screen(im, image, x, y, border=True):
    width, height = image.size
    shadow = Image.new('RGBA', im.size)
    d = ImageDraw.Draw(shadow)
    d.rounded_rectangle((x, y+15, x+width, y+height+15), radius=22, fill=(24,36,25,35))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(16)))
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,width,height), radius=15, fill=255)
    im.paste(image, (x,y), mask)
    if border:
        ImageDraw.Draw(im).rounded_rectangle((x,y,x+width,y+height), radius=15, outline='#c1c9ba', width=2)


def badge(im, xy, value, dark=False):
    x, y = xy
    f = font(23)
    width = ImageDraw.Draw(im).textlength(value,font=f)+34
    ImageDraw.Draw(im).rounded_rectangle((x,y,x+width,y+42),radius=7,fill='#354434' if dark else '#e8eddf')
    text(im,(x+17,y+8),value,23,'#dce5d3' if dark else '#405437')


def base(scene):
    dark = scene['id'] in ['intro','outro']
    im = Image.new('RGBA',(W,H),INK if dark else PAPER)
    logo(im, light=dark)
    text(im,(W-96,68),scene['label'],21,'#a5b09b' if dark else MUTED,'mono','ra')
    line(im,[(96,126),(1824,126)],'#45513f' if dark else LINE)
    return im


def scene_art(index, t):
    s = SCENES[index]
    im = base(s)
    name = s['id']
    d = ImageDraw.Draw(im)
    if name == 'intro':
        reveal(im,(96,227),'你的 VPS。',94,PAPER,t,.08)
        reveal(im,(96,347),'个人助理的',94,PAPER,t,.23)
        reveal(im,(96,467),'工作电脑。',94,ACCENT,t,.38)
        reveal(im,(100,647),'复用已有服务器，连接已有智能体。',32,'#b5bfaa',t,.65)
        badge(im,(100,737),'免费开源 · 无需 AgentVPS 订阅',True)
        x = int(863+46*(1-ease(t/.9)))
        screen(im,photo('desktop.png',975),x,242)
        text(im,(x,880),'VPS 实机截图 · Debian 12 · AgentVPS 0.0.3',22,'#a5b09b')
    elif name == 'install':
        reveal(im,(96,185),'一行命令。',84,INK,t)
        reveal(im,(96,294),'从你的服务器开始。',68,MUTED,t,.16)
        badge(im,(1480,226),'在 VPS 中执行')
        d.rounded_rectangle((96,441,1824,797),radius=18,fill='#222b21')
        line(im,[(96,504),(1824,504)],'#46533d')
        for j,c in enumerate(['#c87157','#b1a068','#799470']):
            d.ellipse((123+j*25,465,135+j*25,477),fill=c)
        text(im,(218,460),'SSH / YOUR VPS',22,'#a8b79d','mono')
        commands = ['curl -fsSL https://agentvps.ai-infra.org/install.sh -o install-agentvps.sh && sudo bash install-agentvps.sh']
        text(im,(132,577),'$',29,ACCENT,'mono')
        chars = max(0,int((t-.6)*57))
        consumed = 0
        for row, command in enumerate(commands):
            shown = command[:max(0,chars-consumed)]
            text(im,(180,583+row*65),shown,25,'#e6ebdc','mono')
            consumed += len(command)
        if int(t*2)%2 == 0:
            d.rectangle((180,704,198,733),fill='#a7b991')
        text(im,(180,651),'复制完整命令，请访问官网。',24,'#a8b79d')
        text(im,(100,840),'原生 Linux 桌面',28,MUTED)
        text(im,(650,840),'Chromium 浏览器',28,MUTED)
        text(im,(1250,840),'Shell · 文件 · 代码工具',28,MUTED)
        text(im,(100,904),'安装指引示意；实际安装用时取决于系统与网络。',21,MUTED)
    elif name == 'connect':
        reveal(im,(96,182),'直接连接 MCP。',84,INK,t)
        reveal(im,(100,296),'无需安装本地转发客户端。',34,MUTED,t,.2)
        items = [('codex.png','Codex'),('claude-code.png','Claude Code'),('cursor.png','Cursor')]
        for j,(icon,label) in enumerate(items):
            y=427+j*131
            mark=photo(icon,62)
            im.alpha_composite(mark,(146,y))
            text(im,(240,y+7),label,35,INK,'sans')
            line(im,[(574,y+32),(750,y+32),(750,587),(850,587)],'#bcc7b3',3)
        d.ellipse((849,487,1049,687),fill=INK)
        text(im,(949,557),'MCP',43,PAPER,'mono','ma')
        text(im,(949,621),'HTTP',19,'#a5b09b','mono','ma')
        line(im,[(1049,587),(1240,587)],GREEN,3)
        pulse=1058+int((t%1.8)/1.8*166)
        d.ellipse((pulse,580,pulse+14,594),fill=ACCENT)
        d.rounded_rectangle((1240,420,1742,723),radius=18,fill='#ebeee5',outline='#b9c6af',width=2)
        logo(im,(1295,465),scale=1.12)
        text(im,(1295,566),'你的远程工作空间',34,INK)
        text(im,(1295,633),'Browser / Shell / Files',22,MUTED,'mono')
        d.rounded_rectangle((274,819,1646,901),radius=10,fill=INK)
        text(im,(960,841),'http://YOUR_VPS_IP:8080/mcp',37,PAPER,'mono','ma')
        text(im,(960,926),'Streamable HTTP · Bearer Token',23,MUTED,'mono','ma')
    elif name == 'desktop':
        reveal(im,(96,212),'一台电脑。',74,INK,t)
        reveal(im,(96,309),'一起工作。',74,MUTED,t,.15)
        features=[('浏览器','打开网页与下载文件'),('终端','运行命令与代码'),('文件','共享同一个工作空间')]
        active=min(2,int(t/2.15))
        for j,(title,desc) in enumerate(features):
            y=485+j*121
            d.ellipse((100,y+10,110,y+20),fill=ACCENT if j==active else '#b7c2ad')
            text(im,(134,y),title,35,INK)
            text(im,(134,y+51),desc,24,MUTED)
        badge(im,(572,203),'VPS 实机截图 · 可随时接管')
        screen(im,photo('console.jpg',1270),564,283)
        line(im,[(1150,887),(1400,887)],ACCENT,3)
        text(im,(1275,903),'Watch / Take over',23,MUTED,'mono','ma')
    elif name == 'workflow':
        reveal(im,(96,183),'把事情做完。',84,INK,t)
        reveal(im,(100,296),'从下载，到结果。',37,MUTED,t,.2)
        jobs=[('01','浏览器下载 CSV','共享文件'),('02','Python 处理数据','远程代码'),('03','生成网页与截图','返回结果')]
        active=min(2,int(t/2.0))
        for j,(number,title,sub) in enumerate(jobs):
            y=431+j*146
            text(im,(103,y),number,32,ACCENT if j<=active else '#a3ae98','mono')
            text(im,(180,y),title,36,INK if j<=active else MUTED)
            text(im,(180,y+55),sub,24,MUTED)
            if j<2: line(im,[(125,y+54),(125,y+112)],GREEN if j<active else LINE,2)
        screen(im,photo('dashboard.png',1100,(65,125,1160,581)),731,371)
        badge(im,(752,294),'实际输出截图 · 演示数据')
        text(im,(754,869),'CSV / Python / Dashboard / PNG',25,MUTED,'mono')
    elif name == 'linux':
        reveal(im,(96,184),'主流 Linux。',80,INK,t)
        reveal(im,(96,285),'验证范围，公开可查。',64,MUTED,t,.15)
        d.rounded_rectangle((96,441,1824,546),radius=12,fill='#e3ebdb')
        text(im,(126,469),'VPS 实机验证',32,'#405437')
        text(im,(648,460),'Debian 12',45,INK,'sans')
        badge(im,(1636,471),'x64')
        text(im,(126,605),'容器内依赖与工作流验证',31,INK)
        text(im,(126,672),'Debian 13 · Ubuntu 22.04 / 24.04 / 26.04',34,MUTED,'sans')
        text(im,(126,735),'Rocky Linux 9.3 · AlmaLinux 9.8 · CentOS Stream 9',34,MUTED,'sans')
        line(im,[(96,825),(1824,825)],LINE)
        text(im,(126,855),'ARM64、RHEL 9 尚未实测；容器测试不等同于完整 VPS 验证。',25,MUTED)
    elif name == 'outro':
        reveal(im,(96,220),'你的服务器。',98,PAPER,t)
        reveal(im,(96,346),'你的个人助理工作空间。',86,PAPER,t,.15)
        reveal(im,(100,511),'免费开源 · 原生 Linux 桌面 · 直接 MCP',36,'#acb99f',t,.4)
        reveal(im,(96,651),'agentvps.ai-infra.org',88,ACCENT,t,.55,'sans')
        d.line((1664,410,1772,302),fill=ACCENT,width=9)
        d.line((1692,302,1772,302,1772,382),fill=ACCENT,width=9)
        text(im,(100,833),'VPS 与所选智能体、模型服务的费用按各自规则执行。',25,'#a8b59d')
        text(im,(100,882),'当前提供远程工具与桌面；内置自主智能体循环仍在规划中。',23,'#a8b59d')
    return im


def subtitle(im, caption, opacity=1):
    f=font(31)
    width=ImageDraw.Draw(im).textlength(caption,font=f)+68
    layer=Image.new('RGBA',im.size)
    ImageDraw.Draw(layer).rounded_rectangle(((W-width)/2,985,(W+width)/2,1048),radius=13,fill=(18,29,21,238))
    text(layer,(960,1000),caption,31,PAPER,anchor='ma')
    layer.putalpha(layer.getchannel('A').point(lambda value:int(value*opacity)))
    im.alpha_composite(layer)


def frame(t):
    elapsed=0
    for i,s in enumerate(SCENES):
        if t<elapsed+s['duration'] or i==len(SCENES)-1:
            local=t-elapsed
            im=scene_art(i,local)
            if i and local<.35:
                previous=scene_art(i-1,SCENES[i-1]['duration'])
                im=Image.blend(previous,im,ease(local/.35))
            subtitle(im,s['caption'],min(1,max(0,(local-.18)*4)))
            ImageDraw.Draw(im).rectangle((0,1076,int(W*t/TOTAL),1079),fill=ACCENT)
            return im.convert('RGB')
        elapsed+=s['duration']


def timestamp(seconds, srt=False):
    millis=round(seconds*1000)
    hours,millis=divmod(millis,3600000); minutes,millis=divmod(millis,60000); secs,millis=divmod(millis,1000)
    return f'{hours:02}:{minutes:02}:{secs:02}{"," if srt else "."}{millis:03}'


def make_audio():
    OUT.mkdir(parents=True,exist_ok=True)
    all_samples=[]
    for scene in SCENES:
        aiff=OUT/(scene['id']+'.aiff'); wav=OUT/(scene['id']+'.wav')
        if not aiff.exists():
            subprocess.run(['say','-v','Tingting','-r','215','-o',str(aiff),scene['voice']],check=True)
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(aiff),'-ar',str(SR),'-ac','1',str(wav)],check=True)
        with wave.open(str(wav)) as f:
            voice=np.frombuffer(f.readframes(f.getnframes()),dtype=np.int16).astype(np.float32)/32768
        duration=len(voice)/SR
        if duration+.8>scene['duration']:
            raise ValueError(f'Narration too long for {scene["id"]}: {duration:.2f}s')
        length=round(scene['duration']*SR)
        samples=np.zeros(length,dtype=np.float32)
        voice*=.75/max(.01,float(np.max(np.abs(voice))))
        start=round(.42*SR)
        samples[start:start+len(voice)]+=voice
        # Original quiet two-note cue, synthesized locally; no third-party music.
        clock=np.arange(length)/SR
        tone=(np.sin(2*np.pi*440*clock)+.5*np.sin(2*np.pi*660*clock))*.009
        envelope=np.minimum(1,clock/.06)*np.exp(-clock/1.25)
        samples+=tone*envelope
        all_samples.append(samples)
        print(f'Voice {scene["id"]}: {duration:.2f}s / {scene["duration"]:.2f}s',flush=True)
    mixed=np.concatenate(all_samples)
    stereo=np.stack([mixed,mixed],axis=-1)
    with wave.open(str(OUT/'narration.wav'),'wb') as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(stereo,-1,1)*32767).astype(np.int16).tobytes())


def subtitles():
    vtt=['WEBVTT\n']; srt=[]; elapsed=0
    for i,s in enumerate(SCENES):
        start,end=elapsed+.2,elapsed+s['duration']-.1
        vtt.append(f'{timestamp(start)} --> {timestamp(end)}\n{s["caption"]}\n')
        srt.append(f'{i+1}\n{timestamp(start,True)} --> {timestamp(end,True)}\n{s["caption"]}\n')
        elapsed+=s['duration']
    (OUT/'agentvps-intro.zh-CN.vtt').write_text('\n'.join(vtt))
    (OUT/'agentvps-intro.zh-CN.srt').write_text('\n'.join(srt))


TOTAL=sum(s['duration'] for s in SCENES)
if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--stills',action='store_true')
    args=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    subtitles()
    elapsed=0
    for i,s in enumerate(SCENES):
        frame(elapsed+min(3,s['duration']-.5)).save(OUT/(s['id']+'.jpg'),quality=94)
        elapsed+=s['duration']
    frame(3).save(OUT/'poster.jpg',quality=94)
    if args.stills:
        print('Prepared storyboards',flush=True)
        raise SystemExit(0)
    make_audio()
    dest=OUT/'agentvps-intro-zh-CN.mp4'
    cmd=['ffmpeg','-hide_banner','-loglevel','warning','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
         '-i',str(OUT/'narration.wav'),'-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k',
         '-t',str(TOTAL),'-movflags','+faststart','-metadata','title=AgentVPS — 你的个人助理工作空间',str(dest)]
    with subprocess.Popen(cmd,stdin=subprocess.PIPE) as process:
        for n in range(round(FPS*TOTAL)):
            process.stdin.write(frame(n/FPS).tobytes())
            if n%(FPS*5)==0: print(f'Rendering {n/FPS:.0f}s / {TOTAL:.0f}s',flush=True)
        process.stdin.close()
        if process.wait()!=0: raise SystemExit('FFmpeg render failed')
    print(dest,flush=True)
