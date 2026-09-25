import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Any, FleetIndex, Host } from '../core/fleet.js';
import { compactImpact, filterHosts, hostFilterSchema, hypothetical, poolImpact } from '../core/hostops.js';
import { applyParams, assertValid, Ctx, journaled, PlanTarget, runPlan } from '../core/plan.js';
import { contractIssues } from '../core/validate.js';
import { run } from './helpers.js';

const SUBSCRIPTION_TYPES = ['XRAY_JSON', 'XRAY_BASE64', 'MIHOMO', 'STASH', 'CLASH', 'SINGBOX'] as const;
const ALPN = ['h3', 'h2', 'http/1.1', 'h2,http/1.1', 'h3,h2,http/1.1', 'h3,h2'] as const;
const SECURITY = ['DEFAULT', 'TLS', 'NONE'] as const;
const MIHOMO_IP = ['dual', 'ipv4', 'ipv6', 'ipv4-prefer', 'ipv6-prefer'] as const;
const TEXT_FIELDS = ['remark', 'address', 'sni', 'host', 'path', 'serverDescription'] as const;

/** Optional host fields shared by create / update / bulk edits. Inbound and nodes are given by tag / name. */
const hostFields = {
    remark: z.string().optional().describe('Host remark/name (1-100 chars)'),
    address: z.string().optional().describe('Host address'),
    port: z.number().optional().describe('Host port'),
    inboundTag: z.string().optional().describe('Inbound tag (or uuid) to bind; its profile is filled in automatically'),
    path: z.string().nullable().optional(),
    sni: z.string().nullable().optional(),
    host: z.string().nullable().optional().describe('Host header'),
    alpn: z.enum(ALPN).nullable().optional(),
    fingerprint: z.string().nullable().optional().describe('uTLS fingerprint (chrome, firefox, safari, ios, android, edge, qq, random, randomized)'),
    isDisabled: z.boolean().optional(),
    isHidden: z.boolean().optional().describe('Hidden hosts are not listed in subscriptions but can be injected into pools'),
    securityLayer: z.enum(SECURITY).optional(),
    tags: z.array(z.string()).optional().describe('Host tags (A-Z0-9_: only, max 10); pools select by these'),
    serverDescription: z.string().nullable().optional().describe('Max 30 chars'),
    nodes: z.array(z.string()).optional().describe('Node names/uuids this host is bound to (replaces the list)'),
    excludeFromSubscriptionTypes: z.array(z.enum(SUBSCRIPTION_TYPES)).optional(),
    xrayJsonTemplate: z.string().nullable().optional().describe('XRAY_JSON template name/uuid the host renders with'),
    internalSquadsMode: z.enum(['EXCLUDE', 'ALLOW_ONLY']).optional(),
    internalSquads: z.array(z.string()).optional().describe('Internal squad names/uuids (with internalSquadsMode)'),
    overrideSniFromAddress: z.boolean().optional(),
    keepSniBlank: z.boolean().optional(),
    pinnedPeerCertSha256: z.string().nullable().optional(),
    verifyPeerCertByName: z.string().nullable().optional(),
    vlessRouteId: z.number().nullable().optional().describe('VLESS route ID (0-65535)'),
    shuffleHost: z.boolean().optional(),
    mihomoX25519: z.boolean().optional(),
    mihomoIpVersion: z.enum(MIHOMO_IP).nullable().optional(),
    xhttpExtraParams: z.unknown().optional().describe('Raw xhttp extra params object'),
    muxParams: z.unknown().optional(),
    sockoptParams: z.unknown().optional(),
    finalMask: z.unknown().optional(),
    mapper: z.unknown().optional().describe('Per-format field mapper'),
};
type HostFieldParams = { [K in keyof typeof hostFields]?: unknown };

/** Translate friendly params (tags/names) into the panel's host body. */
async function toHostBody(ctx: Ctx, idx: FleetIndex, p: HostFieldParams): Promise<Record<string, unknown>> {
    const { inboundTag, nodes, xrayJsonTemplate, internalSquadsMode, internalSquads, ...rest } = p;
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
    if (inboundTag !== undefined) {
        const ib = idx.inbound(String(inboundTag));
        body.inbound = { configProfileUuid: ib.profileUuid, configProfileInboundUuid: ib.uuid };
    }
    if (nodes !== undefined) body.nodes = (nodes as string[]).map((n) => idx.node(n).uuid);
    if (xrayJsonTemplate !== undefined) body.xrayJsonTemplateUuid = xrayJsonTemplate === null ? null : (await ctx.fleet.findTemplate(String(xrayJsonTemplate))).uuid;
    if (internalSquads !== undefined || internalSquadsMode !== undefined) {
        body.internalSquads = {
            mode: internalSquadsMode ?? 'EXCLUDE',
            squads: ((internalSquads as string[] | undefined) ?? []).map((s) => idx.squad(s).uuid),
        };
    }
    return body;
}

/** The comparable projection of a host (names instead of uuids) used in diffs. */
export function hostView(idx: FleetIndex, h: Any, keys: string[]): Any {
    const v: Any = {};
    for (const k of keys) {
        if (k === 'nodes') v.nodes = ((h.nodes ?? []) as string[]).map((u) => idx.nodeName(u)).sort();
        else if (k === 'inbound') v.inbound = idx.inboundByUuid.get(h.inbound?.configProfileInboundUuid ?? '')?.tag ?? h.inbound?.configProfileInboundUuid ?? null;
        else v[k] = h[k] ?? null;
    }
    return v;
}

function bodyToKeys(body: Record<string, unknown>): string[] {
    return Object.keys(body).filter((k) => k !== 'uuid');
}

async function loadTemplatesForImpact(ctx: Ctx) {
    return ctx.fleet.templates({ type: 'XRAY_JSON' });
}

export function registerHostTools(server: McpServer, ctx: Ctx) {
    const { client, fleet } = ctx;
    const readonly = ctx.config.readonly;

    server.tool(
        'hosts_list',
        'Find hosts. Compact rows with inbound tag, profile and node names resolved. All filter fields are optional and combined with AND (no filter = every host, sorted by position).',
        {
            filter: hostFilterSchema.optional(),
            limit: z.number().int().default(150),
            fields: z.array(z.string()).optional().describe('Extra raw host fields to include per row (e.g. alpn, fingerprint, xrayJsonTemplateUuid)'),
            view: z.enum(['compact', 'full']).default('compact'),
        },
        ({ filter, limit, fields, view }) =>
            run(async () => {
                const idx = await fleet.index();
                const hs = await filterHosts(fleet, idx, filter ?? {});
                const rows = view === 'full' ? hs.slice(0, limit) : hs.slice(0, limit).map((h) => idx.hostRow(h, fields));
                return { total: hs.length, shown: rows.length, hosts: rows };
            }),
    );

    server.tool('hosts_get', 'Get one host (raw panel object plus resolved inbound tag / node names)', { uuid: z.string() }, ({ uuid }) =>
        run(async () => {
            const idx = await fleet.index();
            const h = idx.host(uuid);
            return { ...h, _resolved: idx.hostRow(h) };
        }),
    );

    server.tool('hosts_tags_list', 'List all host tags', {}, () => run(() => client.getHostTags()));

    if (readonly) return;

    server.tool(
        'hosts_create',
        'Create a host. Inbound by tag, nodes by name; the body is checked against the panel contract before sending (reports e.g. "serverDescription: max 30").',
        {
            ...hostFields,
            remark: z.string().describe('Host remark/name'),
            address: z.string().describe('Host address'),
            port: z.number().describe('Host port'),
            inboundTag: z.string().describe('Inbound tag (or uuid)'),
            afterHost: z.string().optional().describe('Place the new host right after this host uuid (default: end of list)'),
        },
        ({ afterHost, ...p }) =>
            run(async () => {
                const idx = await fleet.index();
                const body = await toHostBody(ctx, idx, p);
                assertValid(contractIssues('createHost', body), 'host');
                const { result } = await journaled(ctx, 'hosts_create', `host ${p.remark}`, `create ${p.address}:${p.port} inbound ${p.inboundTag}`, () => client.createHost(body));
                const created = (result as Any).response as Host;
                let placed: string | undefined;
                if (afterHost) {
                    const now = await fleet.index(true);
                    const order = now.hostsSorted.filter((h) => h.uuid !== created.uuid);
                    const at = order.findIndex((h) => h.uuid === afterHost);
                    if (at < 0) placed = `anchor ${afterHost} not found; left at the end`;
                    else {
                        order.splice(at + 1, 0, now.host(created.uuid));
                        await client.reorderHosts(order.map((h, i) => ({ uuid: h.uuid, viewPosition: i })));
                        placed = `after ${now.host(afterHost).remark}`;
                    }
                }
                const fresh = await fleet.index(true);
                return { created: fresh.hostRow(fresh.host(created.uuid)), placed };
            }),
    );

    server.tool(
        'hosts_update',
        'Update one host (only given fields change). Inbound by tag, nodes by name. Checked against the contract before sending; a backup of the host is kept.',
        { uuid: z.string().describe('Host UUID'), ...hostFields },
        ({ uuid: ref, ...p }) =>
            run(async () => {
                const idx = await fleet.index();
                const h = idx.host(ref);
                const uuid = h.uuid;
                const body = { uuid, ...(await toHostBody(ctx, idx, p)) };
                assertValid(contractIssues('updateHost', body), 'host update');
                const keys = bodyToKeys(body).map((k) => (k === 'inbound' ? 'inbound' : k));
                const before = hostView(idx, h, keys);
                const { backup } = await journaled(ctx, 'hosts_update', `host ${h.remark} ${uuid}`, `fields: ${keys.join(', ')}`, () => client.updateHost(body), {
                    kind: 'host',
                    uuid,
                    name: h.remark,
                    data: h,
                });
                const fresh = await fleet.index(true);
                return { before, after: hostView(fresh, fresh.host(uuid), keys), backup };
            }),
    );

    server.tool(
        'hosts_bulk_edit',
        'Edit many hosts at once: select by filter, then set fields, regex-replace inside text fields (remark/address/sni/host/path/serverDescription), add/remove tags, change nodes, rebind inbound. Dry run shows per-host diffs, contract violations and the effect on template pools (emptied pools block the apply unless allowEmptyPools).',
        {
            filter: hostFilterSchema,
            set: z.object(hostFields).partial().optional().describe('Fields to set on every selected host'),
            replace: z
                .array(
                    z.object({
                        field: z.enum(TEXT_FIELDS),
                        find: z.string(),
                        replace: z.string(),
                        regex: z.boolean().default(false).describe('find is a JS regex (global); $1.. in replace'),
                    }),
                )
                .optional(),
            tagsAdd: z.array(z.string()).optional(),
            tagsRemove: z.array(z.string()).optional(),
            nodesAdd: z.array(z.string()).optional().describe('Node names/uuids to add to each host'),
            nodesRemove: z.array(z.string()).optional(),
            allowEmptyPools: z.boolean().default(false),
            expectCount: z.number().int().optional().describe('Abort if the filter selects a different number of hosts'),
            ...applyParams,
        },
        (p) =>
            run(() =>
                runPlan(ctx, 'hosts_bulk_edit', { ...p, changeLimit: 12 }, async () => {
                    const idx = await fleet.index();
                    const hosts = await filterHosts(fleet, idx, p.filter);
                    if (!hosts.length) throw new Error('filter selects no hosts');
                    if (p.expectCount !== undefined && hosts.length !== p.expectCount) throw new Error(`filter selects ${hosts.length} hosts, expected ${p.expectCount}`);
                    const setBody = p.set ? await toHostBody(ctx, idx, p.set as HostFieldParams) : {};
                    const addNodes = (p.nodesAdd ?? []).map((n) => idx.node(n).uuid);
                    const rmNodes = new Set((p.nodesRemove ?? []).map((n) => idx.node(n).uuid));
                    const changedHosts: Host[] = [];
                    const targets: PlanTarget[] = hosts.map((h) => {
                        const body: Record<string, unknown> = { uuid: h.uuid, ...structuredClone(setBody) };
                        for (const r of p.replace ?? []) {
                            const cur = (body[r.field] ?? h[r.field]) as string | null;
                            if (typeof cur !== 'string') continue;
                            const nv = r.regex ? cur.replace(new RegExp(r.find, 'g'), r.replace) : cur.split(r.find).join(r.replace);
                            if (nv !== cur) body[r.field] = nv;
                        }
                        if (p.tagsAdd || p.tagsRemove) {
                            const base = (body.tags as string[] | undefined) ?? h.tags ?? [];
                            const next = base.filter((t) => !(p.tagsRemove ?? []).includes(t));
                            for (const t of p.tagsAdd ?? []) if (!next.includes(t)) next.push(t);
                            body.tags = next;
                        }
                        if (addNodes.length || rmNodes.size) {
                            const base = (body.nodes as string[] | undefined) ?? h.nodes ?? [];
                            const next = base.filter((u) => !rmNodes.has(u));
                            for (const u of addNodes) if (!next.includes(u)) next.push(u);
                            body.nodes = next;
                        }
                        const keys = bodyToKeys(body);
                        const merged = { ...h, ...body } as Host;
                        changedHosts.push(merged);
                        const before = hostView(idx, h, keys);
                        const after = hostView(idx, merged, keys);
                        // send only what actually differs
                        const sendBody: Record<string, unknown> = { uuid: h.uuid };
                        for (const k of keys) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) sendBody[k] = body[k];
                        const issues = contractIssues('updateHost', sendBody);
                        return {
                            kind: 'host' as const,
                            uuid: h.uuid,
                            name: h.remark,
                            backup: h,
                            before,
                            after,
                            blockers: issues,
                            write: () => client.updateHost(sendBody),
                            readBack: async () => {
                                const r = ((await client.getHostByUuid(h.uuid)) as Any).response as Host;
                                return hostView(idx, r, keys);
                            },
                        };
                    });
                    // pool impact of the whole batch
                    const tpls = await loadTemplatesForImpact(ctx);
                    const imp = poolImpact(idx, hypothetical(idx, changedHosts), tpls);
                    const summary = compactImpact(imp);
                    if (targets.length) {
                        const first = targets[0];
                        first.info = { selected: hosts.length, poolImpact: Object.keys(summary).length ? summary : 'none' };
                        if (imp.emptied.length && !p.allowEmptyPools) first.blockers = [...(first.blockers ?? []), `${imp.emptied.length} pool(s) would become empty (pass allowEmptyPools to proceed)`];
                        if (imp.firstChanged.length) first.warnings = [`${imp.firstChanged.length} pool(s) change their first member / fallback target`];
                    }
                    return targets;
                }),
            ),
    );

    server.tool(
        'hosts_clone',
        'Clone hosts (e.g. every host of an old node onto a new node): select sources by filter, transform text fields by replace rules, set fields/nodes/inbound. Clones are created right after their sources (or at the end). Dry run first. Afterwards use pools_edit to put the clones into uuid pools next to their sources.',
        {
            filter: hostFilterSchema,
            replace: z
                .array(z.object({ field: z.enum(TEXT_FIELDS), find: z.string(), replace: z.string(), regex: z.boolean().default(false) }))
                .optional()
                .describe('Applied to each clone, e.g. {field:"remark",find:"de1",replace:"de2"}'),
            set: z.object(hostFields).partial().optional().describe('Fields forced on every clone (e.g. nodes:["de2"], isHidden:true)'),
            inboundTagReplace: z.object({ find: z.string(), replace: z.string() }).optional().describe('Rebind each clone to the inbound whose tag is the source tag with this replacement'),
            placement: z.enum(['after-source', 'before-source', 'end']).default('after-source'),
            expectCount: z.number().int().optional(),
            ...applyParams,
        },
        (p) =>
            run(async () => {
                const sources: Host[] = [];
                const res = await runPlan(ctx, 'hosts_clone', { ...p, changeLimit: 30 }, async () => {
                    const idx = await fleet.index();
                    const src = await filterHosts(fleet, idx, p.filter);
                    if (!src.length) throw new Error('filter selects no hosts');
                    if (p.expectCount !== undefined && src.length !== p.expectCount) throw new Error(`filter selects ${src.length} hosts, expected ${p.expectCount}`);
                    const setBody = p.set ? await toHostBody(ctx, idx, p.set as HostFieldParams) : {};
                    sources.length = 0;
                    return src.map((h) => {
                        sources.push(h);
                        const body: Record<string, unknown> = {};
                        for (const k of [
                            'remark', 'address', 'port', 'path', 'sni', 'host', 'alpn', 'fingerprint', 'isDisabled', 'isHidden', 'securityLayer', 'xhttpExtraParams', 'muxParams',
                            'sockoptParams', 'finalMask', 'serverDescription', 'tags', 'overrideSniFromAddress', 'keepSniBlank', 'vlessRouteId', 'pinnedPeerCertSha256',
                            'verifyPeerCertByName', 'shuffleHost', 'mihomoX25519', 'mihomoIpVersion', 'nodes', 'xrayJsonTemplateUuid', 'excludeFromSubscriptionTypes', 'internalSquads', 'mapper',
                        ]) {
                            if (h[k] !== undefined && h[k] !== null) body[k] = structuredClone(h[k]);
                        }
                        body.inbound = { ...h.inbound };
                        for (const r of p.replace ?? []) {
                            const cur = body[r.field];
                            if (typeof cur !== 'string') continue;
                            body[r.field] = r.regex ? cur.replace(new RegExp(r.find, 'g'), r.replace) : cur.split(r.find).join(r.replace);
                        }
                        if (p.inboundTagReplace) {
                            const cur = idx.inboundByUuid.get(h.inbound?.configProfileInboundUuid ?? '');
                            if (!cur) throw new Error(`host ${h.remark} has no inbound`);
                            const ib = idx.inbound(cur.tag.split(p.inboundTagReplace.find).join(p.inboundTagReplace.replace));
                            body.inbound = { configProfileUuid: ib.profileUuid, configProfileInboundUuid: ib.uuid };
                        }
                        Object.assign(body, structuredClone(setBody));
                        const view = hostView(idx, body, ['remark', 'address', 'port', 'sni', 'host', 'path', 'inbound', 'nodes', 'tags', 'isHidden', 'isDisabled']);
                        return {
                            kind: 'host' as const,
                            uuid: `new-from-${h.uuid.slice(0, 8)}`,
                            name: String(body.remark),
                            create: true,
                            backup: null,
                            before: null,
                            after: view,
                            info: { source: `${h.remark} (${h.uuid})` },
                            blockers: contractIssues('createHost', body),
                            write: () => client.createHost(body),
                        };
                    });
                });
                if (res.mode !== 'applied' || p.placement === 'end') return res;
                // placement: move each clone next to its source
                const created = (res.results ?? []).map((r) => String(r.uuid));
                const idx = await fleet.index(true);
                const cloneOf = new Map(sources.map((s, i) => [s.uuid, created[i]]));
                const cloneSet = new Set(created);
                const order: Host[] = [];
                for (const h of idx.hostsSorted) {
                    if (cloneSet.has(h.uuid)) continue;
                    const c = cloneOf.get(h.uuid);
                    const ch = c ? idx.hostByUuid.get(c) : undefined;
                    if (ch && p.placement === 'before-source') order.push(ch);
                    order.push(h);
                    if (ch && p.placement === 'after-source') order.push(ch);
                }
                await client.reorderHosts(order.map((h, i) => ({ uuid: h.uuid, viewPosition: i })));
                ctx.state.log({ tool: 'hosts_clone', target: `${created.length} clones`, summary: `placed ${p.placement}`, ok: true });
                return {
                    ...res,
                    placed: p.placement,
                    poolsHint: {
                        tool: 'pools_edit',
                        add: sources.map((s, i) => ({ host: created[i], after: s.uuid })),
                        note: 'uuid pools list hosts explicitly; tagRegex pools pick clones up by tag automatically',
                    },
                };
            }),
    );

    server.tool(
        'hosts_move',
        'Move hosts to a new place in the list (before/after an anchor host, or to start/end). Position decides visible order and the order of members in tagRegex pools (the first member is the pool\'s fallback target). Dry run shows those pool changes.',
        {
            uuids: z.array(z.string()).describe('Hosts to move, in the order they should end up'),
            before: z.string().optional().describe('Anchor host uuid'),
            after: z.string().optional().describe('Anchor host uuid'),
            to: z.enum(['start', 'end']).optional(),
            ...applyParams,
        },
        (p) =>
            run(async () => {
                let order: Host[] = [];
                const res = await runPlan(ctx, 'hosts_move', p, async () => {
                    const idx = await fleet.index();
                    const moving = p.uuids.map((u) => idx.host(u));
                    const set = new Set(moving.map((h) => h.uuid));
                    const rest = idx.hostsSorted.filter((h) => !set.has(h.uuid));
                    let at: number;
                    if (p.before || p.after) {
                        const anchor = idx.host((p.before ?? p.after)!).uuid;
                        const a = rest.findIndex((h) => h.uuid === anchor);
                        if (a < 0) throw new Error('anchor host not found (or is one of the moved hosts)');
                        at = p.before ? a : a + 1;
                    } else at = p.to === 'start' ? 0 : rest.length;
                    order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
                    const moved = order.map((h, i) => ({ ...h, viewPosition: i }) as Host);
                    const tpls = await loadTemplatesForImpact(ctx);
                    const imp = poolImpact(idx, hypothetical(idx, moved), tpls);
                    const pos = (list: Host[]) => Object.fromEntries(moving.map((m) => [m.remark + ' ' + m.uuid.slice(0, 8), list.findIndex((h) => h.uuid === m.uuid)]));
                    return [
                        {
                            kind: 'other' as const,
                            uuid: 'hosts-order',
                            name: 'hosts order',
                            backup: idx.hostsSorted.map((h) => ({ uuid: h.uuid, viewPosition: h.viewPosition, remark: h.remark })),
                            before: pos(idx.hostsSorted),
                            after: pos(order),
                            warnings: imp.firstChanged,
                            info: { poolImpact: compactImpact(imp) },
                            write: () => client.reorderHosts(order.map((h, i) => ({ uuid: h.uuid, viewPosition: i }))),
                        },
                    ];
                });
                return res;
            }),
    );

    const stateTool = (name: string, desc: string, action: 'enable' | 'disable' | 'delete') =>
        server.tool(
            name,
            desc,
            {
                uuids: z.array(z.string()),
                force: z.boolean().default(false).describe('Proceed even if a pool would become empty or keep a dangling uuid'),
            },
            ({ uuids: refs, force }) =>
                run(async () => {
                    const idx = await fleet.index(true);
                    const hosts = refs.map((u) => idx.host(u));
                    const uuids = hosts.map((h) => h.uuid);
                    let summary: Record<string, string[]> = {};
                    if (action !== 'enable') {
                        const tpls = await loadTemplatesForImpact(ctx);
                        const after =
                            action === 'delete'
                                ? hypothetical(idx, [], new Set(uuids))
                                : hypothetical(idx, hosts.map((h) => ({ ...h, isDisabled: true }) as Host));
                        const imp = poolImpact(idx, after, tpls);
                        summary = compactImpact(imp);
                        if ((imp.emptied.length || imp.danglingUuids.length) && !force) {
                            return {
                                done: false,
                                reason: 'pool impact — nothing changed',
                                poolImpact: summary,
                                next: 'Fix the pools first (pools_edit), or repeat with force:true.',
                            };
                        }
                    }
                    const fn =
                        action === 'enable'
                            ? () => client.bulkEnableHosts({ uuids })
                            : action === 'disable'
                              ? () => client.bulkDisableHosts({ uuids })
                              : () => client.bulkDeleteHosts({ uuids });
                    const { backup } = await journaled(ctx, name, `${hosts.length} host(s)`, `${action}: ${hosts.map((h) => h.remark).slice(0, 10).join('; ')}`, fn, {
                        kind: 'host',
                        uuid: hosts[0].uuid,
                        name: `${action}-${hosts.length}`,
                        data: hosts,
                    });
                    return { done: true, action, hosts: hosts.map((h) => `${h.remark} (${h.uuid})`), poolImpact: summary, backup };
                }),
        );
    stateTool('hosts_bulk_enable', 'Enable hosts', 'enable');
    stateTool(
        'hosts_bulk_disable',
        'Disable hosts. Checks every template pool first: refuses if a pool would lose its last member (that pool\'s location would route to nothing) unless force.',
        'disable',
    );
    stateTool(
        'hosts_bulk_delete',
        'Delete hosts (backup kept). Refuses if a pool would become empty or keep a uuid pointing to a deleted host, unless force. Prefer disabling.',
        'delete',
    );

    server.tool(
        'hosts_bulk_update',
        'Panel-side bulk update: the same raw values on all given hosts in one request (no per-host diff). For anything conditional use hosts_bulk_edit.',
        { uuids: z.array(z.string()), ...hostFields },
        ({ uuids: refs, ...p }) =>
            run(async () => {
                const idx = await fleet.index();
                const body = await toHostBody(ctx, idx, p);
                const hosts = refs.map((u) => idx.host(u));
                const uuids = hosts.map((h) => h.uuid);
                await journaled(ctx, 'hosts_bulk_update', `${uuids.length} host(s)`, `fields: ${Object.keys(body).join(', ')}`, () => client.bulkUpdateHosts({ uuids, ...body }), {
                    kind: 'host',
                    uuid: uuids[0],
                    name: `bulk-${uuids.length}`,
                    data: hosts,
                });
                return { success: true, hosts: uuids.length, fields: Object.keys(body) };
            }),
    );

    server.tool('hosts_delete', 'Delete one host (same checks as hosts_bulk_delete)', { uuid: z.string(), force: z.boolean().default(false) }, ({ uuid: ref, force }) =>
        run(async () => {
            const idx = await fleet.index(true);
            const h = idx.host(ref);
            const uuid = h.uuid;
            const tpls = await loadTemplatesForImpact(ctx);
            const imp = poolImpact(idx, hypothetical(idx, [], new Set([uuid])), tpls);
            if ((imp.emptied.length || imp.danglingUuids.length) && !force) {
                return { deleted: false, poolImpact: compactImpact(imp), next: 'Remove the host from uuid pools first (pools_edit), or repeat with force:true.' };
            }
            const { backup } = await journaled(ctx, 'hosts_delete', `host ${h.remark} ${uuid}`, 'delete', () => client.deleteHost(uuid), { kind: 'host', uuid, name: h.remark, data: h });
            return { deleted: true, host: h.remark, backup, poolImpact: compactImpact(imp) };
        }),
    );
}
