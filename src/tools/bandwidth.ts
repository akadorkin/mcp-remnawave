import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

const start = z.string().describe('Period start, YYYY-MM-DD (a full ISO datetime is truncated to the date)');
const end = z.string().describe('Period end, YYYY-MM-DD (inclusive)');

/** Panel validates these as `date` (YYYY-MM-DD); accept full ISO timestamps and truncate. */
function dateOnly<T extends { start: string; end: string }>(q: T): T {
    return { ...q, start: q.start.slice(0, 10), end: q.end.slice(0, 10) };
}

export function registerBandwidthTools(server: McpServer, client: RemnawaveClient) {
    server.tool(
        'bandwidth_nodes_usage',
        'Traffic per node for a period (top N nodes)',
        { start, end, topNodesLimit: z.number().int().optional() },
        (p) => run(() => client.getNodesUsage(dateOnly(p))),
    );

    server.tool(
        'bandwidth_node_users_usage',
        'Top users by traffic on one node for a period',
        { nodeUuid: z.string(), start, end, topUsersLimit: z.number().int().optional() },
        ({ nodeUuid, ...q }) => run(() => client.getNodeUsersUsage(nodeUuid, dateOnly(q))),
    );

    server.tool(
        'bandwidth_nodes_users_usage',
        'Top users by traffic across several nodes for a period',
        { nodesUuids: z.array(z.string()), start, end, topUsersLimit: z.number().int().optional() },
        ({ nodesUuids, ...q }) => run(() => client.getNodesUsersUsage(nodesUuids, dateOnly(q))),
    );

    server.tool(
        'bandwidth_nodes_usage_by_uuids',
        'Traffic of the given nodes for a period (optionally only nodes above minTotalBytes)',
        { nodesUuids: z.array(z.string()), start, end, minTotalBytes: z.number().optional() },
        ({ nodesUuids, ...q }) => run(() => client.getNodesUsageByUuids(nodesUuids, dateOnly(q))),
    );

    server.tool(
        'bandwidth_user_usage',
        'Traffic of a user per node for a period',
        { userId: z.number().int(), start, end, topNodesLimit: z.number().int().optional() },
        ({ userId, ...q }) => run(() => client.getUserUsage(userId, dateOnly(q))),
    );

    server.tool(
        'bandwidth_squad_usage',
        'Traffic of users in an internal squad for a period (cursor paginated)',
        { squadUuid: z.string(), start, end, minTotalBytes: z.number().optional(), limit: z.number().int().optional(), cursor: z.number().int().optional() },
        ({ squadUuid, ...q }) => run(() => client.getInternalSquadUsage(squadUuid, dateOnly(q))),
    );

    server.tool(
        'bandwidth_squad_user_usage',
        'Traffic of one user inside an internal squad for a period',
        { squadUuid: z.string(), userId: z.number().int(), start, end },
        ({ squadUuid, userId, ...q }) => run(() => client.getInternalSquadUserUsage(squadUuid, userId, dateOnly(q))),
    );
}
