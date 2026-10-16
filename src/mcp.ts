import { McpServer } from '@modelcontextprotocol/server';
import { tools } from './tools.js';
import { messageOf } from './util.js';

export type Executor = (name: string, args: unknown) => Promise<unknown>;
export function mcpServer(execute: Executor) {
  const server = new McpServer({ name: 'agentvps', version: '0.0.1' }, {
    instructions: 'AgentVPS tools execute on a remote VPS. Call workspace_info first. All paths refer to its shared workspace. Poll shell_status until completion and inspect exitCode. Use terminal tools for interactive programs. Browser downloads and code outputs share the filesystem. This is a single-owner computer with OS-user permissions, not an untrusted-code sandbox.',
  });
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema,
      annotations: { readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly, openWorldHint: true } }, async args => {
      try {
        const result = await execute(tool.name, args);
        if (result && typeof result === 'object' && 'image' in result && typeof result.image === 'string') {
          const { image, ...receipt } = result;
          return { content: [{ type: 'text' as const, text: JSON.stringify(receipt) }, { type: 'image' as const, data: image, mimeType: 'image/png' }] };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: messageOf(error) }] }; }
    });
  }
  return server;
}
