import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Any, injectEntries } from '../core/fleet.js';
import { truncate } from '../core/jsonedit.js';
import { Ctx } from '../core/plan.js';
import { inboundRow, nodeRow } from '../core/views.js';
import { run } from './helpers.js';

export function registerFleetTools(server: McpServer, ctx: Ctx) {
    const { fleet } = ctx;

    server.tool(
        'fleet_overview',
        'One-screen health of the whole panel: nodes (compact), counts, and consistency problems that used to need psql joins — enabled hosts whose inbound is not bound on any of their nodes, hosts without inbound/nodes, inbounds in no squad, nodes down.',
        { limit: z.number().int().default(25).describe('Max items per problem list') },
        ({ limit }) =>
            run(async () => {
                const [idx, tplList] = await Promise.all([fleet.index(), fleet.templateList()]);
                const tplName = new Map(tplList.map((t) => [t.uuid, t.name]));
                const cut = <T>(a: T[]) => (a.length > limit ? [...a.slice(0, limit), `… +${a.length - limit} more` as unknown as T] : a);
                const enabled = idx.hostsSorted.filter((h) => !h.isDisabled);
                const noInbound = enabled.filter((h) => !h.inbound?.configProfileInboundUuid || !idx.inboundByUuid.has(h.inbound.configProfileInboundUuid));
                const noNodes = enabled.filter((h) => !(h.nodes ?? []).length);
                const notListening = enabled.filter((h) => {
                    const ib = h.inbound?.configProfileInboundUuid;
                    if (!ib || !(h.nodes ?? []).length) return false;
                    const bound = new Set((idx.nodesByInbound.get(ib) ?? []).map((n) => n.uuid));
                    return !(h.nodes ?? []).some((n) => bound.has(n));
                });
                const onDisabledNodes = enabled.filter((h) => (h.nodes ?? []).length && (h.nodes ?? []).every((n) => idx.nodeByUuid.get(n)?.isDisabled));
                const inbounds = [...idx.inboundByUuid.values()];
                const noSquad = inbounds.filter((i) => (idx.nodesByInbound.get(i.uuid) ?? []).length && !(idx.squadsByInbound.get(i.uuid) ?? []).length);
                const unbound = inbounds.filter((i) => (idx.hostsByInbound.get(i.uuid) ?? []).some((h) => !h.isDisabled) && !(idx.nodesByInbound.get(i.uuid) ?? []).length);
                const h = (x: Any) => `${x.remark} (${x.uuid.slice(0, 8)})`;
                return {
                    counts: {
                        nodes: idx.nodes.length,
                        nodesConnected: idx.nodes.filter((n) => n.isConnected && !n.isDisabled).length,
                        nodesDisabled: idx.nodes.filter((n) => n.isDisabled).length,
                        hosts: idx.hosts.length,
                        hostsVisible: enabled.filter((x) => !x.isHidden).length,
                        hostsHidden: enabled.filter((x) => x.isHidden).length,
                        hostsDisabled: idx.hosts.length - enabled.length,
                        profiles: idx.profiles.length,
                        inbounds: inbounds.length,
                        squads: idx.squads.length,
                        usersOnline: idx.nodes.reduce((a, n) => a + (n.usersOnline ?? 0), 0),
                    },
                    nodes: idx.nodes.map((n) => nodeRow(n, idx)).map(({ uuid: _u, ...r }) => r),
                    problems: {
                        nodesDown: idx.nodes.filter((n) => !n.isDisabled && !n.isConnected).map((n) => `${n.name}: ${n.lastStatusMessage ?? 'disconnected'}`),
                        hostsWithoutInbound: cut(noInbound.map(h)),
                        hostsWithoutNodes: cut(noNodes.map(h)),
                        hostsWhoseNodesDoNotBindTheirInbound: cut(
                            notListening.map(
                                (x) =>
                                    `${h(x)} inbound ${idx.inboundByUuid.get(x.inbound!.configProfileInboundUuid!)?.tag} on ${(x.nodes ?? []).map((n) => idx.nodeName(n)).join(',')}` +
                                    (x.xrayJsonTemplateUuid ? ` — renders with ${tplName.get(x.xrayJsonTemplateUuid) ?? 'a template'} (pool location: usually intended)` : ''),
                            ),
                        ),
                        hostsOnlyOnDisabledNodes: cut(onDisabledNodes.map(h)),
                        inboundsBoundButInNoSquad: cut(noSquad.map((i) => `${i.tag} (${i.profileName})`)),
                        inboundsWithHostsButNoNode: cut(unbound.map((i) => `${i.tag} (${i.profileName})`)),
                    },
                };
            }),
    );

    server.tool(
        'inbound_trace',
        'Follow one inbound through everything that must line up for it to reach a client: profile → nodes binding it → squads including it → hosts pointing at it (and their nodes) → template pools those hosts are in. Reports which link is missing.',
        { inbound: z.string().describe('Inbound tag or uuid'), withPools: z.boolean().default(true).describe('Also resolve template pools (loads templates)') },
        ({ inbound, withPools }) =>
            run(async () => {
                const idx = await fleet.index();
                const ib = idx.inbound(inbound);
                const nodes = idx.nodesByInbound.get(ib.uuid) ?? [];
                const squads = idx.squadsByInbound.get(ib.uuid) ?? [];
                const hosts = idx.hostsByInbound.get(ib.uuid) ?? [];
                const problems: string[] = [];
                if (!nodes.length) problems.push('bound on no node — it listens nowhere');
                if (!squads.length) problems.push('in no squad — no subscription includes it');
                if (!hosts.some((h) => !h.isDisabled)) problems.push('no enabled host points at it');
                const nodeSet = new Set(nodes.map((n) => n.uuid));
                for (const h of hosts.filter((x) => !x.isDisabled)) {
                    const off = (h.nodes ?? []).filter((n) => !nodeSet.has(n));
                    if (off.length) problems.push(`host ${h.remark}: bound to ${off.map((n) => idx.nodeName(n)).join(', ')} which do not bind this inbound`);
                }
                let pools: string[] | undefined;
                if (withPools && hosts.length) {
                    const tpls = await fleet.templates({ type: 'XRAY_JSON' });
                    const hostSet = new Set(hosts.map((h) => h.uuid));
                    pools = [];
                    for (const t of tpls) {
                        injectEntries(t).forEach((e, i) => {
                            const p = idx.resolveEntry(t, i, e);
                            p.members.forEach((m, k) => {
                                if (hostSet.has(m.uuid)) pools!.push(`${t.name} #${i} ${p.selector}: ${m.remark} as ${m.outboundTag} (${k + 1}/${p.members.length})`);
                            });
                            if (e.selector.type === 'uuids') for (const s of p.skipped) if (hostSet.has(s.uuid)) pools!.push(`${t.name} #${i}: ${s.remark} listed but skipped (${s.why})`);
                        });
                    }
                }
                return {
                    inbound: inboundRow(ib),
                    nodes: nodes.map((n) => `${n.name} (${n.isDisabled ? 'disabled' : n.isConnected ? 'connected' : 'DOWN'})`),
                    squads: squads.map((s) => `${s.name} (${s.info?.membersCount} users)`),
                    hosts: hosts.map((h) => idx.hostRow(h)),
                    ...(pools ? { pools } : {}),
                    problems: problems.length ? problems : 'none',
                };
            }),
    );

    server.tool(
        'host_usage',
        'Where a host is used: its inbound/nodes, every template pool that injects it (position, outbound tag it gets, whether it is the first member = fallback target or the only one), and which visible locations those templates serve. Run before disabling/deleting/retagging a host.',
        { uuid: z.string().describe('Host uuid') },
        ({ uuid: ref }) =>
            run(async () => {
                const [idx, tpls] = await Promise.all([fleet.index(), fleet.templates({ type: 'XRAY_JSON' })]);
                const h = idx.host(ref);
                const uuid = h.uuid;
                const def = tpls.find((t) => t.name === 'Default')?.uuid;
                const pools: Any[] = [];
                const listedButSkipped: string[] = [];
                for (const t of tpls) {
                    injectEntries(t).forEach((e, i) => {
                        const p = idx.resolveEntry(t, i, e);
                        const k = p.members.findIndex((m) => m.uuid === uuid);
                        if (k >= 0) {
                            pools.push({
                                template: t.name,
                                entry: i,
                                selector: p.selector,
                                position: `${k + 1}/${p.members.length}`,
                                outboundTag: p.members[k].outboundTag,
                                ...(k === 0 ? { first: true } : {}),
                                ...(p.members.length === 1 ? { only: true } : {}),
                                locations: idx.recipientsOf(t, def).filter((x) => !x.isHidden).length,
                            });
                        }
                        const s = p.skipped.find((x) => x.uuid === uuid);
                        if (s) listedButSkipped.push(`${t.name} #${i}: ${s.why}`);
                    });
                }
                const ownTpl = h.xrayJsonTemplateUuid ? tpls.find((t) => t.uuid === h.xrayJsonTemplateUuid)?.name : undefined;
                return {
                    host: idx.hostRow(h),
                    rendersWith: ownTpl ?? (h.xrayJsonTemplateUuid ? h.xrayJsonTemplateUuid : 'Default'),
                    pools,
                    ...(listedButSkipped.length ? { listedButSkipped } : {}),
                    risk: pools.filter((p) => p.only).length
                        ? `sole member of ${pools.filter((p) => p.only).length} pool(s): disabling it empties them`
                        : pools.filter((p) => p.first).length
                          ? `first member (fallback target) of ${pools.filter((p) => p.first).length} pool(s)`
                          : 'none',
                };
            }),
    );

    server.tool(
        'config_search',
        'Search a string or regex across the panel: config profiles, subscription templates, hosts and nodes. Returns each hit with its object and exact JSON path — e.g. where an IP, domain, SNI, outbound tag or host uuid is referenced. Secrets are not searched.',
        {
            query: z.string(),
            regex: z.boolean().default(false),
            in: z.array(z.enum(['profiles', 'templates', 'hosts', 'nodes'])).default(['profiles', 'templates', 'hosts', 'nodes']),
            keys: z.boolean().default(false).describe('Also match object keys'),
            limit: z.number().int().default(100),
        },
        (p) =>
            run(async () => {
                const idx = await fleet.index();
                const re = p.regex ? new RegExp(p.query) : null;
                const test = (s: string) => (re ? re.test(s) : s.includes(p.query));
                const hits: Any[] = [];
                let total = 0;
                const skip = new Set(ctx.config.redactKeys);
                const walk = (v: unknown, path: string, where: string) => {
                    if (typeof v === 'string' || typeof v === 'number') {
                        const s = String(v);
                        if (test(s)) {
                            total++;
                            let value = truncate(s, 160);
                            if (s.length > 160) {
                                // long strings (YAML templates): show the neighbourhood of the match
                                const at = re ? s.search(re) : s.indexOf(p.query);
                                value = `…${s.slice(Math.max(0, at - 60), at + 100)}… (${s.length} chars)`;
                            }
                            if (hits.length < p.limit) hits.push({ in: where, path: path || '/', value });
                        }
                        return;
                    }
                    if (Array.isArray(v)) {
                        v.forEach((x, i) => {
                            const lab = x && typeof x === 'object' && typeof (x as Any).tag === 'string' ? `[tag=${(x as Any).tag}]` : `/${i}`;
                            walk(x, path + lab, where);
                        });
                        return;
                    }
                    if (v && typeof v === 'object') {
                        for (const [k, x] of Object.entries(v)) {
                            if (skip.has(k)) continue;
                            if (p.keys && test(k)) {
                                total++;
                                if (hits.length < p.limit) hits.push({ in: where, path: `${path}/${k}`, key: k });
                            }
                            walk(x, `${path}/${k}`, where);
                        }
                    }
                };
                if (p.in.includes('profiles')) for (const pr of idx.profiles) walk(pr.config, '', `profile ${pr.name}`);
                if (p.in.includes('hosts')) {
                    for (const h of idx.hostsSorted) {
                        const { uuid: _u, ...rest } = h;
                        walk(rest, '', `host ${h.remark} (${h.uuid})`);
                        if (test(h.uuid)) {
                            total++;
                            if (hits.length < p.limit) hits.push({ in: `host ${h.remark}`, path: '/uuid', value: h.uuid });
                        }
                    }
                }
                if (p.in.includes('nodes')) {
                    for (const n of idx.nodes) {
                        const { configProfile: _c, system: _s, ...rest } = n;
                        walk(rest, '', `node ${n.name}`);
                    }
                }
                if (p.in.includes('templates')) {
                    for (const t of await fleet.templates()) {
                        const doc = t.templateJson ?? (t.encodedTemplateYaml ? { yaml: Buffer.from(t.encodedTemplateYaml, 'base64').toString('utf8') } : {});
                        walk(doc, '', `template ${t.name} (${t.templateType})`);
                    }
                }
                const byObject: Record<string, number> = {};
                for (const hit of hits) byObject[hit.in] = (byObject[hit.in] ?? 0) + 1;
                return { total, shown: hits.length, objects: Object.keys(byObject).length, byObject, hits };
            }),
    );
}
