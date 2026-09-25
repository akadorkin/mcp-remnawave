import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Any, Host, Profile, Squad, Template } from '../core/fleet.js';
import { applyParams, Ctx, journaled, PlanTarget, runPlan } from '../core/plan.js';
import { run } from './helpers.js';
import { hostView } from './hosts.js';
import { profileTarget } from './inbounds.js';
import { templateTarget } from './subscriptions.js';

const HOST_RESTORABLE = [
    'remark', 'address', 'port', 'path', 'sni', 'host', 'alpn', 'fingerprint', 'isDisabled', 'isHidden', 'securityLayer', 'serverDescription', 'tags', 'nodes',
    'inbound', 'xrayJsonTemplateUuid', 'excludeFromSubscriptionTypes', 'overrideSniFromAddress', 'keepSniBlank', 'shuffleHost', 'mihomoX25519', 'vlessRouteId',
    'xhttpExtraParams', 'muxParams', 'sockoptParams', 'finalMask', 'mapper', 'pinnedPeerCertSha256', 'verifyPeerCertByName', 'mihomoIpVersion', 'internalSquads',
];

export function registerMaintenanceTools(server: McpServer, ctx: Ctx) {
    const { client, fleet, state } = ctx;

    server.tool(
        'journal_list',
        'What this server changed on the panel: the write journal (newest first) with the backup file of each change',
        { limit: z.number().int().default(30), contains: z.string().optional().describe('Substring filter (tool, target, summary)') },
        ({ limit, contains }) => run(async () => ({ file: state.journalFile, entries: state.journal(limit, contains) })),
    );

    server.tool(
        'backups_list',
        'Backups taken before writes (profiles, templates, hosts, nodes, squads), newest first',
        { kind: z.enum(['config-profile', 'sub-template', 'host', 'node', 'squad', 'other']).optional(), contains: z.string().optional(), limit: z.number().int().default(30) },
        ({ kind, contains, limit }) => run(async () => ({ dir: state.backupDir, backups: state.listBackups({ kind, contains }, limit) })),
    );

    if (ctx.config.readonly) return;

    server.tool(
        'backup_restore',
        'Roll an object back to a backup made by this server: config profile, template, host(s), squad inbounds, node inbound bindings, or hosts order. Dry run shows the diff against the current state; apply with planHash. Deleted hosts are recreated (with new uuids — uuid pools must then be fixed with pools_edit).',
        {
            file: z.string().describe('Backup file path (from backups_list / journal_list)'),
            allowInboundRemoval: z.boolean().default(false),
            ...applyParams,
        },
        (p) =>
            run(() =>
                runPlan(ctx, 'backup_restore', p, async () => {
                    const rec = state.readBackup(p.file);
                    const idx = await fleet.index();
                    switch (rec.kind) {
                        case 'config-profile': {
                            const b = rec.data as Profile;
                            const cur = idx.profileByUuid.get(b.uuid);
                            if (!cur) throw new Error(`profile ${b.name} no longer exists; recreate with config_profiles_create (inbounds get new uuids)`);
                            return [profileTarget(ctx, idx, cur, b.config, p.allowInboundRemoval)];
                        }
                        case 'sub-template': {
                            const b = rec.data as Template;
                            const cur = await fleet.template(b.uuid, true);
                            const after = b.templateJson ?? { yaml: Buffer.from(b.encodedTemplateYaml ?? '', 'base64').toString('utf8') };
                            return [templateTarget(ctx, idx, cur, after, 0)];
                        }
                        case 'host': {
                            const list = (Array.isArray(rec.data) ? rec.data : [rec.data]) as Host[];
                            return list.map((b): PlanTarget => {
                                const keys = HOST_RESTORABLE.filter((k) => b[k] !== undefined);
                                const body: Any = {};
                                for (const k of keys) body[k] = b[k];
                                const cur = idx.hostByUuid.get(b.uuid);
                                if (!cur) {
                                    return {
                                        kind: 'host',
                                        uuid: `recreate-${b.uuid.slice(0, 8)}`,
                                        name: b.remark,
                                        create: true,
                                        backup: null,
                                        before: null,
                                        after: hostView(idx, b, ['remark', 'address', 'port', 'inbound', 'nodes', 'tags', 'isHidden', 'isDisabled']),
                                        warnings: [`host ${b.uuid} was deleted: it is recreated with a NEW uuid; uuid pools that listed it need pools_edit`],
                                        write: () => client.createHost(body),
                                    };
                                }
                                return {
                                    kind: 'host',
                                    uuid: b.uuid,
                                    name: b.remark,
                                    backup: cur,
                                    before: hostView(idx, cur, keys),
                                    after: hostView(idx, b, keys),
                                    write: () => client.updateHost({ uuid: b.uuid, ...body }),
                                    readBack: async () => hostView(idx, ((await client.getHostByUuid(b.uuid)) as Any).response, keys),
                                };
                            });
                        }
                        case 'squad': {
                            const b = rec.data as Squad;
                            const cur = idx.squadByUuid.get(b.uuid);
                            if (!cur) throw new Error(`squad ${b.name} no longer exists`);
                            const tags = (b.inbounds ?? []).map((i) => i.tag);
                            const missing = tags.filter((t) => !idx.inboundsByTag.has(t));
                            return [
                                {
                                    kind: 'squad',
                                    uuid: b.uuid,
                                    name: b.name,
                                    backup: cur,
                                    before: { name: cur.name, inbounds: (cur.inbounds ?? []).map((i) => i.tag).sort() },
                                    after: { name: b.name, inbounds: tags.filter((t) => idx.inboundsByTag.has(t)).sort() },
                                    warnings: missing.length ? [`inbounds that no longer exist are skipped: ${missing.join(', ')}`] : [],
                                    write: () => client.updateInternalSquad({ uuid: b.uuid, name: b.name, inbounds: tags.filter((t) => idx.inboundsByTag.has(t)).map((t) => idx.inbound(t).uuid) }),
                                },
                            ];
                        }
                        case 'node': {
                            const raw = rec.data as Any;
                            const nodes = (Array.isArray(raw) ? raw : raw.node ? [raw.node] : [raw]) as Any[];
                            return nodes.map((b): PlanTarget => {
                                const cur = idx.nodeByUuid.get(b.uuid);
                                if (!cur) throw new Error(`node ${b.name} was deleted; its history is gone — recreate it with nodes_create`);
                                const tags = ((b.configProfile?.activeInbounds ?? []) as Any[]).map((i) => i.tag).filter((t) => idx.inboundsByTag.has(t));
                                const prof = b.configProfile?.activeConfigProfileUuid;
                                return {
                                    kind: 'node',
                                    uuid: b.uuid,
                                    name: b.name,
                                    backup: cur,
                                    before: { profile: cur.configProfile?.activeConfigProfileUuid, inbounds: (cur.configProfile?.activeInbounds ?? []).map((i) => i.tag).sort() },
                                    after: { profile: prof, inbounds: [...tags].sort() },
                                    info: { note: 'restores the profile + inbound bindings; other node fields are left as they are' },
                                    write: () => client.updateNode({ uuid: b.uuid, configProfile: { activeConfigProfileUuid: prof, activeInbounds: tags.map((t) => idx.inbound(t).uuid) } }),
                                };
                            });
                        }
                        default: {
                            const list = rec.data as Array<{ uuid: string; viewPosition: number }>;
                            if (!Array.isArray(list) || list[0]?.viewPosition === undefined) throw new Error('this backup kind cannot be restored automatically');
                            const known = list.filter((x) => idx.hostByUuid.has(x.uuid)).sort((a, b) => a.viewPosition - b.viewPosition);
                            const extra = idx.hostsSorted.filter((h) => !known.some((k) => k.uuid === h.uuid));
                            const order = [...known.map((k) => k.uuid), ...extra.map((h) => h.uuid)];
                            return [
                                {
                                    kind: 'other',
                                    uuid: 'hosts-order',
                                    name: 'hosts order',
                                    backup: idx.hostsSorted.map((h) => ({ uuid: h.uuid, viewPosition: h.viewPosition, remark: h.remark })),
                                    before: idx.hostsSorted.map((h) => h.uuid),
                                    after: order,
                                    write: () => client.reorderHosts(order.map((u, i) => ({ uuid: u, viewPosition: i }))),
                                },
                            ];
                        }
                    }
                }),
            ),
    );

    server.tool(
        'api_request',
        'Escape hatch: call any panel REST route (path must start with /api/). Use only when no dedicated tool exists. GET is always allowed; other methods are journaled. Output goes through the same redaction and size limits.',
        {
            method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']),
            path: z.string().regex(/^\/api\//),
            query: z.record(z.unknown()).optional(),
            body: z.unknown().optional(),
        },
        ({ method, path, query, body }) =>
            run(async () => {
                if (method === 'GET') return client.request('GET', path, undefined, query);
                const { result } = await journaled(ctx, 'api_request', `${method} ${path}`, body === undefined ? 'no body' : JSON.stringify(body).slice(0, 200), () =>
                    client.request(method, path, body, query),
                );
                return result;
            }),
    );
}
