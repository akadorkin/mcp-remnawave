import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Any, Node } from '../core/fleet.js';
import { applyParams, assertValid, Ctx, journaled, PlanTarget, runPlan } from '../core/plan.js';
import { contractIssues } from '../core/validate.js';
import { nodeDetail, nodeRow } from '../core/views.js';
import { run } from './helpers.js';

const IP_STATUS = ['INBOUND', 'OUTBOUND', 'MANAGEMENT', 'TRANSIT', 'MONITORING', 'RESERVE', 'BLOCKED', 'FLAGGED', 'DEPRECATED', 'UNKNOWN'] as const;

const nodeRef = z.string().describe('Node uuid or name (full name, or its last dash-part like "de2")');

const nodeFields = {
    name: z.string().optional().describe('Node name (3-30 chars)'),
    address: z.string().optional().describe('Node address (IP or hostname)'),
    port: z.number().optional().describe('Node API port'),
    proxyUrl: z.string().nullable().optional().describe('socks5:// URL the panel uses to reach the node'),
    countryCode: z.string().optional().describe('Country code (US, DE, NL...)'),
    isTrafficTrackingActive: z.boolean().optional(),
    trafficLimitBytes: z.number().optional(),
    trafficResetDay: z.number().optional().describe('Day of month to reset traffic (1-31)'),
    notifyPercent: z.number().optional().describe('Traffic notification threshold %'),
    consumptionMultiplier: z.number().optional(),
    nodeConsumptionMultiplier: z.number().optional(),
    providerUuid: z.string().nullable().optional().describe('Infra billing provider UUID'),
    tags: z.array(z.string()).optional().describe('Node tags (A-Z0-9_: only, max 10)'),
    activePluginUuid: z.string().nullable().optional(),
    integrationUuids: z.array(z.string()).optional().describe('Node integration UUIDs'),
    note: z.string().nullable().optional(),
    ips: z.array(z.object({ ip: z.string(), status: z.enum(IP_STATUS) })).optional().describe('IP inventory of the node (replaces the list)'),
};

function toNodeBody(params: Record<string, unknown>): Record<string, unknown> {
    const { activeConfigProfileUuid, activeInbounds, ...rest } = params;
    const body: Record<string, unknown> = { ...rest };
    if (activeConfigProfileUuid !== undefined || activeInbounds !== undefined) {
        body.configProfile = { activeConfigProfileUuid, activeInbounds };
    }
    return body;
}

/** What a node deletion takes with it (FK cascades in the panel DB). */
function deletionImpact(n: Node, ctx: { idx: import('../core/fleet.js').FleetIndex }) {
    const hosts = ctx.idx.hostsByNode.get(n.uuid) ?? [];
    const enabled = hosts.filter((h) => !h.isDisabled);
    return {
        node: n.name,
        state: n.isDisabled ? 'disabled' : n.isConnected ? 'connected' : 'disconnected',
        inboundBindings: n.configProfile?.activeInbounds?.length ?? 0,
        hostsBound: hosts.length,
        enabledHostsBound: enabled.map((h) => ctx.idx.hostRow(h)).slice(0, 40),
        cascades: 'inbound bindings, host↔node links, billing, node metadata, ALL traffic history of the node (nodes_usage_history, nodes_user_usage_history), torrent reports',
    };
}

export function registerNodeTools(server: McpServer, ctx: Ctx) {
    const { client, fleet } = ctx;
    const readonly = ctx.config.readonly;

    server.tool(
        'nodes_list',
        'List nodes as compact rows: state, profile, inbound/host counts, users online, xray version, traffic. Use view:"full" only if you need raw panel objects (large; written to a file).',
        {
            view: z.enum(['compact', 'full']).default('compact'),
            filter: z.string().optional().describe('Case-insensitive substring of name/address/country/profile'),
            state: z.enum(['connected', 'disconnected', 'disabled', 'problems']).optional().describe('"problems" = enabled but not connected'),
        },
        ({ view, filter, state }) =>
            run(async () => {
                const idx = await fleet.index();
                let nodes = [...idx.nodes].sort((a, b) => (a.viewPosition ?? 0) - (b.viewPosition ?? 0));
                if (state === 'connected') nodes = nodes.filter((n) => n.isConnected && !n.isDisabled);
                if (state === 'disabled') nodes = nodes.filter((n) => n.isDisabled);
                if (state === 'disconnected' || state === 'problems') nodes = nodes.filter((n) => !n.isConnected && !n.isDisabled);
                if (view === 'full') return nodes;
                let rows = nodes.map((n) => nodeRow(n, idx));
                if (filter) {
                    const f = filter.toLowerCase();
                    rows = rows.filter((r) => [r.name, r.address, r.country, r.profile].some((v) => String(v ?? '').toLowerCase().includes(f)));
                }
                return { total: rows.length, nodes: rows };
            }),
    );

    server.tool(
        'nodes_get',
        'One node in detail: status, profile, bound inbound tags, hosts bound (visible/hidden/disabled), squads that reach it, system load, interface Mbit/s. view:"full" = raw panel object.',
        { node: nodeRef, view: z.enum(['detail', 'full']).default('detail') },
        ({ node, view }) =>
            run(async () => {
                const idx = await fleet.index();
                const n = idx.node(node);
                return view === 'full' ? n : nodeDetail(n, idx);
            }),
    );

    server.tool('nodes_tags_list', 'List all node tags', {}, () => run(() => client.getNodeTags()));

    if (readonly) return;

    server.tool(
        'nodes_create',
        'Create a node. Inbounds can be given by tag (activeInboundTags) instead of uuid. Response is a compact row (the raw response embeds every inbound with its REALITY keys).',
        {
            ...nodeFields,
            name: z.string().describe('Node name'),
            address: z.string().describe('Node address'),
            profile: z.string().describe('Config profile name or uuid'),
            activeInboundTags: z.array(z.string()).optional().describe('Inbound tags of that profile to enable'),
            activeInbounds: z.array(z.string()).optional().describe('Inbound uuids (alternative to tags)'),
        },
        ({ profile, activeInboundTags, activeInbounds, ...p }) =>
            run(async () => {
                const idx = await fleet.index();
                const prof = idx.profile(profile);
                const uuids = activeInbounds ?? (activeInboundTags ?? []).map((t) => {
                    const ib = idx.inbound(t);
                    if (ib.profileUuid !== prof.uuid) throw new Error(`inbound ${t} belongs to profile ${ib.profileName}, not ${prof.name}`);
                    return ib.uuid;
                });
                const body = toNodeBody({ ...p, activeConfigProfileUuid: prof.uuid, activeInbounds: uuids });
                assertValid(contractIssues('createNode', body), 'node');
                const { result } = await journaled(ctx, 'nodes_create', `node ${p.name}`, `create with ${uuids.length} inbound(s)`, () => client.createNode(body));
                return nodeRow((result as Any).response as Node);
            }),
    );

    server.tool(
        'nodes_update',
        'Update node fields (only the provided ones change). For inbound bindings use node_inbounds_edit (tag-based, keeps the rest). Response is a compact row.',
        { node: nodeRef, ...nodeFields },
        ({ node, ...p }) =>
            run(async () => {
                const idx = await fleet.index();
                const n = idx.node(node);
                const body = { uuid: n.uuid, ...p };
                assertValid(contractIssues('updateNode', body), 'node update');
                const { result, backup } = await journaled(
                    ctx,
                    'nodes_update',
                    `node ${n.name}`,
                    `fields: ${Object.keys(p).join(', ')}`,
                    () => client.updateNode(body),
                    { kind: 'node', uuid: n.uuid, name: n.name, data: n },
                );
                return { node: nodeRow((result as Any).response as Node), backup };
            }),
    );

    server.tool(
        'node_inbounds_edit',
        'Change which inbounds a node listens on, by tag: add / remove / set, keeping every other binding. Dry run by default. Refuses to unbind an inbound that still has enabled hosts on this node unless allowHostLoss. Optionally switch the node to another profile (then give the full set).',
        {
            node: nodeRef,
            add: z.array(z.string()).optional().describe('Inbound tags to bind'),
            remove: z.array(z.string()).optional().describe('Inbound tags to unbind'),
            set: z.array(z.string()).optional().describe('Exact list of inbound tags (replaces add/remove)'),
            profile: z.string().optional().describe('Switch to this profile (name/uuid); requires set'),
            allowHostLoss: z.boolean().default(false).describe('Allow unbinding inbounds that enabled hosts on this node still use'),
            forceRestartAfter: z.boolean().default(false).describe('After a successful apply, restart xray on the node with forceRestart (a new binding is sometimes not picked up otherwise)'),
            ...applyParams,
        },
        (p) =>
            run(async () => {
                let nodeUuid = '';
                const res = await runPlan(ctx, 'node_inbounds_edit', p, async () => {
                    const idx = await fleet.index();
                    const n = idx.node(p.node);
                    nodeUuid = n.uuid;
                    const curProfile = n.configProfile?.activeConfigProfileUuid ?? null;
                    const targetProfile = p.profile ? idx.profile(p.profile) : curProfile ? idx.profileByUuid.get(curProfile) : undefined;
                    if (!targetProfile) throw new Error(`node ${n.name} has no config profile; pass profile + set`);
                    if (p.profile && targetProfile.uuid !== curProfile && !p.set) throw new Error('switching profile requires the full list in set');
                    const current = (n.configProfile?.activeInbounds ?? []).map((i) => i.tag);
                    const tagOf = (t: string) => {
                        const ib = idx.inbound(t);
                        if (ib.profileUuid !== targetProfile.uuid) throw new Error(`inbound ${t} is in profile ${ib.profileName}, node uses ${targetProfile.name}`);
                        return ib.tag;
                    };
                    let next: string[];
                    if (p.set) next = [...new Set(p.set.map(tagOf))];
                    else {
                        const add = (p.add ?? []).map(tagOf);
                        const rm = new Set((p.remove ?? []).map(tagOf));
                        const missing = [...rm].filter((t) => !current.includes(t));
                        if (missing.length) throw new Error(`not bound on ${n.name}: ${missing.join(', ')}`);
                        next = current.filter((t) => !rm.has(t));
                        for (const t of add) if (!next.includes(t)) next.push(t);
                    }
                    const removed = current.filter((t) => !next.includes(t));
                    const added = next.filter((t) => !current.includes(t));
                    const blockers: string[] = [];
                    const warnings: string[] = [];
                    for (const t of removed) {
                        const ib = idx.inboundsByTag.get(t)?.[0];
                        const hosts = ib ? (idx.hostsByInbound.get(ib.uuid) ?? []).filter((h) => !h.isDisabled && h.nodes.includes(n.uuid)) : [];
                        if (hosts.length) {
                            const msg = `${t}: ${hosts.length} enabled host(s) on this node use it (${hosts.slice(0, 5).map((h) => h.remark).join('; ')})`;
                            if (p.allowHostLoss) warnings.push(msg);
                            else blockers.push(msg + ' — pass allowHostLoss to unbind anyway');
                        }
                    }
                    for (const t of added) {
                        const ib = idx.inbound(t);
                        if (!(idx.squadsByInbound.get(ib.uuid) ?? []).length) warnings.push(`${t}: not in any squad — it will listen, but no subscription will include it`);
                    }
                    if (added.length || removed.length) warnings.push(`xray on ${n.name} restarts to apply (connections drop briefly)`);
                    const uuidOf = (t: string) => idx.inbound(t).uuid;
                    const t: PlanTarget = {
                        kind: 'node',
                        uuid: n.uuid,
                        name: n.name,
                        backup: n,
                        before: { profile: idx.profileByUuid.get(curProfile ?? '')?.name ?? curProfile, inbounds: [...current].sort() },
                        after: { profile: targetProfile.name, inbounds: [...next].sort() },
                        blockers,
                        warnings,
                        info: { bound: `${current.length} → ${next.length}`, added, removed },
                        write: () =>
                            client.updateNode({
                                uuid: n.uuid,
                                configProfile: { activeConfigProfileUuid: targetProfile.uuid, activeInbounds: next.map(uuidOf) },
                            }),
                        readBack: async () => {
                            const r = ((await client.getNodeByUuid(n.uuid)) as Any).response as Node;
                            const pu = r.configProfile?.activeConfigProfileUuid ?? null;
                            return {
                                profile: idx.profileByUuid.get(pu ?? '')?.name ?? pu,
                                inbounds: (r.configProfile?.activeInbounds ?? []).map((i) => i.tag).sort(),
                            };
                        },
                    };
                    return [t];
                });
                if (res.mode === 'applied' && p.forceRestartAfter && nodeUuid) {
                    await client.restartNode(nodeUuid, true);
                    return { ...res, restarted: 'forceRestart sent' };
                }
                return res;
            }),
    );

    server.tool(
        'nodes_delete',
        'Delete a node. Destructive beyond the node row: cascades to inbound bindings, host links, billing and ALL its traffic history. Call without confirmName to see the impact; repeat with confirmName = exact node name to delete.',
        { node: nodeRef, confirmName: z.string().optional().describe('Exact node name, required to actually delete') },
        ({ node, confirmName }) =>
            run(async () => {
                const idx = await fleet.index(true);
                const n = idx.node(node);
                const impact = deletionImpact(n, { idx });
                if (confirmName !== n.name) {
                    return { deleted: false, impact, next: `Repeat with confirmName:"${n.name}" to delete. Consider nodes_disable instead — it keeps history and bindings.` };
                }
                const hosts = (idx.hostsByNode.get(n.uuid) ?? []).map((h) => h);
                const { backup } = await journaled(ctx, 'nodes_delete', `node ${n.name}`, `delete (${impact.hostsBound} host links)`, () => client.deleteNode(n.uuid), {
                    kind: 'node',
                    uuid: n.uuid,
                    name: n.name,
                    data: { node: n, hostsBound: hosts },
                });
                return { deleted: true, node: n.name, backup, impact };
            }),
    );

    const simple = (name: string, desc: string, fn: (uuid: string) => Promise<unknown>) =>
        server.tool(name, desc, { node: nodeRef }, ({ node }) =>
            run(async () => {
                const n = (await fleet.index()).node(node);
                await journaled(ctx, name, `node ${n.name}`, name, () => fn(n.uuid));
                return { success: true, node: n.name };
            }),
        );
    simple('nodes_enable', 'Enable a node', (u) => client.enableNode(u));
    simple('nodes_disable', 'Disable a node (keeps bindings and history; hosts on it stay as they are)', (u) => client.disableNode(u));
    simple('nodes_reset_traffic', 'Reset traffic counter of a node', (u) => client.resetNodeTraffic(u));

    server.tool(
        'nodes_restart',
        'Restart xray on a node. forceRestart:true is needed after adding an inbound binding (a plain restart answers "configuration is up-to-date" and keeps the old port set). Config profile edits restart their nodes by themselves.',
        { node: nodeRef, forceRestart: z.boolean().default(false).describe('Force restart even if config is unchanged') },
        ({ node, forceRestart }) =>
            run(async () => {
                const n = (await fleet.index()).node(node);
                await journaled(ctx, 'nodes_restart', `node ${n.name}`, `restart force=${forceRestart}`, () => client.restartNode(n.uuid, forceRestart));
                return { success: true, node: n.name, forceRestart };
            }),
    );

    server.tool(
        'nodes_restart_all',
        'Restart xray on ALL nodes (every user reconnects). Requires confirm:true.',
        { forceRestart: z.boolean().default(false), confirm: z.boolean().default(false) },
        ({ forceRestart, confirm }) =>
            run(async () => {
                if (!confirm) return { restarted: false, next: 'This restarts every node. Repeat with confirm:true.' };
                await journaled(ctx, 'nodes_restart_all', 'all nodes', `restart force=${forceRestart}`, () => client.restartAllNodes(forceRestart));
                return { success: true };
            }),
    );

    server.tool(
        'nodes_reorder',
        'Reorder nodes in the panel list. Pass node refs in the desired order; nodes not listed keep their relative order after them.',
        { order: z.array(z.string()).describe('Node names/uuids in the new order') },
        ({ order }) =>
            run(async () => {
                const idx = await fleet.index(true);
                const first = order.map((r) => idx.node(r));
                const firstSet = new Set(first.map((n) => n.uuid));
                const rest = [...idx.nodes].sort((a, b) => (a.viewPosition ?? 0) - (b.viewPosition ?? 0)).filter((n) => !firstSet.has(n.uuid));
                const nodes = [...first, ...rest].map((n, i) => ({ uuid: n.uuid, viewPosition: i }));
                await journaled(ctx, 'nodes_reorder', 'nodes', `new order: ${first.map((n) => n.name).join(', ')} …`, () => client.reorderNodes(nodes));
                return { success: true, order: [...first, ...rest].map((n) => n.name) };
            }),
    );

    server.tool(
        'nodes_bulk_profile_modification',
        'Set config profile and inbounds (by tag) for several nodes at once — replaces their bindings wholesale.',
        { nodes: z.array(nodeRef), profile: z.string().describe('Profile name/uuid'), inboundTags: z.array(z.string()) },
        ({ nodes, profile, inboundTags }) =>
            run(async () => {
                const idx = await fleet.index(true);
                const prof = idx.profile(profile);
                const ns = nodes.map((r) => idx.node(r));
                const ibs = inboundTags.map((t) => idx.inbound(t));
                const foreign = ibs.filter((i) => i.profileUuid !== prof.uuid);
                if (foreign.length) throw new Error(`not in ${prof.name}: ${foreign.map((i) => i.tag).join(', ')}`);
                await journaled(
                    ctx,
                    'nodes_bulk_profile_modification',
                    ns.map((n) => n.name).join(', '),
                    `profile ${prof.name}, ${ibs.length} inbound(s)`,
                    () => client.bulkNodeProfileModification({ uuids: ns.map((n) => n.uuid), configProfile: { activeConfigProfileUuid: prof.uuid, activeInbounds: ibs.map((i) => i.uuid) } }),
                    { kind: 'node', uuid: ns[0].uuid, name: 'bulk-' + ns.map((n) => n.name).join('+'), data: ns },
                );
                return { success: true, nodes: ns.map((n) => n.name), profile: prof.name, inbounds: ibs.length };
            }),
    );

    server.tool(
        'nodes_bulk_actions',
        'Enable / disable / restart / reset traffic on selected nodes',
        { nodes: z.array(nodeRef), action: z.enum(['ENABLE', 'DISABLE', 'RESTART', 'RESET_TRAFFIC']) },
        ({ nodes, action }) =>
            run(async () => {
                const idx = await fleet.index();
                const ns = nodes.map((r) => idx.node(r));
                await journaled(ctx, 'nodes_bulk_actions', ns.map((n) => n.name).join(', '), action, () => client.bulkNodeActions({ uuids: ns.map((n) => n.uuid), action }));
                return { success: true, action, nodes: ns.map((n) => n.name) };
            }),
    );

    server.tool(
        'nodes_bulk_update',
        'Bulk update properties for selected nodes',
        {
            nodes: z.array(nodeRef),
            countryCode: z.string().optional(),
            consumptionMultiplier: z.number().optional(),
            nodeConsumptionMultiplier: z.number().optional(),
            providerUuid: z.string().optional(),
            tags: z.array(z.string()).optional(),
            activePluginUuid: z.string().nullable().optional(),
            integrationUuids: z.array(z.string()).optional(),
            note: z.string().optional(),
        },
        ({ nodes, ...fields }) =>
            run(async () => {
                const idx = await fleet.index();
                const ns = nodes.map((r) => idx.node(r));
                await journaled(ctx, 'nodes_bulk_update', ns.map((n) => n.name).join(', '), `fields: ${Object.keys(fields).join(', ')}`, () =>
                    client.bulkUpdateNodes({ uuids: ns.map((n) => n.uuid), fields }),
                );
                return { success: true, nodes: ns.map((n) => n.name), fields: Object.keys(fields) };
            }),
    );
}
