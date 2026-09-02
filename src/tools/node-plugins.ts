import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

export function registerNodePluginTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('node_plugins_list', 'List node plugins', {}, () => run(() => client.getNodePlugins()));

    server.tool('node_plugins_get', 'Get a node plugin by UUID', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getNodePlugin(uuid)),
    );

    server.tool(
        'node_plugins_torrent_reports',
        'Torrent blocker reports (paginated)',
        { start: z.number().int().default(0), size: z.number().int().default(50) },
        (p) => run(() => client.getTorrentBlockerReports(p)),
    );

    server.tool('node_plugins_torrent_stats', 'Torrent blocker statistics', {}, () => run(() => client.getTorrentBlockerStats()));

    server.tool('shared_lists_list', 'List node plugin shared lists', {}, () => run(() => client.getSharedLists()));

    if (readonly) return;

    server.tool('node_plugins_create', 'Create a node plugin', { name: z.string() }, (p) => run(() => client.createNodePlugin(p)));

    server.tool(
        'node_plugins_update',
        'Update a node plugin',
        { uuid: z.string(), name: z.string().optional(), pluginConfig: z.unknown().optional() },
        (p) => run(() => client.updateNodePlugin(p)),
    );

    server.tool('node_plugins_delete', 'Delete a node plugin', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteNodePlugin(uuid);
            return { success: true, message: `Plugin ${uuid} deleted` };
        }),
    );

    server.tool(
        'node_plugins_reorder',
        'Reorder node plugins',
        { items: z.array(z.object({ viewPosition: z.number(), uuid: z.string() })) },
        (p) => run(() => client.reorderNodePlugins(p)),
    );

    server.tool('node_plugins_clone', 'Clone a node plugin', { cloneFromUuid: z.string() }, (p) => run(() => client.cloneNodePlugin(p)));

    server.tool('node_plugins_sync', 'Push a plugin to the nodes that use it', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.syncNodePlugin(uuid)),
    );

    server.tool(
        'node_plugins_execute',
        'Execute a plugin command (blockIps / unblockIps / recreateTables) on target nodes',
        {
            command: z.union([
                z.object({ command: z.literal('blockIps'), ips: z.array(z.object({ ip: z.string(), timeout: z.number() })) }),
                z.object({ command: z.literal('unblockIps'), ips: z.array(z.string()).min(1) }),
                z.object({ command: z.literal('recreateTables') }),
            ]),
            targetNodes: z.union([
                z.object({ target: z.literal('allNodes') }),
                z.object({ target: z.literal('specificNodes'), nodeUuids: z.array(z.string()).min(1) }),
            ]),
        },
        (p) => run(() => client.executeNodePlugin(p)),
    );

    server.tool('node_plugins_torrent_truncate', 'Truncate all torrent blocker reports', {}, () =>
        run(() => client.truncateTorrentBlockerReports()),
    );

    server.tool('shared_lists_create', 'Create a shared list', { name: z.string(), config: z.record(z.unknown()) }, (p) =>
        run(() => client.createSharedList(p)),
    );

    server.tool('shared_lists_update', 'Update a shared list', { name: z.string(), config: z.record(z.unknown()) }, (p) =>
        run(() => client.updateSharedList(p)),
    );

    server.tool('shared_lists_sync', 'Push a shared list to nodes', { name: z.string() }, ({ name }) => run(() => client.syncSharedList(name)));
}
