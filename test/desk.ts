import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { remoteClient } from '../src/client.js';
import { startServer } from '../src/server.js';

let local: Awaited<ReturnType<typeof startServer>> | undefined, temp: string | undefined;
if (!process.env.AGENTVPS_URL) {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentvps-desk-'));
  await fs.mkdir(path.join(temp,'workspace')); await fs.mkdir(path.join(temp,'state'));
  const token = randomBytes(32).toString('hex');
  local = await startServer({ home:temp,workspace:path.join(temp,'workspace'),state:path.join(temp,'state'),token,host:'127.0.0.1',port:0,previewPort:0,name:'desk-test' });
  process.env.AGENTVPS_URL = local.url; process.env.AGENTVPS_TOKEN = token;
}
const client = await remoteClient();
const token = process.env.AGENTVPS_TOKEN || (await fs.readFile(process.env.AGENTVPS_TOKEN_FILE!, 'utf8')).trim();
const mcp = new Client({ name:'desk-agent-fixture',version:'1' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(client.url+'/mcp'), { requestInit:{ headers:{Authorization:`Bearer ${token}`} } }));
const call = async (name: string, args: any = {}): Promise<any> => {
  const result = await mcp.callTool({name,arguments:args});
  const text = (result.content as any[]).find(c=>c.type==='text')?.text;
  if (result.isError) throw new Error(text); return JSON.parse(text);
};
async function until(fn: () => Promise<boolean>, label: string) { for (let i=0;i<60;i++) { if (await fn().catch(()=>false)) return; await new Promise(r=>setTimeout(r,150)); } throw new Error('Timed out: '+label); }
const folder = `desk-proof-${Date.now()}`, output = path.resolve(process.env.AGENTVPS_TEST_OUTPUT || 'test-results/desk');
await fs.mkdir(output,{recursive:true});
let job: any, terminal: any, tab: any, browser: any;
try {
  const identity = await call('workspace_info');
  if (process.env.AGENTVPS_EXPECT_PLATFORM) assert.equal(identity.platform,process.env.AGENTVPS_EXPECT_PLATFORM);
  await call('file_write',{path:folder+'/agent-note.md',content:'# From your agent\n\nWritten through MCP, visible in your remote desk.\n'});
  await call('file_write',{path:folder+'/index.html',content:`<!doctype html><html><head><meta charset="utf-8"><title>Field notes · AgentVPS</title><style>body{margin:0;padding:70px 90px;background:#f7f3e9;color:#2b392e;font-family:Georgia,serif}small{font:12px monospace;color:#7c8a70;letter-spacing:2px}h1{font-size:68px;font-weight:400;letter-spacing:-3px;margin:35px 0 15px}p{font:17px/1.8 Georgia,serif;color:#7a826d}section{margin:40px 0;padding:30px;background:#e8eddd;border:1px solid #d6ddca}input{font:18px monospace;padding:14px;border:1px solid #bbc8ac;background:#fbfcf7}button{font:16px sans-serif;padding:16px 24px;border:0;background:#526d4b;color:white;margin-left:12px}#result{font:23px Georgia;margin-top:24px;color:#b05a39}footer{margin-top:80px;border-top:1px solid #d5dcc8;padding-top:20px;font:12px monospace;color:#7a826d}</style></head><body><small>AGENTVPS / SHARED COMPUTER</small><h1>The desk is yours.</h1><p>This page is running inside the VPS browser.<br>Your agent and your remote desk see the same thing.</p><section><input id="message" aria-label="Message" placeholder="Leave a note"><button id="send" onclick="document.querySelector('#result').textContent='Received: '+document.querySelector('#message').value">Send note ↗</button><div id="result">Waiting for your input.</div></section><footer>LIVE BROWSER · FILES · TERMINAL · ONE WORKSPACE</footer></body></html>`});
  job = await call('code_execute',{language:'python',code:`from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer\nimport os\nos.chdir(${JSON.stringify(folder)})\ns=ThreadingHTTPServer(('127.0.0.1',0),SimpleHTTPRequestHandler)\nprint(s.server_port,flush=True)\ns.serve_forever()`,waitMs:1000,timeoutMs:86400000});
  const port = Number(job.stdout.trim()); assert.ok(port>0,job.stderr);
  tab = await call('browser_open',{url:`http://127.0.0.1:${port}/`});
  terminal = await call('terminal_create',{cwd:folder});
  assert.equal((await fetch(client.url+`/api/browser/${tab.id}/frame`)).status,401);
  const frame = await client.request(`/api/browser/${tab.id}/frame`); assert.equal(frame.headers.get('content-type')?.split(';')[0],'image/jpeg');
  const image = Buffer.from(await frame.arrayBuffer()); assert.equal(image.readUInt16BE(0),0xffd8);
  const before = await call('file_list',{path:folder}); await client.request(`/api/browser/${tab.id}/frame`);
  assert.equal((await call('file_list',{path:folder})).length,before.length);
  await assert.rejects(call('browser_input',{id:tab.id,action:'click',x:9999,y:5}),/viewport/);
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1512,height:1050}});
  await page.route('**/api/tools', async route => { await new Promise(resolve => setTimeout(resolve, 350)); await route.continue(); });
  const errors: string[]=[]; page.on('pageerror',(e: Error)=>errors.push(e.message)); page.on('dialog',(d: any)=>d.accept());
  await page.goto(client.url); await page.locator('#token').fill(token); await page.getByRole('button',{name:'Open workspace'}).click();
  if (identity.desktop?.enabled) await page.locator('[data-view=desk]').click();
  await page.locator('#desk').waitFor({state:'visible'});
  await page.locator('#desk-file-list button').filter({hasText:folder}).click();
  await page.locator('#desk-file-list button').filter({hasText:'agent-note.md'}).click();
  await page.locator('#desk-file-text').waitFor({state:'visible'});
  assert.match(await page.locator('#desk-file-text').inputValue(),/Written through MCP/);
  await page.locator('#desk-file-text').fill('Edits from the remote desk.\n');
  await call('file_write',{path:folder+'/agent-note.md',content:'Agent changed this while you were editing.\n'});
  await page.locator('#desk-file-save').click(); await page.locator('#notice').filter({hasText:'File changed on the VPS'}).waitFor();
  assert.match((await call('file_read',{path:folder+'/agent-note.md'})).content,/Agent changed/);
  await page.locator('#desk-file-reload').click(); await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('#desk-file-text')?.value.startsWith('Agent changed'));
  await page.locator('#desk-file-text').fill('Saved from the remote desk.\n'); await page.locator('#desk-file-save').click();
  await until(async ()=>(await call('file_read',{path:folder+'/agent-note.md'})).content==='Saved from the remote desk.\n','desk file save');
  await call('file_write',{path:folder+'/appeared-from-mcp.txt',content:'An agent created this after the desk opened.'});
  await page.locator('#desk-file-list button').filter({hasText:'appeared-from-mcp.txt'}).waitFor();
  const binary = randomBytes(1024);
  await page.locator('#desk-upload').setInputFiles({name:'binary.bin',mimeType:'application/octet-stream',buffer:binary});
  await until(async ()=>(await call('file_read',{path:folder+'/binary.bin',encoding:'base64'})).content===binary.toString('base64'),'binary upload');
  await page.locator('#desk-file-list button').filter({hasText:'binary.bin'}).click();
  await page.waitForFunction(()=>document.querySelector('#desk-file-title')?.textContent?.endsWith('binary.bin'));
  const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#desk-file-download').click()]);
  assert.deepEqual(await fs.readFile(await download.path()),binary);
  await page.selectOption('#desk-terminal-select',terminal.id);
  await page.locator('#desk-terminal-host .xterm-helper-textarea').focus();
  await page.keyboard.type("printf 'desk-pty-proof' > terminal.txt",{delay:5}); await page.keyboard.press('Enter');
  await until(async ()=>(await call('file_read',{path:folder+'/terminal.txt'})).content==='desk-pty-proof','interactive terminal');
  await page.keyboard.type("printf '\\033[32mRemote desk connected.\\033[0m\\n'; pwd",{delay:3}); await page.keyboard.press('Enter');
  await page.locator('#desk-browser-mode').click(); await page.selectOption('#desk-tabs',tab.id);
  await page.waitForFunction(()=>{const i=document.querySelector<HTMLImageElement>('#desk-frame');return i&&!i.hidden&&i.naturalWidth>0;});
  await page.locator('#desk-control').click();
  async function clickRemote(selector: string) {
    const bounds = (await call('browser_evaluate',{id:tab.id,expression:`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`})).result;
    const rect = await page.locator('#desk-frame').boundingBox(); const width = await page.locator('#desk-frame').evaluate((i:HTMLImageElement)=>i.naturalWidth);
    await page.mouse.click(rect.x+bounds.x*rect.width/width,rect.y+bounds.y*rect.width/width);
  }
  await clickRemote('#message'); await page.keyboard.type('Hello from my desk',{delay:30}); await clickRemote('#send');
  await until(async ()=>(await call('browser_evaluate',{id:tab.id,expression:'document.querySelector("#result").textContent'})).result==='Received: Hello from my desk','browser pointer and keyboard');
  await page.locator('#desk-control').click();
  await page.waitForTimeout(1500); await page.screenshot({path:path.join(output,'desk.png'),fullPage:true,animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(300); await page.locator('#desk-toggle-files').click();
  await page.screenshot({path:path.join(output,'desk-mobile.png'),fullPage:true,animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false); assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'desk-proof.json'),JSON.stringify({testedAt:new Date().toISOString(),identity,folder,checks:['MCP file visible in desk','stale edit rejected','saved edit visible over MCP','live file refresh','binary upload/download integrity','interactive PTY keyboard','authenticated transient browser frames','shared browser click and typing','desktop and mobile layout'],kept:process.env.AGENTVPS_KEEP_DEMO==='1'},null,2));
  console.log(`PASS: remote desk files, editing, PTY, browser interaction and responsive UI. Evidence: ${output}`);
  if(process.env.AGENTVPS_KEEP_DEMO==='1'){job=terminal=tab=undefined;}
} finally {
  await browser?.close();
  if(tab)await call('browser_close',{id:tab.id}).catch(()=>{});
  if(terminal)await call('terminal_close',{id:terminal.id}).catch(()=>{});
  if(job)await call('shell_cancel',{id:job.id}).catch(()=>{});
  await mcp.close(); await local?.close(); if(temp)await fs.rm(temp,{recursive:true,force:true});
}
