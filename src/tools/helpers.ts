import { AsyncLocalStorage } from 'node:async_hooks';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Output, ToolResponse } from '../core/output.js';

export type { ToolResponse };

const current = new AsyncLocalStorage<string>();
let output: Output | null = null;

/**
 * Route every tool handler through one place: remember the tool name (used to name
 * spill files) and make sure `run` applies the shared output policy.
 */
export function instrument(server: McpServer, out: Output) {
    output = out;
    const orig = server.tool.bind(server) as (...a: unknown[]) => unknown;
    (server as unknown as { tool: (...a: unknown[]) => unknown }).tool = (...args: unknown[]) => {
        const name = args[0] as string;
        const cb = args[args.length - 1] as (...a: unknown[]) => unknown;
        args[args.length - 1] = (...cbArgs: unknown[]) => current.run(name, () => cb(...cbArgs));
        return orig(...args);
    };
}

function out(): Output {
    if (!output) throw new Error('output policy not initialised');
    return output;
}

/** Run an API call and wrap the outcome as an MCP tool response (redacted, size-guarded). */
export async function run(fn: () => Promise<unknown>): Promise<ToolResponse> {
    return out().run(current.getStore() ?? 'result', fn);
}

export function toolResult(data: unknown): ToolResponse {
    return out().ok(current.getStore() ?? 'result', data);
}

export function toolError(error: unknown): ToolResponse {
    return out().error(error);
}
