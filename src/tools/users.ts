import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

const USER_STATUS = ['ACTIVE', 'DISABLED', 'LIMITED', 'EXPIRED'] as const;
const TRAFFIC_STRATEGY = ['NO_RESET', 'DAY', 'WEEK', 'MONTH', 'MONTH_ROLLING'] as const;

const userId = z.number().int().describe('Numeric user id (field `id` in API responses; NOT the vlessUuid)');

export function registerUserTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool(
        'users_list',
        'List Remnawave VPN users with pagination and optional column filters (exact match). Filter ids known to work: telegramId, vlessUuid, email, tag, status.',
        {
            start: z.number().int().default(0).describe('Offset for pagination'),
            size: z.number().int().default(25).describe('Number of users to return (max 500)'),
            filters: z
                .array(z.object({ id: z.string(), value: z.string() }))
                .optional()
                .describe('Column filters, e.g. [{"id":"telegramId","value":"123456"}]'),
            sorting: z
                .array(z.object({ id: z.string(), desc: z.boolean() }))
                .optional()
                .describe('Sorting, e.g. [{"id":"createdAt","desc":true}]'),
        },
        (p) => run(() => client.getUsers(p)),
    );

    server.tool(
        'users_find',
        'Find users by an exact attribute value: telegramId, email, tag or vlessUuid. Shortcut over users_list filters.',
        {
            field: z.enum(['telegramId', 'email', 'tag', 'vlessUuid', 'status']).describe('Attribute to match'),
            value: z.string().describe('Exact value'),
            size: z.number().int().default(100).describe('Max results'),
        },
        ({ field, value, size }) =>
            run(() => client.getUsers({ start: 0, size, filters: [{ id: field, value }] })),
    );

    server.tool(
        'users_stream',
        'Cursor-based export of users, optionally filtered by status/strategy/telegramId/email/tag/externalSquadUuid. Use for iterating over all users.',
        {
            cursor: z.number().int().optional().describe('Cursor from previous call (last user id)'),
            size: z.number().int().optional().describe('Page size'),
            status: z.enum(USER_STATUS).optional(),
            trafficLimitStrategy: z.enum(TRAFFIC_STRATEGY).optional(),
            telegramId: z.string().optional(),
            email: z.string().optional(),
            tag: z.string().optional(),
            externalSquadUuid: z.string().optional(),
        },
        (p) => run(() => client.streamUsers(p)),
    );

    server.tool('users_get', 'Get a user by numeric id', { id: userId }, ({ id }) => run(() => client.getUserById(id)));

    server.tool(
        'users_get_by_username',
        'Get a user by username',
        { username: z.string().describe('Username') },
        ({ username }) => run(() => client.getUserByUsername(username)),
    );

    server.tool(
        'users_get_by_short_uuid',
        'Get a user by subscription short UUID',
        { shortUuid: z.string().describe('Short UUID') },
        ({ shortUuid }) => run(() => client.getUserByShortUuid(shortUuid)),
    );

    server.tool('users_tags_list', 'List all user tags', {}, () => run(() => client.getUserTags()));

    server.tool(
        'users_resolve',
        'Resolve a user by exactly one of: id, shortUuid, username',
        {
            id: z.number().int().optional().describe('Numeric user id'),
            shortUuid: z.string().optional().describe('Short UUID'),
            username: z.string().optional().describe('Username'),
        },
        (p) => run(() => client.resolveUsers(p)),
    );

    server.tool(
        'users_accessible_nodes',
        'List nodes a user can connect to (via their internal squads)',
        { id: userId },
        ({ id }) => run(() => client.getUserAccessibleNodes(id)),
    );

    server.tool(
        'users_subscription_request_history',
        'Subscription fetch history (client apps, IPs, user agents) for a user',
        { id: userId },
        ({ id }) => run(() => client.getUserSubscriptionRequestHistory(id)),
    );

    if (readonly) return;

    server.tool(
        'users_create',
        'Create a new VPN user',
        {
            username: z.string().describe('Unique username'),
            expireAt: z.string().describe('Expiration date in ISO 8601 format'),
            status: z.enum(USER_STATUS).optional().describe('Initial status'),
            trafficLimitBytes: z.number().optional().describe('Traffic limit in bytes (0 = unlimited)'),
            trafficLimitStrategy: z.enum(TRAFFIC_STRATEGY).optional().describe('Traffic reset period'),
            description: z.string().optional(),
            tag: z.string().optional().describe('User tag for grouping'),
            telegramId: z.number().optional().describe('Telegram user ID'),
            email: z.string().optional(),
            hwidDeviceLimit: z.number().optional().describe('Max number of HWID devices'),
            activeInternalSquads: z.array(z.string()).optional().describe('Internal squad UUIDs'),
            externalSquadUuid: z.string().optional(),
            shortUuid: z.string().optional().describe('Custom subscription short UUID'),
            vlessUuid: z.string().optional().describe('Custom VLESS UUID'),
            trojanPassword: z.string().optional(),
            ssPassword: z.string().optional(),
            createdAt: z.string().optional().describe('Override creation date (ISO 8601)'),
            lastTrafficResetAt: z.string().optional(),
        },
        (p) => run(() => client.createUser(p)),
    );

    server.tool(
        'users_update',
        'Update an existing user (identify by id or username)',
        {
            id: z.number().int().optional().describe('Numeric user id'),
            username: z.string().optional().describe('Username (alternative identifier)'),
            status: z.enum(['ACTIVE', 'DISABLED']).optional(),
            expireAt: z.string().optional().describe('New expiration date (ISO 8601)'),
            trafficLimitBytes: z.number().optional(),
            trafficLimitStrategy: z.enum(TRAFFIC_STRATEGY).optional(),
            description: z.string().optional(),
            tag: z.string().optional(),
            telegramId: z.number().optional(),
            email: z.string().optional(),
            hwidDeviceLimit: z.number().optional(),
            activeInternalSquads: z.array(z.string()).optional().describe('Internal squad UUIDs (replaces the set)'),
            externalSquadUuid: z.string().optional(),
        },
        (p) => run(() => client.updateUser(p)),
    );

    server.tool('users_delete', 'Delete a user', { id: userId }, ({ id }) =>
        run(async () => {
            await client.deleteUser(id);
            return { success: true, message: `User ${id} deleted` };
        }),
    );

    server.tool('users_enable', 'Enable a disabled user', { id: userId }, ({ id }) => run(() => client.enableUser(id)));
    server.tool('users_disable', 'Disable a user', { id: userId }, ({ id }) => run(() => client.disableUser(id)));

    server.tool(
        'users_revoke_subscription',
        'Revoke subscription: regenerates the short UUID and credentials (or only passwords)',
        {
            id: userId,
            revokeOnlyPasswords: z.boolean().optional().describe('Keep short UUID, rotate only credentials'),
            shortUuid: z.string().optional().describe('Set a specific new short UUID'),
        },
        ({ id, ...body }) => run(() => client.revokeUserSubscription(id, body)),
    );

    server.tool('users_reset_traffic', 'Reset traffic counter of a user', { id: userId }, ({ id }) =>
        run(() => client.resetUserTraffic(id)),
    );

    server.tool(
        'users_extend',
        'Extend expiration date of a user by N days',
        { id: userId, days: z.number().int().describe('Days to add') },
        ({ id, days }) => run(() => client.extendUser(id, days)),
    );

    server.tool(
        'users_bulk_delete_by_status',
        'Delete all users with the given status',
        { status: z.enum(USER_STATUS) },
        (p) => run(() => client.bulkDeleteUsersByStatus(p)),
    );

    server.tool(
        'users_bulk_update',
        'Bulk update fields for selected users',
        {
            userIds: z.array(z.number().int()).describe('Numeric user ids'),
            status: z.enum(USER_STATUS).optional(),
            expireAt: z.string().optional(),
            trafficLimitBytes: z.number().optional(),
            trafficLimitStrategy: z.enum(TRAFFIC_STRATEGY).optional(),
            description: z.string().optional(),
            telegramId: z.number().optional(),
            email: z.string().optional(),
            tag: z.string().optional(),
            hwidDeviceLimit: z.number().optional(),
            externalSquadUuid: z.string().optional(),
        },
        ({ userIds, ...fields }) => run(() => client.bulkUpdateUsers({ userIds, fields })),
    );

    server.tool(
        'users_bulk_reset_traffic',
        'Reset traffic for selected users',
        { userIds: z.array(z.number().int()) },
        (p) => run(() => client.bulkResetUsersTraffic(p)),
    );

    server.tool(
        'users_bulk_revoke_subscription',
        'Revoke subscriptions for selected users',
        { userIds: z.array(z.number().int()) },
        (p) => run(() => client.bulkRevokeUsersSubscription(p)),
    );

    server.tool('users_bulk_delete', 'Delete selected users', { userIds: z.array(z.number().int()) }, (p) =>
        run(() => client.bulkDeleteUsers(p)),
    );

    server.tool(
        'users_bulk_update_squads',
        'Set internal squads for selected users',
        {
            userIds: z.array(z.number().int()),
            activeInternalSquads: z.array(z.string()).describe('Internal squad UUIDs'),
        },
        (p) => run(() => client.bulkUpdateUserSquads(p)),
    );

    server.tool(
        'users_bulk_extend_expiration',
        'Extend expiration date for selected users',
        { userIds: z.array(z.number().int()), extendDays: z.number().int() },
        (p) => run(() => client.bulkExtendUsersExpiration(p)),
    );

    server.tool(
        'users_bulk_all_update',
        'Update ALL users at once',
        {
            status: z.enum(USER_STATUS).optional(),
            expireAt: z.string().optional(),
            trafficLimitBytes: z.number().optional(),
            trafficLimitStrategy: z.enum(TRAFFIC_STRATEGY).optional(),
            description: z.string().optional(),
            telegramId: z.number().optional(),
            email: z.string().optional(),
            tag: z.string().optional(),
            hwidDeviceLimit: z.number().optional(),
        },
        (p) => run(() => client.bulkAllUpdateUsers(p)),
    );

    server.tool('users_bulk_all_reset_traffic', 'Reset traffic counters for ALL users', {}, () =>
        run(() => client.bulkAllResetUsersTraffic()),
    );

    server.tool(
        'users_bulk_all_extend_expiration',
        'Extend expiration date for ALL users',
        { extendDays: z.number().int() },
        (p) => run(() => client.bulkAllExtendUsersExpiration(p)),
    );
}
