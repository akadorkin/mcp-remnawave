import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

export function registerSubscriptionTools(server: McpServer, client: RemnawaveClient) {
    server.tool(
        'subscriptions_list',
        'List subscriptions with pagination',
        { start: z.number().int().default(0), size: z.number().int().default(25) },
        ({ start, size }) => run(() => client.getSubscriptions(start, size)),
    );

    server.tool('subscriptions_get_by_id', 'Get subscription of a user by numeric user id', { userId: z.number().int() }, ({ userId }) =>
        run(() => client.getSubscriptionById(userId)),
    );

    server.tool('subscriptions_get_by_username', 'Get subscription by username', { username: z.string() }, ({ username }) =>
        run(() => client.getSubscriptionByUsername(username)),
    );

    server.tool('subscriptions_get_by_short_uuid', 'Get subscription by short UUID', { shortUuid: z.string() }, ({ shortUuid }) =>
        run(() => client.getSubscriptionByShortUuid(shortUuid)),
    );

    server.tool('subscription_info', 'Public subscription info (what the client app sees) by short UUID', { shortUuid: z.string() }, ({ shortUuid }) =>
        run(() => client.getSubscriptionInfo(shortUuid)),
    );

    server.tool(
        'subscriptions_get_raw_by_short_uuid',
        'Raw subscription (hosts with resolved links) by short UUID',
        { shortUuid: z.string(), withDisabledHosts: z.boolean().optional() },
        ({ shortUuid, withDisabledHosts }) => run(() => client.getSubscriptionByShortUuidRaw(shortUuid, withDisabledHosts)),
    );

    server.tool('subscriptions_get_subpage_config', 'Subscription page config served for a short UUID', { shortUuid: z.string() }, ({ shortUuid }) =>
        run(() => client.getSubscriptionSubpageConfig(shortUuid)),
    );

    server.tool('subscriptions_get_connection_keys', 'Connection keys (links) of a user by numeric user id', { userId: z.number().int() }, ({ userId }) =>
        run(() => client.getConnectionKeysByUserId(userId)),
    );

    server.tool(
        'subscription_request_history_list',
        'Subscription request history (paginated, filterable)',
        {
            start: z.number().int().default(0),
            size: z.number().int().default(50),
            filters: z.array(z.object({ id: z.string(), value: z.string() })).optional(),
            sorting: z.array(z.object({ id: z.string(), desc: z.boolean() })).optional(),
        },
        (p) => run(() => client.getSubscriptionRequestHistory(p)),
    );

    server.tool('subscription_request_history_stats', 'Subscription request history statistics', {}, () =>
        run(() => client.getSubscriptionRequestHistoryStats()),
    );

    server.tool('sub_templates_list', 'List subscription templates', {}, () => run(() => client.getSubscriptionTemplates()));
    server.tool('sub_templates_get', 'Get a subscription template by UUID', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getSubscriptionTemplate(uuid)),
    );
    server.tool('sub_settings_get', 'Get global subscription settings', {}, () => run(() => client.getSubscriptionSettings()));
}
