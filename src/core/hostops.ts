import { z } from 'zod';
import { Fleet, FleetIndex, Host, injectEntries, ResolvedPool, Template } from './fleet.js';

export const hostFilterSchema = z
    .object({
        uuids: z.array(z.string()).optional().describe('Exact host uuids'),
        text: z.string().optional().describe('Case-insensitive substring of remark/address/sni/host/path/description'),
        remarkRegex: z.string().optional().describe('JS regex on remark'),
        address: z.string().optional().describe('Substring of address'),
        sni: z.string().optional().describe('Substring of sni'),
        port: z.number().optional(),
        node: z.string().optional().describe('Bound to this node (name/uuid)'),
        inbound: z.string().optional().describe('Inbound tag (exact) or uuid'),
        inboundRegex: z.string().optional().describe('JS regex on inbound tag'),
        profile: z.string().optional().describe('Config profile name/uuid of the inbound'),
        tag: z.string().optional().describe('Host tag, exact'),
        tagRegex: z.string().optional().describe('JS regex matched against host tags (like a template selector)'),
        template: z.string().optional().describe('xrayJsonTemplate name/uuid the host renders with'),
        state: z.enum(['any', 'enabled', 'visible', 'hidden', 'disabled']).optional().describe('Default any'),
    })
    .describe('Host selection; all given conditions must hold');

export type HostFilter = z.infer<typeof hostFilterSchema>;

export async function filterHosts(fleet: Fleet, idx: FleetIndex, f: HostFilter): Promise<Host[]> {
    let hs = idx.hostsSorted;
    if (f.uuids?.length) {
        const want = new Set(f.uuids.map((u) => idx.host(u).uuid));
        hs = hs.filter((h) => want.has(h.uuid));
    }
    if (f.text) {
        const t = f.text.toLowerCase();
        hs = hs.filter((h) => [h.remark, h.address, h.sni, h.host, h.path, h.serverDescription].some((v) => typeof v === 'string' && v.toLowerCase().includes(t)));
    }
    if (f.remarkRegex) {
        const re = new RegExp(f.remarkRegex);
        hs = hs.filter((h) => re.test(h.remark));
    }
    if (f.address) hs = hs.filter((h) => (h.address ?? '').includes(f.address!));
    if (f.sni) hs = hs.filter((h) => (h.sni ?? '').includes(f.sni!));
    if (f.port !== undefined) hs = hs.filter((h) => h.port === f.port);
    if (f.node) {
        const n = idx.node(f.node);
        hs = hs.filter((h) => (h.nodes ?? []).includes(n.uuid));
    }
    if (f.inbound) {
        const ib = idx.inbound(f.inbound);
        hs = hs.filter((h) => h.inbound?.configProfileInboundUuid === ib.uuid);
    }
    if (f.inboundRegex) {
        const re = new RegExp(f.inboundRegex);
        hs = hs.filter((h) => {
            const ib = idx.inboundByUuid.get(h.inbound?.configProfileInboundUuid ?? '');
            return ib ? re.test(ib.tag) : false;
        });
    }
    if (f.profile) {
        const p = idx.profile(f.profile);
        hs = hs.filter((h) => h.inbound?.configProfileUuid === p.uuid);
    }
    if (f.tag) hs = hs.filter((h) => (h.tags ?? []).includes(f.tag!));
    if (f.tagRegex) {
        const re = new RegExp(f.tagRegex);
        hs = hs.filter((h) => (h.tags ?? []).some((t) => re.test(t)));
    }
    if (f.template) {
        const t = await fleet.findTemplate(f.template);
        hs = hs.filter((h) => h.xrayJsonTemplateUuid === t.uuid);
    }
    switch (f.state ?? 'any') {
        case 'enabled':
            hs = hs.filter((h) => !h.isDisabled);
            break;
        case 'visible':
            hs = hs.filter((h) => !h.isDisabled && !h.isHidden);
            break;
        case 'hidden':
            hs = hs.filter((h) => !h.isDisabled && h.isHidden);
            break;
        case 'disabled':
            hs = hs.filter((h) => h.isDisabled);
            break;
    }
    return hs;
}

export function allPools(idx: FleetIndex, templates: Template[]): ResolvedPool[] {
    const out: ResolvedPool[] = [];
    for (const t of templates) injectEntries(t).forEach((e, i) => out.push(idx.resolveEntry(t, i, e)));
    return out;
}

export interface PoolImpact {
    emptied: string[];
    firstChanged: string[];
    lost: string[];
    gained: string[];
    danglingUuids: string[];
}

/**
 * Compare every pool of every template between the current fleet and a hypothetical one
 * (hosts disabled / deleted / retagged / hidden / moved). This is the check that would
 * have caught "location routes to block": the only member of a uuid-pool got disabled.
 */
export function poolImpact(before: FleetIndex, after: FleetIndex, templates: Template[]): PoolImpact {
    const a = allPools(before, templates);
    const b = allPools(after, templates);
    const imp: PoolImpact = { emptied: [], firstChanged: [], lost: [], gained: [], danglingUuids: [] };
    for (let i = 0; i < a.length; i++) {
        const pa = a[i];
        const pb = b[i];
        const label = `${pa.template} #${pa.index} ${pa.selector}`;
        const ma = pa.members.map((m) => m.uuid);
        const mb = pb.members.map((m) => m.uuid);
        if (ma.length && !mb.length) imp.emptied.push(`${label}: loses its only member(s) ${pa.members.map((m) => m.remark).join('; ')}`);
        else if (ma[0] && mb[0] && ma[0] !== mb[0]) {
            imp.firstChanged.push(`${label}: first member (tag "${pa.members[0].outboundTag}", fallback target) ${pa.members[0].remark} → ${pb.members[0].remark}`);
        }
        const lost = pa.members.filter((m) => !mb.includes(m.uuid));
        const gained = pb.members.filter((m) => !ma.includes(m.uuid));
        if (lost.length && mb.length) imp.lost.push(`${label}: −${lost.map((m) => m.remark).join('; ')}`);
        if (gained.length) imp.gained.push(`${label}: +${gained.map((m) => m.remark).join('; ')}`);
        const newMissing = pb.missing.filter((u) => !pa.missing.includes(u));
        if (newMissing.length) imp.danglingUuids.push(`${label}: will reference deleted host(s) ${newMissing.join(', ')}`);
    }
    return imp;
}

export function compactImpact(imp: PoolImpact, limit = 25) {
    const cut = (a: string[]) => (a.length > limit ? [...a.slice(0, limit), `… +${a.length - limit} more`] : a);
    const o: Record<string, string[]> = {};
    if (imp.emptied.length) o.emptiedPools = cut(imp.emptied);
    if (imp.danglingUuids.length) o.danglingUuids = cut(imp.danglingUuids);
    if (imp.firstChanged.length) o.fallbackChanged = cut(imp.firstChanged);
    if (imp.lost.length) o.membersLost = cut(imp.lost);
    if (imp.gained.length) o.membersGained = cut(imp.gained);
    return o;
}

/** A FleetIndex with some hosts replaced / removed / re-positioned. */
export function hypothetical(idx: FleetIndex, changed: Host[], removed: Set<string> = new Set()): FleetIndex {
    const byUuid = new Map(changed.map((h) => [h.uuid, h]));
    const hosts = idx.hosts.filter((h) => !removed.has(h.uuid)).map((h) => byUuid.get(h.uuid) ?? h);
    for (const h of changed) if (!idx.hostByUuid.has(h.uuid)) hosts.push(h);
    return new FleetIndex(idx.nodes, hosts, idx.profiles, idx.squads);
}
