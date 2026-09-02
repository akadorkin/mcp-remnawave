import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

const IP_STATUS = ['INBOUND', 'OUTBOUND', 'MANAGEMENT', 'TRANSIT', 'MONITORING', 'RESERVE', 'BLOCKED', 'FLAGGED', 'DEPRECATED', 'UNKNOWN'] as const;

const nodeFields = {
    name: z.string().optional().describe('Node name'),
    address: z.string().optional().describe('Node address (IP or hostname)'),
    port: z.number().optional().describe('Node API port'),
    proxyUrl: z.string().optional().describe('Proxy URL used by the panel to reach the node'),
    countryCode: z.string().optional().describe('Country code (US, DE, NL...)'),
    isTrafficTrackingActive: z.boolean().optional(),
    trafficLimitBytes: z.number().optional(),
    trafficResetDay: z.number().optional().describe('Day of month to reset traffic (1-31)'),
    notifyPercent: z.number().optional().describe('Traffic notification threshold %'),
    consumptionMultiplier: z.number().optional(),
    nodeConsumptionMultiplier: z.number().optional(),
    providerUuid: z.string().optional().describe('Infra billing provider UUID'),
    tags: z.array(z.string()).optional(),
    activePluginUuid: z.string().optional(),
    integrationUuids: z.array(z.string()).optional().describe('Node integration UUIDs'),
    note: z.string().optional(),
    ips: z.array(z.object({ ip: z.string(), status: z.enum(IP_STATUS) })).optional().describe('IP inventory of the node'),
    activeConfigProfileUuid: z.string().optional().describe('Config profile UUID (configProfile.activeConfigProfileUuid)'),
    activeInbounds: z.array(z.string()).optional().describe('Inbound UUIDs to enable (configProfile.activeInbounds)'),
};

function toNodeBody(params: Record<string, unknown>): Record<string, unknown> {
    const { activeConfigProfileUuid, activeInbounds, ...rest } = params;
    const body: Record<string, unknown> = { ...rest };
    if (activeConfigProfileUuid !== undefined || activeInbounds !== undefined) {
        body.configProfile = { activeConfigProfileUuid, activeInbounds };
    }
    return body;
}

export function registerNodeTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('nodes_list', 'List all nodes with status and traffic', {}, () => run(() => client.getNodes()));

    server.tool('nodes_get', 'Get a node by UUID', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getNodeByUuid(uuid)),
    );

    server.tool('nodes_tags_list', 'List all node tags', {}, () => run(() => client.getNodeTags()));

    if (readonly) return;

    server.tool(
        'nodes_create',
        'Create a node. Requires name, address, activeConfigProfileUuid and activeInbounds.',
        {
            ...nodeFields,
            name: z.string().describe('Node name'),
            address: z.string().describe('Node address'),
            activeConfigProfileUuid: z.string().describe('Config profile UUID'),
            activeInbounds: z.array(z.string()).describe('Inbound UUIDs to enable'),
        },
        (p) => run(() => client.createNode(toNodeBody(p))),
    );

    server.tool(
        'nodes_update',
        'Update a node (only the provided fields change)',
        { uuid: z.string().describe('Node UUID'), ...nodeFields },
        (p) => run(() => client.updateNode(toNodeBody(p))),
    );

    server.tool('nodes_delete', 'Delete a node (cascades: usage history, billing, host bindings)', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteNode(uuid);
            return { success: true, message: `Node ${uuid} deleted` };
        }),
    );

    server.tool('nodes_enable', 'Enable a node', { uuid: z.string() }, ({ uuid }) => run(() => client.enableNode(uuid)));
    server.tool('nodes_disable', 'Disable a node', { uuid: z.string() }, ({ uuid }) => run(() => client.disableNode(uuid)));

    server.tool(
        'nodes_restart',
        'Restart xray on a node',
        { uuid: z.string(), forceRestart: z.boolean().default(false).describe('Force restart even if config is unchanged') },
        ({ uuid, forceRestart }) => run(() => client.restartNode(uuid, forceRestart)),
    );

    server.tool(
        'nodes_restart_all',
        'Restart xray on all nodes',
        { forceRestart: z.boolean().default(false) },
        ({ forceRestart }) => run(() => client.restartAllNodes(forceRestart)),
    );

    server.tool('nodes_reset_traffic', 'Reset traffic counter of a node', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.resetNodeTraffic(uuid)),
    );

    server.tool(
        'nodes_reorder',
        'Reorder nodes',
        { nodes: z.array(z.object({ viewPosition: z.number(), uuid: z.string() })) },
        ({ nodes }) => run(() => client.reorderNodes(nodes)),
    );

    server.tool(
        'nodes_bulk_profile_modification',
        'Set config profile and inbounds for selected nodes',
        {
            uuids: z.array(z.string()),
            configProfileUuid: z.string(),
            activeInbounds: z.array(z.string()),
        },
        ({ uuids, configProfileUuid, activeInbounds }) =>
            run(() =>
                client.bulkNodeProfileModification({
                    uuids,
                    configProfile: { activeConfigProfileUuid: configProfileUuid, activeInbounds },
                }),
            ),
    );

    server.tool(
        'nodes_bulk_actions',
        'Enable / disable / restart / reset traffic on selected nodes',
        { uuids: z.array(z.string()), action: z.enum(['ENABLE', 'DISABLE', 'RESTART', 'RESET_TRAFFIC']) },
        (p) => run(() => client.bulkNodeActions(p)),
    );

    server.tool(
        'nodes_bulk_update',
        'Bulk update properties for selected nodes',
        {
            uuids: z.array(z.string()),
            countryCode: z.string().optional(),
            consumptionMultiplier: z.number().optional(),
            nodeConsumptionMultiplier: z.number().optional(),
            providerUuid: z.string().optional(),
            tags: z.array(z.string()).optional(),
            activePluginUuid: z.string().optional(),
            integrationUuids: z.array(z.string()).optional(),
            note: z.string().optional(),
        },
        ({ uuids, ...fields }) => run(() => client.bulkUpdateNodes({ uuids, fields })),
    );
}
