import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

export function registerInfraBillingTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('billing_providers_list', 'List infrastructure billing providers', {}, () => run(() => client.getBillingProviders()));

    server.tool('billing_provider_get', 'Get a billing provider by UUID', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getBillingProviderByUuid(uuid)),
    );

    server.tool('billing_nodes_list', 'List billing nodes', {}, () => run(() => client.getBillingNodes()));

    server.tool(
        'billing_history_list',
        'List billing history (paginated)',
        { start: z.number().int().default(0), size: z.number().int().default(50) },
        (p) => run(() => client.getBillingHistory(p)),
    );

    if (readonly) return;

    server.tool(
        'billing_provider_create',
        'Create a billing provider',
        { name: z.string(), faviconLink: z.string().optional(), loginUrl: z.string().optional() },
        (p) => run(() => client.createBillingProvider(p)),
    );

    server.tool(
        'billing_provider_update',
        'Update a billing provider',
        { uuid: z.string(), name: z.string().optional(), faviconLink: z.string().optional(), loginUrl: z.string().optional() },
        (p) => run(() => client.updateBillingProvider(p)),
    );

    server.tool('billing_provider_delete', 'Delete a billing provider', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteBillingProvider(uuid);
            return { success: true, message: `Provider ${uuid} deleted` };
        }),
    );

    server.tool(
        'billing_node_create',
        'Attach a node to a billing provider',
        {
            nodeUuid: z.string(),
            providerUuid: z.string(),
            name: z.string().describe('Display name of the billing entry'),
            nextBillingAt: z.string().describe('Next billing date (ISO 8601)'),
        },
        (p) => run(() => client.createBillingNode(p)),
    );

    server.tool(
        'billing_node_update',
        'Set next billing date for billing nodes',
        { uuids: z.array(z.string()), nextBillingAt: z.string() },
        (p) => run(() => client.updateBillingNode(p)),
    );

    server.tool('billing_node_delete', 'Delete a billing node', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteBillingNode(uuid);
            return { success: true, message: `Billing node ${uuid} deleted` };
        }),
    );

    server.tool(
        'billing_history_create',
        'Record a payment',
        { providerUuid: z.string(), amount: z.number(), billedAt: z.string() },
        (p) => run(() => client.createBillingHistory(p)),
    );

    server.tool('billing_history_delete', 'Delete a payment record', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteBillingHistory(uuid);
            return { success: true, message: `History entry ${uuid} deleted` };
        }),
    );
}
