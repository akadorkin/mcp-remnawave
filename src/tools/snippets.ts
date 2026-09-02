import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

export function registerSnippetTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('snippets_list', 'List configuration snippets', {}, () => run(() => client.getSnippets()));

    if (readonly) return;

    server.tool(
        'snippets_create',
        'Create a configuration snippet',
        { name: z.string(), snippet: z.array(z.record(z.unknown())).describe('Snippet content as array of objects') },
        (p) => run(() => client.createSnippet(p)),
    );

    server.tool(
        'snippets_update',
        'Replace the content of a snippet',
        { name: z.string(), snippet: z.array(z.record(z.unknown())) },
        (p) => run(() => client.updateSnippet(p)),
    );

    server.tool('snippets_delete', 'Delete a snippet by name', { name: z.string() }, (p) => run(() => client.deleteSnippet(p)));

    server.tool('snippets_sync', 'Push a snippet to nodes / config profiles that use it', { name: z.string() }, ({ name }) =>
        run(() => client.syncSnippet(name)),
    );
}
