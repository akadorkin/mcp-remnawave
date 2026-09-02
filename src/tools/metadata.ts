import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

export function registerMetadataTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('metadata_node_get', 'Get custom metadata of a node', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getNodeMetadata(uuid)),
    );

    server.tool('metadata_user_get', 'Get custom metadata of a user', { userId: z.number().int() }, ({ userId }) =>
        run(() => client.getUserMetadata(userId)),
    );

    if (readonly) return;

    server.tool(
        'metadata_node_upsert',
        'Create or replace custom metadata of a node',
        { uuid: z.string(), metadata: z.record(z.unknown()) },
        ({ uuid, metadata }) => run(() => client.upsertNodeMetadata(uuid, { metadata })),
    );

    server.tool(
        'metadata_user_upsert',
        'Create or replace custom metadata of a user',
        { userId: z.number().int(), metadata: z.record(z.unknown()) },
        ({ userId, metadata }) => run(() => client.upsertUserMetadata(userId, { metadata })),
    );
}
