import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

export function registerNodeIntegrationTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('node_integrations_list', 'List node integrations', {}, () => run(() => client.getNodeIntegrations()));

    server.tool('node_integrations_get', 'Get a node integration by UUID', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getNodeIntegration(uuid)),
    );

    if (readonly) return;

    server.tool(
        'node_integrations_create',
        'Create a node integration',
        { name: z.string(), description: z.string().optional(), config: z.record(z.unknown()) },
        (p) => run(() => client.createNodeIntegration(p)),
    );

    server.tool(
        'node_integrations_update',
        'Update a node integration',
        {
            uuid: z.string(),
            name: z.string().optional(),
            description: z.string().optional(),
            config: z.record(z.unknown()).optional(),
            restartNodes: z.boolean().optional().describe('Restart nodes using this integration'),
        },
        (p) => run(() => client.updateNodeIntegration(p)),
    );

    server.tool('node_integrations_delete', 'Delete a node integration', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteNodeIntegration(uuid);
            return { success: true, message: `Integration ${uuid} deleted` };
        }),
    );
}
