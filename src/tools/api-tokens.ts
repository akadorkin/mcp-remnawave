import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

export function registerApiTokenTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('api_tokens_list', 'List API tokens', {}, () => run(() => client.getApiTokens()));
    server.tool('api_tokens_scopes', 'List available API token scopes', {}, () => run(() => client.getApiTokenScopes()));

    if (readonly) return;

    server.tool(
        'api_tokens_create',
        'Create an API token',
        {
            name: z.string().describe('Token name'),
            expiresInDays: z.number().int().describe('Lifetime in days'),
            scopes: z.array(z.string()).optional().describe('Scopes (see api_tokens_scopes); omit for full access'),
        },
        (p) => run(() => client.createApiToken(p)),
    );

    server.tool('api_tokens_delete', 'Delete an API token', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteApiToken(uuid);
            return { success: true, message: `Token ${uuid} deleted` };
        }),
    );
}
