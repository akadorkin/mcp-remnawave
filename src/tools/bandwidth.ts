import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

const start = z.string().describe('Period start (ISO 8601)');
const end = z.string().describe('Period end (ISO 8601)');

export function registerBandwidthTools(server: McpServer, client: RemnawaveClient) {
    server.tool(
        'bandwidth_nodes_usage',
        'Traffic per node for a period (top N nodes)',
        { start, end, topNodesLimit: z.number().int().optional() },
        (p) => run(() => client.getNodesUsage(p)),
    );

    server.tool('bandwidth_nodes_realtime', 'Realtime traffic of nodes', {}, () => run(() => client.getNodesRealtimeUsage()));

    server.tool(
        'bandwidth_node_users_usage',
        'Top users by traffic on one node for a period',
        { nodeUuid: z.string(), start, end, topUsersLimit: z.number().int().optional() },
        ({ nodeUuid, ...q }) => run(() => client.getNodeUsersUsage(nodeUuid, q)),
    );

    server.tool(
        'bandwidth_nodes_users_usage',
        'Top users by traffic across several nodes for a period',
        { nodesUuids: z.array(z.string()), start, end, topUsersLimit: z.number().int().optional() },
        ({ nodesUuids, ...q }) => run(() => client.getNodesUsersUsage(nodesUuids, q)),
    );

    server.tool(
        'bandwidth_nodes_usage_by_uuids',
        'Traffic of the given nodes for a period (optionally only nodes above minTotalBytes)',
        { nodesUuids: z.array(z.string()), start, end, minTotalBytes: z.number().optional() },
        ({ nodesUuids, ...q }) => run(() => client.getNodesUsageByUuids(nodesUuids, q)),
    );

    server.tool(
        'bandwidth_user_usage',
        'Traffic of a user per node for a period',
        { userId: z.number().int(), start, end, topNodesLimit: z.number().int().optional() },
        ({ userId, ...q }) => run(() => client.getUserUsage(userId, q)),
    );

    server.tool(
        'bandwidth_squad_usage',
        'Traffic of users in an internal squad for a period (cursor paginated)',
        { squadUuid: z.string(), start, end, minTotalBytes: z.number().optional(), limit: z.number().int().optional(), cursor: z.number().int().optional() },
        ({ squadUuid, ...q }) => run(() => client.getInternalSquadUsage(squadUuid, q)),
    );

    server.tool(
        'bandwidth_squad_user_usage',
        'Traffic of one user inside an internal squad for a period',
        { squadUuid: z.string(), userId: z.number().int(), start, end },
        ({ squadUuid, userId, ...q }) => run(() => client.getInternalSquadUserUsage(squadUuid, userId, q)),
    );
}
