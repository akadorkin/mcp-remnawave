import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

const SUBSCRIPTION_TYPES = ['XRAY_JSON', 'XRAY_BASE64', 'MIHOMO', 'STASH', 'CLASH', 'SINGBOX'] as const;
const ALPN = ['h3', 'h2', 'http/1.1', 'h2,http/1.1', 'h3,h2,http/1.1', 'h3,h2'] as const;
const SECURITY = ['DEFAULT', 'TLS', 'NONE'] as const;
const MIHOMO_IP = ['dual', 'ipv4', 'ipv6', 'ipv4-prefer', 'ipv6-prefer'] as const;

/** Optional host fields shared by create / update / bulk update. */
const hostFields = {
    remark: z.string().optional().describe('Host remark/name'),
    address: z.string().optional().describe('Host address'),
    port: z.number().optional().describe('Host port'),
    configProfileUuid: z.string().optional().describe('Config profile UUID (inbound.configProfileUuid)'),
    configProfileInboundUuid: z.string().optional().describe('Inbound UUID (inbound.configProfileInboundUuid)'),
    path: z.string().optional(),
    sni: z.string().optional(),
    host: z.string().optional().describe('Host header'),
    alpn: z.enum(ALPN).optional(),
    fingerprint: z.string().optional().describe('uTLS fingerprint (chrome, firefox, safari, ios, android, edge, qq, random, randomized)'),
    isDisabled: z.boolean().optional(),
    isHidden: z.boolean().optional().describe('Hide from subscription list'),
    securityLayer: z.enum(SECURITY).optional(),
    tags: z.array(z.string()).optional().describe('Host tags'),
    serverDescription: z.string().optional(),
    nodes: z.array(z.string()).optional().describe('Node UUIDs this host is bound to'),
    excludeFromSubscriptionTypes: z.array(z.enum(SUBSCRIPTION_TYPES)).optional(),
    xrayJsonTemplateUuid: z.string().optional(),
    internalSquadsMode: z.enum(['EXCLUDE', 'ALLOW_ONLY']).optional().describe('How internalSquads is applied'),
    internalSquads: z.array(z.string()).optional().describe('Internal squad UUIDs (used with internalSquadsMode)'),
    overrideSniFromAddress: z.boolean().optional(),
    keepSniBlank: z.boolean().optional(),
    pinnedPeerCertSha256: z.string().optional(),
    verifyPeerCertByName: z.string().optional(),
    vlessRouteId: z.number().optional().describe('VLESS route ID (0-65535)'),
    shuffleHost: z.boolean().optional(),
    mihomoX25519: z.boolean().optional(),
    mihomoIpVersion: z.enum(MIHOMO_IP).optional(),
    xhttpExtraParams: z.unknown().optional().describe('Raw xhttp extra params object'),
    muxParams: z.unknown().optional(),
    sockoptParams: z.unknown().optional(),
    finalMask: z.unknown().optional(),
    mapper: z.unknown().optional().describe('Per-format field mapper {xrayJson,mihomo,base64,singbox: [{op,from,to,value}]}'),
};

/** Turn flat tool params into the panel host body. */
function toHostBody(params: Record<string, unknown>): Record<string, unknown> {
    const { configProfileUuid, configProfileInboundUuid, internalSquadsMode, internalSquads, ...rest } = params;
    const body: Record<string, unknown> = { ...rest };
    if (configProfileUuid !== undefined || configProfileInboundUuid !== undefined) {
        body.inbound = { configProfileUuid, configProfileInboundUuid };
    }
    if (internalSquads !== undefined || internalSquadsMode !== undefined) {
        body.internalSquads = { mode: internalSquadsMode ?? 'EXCLUDE', squads: internalSquads ?? [] };
    }
    return body;
}

export function registerHostTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool('hosts_list', 'List all hosts', {}, () => run(() => client.getHosts()));

    server.tool('hosts_get', 'Get a host by UUID', { uuid: z.string() }, ({ uuid }) =>
        run(() => client.getHostByUuid(uuid)),
    );

    server.tool('hosts_tags_list', 'List all host tags', {}, () => run(() => client.getHostTags()));

    if (readonly) return;

    server.tool(
        'hosts_create',
        'Create a host. Requires remark, address, port, configProfileUuid and configProfileInboundUuid.',
        {
            ...hostFields,
            remark: z.string().describe('Host remark/name'),
            address: z.string().describe('Host address'),
            port: z.number().describe('Host port'),
            configProfileUuid: z.string().describe('Config profile UUID'),
            configProfileInboundUuid: z.string().describe('Inbound UUID inside the profile'),
        },
        (p) => run(() => client.createHost(toHostBody(p))),
    );

    server.tool(
        'hosts_update',
        'Update a host (only the provided fields change)',
        { uuid: z.string().describe('Host UUID'), ...hostFields },
        (p) => run(() => client.updateHost(toHostBody(p))),
    );

    server.tool('hosts_delete', 'Delete a host', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            await client.deleteHost(uuid);
            return { success: true, message: `Host ${uuid} deleted` };
        }),
    );

    server.tool(
        'hosts_reorder',
        'Reorder hosts',
        {
            hosts: z.array(z.object({ viewPosition: z.number(), uuid: z.string() })),
        },
        ({ hosts }) => run(() => client.reorderHosts(hosts)),
    );

    server.tool('hosts_bulk_enable', 'Enable selected hosts', { uuids: z.array(z.string()) }, (p) =>
        run(() => client.bulkEnableHosts(p)),
    );
    server.tool('hosts_bulk_disable', 'Disable selected hosts', { uuids: z.array(z.string()) }, (p) =>
        run(() => client.bulkDisableHosts(p)),
    );
    server.tool('hosts_bulk_delete', 'Delete selected hosts', { uuids: z.array(z.string()) }, (p) =>
        run(() => client.bulkDeleteHosts(p)),
    );

    server.tool(
        'hosts_bulk_update',
        'Apply the same field values to selected hosts (replaces the old set-inbound / set-port tools)',
        { uuids: z.array(z.string()).describe('Host UUIDs'), ...hostFields },
        (p) => run(() => client.bulkUpdateHosts(toHostBody(p))),
    );
}
