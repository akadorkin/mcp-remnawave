import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

const userId = z.number().int().describe('Numeric user id');

export function registerHwidTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('hwid_devices_list', 'List HWID devices of a user', { userId }, ({ userId }) =>
        run(() => client.getUserHwidDevices(userId)),
    );

    server.tool(
        'hwid_devices_list_all',
        'List HWID devices across all users (paginated)',
        {
            start: z.number().int().default(0),
            size: z.number().int().default(50),
            filters: z.array(z.object({ id: z.string(), value: z.string() })).optional(),
        },
        (p) => run(() => client.getAllHwidDevices(p)),
    );

    server.tool('hwid_stats', 'HWID device statistics', {}, () => run(() => client.getHwidStats()));

    server.tool(
        'hwid_top_users',
        'Users with the most HWID devices',
        { start: z.number().int().default(0), size: z.number().int().default(25) },
        (p) => run(() => client.getHwidTopUsers(p)),
    );

    if (readonly) return;

    server.tool(
        'hwid_device_create',
        'Register a HWID device for a user',
        {
            userId,
            hwid: z.string().describe('Hardware ID'),
            platform: z.string().optional(),
            osVersion: z.string().optional(),
            deviceModel: z.string().optional(),
            userAgent: z.string().optional(),
            requestIp: z.string().optional(),
        },
        (p) => run(() => client.createUserHwidDevice(p)),
    );

    server.tool('hwid_device_delete', 'Delete one HWID device of a user', { userId, hwid: z.string() }, ({ userId, hwid }) =>
        run(() => client.deleteHwidDevice(userId, hwid)),
    );

    server.tool('hwid_devices_delete_all', 'Delete all HWID devices of a user', { userId }, ({ userId }) =>
        run(() => client.deleteAllUserHwidDevices(userId)),
    );
}
