import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Any, FleetIndex, Profile } from '../core/fleet.js';
import { applyOps, Op, resolve } from '../core/jsonedit.js';
import { applyParams, Ctx, journaled, PlanTarget, runPlan } from '../core/plan.js';
import { inboundRow, profileRow, xraySummary } from '../core/views.js';
import { run } from './helpers.js';

const profileRef = z.string().describe('Config profile name or uuid');

export const opSchema = z
    .object({
        op: z.enum(['replace', 'set', 'add', 'remove', 'test', 'move', 'copy', 'merge', 'insert', 'array_add', 'array_remove', 'replace_string']),
        path: z.string().optional().describe('Target path, e.g. /outbounds[tag=relay-out]/settings/vnext/0/address'),
        from: z.string().optional().describe('Source path for move/copy'),
        value: z.unknown().optional().describe('Value for replace/set/add/test/merge/insert'),
        values: z.array(z.unknown()).optional().describe('Values for array_add / array_remove'),
        position: z.enum(['before', 'after', 'start', 'end']).optional().describe('insert: before/after the element at path; array_add: start/end'),
        before: z.unknown().optional().describe('array_add: insert before this existing value'),
        after: z.unknown().optional().describe('array_add: insert after this existing value'),
        allowDuplicates: z.boolean().optional(),
        ignoreMissing: z.boolean().optional(),
        find: z.string().optional().describe('replace_string: text (or regex) to find in string values'),
        replace: z.string().optional().describe('replace_string: replacement'),
        regex: z.boolean().optional(),
        keys: z.array(z.string()).optional().describe('replace_string: only in values of these keys (e.g. ["address"])'),
        expect: z.number().int().optional().describe('replace_string: exact number of replacements required'),
    })
    .describe('One edit operation');

export const OPS_HELP = `Paths: JSON-Pointer with selectors — /inbounds[tag=X]/streamSettings/realitySettings/dest, /routing/rules[ruleTag=Y], /routing/balancers[tag=Z]/selector, /outbounds[tag=W]/settings/vnext/0/address. [k=v] must match exactly one element; [k~=v] = array field contains v; several [..][..] = AND.
Ops: replace (must exist) | set (create or replace) | add (JSON-Patch add; "-" appends) | remove | test (assert value) | move/copy (from→path) | merge (RFC 7386 merge into object; null deletes) | insert (value before/after the element at path) | array_add (values into array; before/after an existing value, or start/end; skips duplicates) | array_remove (values out of array) | replace_string (find→replace in all string values under path; regex; keys filter; expect = exact count).`;

export function toOps(raw: Array<z.infer<typeof opSchema>>): Op[] {
    return raw.map((o) => {
        const pos = o.position;
        switch (o.op) {
            case 'insert':
                return { op: 'insert', path: o.path!, position: pos === 'after' ? 'after' : 'before', value: o.value };
            case 'array_add':
                return {
                    op: 'array_add',
                    path: o.path!,
                    values: o.values ?? [],
                    position: pos === 'start' ? 'start' : 'end',
                    before: o.before,
                    after: o.after,
                    allowDuplicates: o.allowDuplicates,
                };
            case 'array_remove':
                return { op: 'array_remove', path: o.path!, values: o.values ?? [], ignoreMissing: o.ignoreMissing };
            case 'replace_string':
                if (o.find === undefined || o.replace === undefined) throw new Error('replace_string needs find and replace');
                return { op: 'replace_string', path: o.path, find: o.find, replace: o.replace, regex: o.regex, keys: o.keys, expect: o.expect };
            case 'move':
            case 'copy':
                return { op: o.op, from: o.from!, path: o.path! };
            case 'remove':
                return { op: 'remove', path: o.path! };
            case 'merge':
                return { op: 'merge', path: o.path!, value: o.value as Record<string, unknown> };
            default:
                if (!o.path) throw new Error(`${o.op} needs path`);
                return { op: o.op, path: o.path, value: o.value } as Op;
        }
    });
}

/** Checks that decide whether a profile edit is safe to send. */
export function profileChecks(idx: FleetIndex, prof: Profile, before: Any, after: Any, allowInboundRemoval: boolean) {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const tagsOf = (c: Any) => ((c.inbounds ?? []) as Any[]).map((i) => i?.tag as string);
    const bt = tagsOf(before);
    const at = tagsOf(after);
    const dup = at.filter((t, i) => at.indexOf(t) !== i);
    if (dup.length) blockers.push(`duplicate inbound tags: ${[...new Set(dup)].join(', ')}`);
    if (at.some((t) => !t)) blockers.push('an inbound has no tag');
    const removed = bt.filter((t) => !at.includes(t));
    for (const t of removed) {
        const ib = prof.inbounds.find((i) => i.tag === t);
        const hosts = ib ? idx.hostsByInbound.get(ib.uuid) ?? [] : [];
        const squads = ib ? idx.squadsByInbound.get(ib.uuid) ?? [] : [];
        const nodes = ib ? idx.nodesByInbound.get(ib.uuid) ?? [] : [];
        const msg = `inbound ${t} disappears: ${hosts.length} host(s) lose their inbound (set NULL), ${squads.length} squad link(s) and ${nodes.length} node binding(s) are deleted. Renaming a tag counts as delete+create (new uuid).`;
        if (allowInboundRemoval) warnings.push(msg);
        else blockers.push(msg + ' Pass allowInboundRemoval to proceed.');
    }
    const added = at.filter((t) => !bt.includes(t));
    for (const t of added) {
        const other = (idx.inboundsByTag.get(t) ?? []).filter((i) => i.profileUuid !== prof.uuid);
        if (other.length) blockers.push(`inbound tag ${t} already exists in profile ${other[0].profileName} (panel answers 409 A113)`);
    }
    if (added.length) warnings.push(`new inbound(s) ${added.join(', ')}: bind them to nodes (node_inbounds_edit) and add to squads, or they listen nowhere / reach nobody`);
    // routing references
    const outTags = new Set(((after.outbounds ?? []) as Any[]).map((o) => o?.tag));
    const balTags = new Set(((after.routing?.balancers ?? []) as Any[]).map((b) => b?.tag));
    const inTags = new Set(at);
    ((after.routing?.rules ?? []) as Any[]).forEach((r, i) => {
        if (r?.outboundTag && !outTags.has(r.outboundTag)) warnings.push(`rule #${i}: outboundTag "${r.outboundTag}" does not exist`);
        if (r?.balancerTag && !balTags.has(r.balancerTag)) warnings.push(`rule #${i}: balancerTag "${r.balancerTag}" does not exist`);
        for (const it of (r?.inboundTag ?? []) as string[]) if (!inTags.has(it)) warnings.push(`rule #${i}: inboundTag "${it}" does not exist`);
    });
    for (const b of (after.routing?.balancers ?? []) as Any[]) {
        for (const pre of (b?.selector ?? []) as string[]) if (![...outTags].some((t) => String(t).startsWith(pre))) warnings.push(`balancer ${b.tag}: selector "${pre}" matches no outbound`);
        if (b?.fallbackTag && !outTags.has(b.fallbackTag)) warnings.push(`balancer ${b.tag}: fallbackTag "${b.fallbackTag}" does not exist`);
    }
    // only report routing problems that the edit introduced
    const beforeWarn = new Set(profileRoutingWarnings(before));
    const filtered = warnings.filter((w) => !/^(rule|balancer) /.test(w) || !beforeWarn.has(w));
    const nodes = prof.nodes ?? [];
    if (nodes.length) filtered.push(`panel restarts xray on ${nodes.length} node(s) using this profile (${nodes.map((n) => n.name).join(', ')}) — connections drop for ~1 min`);
    return { blockers, warnings: filtered };
}

function profileRoutingWarnings(c: Any): string[] {
    const w: string[] = [];
    const outTags = new Set(((c.outbounds ?? []) as Any[]).map((o) => o?.tag));
    const balTags = new Set(((c.routing?.balancers ?? []) as Any[]).map((b) => b?.tag));
    const inTags = new Set(((c.inbounds ?? []) as Any[]).map((i) => i?.tag));
    ((c.routing?.rules ?? []) as Any[]).forEach((r, i) => {
        if (r?.outboundTag && !outTags.has(r.outboundTag)) w.push(`rule #${i}: outboundTag "${r.outboundTag}" does not exist`);
        if (r?.balancerTag && !balTags.has(r.balancerTag)) w.push(`rule #${i}: balancerTag "${r.balancerTag}" does not exist`);
        for (const it of (r?.inboundTag ?? []) as string[]) if (!inTags.has(it)) w.push(`rule #${i}: inboundTag "${it}" does not exist`);
    });
    for (const b of (c.routing?.balancers ?? []) as Any[]) {
        for (const pre of (b?.selector ?? []) as string[]) if (![...outTags].some((t) => String(t).startsWith(pre))) w.push(`balancer ${b.tag}: selector "${pre}" matches no outbound`);
        if (b?.fallbackTag && !outTags.has(b.fallbackTag)) w.push(`balancer ${b.tag}: fallbackTag "${b.fallbackTag}" does not exist`);
    }
    return w;
}

export function profileTarget(ctx: Ctx, idx: FleetIndex, prof: Profile, after: Any, allowInboundRemoval: boolean, extra?: Partial<PlanTarget>): PlanTarget {
    const checks = profileChecks(idx, prof, prof.config, after, allowInboundRemoval);
    return {
        kind: 'config-profile',
        uuid: prof.uuid,
        name: prof.name,
        backup: prof,
        before: prof.config,
        after,
        blockers: checks.blockers,
        warnings: checks.warnings,
        write: () => ctx.client.updateConfigProfile({ uuid: prof.uuid, config: after }),
        readBack: async () => (((await ctx.client.getConfigProfileByUuid(prof.uuid)) as Any).response as Profile).config,
        ...extra,
    };
}

export function registerInboundTools(server: McpServer, ctx: Ctx) {
    const { client, fleet } = ctx;
    const readonly = ctx.config.readonly;

    server.tool('config_profiles_list', 'List config profiles: counts of inbounds/outbounds/rules and the nodes using each', {}, () =>
        run(async () => (await fleet.index()).profiles.map(profileRow)),
    );

    server.tool(
        'config_profile_read',
        `Read a config profile without drowning in it. view: summary (outbounds with targets, balancers, rules with matches) | inbounds (table: port, protocol, dest/SNI, nodes, squads, hosts) | path (subtree at path) | raw (whole config, usually spilled to a file). REALITY private keys are masked. ${OPS_HELP.split('\n')[0]}`,
        {
            profile: profileRef,
            view: z.enum(['summary', 'inbounds', 'path', 'raw']).default('summary'),
            path: z.string().optional().describe('For view=path, e.g. /outbounds[tag=relay-out] or /routing/rules/3'),
            inboundFilter: z.string().optional().describe('For view=inbounds: substring of tag'),
        },
        ({ profile, view, path, inboundFilter }) =>
            run(async () => {
                const idx = await fleet.index();
                const p = idx.profile(profile);
                if (view === 'raw') return p.config;
                if (view === 'path') {
                    if (!path) throw new Error('view=path needs path');
                    const r = resolve(p.config, path);
                    return { profile: p.name, path, pointer: r.pointer, value: r.value };
                }
                if (view === 'inbounds') {
                    const rows = p.inbounds.filter((i) => !inboundFilter || i.tag.includes(inboundFilter)).map((i) => inboundRow({ ...i, profileName: p.name }, idx));
                    return { profile: p.name, total: rows.length, inbounds: rows };
                }
                return { ...profileRow(p), ...xraySummary(p.config) };
            }),
    );

    server.tool(
        'inbounds_list',
        'List inbounds across profiles as compact rows (tag, port, protocol, REALITY dest/SNI) with the nodes that bind them, squads that include them and number of enabled hosts. Filter to keep it short.',
        {
            profile: z.string().optional().describe('Profile name/uuid'),
            tag: z.string().optional().describe('Substring of tag'),
            tagRegex: z.string().optional(),
            port: z.number().int().optional(),
            node: z.string().optional().describe('Only inbounds bound on this node'),
            orphans: z.boolean().optional().describe('Only inbounds with no node binding or no squad'),
        },
        (f) =>
            run(async () => {
                const idx = await fleet.index();
                let ibs = [...idx.inboundByUuid.values()];
                if (f.profile) {
                    const p = idx.profile(f.profile);
                    ibs = ibs.filter((i) => i.profileUuid === p.uuid);
                }
                if (f.tag) ibs = ibs.filter((i) => i.tag.includes(f.tag!));
                if (f.tagRegex) {
                    const re = new RegExp(f.tagRegex);
                    ibs = ibs.filter((i) => re.test(i.tag));
                }
                if (f.port !== undefined) ibs = ibs.filter((i) => i.port === f.port);
                if (f.node) {
                    const n = idx.node(f.node);
                    const bound = new Set((n.configProfile?.activeInbounds ?? []).map((i) => i.uuid));
                    ibs = ibs.filter((i) => bound.has(i.uuid));
                }
                if (f.orphans) ibs = ibs.filter((i) => !(idx.nodesByInbound.get(i.uuid) ?? []).length || !(idx.squadsByInbound.get(i.uuid) ?? []).length);
                return { total: ibs.length, inbounds: ibs.map((i) => inboundRow(i, idx)) };
            }),
    );

    server.tool('config_profiles_get_computed_config', 'Computed configuration of a profile as the panel sends it to nodes (large; spilled to a file)', { profile: profileRef }, ({ profile }) =>
        run(async () => client.getComputedConfigByProfileUuid((await fleet.index()).profile(profile).uuid)),
    );

    if (readonly) return;

    server.tool(
        'config_profile_patch',
        `Edit a config profile surgically: a list of operations on paths, applied to a fresh copy, then diffed. Dry run by default; apply with the planHash. Blocks removal/renaming of inbounds that hosts, squads or nodes use (unless allowInboundRemoval), duplicate tags and tags already used in another profile; warns about routing references that point nowhere. The panel restarts every node of the profile on write. A backup of the profile is saved.
${OPS_HELP}`,
        {
            profile: profileRef,
            ops: z.array(opSchema).min(1),
            allowInboundRemoval: z.boolean().default(false),
            ...applyParams,
        },
        (p) =>
            run(() =>
                runPlan(ctx, 'config_profile_patch', p, async () => {
                    const idx = await fleet.index();
                    const prof = idx.profile(p.profile);
                    const { doc, results } = applyOps(prof.config, toOps(p.ops));
                    return [profileTarget(ctx, idx, prof, doc as Any, p.allowInboundRemoval, { info: { ops: results } })];
                }),
            ),
    );

    server.tool(
        'config_profiles_update',
        'Replace a profile config wholesale (or rename it). Prefer config_profile_patch; this one exists for restoring or bulk rewrites. Same dry-run/apply protocol and inbound safety checks.',
        {
            profile: profileRef,
            name: z.string().optional().describe('New name'),
            config: z.record(z.unknown()).optional().describe('Full xray configuration object; replaces the stored one'),
            allowInboundRemoval: z.boolean().default(false),
            ...applyParams,
        },
        (p) =>
            run(async () => {
                if (!p.config && p.name) {
                    const idx = await fleet.index();
                    const prof = idx.profile(p.profile);
                    await journaled(ctx, 'config_profiles_update', `profile ${prof.name}`, `rename → ${p.name}`, () => client.updateConfigProfile({ uuid: prof.uuid, name: p.name }));
                    return { renamed: `${prof.name} → ${p.name}` };
                }
                if (!p.config) throw new Error('nothing to update');
                return runPlan(ctx, 'config_profiles_update', p, async () => {
                    const idx = await fleet.index();
                    const prof = idx.profile(p.profile);
                    return [
                        profileTarget(ctx, idx, prof, p.config as Any, p.allowInboundRemoval, {
                            write: () => client.updateConfigProfile({ uuid: prof.uuid, config: p.config, ...(p.name ? { name: p.name } : {}) }),
                        }),
                    ];
                });
            }),
    );

    server.tool(
        'config_profiles_create',
        'Create a config profile. Inbound tags must be unique across ALL profiles (the panel answers 409 A113 otherwise) — checked before sending.',
        { name: z.string(), config: z.record(z.unknown()) },
        ({ name, config }) =>
            run(async () => {
                const idx = await fleet.index();
                const tags = ((config.inbounds ?? []) as Any[]).map((i) => i?.tag);
                const clash = tags.filter((t) => idx.inboundsByTag.has(t));
                if (clash.length) throw new Error(`inbound tags already exist in other profiles: ${clash.slice(0, 20).join(', ')}`);
                const { result } = await journaled(ctx, 'config_profiles_create', `profile ${name}`, `create with ${tags.length} inbound(s)`, () => client.createConfigProfile({ name, config }));
                return profileRow((result as Any).response as Profile);
            }),
    );

    server.tool(
        'config_profiles_delete',
        'Delete a config profile (all its inbounds go: host bindings are nulled, squad links and node bindings deleted). Call without confirmName to see the impact.',
        { profile: profileRef, confirmName: z.string().optional() },
        ({ profile, confirmName }) =>
            run(async () => {
                const idx = await fleet.index(true);
                const prof = idx.profile(profile);
                const hosts = prof.inbounds.flatMap((i) => idx.hostsByInbound.get(i.uuid) ?? []);
                const impact = {
                    profile: prof.name,
                    nodes: (prof.nodes ?? []).map((n) => n.name),
                    inbounds: prof.inbounds.length,
                    hostsLosingInbound: hosts.length,
                    enabledHosts: hosts.filter((h) => !h.isDisabled).length,
                    squadLinks: prof.inbounds.reduce((a, i) => a + (idx.squadsByInbound.get(i.uuid) ?? []).length, 0),
                };
                if (confirmName !== prof.name) return { deleted: false, impact, next: `Repeat with confirmName:"${prof.name}" to delete.` };
                const { backup } = await journaled(ctx, 'config_profiles_delete', `profile ${prof.name}`, 'delete', () => client.deleteConfigProfile(prof.uuid), {
                    kind: 'config-profile',
                    uuid: prof.uuid,
                    name: prof.name,
                    data: prof,
                });
                return { deleted: true, impact, backup };
            }),
    );

    server.tool(
        'config_profiles_reorder',
        'Reorder config profiles; pass names/uuids in the desired order (others follow)',
        { order: z.array(z.string()) },
        ({ order }) =>
            run(async () => {
                const idx = await fleet.index(true);
                const first = order.map((r) => idx.profile(r));
                const set = new Set(first.map((p) => p.uuid));
                const rest = [...idx.profiles].sort((a, b) => (a.viewPosition ?? 0) - (b.viewPosition ?? 0)).filter((p) => !set.has(p.uuid));
                const items = [...first, ...rest].map((p, i) => ({ uuid: p.uuid, viewPosition: i }));
                await journaled(ctx, 'config_profiles_reorder', 'profiles', first.map((p) => p.name).join(', '), () => client.reorderConfigProfiles({ items }));
                return { order: [...first, ...rest].map((p) => p.name) };
            }),
    );
}
