import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

export function registerSquadTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('squads_list', 'List internal squads', {}, () => run(() => client.getInternalSquads()));

    server.tool('squads_get', 'Get an internal squad by UUID', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getInternalSquadByUuid(uuid)),
    );

    server.tool('squads_accessible_nodes', 'Nodes reachable through a squad', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getSquadAccessibleNodes(uuid)),
    );

    if (readonly) return;

    server.tool(
        'squads_create',
        'Create an internal squad',
        { name: z.string(), inbounds: z.array(z.string()).describe('Inbound UUIDs') },
        (p) => run(() => client.createInternalSquad(p)),
    );

    server.tool(
        'squads_update',
        'Update an internal squad',
        { uuid: z.string(), name: z.string().optional(), inbounds: z.array(z.string()).optional() },
        (p) => run(() => client.updateInternalSquad(p)),
    );

    server.tool('squads_delete', 'Delete an internal squad', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteInternalSquad(uuid);
            return { success: true, message: `Squad ${uuid} deleted` };
        }),
    );

    server.tool(
        'squads_reorder',
        'Reorder internal squads',
        { items: z.array(z.object({ viewPosition: z.number(), uuid: z.string() })) },
        (p) => run(() => client.reorderInternalSquads(p)),
    );

    server.tool(
        'squads_add_users',
        'Add specific users (by numeric id) to an internal squad',
        { squadUuid: z.string(), userIds: z.array(z.number().int()) },
        ({ squadUuid, userIds }) => run(() => client.addUsersToSquad(squadUuid, userIds)),
    );

    server.tool(
        'squads_remove_users',
        'Remove specific users (by numeric id) from an internal squad',
        { squadUuid: z.string(), userIds: z.array(z.number().int()) },
        ({ squadUuid, userIds }) => run(() => client.removeUsersFromSquad(squadUuid, userIds)),
    );

    server.tool('squads_add_all_users', 'Add EVERY user of the panel to an internal squad', { squadUuid: z.string() }, ({ squadUuid }) =>
        run(() => client.addAllUsersToSquad(squadUuid)),
    );

    server.tool('squads_remove_all_users', 'Remove EVERY user from an internal squad', { squadUuid: z.string() }, ({ squadUuid }) =>
        run(() => client.removeAllUsersFromSquad(squadUuid)),
    );
}
