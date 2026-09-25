import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Any, Squad } from '../core/fleet.js';
import { applyParams, Ctx, journaled, runPlan } from '../core/plan.js';
import { squadRow } from '../core/views.js';
import { run } from './helpers.js';

const squadRef = z.string().describe('Internal squad name or uuid');

export function registerSquadTools(server: McpServer, ctx: Ctx) {
    const { client, fleet } = ctx;
    const readonly = ctx.config.readonly;

    server.tool(
        'squads_list',
        'List internal squads: members, inbound count (withTags adds the inbound tags)',
        { withTags: z.boolean().default(false) },
        ({ withTags }) => run(async () => (await fleet.index()).squads.map((s) => squadRow(s, withTags))),
    );

    server.tool('squads_get', 'Internal squad with its inbound tags grouped by profile and the nodes those inbounds are bound on', { squad: squadRef }, ({ squad }) =>
        run(async () => {
            const idx = await fleet.index();
            const s = idx.squad(squad);
            const byProfile: Record<string, string[]> = {};
            for (const ib of s.inbounds ?? []) {
                const p = idx.inboundByUuid.get(ib.uuid)?.profileName ?? ib.profileUuid;
                (byProfile[p] ??= []).push(ib.tag);
            }
            const nodes = new Set<string>();
            for (const ib of s.inbounds ?? []) for (const n of idx.nodesByInbound.get(ib.uuid) ?? []) nodes.add(n.name);
            return { ...squadRow(s), inboundsByProfile: byProfile, nodes: [...nodes].sort() };
        }),
    );

    server.tool('squads_accessible_nodes', 'Nodes reachable through a squad', { squad: squadRef }, ({ squad }) =>
        run(async () => client.getSquadAccessibleNodes((await fleet.index()).squad(squad).uuid)),
    );

    if (readonly) return;

    server.tool(
        'squads_create',
        'Create an internal squad with inbounds given by tag',
        { name: z.string(), inboundTags: z.array(z.string()) },
        ({ name, inboundTags }) =>
            run(async () => {
                const idx = await fleet.index();
                const inbounds = inboundTags.map((t) => idx.inbound(t).uuid);
                const { result } = await journaled(ctx, 'squads_create', `squad ${name}`, `create with ${inbounds.length} inbound(s)`, () =>
                    client.createInternalSquad({ name, inbounds }),
                );
                return squadRow((result as Any).response as Squad, true);
            }),
    );

    server.tool(
        'squad_inbounds_edit',
        'Add / remove inbounds (by tag) of an internal squad, keeping the rest. An inbound missing from every squad is in nobody\'s subscription. Dry run by default.',
        {
            squad: squadRef,
            add: z.array(z.string()).optional(),
            remove: z.array(z.string()).optional(),
            rename: z.string().optional(),
            ...applyParams,
        },
        (p) =>
            run(() =>
                runPlan(ctx, 'squad_inbounds_edit', p, async () => {
                    const idx = await fleet.index();
                    const s = idx.squad(p.squad);
                    const cur = (s.inbounds ?? []).map((i) => i.tag);
                    const rm = new Set((p.remove ?? []).map((t) => idx.inbound(t).tag));
                    const next = cur.filter((t) => !rm.has(t));
                    for (const t of (p.add ?? []).map((x) => idx.inbound(x).tag)) if (!next.includes(t)) next.push(t);
                    const warnings: string[] = [];
                    for (const t of [...rm]) {
                        const ib = idx.inbound(t);
                        const others = (idx.squadsByInbound.get(ib.uuid) ?? []).filter((x) => x.uuid !== s.uuid);
                        if (!others.length) warnings.push(`${t} will be in no squad: its ${(idx.hostsByInbound.get(ib.uuid) ?? []).filter((h) => !h.isDisabled).length} enabled host(s) vanish from every subscription`);
                    }
                    return [
                        {
                            kind: 'squad',
                            uuid: s.uuid,
                            name: s.name,
                            backup: s,
                            before: { name: s.name, inbounds: [...cur].sort() },
                            after: { name: p.rename ?? s.name, inbounds: [...next].sort() },
                            warnings,
                            info: { members: s.info?.membersCount },
                            write: () => client.updateInternalSquad({ uuid: s.uuid, inbounds: next.map((t) => idx.inbound(t).uuid), ...(p.rename ? { name: p.rename } : {}) }),
                            readBack: async () => {
                                const r = ((await client.getInternalSquadByUuid(s.uuid)) as Any).response as Squad;
                                return { name: r.name, inbounds: (r.inbounds ?? []).map((i) => i.tag).sort() };
                            },
                        },
                    ];
                }),
            ),
    );

    server.tool('squads_delete', 'Delete an internal squad (backup kept). Requires confirmName.', { squad: squadRef, confirmName: z.string().optional() }, ({ squad, confirmName }) =>
        run(async () => {
            const idx = await fleet.index(true);
            const s = idx.squad(squad);
            if (confirmName !== s.name) return { deleted: false, squad: squadRow(s), next: `Repeat with confirmName:"${s.name}"` };
            const { backup } = await journaled(ctx, 'squads_delete', `squad ${s.name}`, 'delete', () => client.deleteInternalSquad(s.uuid), { kind: 'squad', uuid: s.uuid, name: s.name, data: s });
            return { deleted: true, squad: s.name, backup };
        }),
    );

    server.tool(
        'squads_reorder',
        'Reorder internal squads (names/uuids in desired order; others follow)',
        { order: z.array(z.string()) },
        ({ order }) =>
            run(async () => {
                const idx = await fleet.index(true);
                const first = order.map((r) => idx.squad(r));
                const set = new Set(first.map((s) => s.uuid));
                const rest = [...idx.squads].sort((a, b) => (a.viewPosition ?? 0) - (b.viewPosition ?? 0)).filter((s) => !set.has(s.uuid));
                const items = [...first, ...rest].map((s, i) => ({ uuid: s.uuid, viewPosition: i }));
                await journaled(ctx, 'squads_reorder', 'squads', first.map((s) => s.name).join(', '), () => client.reorderInternalSquads({ items }));
                return { order: [...first, ...rest].map((s) => s.name) };
            }),
    );

    server.tool(
        'squads_add_users',
        'Add specific users (by numeric id) to an internal squad',
        { squad: squadRef, userIds: z.array(z.number().int()).min(1) },
        ({ squad, userIds }) =>
            run(async () => {
                const s = (await fleet.index()).squad(squad);
                await journaled(ctx, 'squads_add_users', `squad ${s.name}`, `+${userIds.length} user(s): ${userIds.slice(0, 20).join(', ')}`, () => client.addUsersToSquad(s.uuid, userIds));
                return { success: true, squad: s.name, added: userIds.length };
            }),
    );

    server.tool(
        'squads_remove_users',
        'Remove specific users (by numeric id) from an internal squad',
        { squad: squadRef, userIds: z.array(z.number().int()).min(1) },
        ({ squad, userIds }) =>
            run(async () => {
                const s = (await fleet.index()).squad(squad);
                await journaled(ctx, 'squads_remove_users', `squad ${s.name}`, `−${userIds.length} user(s): ${userIds.slice(0, 20).join(', ')}`, () =>
                    client.removeUsersFromSquad(s.uuid, userIds),
                );
                return { success: true, squad: s.name, removed: userIds.length };
            }),
    );

    server.tool(
        'squads_add_all_users',
        'Add EVERY user of the panel to an internal squad. Requires confirmName.',
        { squad: squadRef, confirmName: z.string().optional() },
        ({ squad, confirmName }) =>
            run(async () => {
                const s = (await fleet.index()).squad(squad);
                if (confirmName !== s.name) return { done: false, next: `This adds ALL users to ${s.name}. Repeat with confirmName:"${s.name}"` };
                await journaled(ctx, 'squads_add_all_users', `squad ${s.name}`, 'add ALL users', () => client.addAllUsersToSquad(s.uuid));
                return { success: true };
            }),
    );

    server.tool(
        'squads_remove_all_users',
        'Remove EVERY user from an internal squad. Requires confirmName.',
        { squad: squadRef, confirmName: z.string().optional() },
        ({ squad, confirmName }) =>
            run(async () => {
                const s = (await fleet.index()).squad(squad);
                if (confirmName !== s.name) return { done: false, next: `This removes ALL ${s.info?.membersCount} users from ${s.name}. Repeat with confirmName:"${s.name}"` };
                await journaled(ctx, 'squads_remove_all_users', `squad ${s.name}`, 'remove ALL users', () => client.removeAllUsersFromSquad(s.uuid));
                return { success: true };
            }),
    );
}
