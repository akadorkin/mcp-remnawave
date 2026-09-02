import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

const targetNodes = z
    .union([
        z.object({ target: z.literal('allNodes') }),
        z.object({ target: z.literal('specificNodes'), nodeUuids: z.array(z.string()).min(1) }),
    ])
    .describe('Which nodes to target');

export function registerConnectionTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool(
        'connections_by_user',
        'Start a job collecting active connections (IPs) of a user across nodes. Returns a jobId.',
        { userId: z.number().int() },
        ({ userId }) => run(() => client.startConnectionsByUser(userId)),
    );

    server.tool('connections_by_user_result', 'Fetch the result of a connections_by_user job', { jobId: z.string() }, ({ jobId }) =>
        run(() => client.getConnectionsByUserResult(jobId)),
    );

    server.tool(
        'connections_by_node',
        'Start a job collecting active connections of all users on a node. Returns a jobId.',
        { nodeUuid: z.string() },
        ({ nodeUuid }) => run(() => client.startConnectionsByNode(nodeUuid)),
    );

    server.tool('connections_by_node_result', 'Fetch the result of a connections_by_node job', { jobId: z.string() }, ({ jobId }) =>
        run(() => client.getConnectionsByNodeResult(jobId)),
    );

    server.tool(
        'connections_geocheck',
        'Start a geo/IP check from a node (optionally for a given ip or interface). Returns a jobId.',
        { nodeUuid: z.string(), ip: z.string().optional(), interface: z.string().optional() },
        ({ nodeUuid, ...body }) => run(() => client.startGeocheckByNode(nodeUuid, body)),
    );

    server.tool('connections_geocheck_result', 'Fetch the result of a geocheck job', { jobId: z.string() }, ({ jobId }) =>
        run(() => client.getGeocheckByNodeResult(jobId)),
    );

    if (readonly) return;

    server.tool(
        'connections_drop',
        'Drop active connections by user ids or IP addresses on all / specific nodes',
        {
            dropBy: z.union([
                z.object({ by: z.literal('userIds'), userIds: z.array(z.number().int()).min(1) }),
                z.object({ by: z.literal('ipAddresses'), ipAddresses: z.array(z.string()).min(1) }),
            ]),
            targetNodes,
        },
        (p) => run(() => client.dropConnections(p)),
    );
}
