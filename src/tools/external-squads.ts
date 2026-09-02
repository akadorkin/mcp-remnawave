import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

const SUBSCRIPTION_TYPES = ['XRAY_JSON', 'XRAY_BASE64', 'MIHOMO', 'STASH', 'CLASH', 'SINGBOX'] as const;

export function registerExternalSquadTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('external_squads_list', 'List external squads', {}, () => run(() => client.getExternalSquads()));

    server.tool('external_squads_get', 'Get an external squad by UUID', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getExternalSquadByUuid(uuid)),
    );

    if (readonly) return;

    server.tool('external_squads_create', 'Create an external squad', { name: z.string() }, (p) =>
        run(() => client.createExternalSquad(p)),
    );

    server.tool(
        'external_squads_update',
        'Update an external squad (templates, subscription settings, headers, HWID settings...)',
        {
            uuid: z.string(),
            name: z.string().optional(),
            templates: z.array(z.object({ templateUuid: z.string(), templateType: z.enum(SUBSCRIPTION_TYPES) })).optional(),
            subscriptionSettings: z
                .object({
                    serveJsonAtBaseSubscription: z.boolean().optional(),
                    isShowCustomRemarks: z.boolean().optional(),
                    randomizeHosts: z.boolean().optional(),
                })
                .optional(),
            hostOverrides: z.object({ serverDescription: z.string().optional(), vlessRouteId: z.number().optional() }).optional(),
            responseHeadersAdd: z.record(z.string()).optional().describe('Headers to add to subscription responses'),
            responseHeadersRemove: z.array(z.string()).optional().describe('Header names to remove'),
            hwidSettings: z
                .object({ enabled: z.boolean().optional(), fallbackDeviceLimit: z.number().optional(), maxDevicesAnnounce: z.string().optional() })
                .optional(),
            customRemarks: z.record(z.unknown()).optional(),
            subpageConfigUuid: z.string().optional(),
        },
        (p) => run(() => client.updateExternalSquad(p)),
    );

    server.tool('external_squads_delete', 'Delete an external squad', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteExternalSquad(uuid);
            return { success: true, message: `Squad ${uuid} deleted` };
        }),
    );

    server.tool('external_squads_add_all_users', 'Assign EVERY user of the panel to an external squad', { squadUuid: z.string() }, ({ squadUuid }) =>
        run(() => client.addAllUsersToExternalSquad(squadUuid)),
    );

    server.tool('external_squads_remove_all_users', 'Detach EVERY user from an external squad', { squadUuid: z.string() }, ({ squadUuid }) =>
        run(() => client.removeAllUsersFromExternalSquad(squadUuid)),
    );

    server.tool(
        'external_squads_reorder',
        'Reorder external squads',
        { items: z.array(z.object({ viewPosition: z.number(), uuid: z.string() })) },
        (p) => run(() => client.reorderExternalSquads(p)),
    );
}
