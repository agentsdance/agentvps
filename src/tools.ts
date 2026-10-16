import { z } from 'zod';
import type { Runtime } from './runtime.js';
import { ToolError } from './util.js';

export interface Tool { name: string; description: string; schema: z.ZodObject; readOnly: boolean; run: (runtime: Runtime, args: any) => unknown }
const define = <T extends z.ZodRawShape>(name: string, description: string, shape: T, run: (runtime: Runtime, args: z.infer<z.ZodObject<T>>) => unknown, readOnly = false): Tool => ({ name, description, schema: z.strictObject(shape), run, readOnly });
const text = z.string(), id = z.string().min(1), file = z.string().min(1).describe('Path in the remote workspace, not on the agent computer.');
const cwd = file.optional(), timeoutMs = z.number().int().min(100).max(604800000).optional(), waitMs = z.number().int().min(0).max(30000).optional();
const port = z.number().int().min(1024).max(65535), encoding = z.enum(['utf8', 'base64']).optional();
const cols = z.number().int().min(20).max(400).optional(), rows = z.number().int().min(5).max(200).optional();

export const tools: Tool[] = [
  define('desktop_status', 'Check the real Linux desktop and whether a human has taken control.', {}, r => r.desktop.status(), true),
  define('desktop_resize', 'Change the Linux screen resolution without restarting applications. Supported sizes: 1280x720, 1440x900, 1680x1050, 1920x1080.', { width: z.number().int(), height: z.number().int() }, (r, a) => r.desktop.resize(a.width, a.height)),
  define('desktop_screenshot', 'Capture the full Linux desktop, including native application windows. Save a PNG in the shared workspace and return image data.', { path: file.optional() }, (r, a) => r.desktop.screenshot(a.path), true),
  define('desktop_launch', 'Open the shared Chromium browser, a native terminal window or file manager on the Linux desktop.', { app: z.enum(['browser', 'terminal', 'files']) }, (r, a) => r.launchDesktop(a.app)),
  define('desktop_input', 'Operate the Linux desktop with mouse/keyboard. Coordinates refer to desktop pixels. Keys use X11 names such as Return, ctrl+l, Alt+F4. Refuses input during human takeover.', { action: z.enum(['move', 'click', 'double_click', 'key', 'text', 'scroll']), x: z.number().int().min(0).max(10000).optional(), y: z.number().int().min(0).max(10000).optional(), button: z.number().int().min(1).max(3).optional(), key: text.max(100).optional(), text: text.max(10000).optional(), amount: z.number().int().min(-20).max(20).optional() }, (r, a) => r.desktop.input(a)),
  define('workspace_info', 'Identify the VPS and shared workspace. Call first to verify execution location.', {}, r => r.info(), true),
  define('health_check', 'Check interpreter readiness; optionally launch Chromium to verify the browser.', { browser: z.boolean().optional() }, (r, a) => r.health(a.browser), true),
  define('shell_run', 'Run Bash on the VPS. Returns a job ID; poll shell_status for long work. Default timeout 5 minutes, maximum 7 days. stdout and stderr are separate.', { command: text.min(1).max(100000), cwd, timeoutMs, waitMs, env: z.record(text, text).optional() }, (r, a) => r.jobs.run(a)),
  define('shell_status', 'Read job output, exit status and timestamps. waitMs optionally waits up to 30 seconds.', { id, waitMs }, (r, a) => r.jobs.wait(a.id, a.waitMs), true),
  define('shell_list', 'List recent command receipts on this VPS.', {}, r => r.jobs.list(), true),
  define('shell_cancel', 'Stop a running command and its process group.', { id }, (r, a) => r.jobs.stop(a.id)),
  define('shell_input', 'Send input to a running command. eof closes stdin.', { id, text: text.max(100000), eof: z.boolean().optional() }, (r, a) => r.jobs.input(a.id, a.text, a.eof)),
  define('code_execute', 'Execute Python, JavaScript or Bash in a fresh process on the VPS. Source is saved in the workspace. Variables do not persist between calls; files do.', { language: z.enum(['python', 'javascript', 'bash']), code: text.min(1).max(1000000), cwd, timeoutMs, waitMs }, (r, a) => r.code(a)),
  define('file_list', 'List files in the shared remote workspace.', { path: cwd }, (r, a) => r.workspace.list(a.path), true),
  define('file_read', 'Read a text or binary file. Use base64 for binary data; paginate with byte offset and limit.', { path: file, encoding, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(5000000).optional() }, (r, a) => r.workspace.read(a.path, a.encoding, a.offset, a.limit), true),
  define('file_write', 'Write text or base64 binary into the remote workspace atomically. Maximum 20 MiB. Optional expectedSha256 checks for changes before saving; createOnly refuses to overwrite.', { path: file, content: text.max(28_000_000), encoding, expectedSha256: text.regex(/^[a-f0-9]{64}$/).optional(), createOnly: z.boolean().optional() }, (r, a) => r.workspace.write(a.path, a.content, a.encoding, a.expectedSha256, a.createOnly)),
  define('file_edit', 'Replace exactly one matching text occurrence. Fails if the match is absent or ambiguous.', { path: file, search: text.min(1), replacement: text }, (r, a) => r.workspace.edit(a.path, a.search, a.replacement)),
  define('file_mkdir', 'Create a remote workspace directory and its parents.', { path: file }, (r, a) => r.workspace.mkdir(a.path)),
  define('file_move', 'Move or rename within the workspace; fails if the destination exists.', { from: file, to: file }, (r, a) => r.workspace.move(a.from, a.to)),
  define('file_trash', 'Move a file or directory to workspace/.trash and return its recovery path.', { path: file }, (r, a) => r.workspace.remove(a.path)),
  define('file_search', 'Search remote filenames or text contents. Returns at most 200 matches; skips symlinks, dependencies and trash.', { query: text.min(1), path: cwd, content: z.boolean().optional() }, (r, a) => r.workspace.search(a.query, a.path, a.content), true),
  define('terminal_create', 'Start a real persistent Bash PTY on the VPS. State lasts until close or daemon restart.', { cwd, cols, rows }, (r, a) => r.terminals.create(a.cwd, a.cols, a.rows)),
  define('terminal_list', 'List terminal sessions.', {}, r => r.terminals.list(), true),
  define('terminal_read', 'Read PTY output since a character cursor. Output includes terminal escape sequences.', { id, cursor: z.number().int().min(0).optional() }, (r, a) => r.terminals.read(a.id, a.cursor), true),
  define('terminal_write', 'Write to a PTY. Include newline to execute a command; use control characters for interactive programs.', { id, data: text.max(100000) }, (r, a) => r.terminals.write(a.id, a.data)),
  define('terminal_resize', 'Resize a live PTY.', { id, cols: cols.unwrap(), rows: rows.unwrap() }, (r, a) => r.terminals.resize(a.id, a.cols, a.rows)),
  define('terminal_close', 'Terminate a PTY session.', { id }, (r, a) => r.terminals.close(a.id)),
  define('browser_tabs', 'List VPS browser tabs and completed downloads. Browser state belongs to this remote environment.', {}, r => r.browser.list(), true),
  define('browser_open', 'Open an HTTP(S) page in a new VPS Chromium tab. Returns the accessible page snapshot.', { url: text }, (r, a) => r.browser.open(a.url)),
  define('browser_navigate', 'Navigate a VPS tab to an HTTP(S) URL.', { id, url: text }, (r, a) => r.browser.navigate(a.id, a.url)),
  define('browser_snapshot', 'Read a tab accessibility snapshot for choosing selectors.', { id }, (r, a) => r.browser.snapshot(a.id), true),
  define('browser_action', 'Interact with a tab using Playwright selectors such as role=button[name="Save"] or text=Download. For file downloads use browser_download.', { id, action: z.enum(['click', 'fill', 'press', 'select', 'hover', 'check', 'uncheck', 'scroll', 'back', 'forward', 'reload']), selector: text.optional(), text: text.optional(), key: text.optional(), x: z.number().optional(), y: z.number().optional(), value: text.optional() }, (r, a) => r.browser.action(a)),
  define('browser_evaluate', 'Evaluate JavaScript in the remote page. This can modify page state. Return a JSON-serializable result.', { id, expression: text.max(100000) }, (r, a) => r.browser.evaluate(a.id, a.expression)),
  define('browser_input', 'Send pointer, keyboard or text input to the shared VPS browser. Pointer coordinates are viewport pixels. Desk viewers and agents operate the same tab.', { id, action: z.enum(['click', 'double_click', 'move', 'scroll', 'key', 'text']), x: z.number().min(-10000).max(10000).optional(), y: z.number().min(-10000).max(10000).optional(), button: z.enum(['left', 'middle', 'right']).optional(), key: text.max(100).optional(), text: text.max(100000).optional() }, (r, a) => r.browser.input(a)),
  define('browser_screenshot', 'Capture a PNG, save it in the shared workspace, and return intact image data.', { id, path: file.optional(), fullPage: z.boolean().optional() }, (r, a) => r.browser.screenshot(a.id, a.path, a.fullPage)),
  define('browser_download', 'Click a download link/button and wait for the file to be saved in workspace/downloads.', { id, selector: text.min(1) }, (r, a) => r.browser.download(a.id, a.selector)),
  define('browser_upload', 'Set a page file input to files already in the remote workspace.', { id, selector: text.min(1), paths: z.array(file).min(1).max(20) }, (r, a) => r.browser.upload(a.id, a.selector, a.paths)),
  define('browser_close', 'Close a VPS browser tab.', { id }, (r, a) => r.browser.closeTab(a.id)),
  define('preview_open', 'Create an expiring preview link for a service listening on a VPS loopback port. Preview gateway uses a separate port from the control API.', { port, ttlSeconds: z.number().int().min(60).max(86400).optional() }, (r, a) => r.previews.open(a.port, a.ttlSeconds)),
  define('preview_revoke', 'Revoke a preview link immediately.', { id }, (r, a) => r.previews.revoke(a.id)),
  define('memory_set', 'Save an explicit note for future agent sessions. Store useful preferences or task context, never credentials.', { key: text, content: text.max(100000) }, (r, a) => r.personal.memorySet(a.key, a.content)),
  define('memory_get', 'Read a persistent note by key.', { key: text }, (r, a) => r.personal.memoryGet(a.key), true),
  define('memory_search', 'Search persistent notes by key or content.', { query: text.optional() }, (r, a) => r.personal.memorySearch(a.query), true),
  define('memory_delete', 'Delete an explicit persistent note.', { key: text }, (r, a) => r.personal.memoryDelete(a.key)),
  define('schedule_add', 'Schedule a recurring shell command. First run follows one interval; missed intervals coalesce, same task never overlaps. No model/agent loop is included.', { name: text.min(1).max(100), command: text.min(1).max(100000), cwd, everyMs: z.number().int().min(60000).max(31536000000), timeoutMs }, (r, a) => r.personal.addSchedule(a)),
  define('schedule_list', 'List recurring tasks, next-run times and last job IDs.', {}, r => r.personal.listSchedules(), true),
  define('schedule_update', 'Enable, disable or remove a recurring task. Removing does not cancel an already running job.', { id, enabled: z.boolean().optional(), remove: z.boolean().optional() }, (r, a) => r.personal.updateSchedule(a.id, a.enabled, a.remove)),
];
export const catalog = () => tools.map(t => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.schema), readOnly: t.readOnly }));
export async function execute(runtime: Runtime, name: string, args: unknown = {}) {
  const tool = tools.find(t => t.name === name); if (!tool) throw new ToolError(`Unknown tool: ${name}`, 404);
  const parsed = tool.schema.safeParse(args); if (!parsed.success) throw new ToolError(parsed.error.message);
  if ((name.startsWith('browser_') && !tool.readOnly && name !== 'browser_screenshot') || (name.startsWith('desktop_') && !tool.readOnly)) runtime.desktop.assertAgentControl();
  return await tool.run(runtime, parsed.data);
}
