import { RemnawaveClient } from '../client/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = Record<string, any>;

export interface Inbound {
    uuid: string;
    profileUuid: string;
    tag: string;
    type: string;
    network: string | null;
    security: string | null;
    port: number | null;
    rawInbound?: Any;
}
export interface Node extends Any {
    uuid: string;
    name: string;
    isConnected: boolean;
    isDisabled: boolean;
    configProfile: { activeConfigProfileUuid: string | null; activeInbounds: Inbound[] } | null;
}
export interface Host extends Any {
    uuid: string;
    viewPosition: number;
    remark: string;
    address: string;
    port: number;
    isDisabled: boolean;
    isHidden: boolean;
    tags: string[];
    nodes: string[];
    inbound: { configProfileUuid: string | null; configProfileInboundUuid: string | null } | null;
    xrayJsonTemplateUuid: string | null;
}
export interface Profile extends Any {
    uuid: string;
    name: string;
    config: Any;
    inbounds: Inbound[];
    nodes: Array<{ uuid: string; name: string }>;
}
export interface Squad extends Any {
    uuid: string;
    name: string;
    info: { membersCount: number; inboundsCount: number };
    inbounds: Inbound[];
}
export interface TemplateMeta {
    uuid: string;
    name: string;
    templateType: string;
    viewPosition: number;
    tags?: string[];
}
export interface Template extends TemplateMeta {
    templateJson: Any | null;
    encodedTemplateYaml: string | null;
}

export interface InjectEntry {
    selector: { type: 'uuids'; values: string[] } | { type: 'tagRegex' | 'remarkRegex'; pattern: string } | { type: 'sameTagAsRecipient' };
    selectFrom?: 'ALL' | 'HIDDEN' | 'NOT_HIDDEN';
    tagPrefix?: string;
    useHostRemarkAsTag?: boolean;
    useHostTagAsTag?: boolean;
}

export interface PoolMember {
    uuid: string;
    remark: string;
    outboundTag: string;
    hidden: boolean;
}
export interface ResolvedPool {
    template: string;
    templateUuid: string;
    index: number;
    selector: string;
    selectFrom: string;
    tagPrefix: string | null;
    members: PoolMember[];
    /** uuids listed in a uuids-selector that no longer exist */
    missing: string[];
    /** uuids listed that exist but are disabled or excluded by selectFrom (silently skipped by the panel) */
    skipped: Array<{ uuid: string; remark: string; why: string }>;
    note?: string;
}

const TTL_MS = 20_000;

/**
 * An in-memory snapshot of the panel with the joins that used to be done in psql:
 * inbound ↔ profile ↔ nodes ↔ squads ↔ hosts ↔ templates. Rebuilt lazily, dropped on
 * every write made through the client.
 */
export class Fleet {
    private baseCache: { at: number; idx: FleetIndex } | null = null;
    private basePending: Promise<FleetIndex> | null = null;
    private tplList: { at: number; list: TemplateMeta[] } | null = null;
    private tplCache = new Map<string, { at: number; tpl: Template }>();

    constructor(private client: RemnawaveClient) {
        client.onWrite(() => this.invalidate());
    }

    /** Drop nodes/hosts/profiles/squads; templates stay (they are re-read explicitly when edited). */
    invalidateBase() {
        this.baseCache = null;
    }

    invalidate() {
        this.baseCache = null;
        this.tplList = null;
        this.tplCache.clear();
    }

    async index(fresh = false): Promise<FleetIndex> {
        if (!fresh && this.baseCache && Date.now() - this.baseCache.at < TTL_MS) return this.baseCache.idx;
        if (!fresh && this.basePending) return this.basePending;
        this.basePending = (async () => {
            const [nodes, hosts, profiles, squads] = await Promise.all([
                this.client.getNodes() as Promise<Any>,
                this.client.getHosts() as Promise<Any>,
                this.client.getConfigProfiles() as Promise<Any>,
                this.client.getInternalSquads() as Promise<Any>,
            ]);
            const idx = new FleetIndex(
                nodes.response as Node[],
                hosts.response as Host[],
                profiles.response.configProfiles as Profile[],
                squads.response.internalSquads as Squad[],
            );
            this.baseCache = { at: Date.now(), idx };
            return idx;
        })();
        try {
            return await this.basePending;
        } finally {
            this.basePending = null;
        }
    }

    async templateList(fresh = false): Promise<TemplateMeta[]> {
        if (!fresh && this.tplList && Date.now() - this.tplList.at < TTL_MS) return this.tplList.list;
        const r = (await this.client.getSubscriptionTemplates()) as Any;
        const list = (r.response.templates as TemplateMeta[]).map(({ uuid, name, templateType, viewPosition, tags }) => ({
            uuid,
            name,
            templateType,
            viewPosition,
            tags,
        }));
        this.tplList = { at: Date.now(), list };
        return list;
    }

    async template(uuid: string, fresh = false): Promise<Template> {
        const c = this.tplCache.get(uuid);
        if (!fresh && c && Date.now() - c.at < TTL_MS * 3) return c.tpl;
        const r = (await this.client.getSubscriptionTemplate(uuid)) as Any;
        const tpl = r.response as Template;
        this.tplCache.set(uuid, { at: Date.now(), tpl });
        return tpl;
    }

    /** Find a template by uuid or name (name may be ambiguous across types; XRAY_JSON wins). */
    async findTemplate(ref: string): Promise<TemplateMeta> {
        const list = await this.templateList();
        const byUuid = list.find((t) => t.uuid === ref);
        if (byUuid) return byUuid;
        const byName = list.filter((t) => t.name === ref);
        if (byName.length === 1) return byName[0];
        const xr = byName.filter((t) => t.templateType === 'XRAY_JSON');
        if (xr.length === 1) return xr[0];
        if (!byName.length) {
            const ci = list.filter((t) => t.name.toLowerCase() === ref.toLowerCase());
            if (ci.length === 1) return ci[0];
            throw new Error(`template "${ref}" not found`);
        }
        throw new Error(`template name "${ref}" is ambiguous (${byName.map((t) => `${t.templateType}:${t.uuid}`).join(', ')}); pass the uuid`);
    }

    /** Load full templates, optionally filtered. Sequential-ish through the client throttle. */
    async templates(filter?: { type?: string; nameRegex?: string; names?: string[] }, fresh = false): Promise<Template[]> {
        let list = await this.templateList(fresh);
        if (filter?.type) list = list.filter((t) => t.templateType === filter.type);
        if (filter?.names?.length) {
            const want = new Set(filter.names);
            list = list.filter((t) => want.has(t.name) || want.has(t.uuid));
        }
        if (filter?.nameRegex) {
            const re = new RegExp(filter.nameRegex);
            list = list.filter((t) => re.test(t.name));
        }
        const out: Template[] = [];
        const queue = [...list];
        const workers = Array.from({ length: 3 }, async () => {
            for (let t = queue.shift(); t; t = queue.shift()) out.push(await this.template(t.uuid, fresh));
        });
        await Promise.all(workers);
        return out.sort((a, b) => a.viewPosition - b.viewPosition);
    }
}

export class FleetIndex {
    readonly nodeByUuid = new Map<string, Node>();
    readonly hostByUuid = new Map<string, Host>();
    readonly profileByUuid = new Map<string, Profile>();
    readonly squadByUuid = new Map<string, Squad>();
    readonly inboundByUuid = new Map<string, Inbound & { profileName: string }>();
    readonly inboundsByTag = new Map<string, Array<Inbound & { profileName: string }>>();
    readonly nodesByInbound = new Map<string, Node[]>();
    readonly squadsByInbound = new Map<string, Squad[]>();
    readonly hostsByInbound = new Map<string, Host[]>();
    readonly hostsByNode = new Map<string, Host[]>();
    readonly hostsSorted: Host[];

    constructor(
        readonly nodes: Node[],
        readonly hosts: Host[],
        readonly profiles: Profile[],
        readonly squads: Squad[],
    ) {
        const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
            const a = m.get(k);
            if (a) a.push(v);
            else m.set(k, [v]);
        };
        for (const p of profiles) {
            this.profileByUuid.set(p.uuid, p);
            for (const ib of p.inbounds ?? []) {
                const rec = { ...ib, profileName: p.name };
                this.inboundByUuid.set(ib.uuid, rec);
                push(this.inboundsByTag, ib.tag, rec);
            }
        }
        for (const n of nodes) {
            this.nodeByUuid.set(n.uuid, n);
            for (const ib of n.configProfile?.activeInbounds ?? []) push(this.nodesByInbound, ib.uuid, n);
        }
        for (const s of squads) {
            this.squadByUuid.set(s.uuid, s);
            for (const ib of s.inbounds ?? []) push(this.squadsByInbound, ib.uuid, s);
        }
        this.hostsSorted = [...hosts].sort((a, b) => a.viewPosition - b.viewPosition);
        for (const h of this.hostsSorted) {
            this.hostByUuid.set(h.uuid, h);
            const ib = h.inbound?.configProfileInboundUuid;
            if (ib) push(this.hostsByInbound, ib, h);
            for (const n of h.nodes ?? []) push(this.hostsByNode, n, h);
        }
    }

    node(ref: string): Node {
        const byUuid = this.nodeByUuid.get(ref);
        if (byUuid) return byUuid;
        const low = ref.toLowerCase();
        const exact = this.nodes.filter((n) => n.name.toLowerCase() === low);
        if (exact.length === 1) return exact[0];
        // "de2" → "de-hetzner-de2": match on the last dash-separated part
        const tail = this.nodes.filter((n) => n.name.toLowerCase().split('-').pop() === low);
        if (tail.length === 1) return tail[0];
        const sub = this.nodes.filter((n) => n.name.toLowerCase().includes(low));
        if (sub.length === 1) return sub[0];
        const cands = (tail.length ? tail : sub).map((n) => n.name);
        throw new Error(`node "${ref}" ${cands.length ? `is ambiguous: ${cands.join(', ')}` : 'not found'}`);
    }

    profile(ref: string): Profile {
        const p = this.profileByUuid.get(ref) ?? this.profiles.find((x) => x.name === ref) ?? this.profiles.find((x) => x.name.toLowerCase() === ref.toLowerCase());
        if (!p) throw new Error(`config profile "${ref}" not found (have: ${this.profiles.map((x) => x.name).join(', ')})`);
        return p;
    }

    squad(ref: string): Squad {
        const s = this.squadByUuid.get(ref) ?? this.squads.find((x) => x.name === ref) ?? this.squads.find((x) => x.name.toLowerCase() === ref.toLowerCase());
        if (!s) throw new Error(`internal squad "${ref}" not found`);
        return s;
    }

    /** Host by uuid or a unique uuid prefix (≥ 6 chars, as printed in reports). */
    host(uuid: string): Host {
        const h = this.hostByUuid.get(uuid);
        if (h) return h;
        if (uuid.length >= 6) {
            const m = this.hostsSorted.filter((x) => x.uuid.startsWith(uuid));
            if (m.length === 1) return m[0];
            if (m.length > 1) throw new Error(`host prefix ${uuid} is ambiguous (${m.length} hosts)`);
        }
        throw new Error(`host ${uuid} not found`);
    }

    /** Inbound by tag (tags are globally unique in the panel) or uuid. */
    inbound(ref: string): Inbound & { profileName: string } {
        const byUuid = this.inboundByUuid.get(ref);
        if (byUuid) return byUuid;
        const t = this.inboundsByTag.get(ref);
        if (!t?.length) throw new Error(`inbound "${ref}" not found`);
        if (t.length > 1) throw new Error(`inbound tag "${ref}" exists in several profiles: ${t.map((x) => x.profileName).join(', ')}`);
        return t[0];
    }

    nodeName(uuid: string) {
        return this.nodeByUuid.get(uuid)?.name ?? `?${uuid.slice(0, 8)}`;
    }

    /** Compact host row for listings. */
    hostRow(h: Host, extra: string[] = []): Any {
        const ib = h.inbound?.configProfileInboundUuid ? this.inboundByUuid.get(h.inbound.configProfileInboundUuid) : undefined;
        const row: Any = {
            uuid: h.uuid,
            pos: h.viewPosition,
            remark: h.remark,
            address: h.address,
            port: h.port,
            sni: h.sni || undefined,
            host: h.host || undefined,
            path: h.path || undefined,
            state: h.isDisabled ? 'disabled' : h.isHidden ? 'hidden' : 'visible',
            tags: h.tags?.length ? h.tags : undefined,
            inbound: ib ? ib.tag : h.inbound?.configProfileInboundUuid ? `?${h.inbound.configProfileInboundUuid}` : null,
            profile: ib?.profileName,
            nodes: (h.nodes ?? []).map((n) => this.nodeName(n)),
            desc: h.serverDescription || undefined,
        };
        for (const f of extra) row[f] = h[f];
        return row;
    }

    // ------------------------------------------------------------ pools

    /** Hosts the panel would consider for injection (enabled ones), in panel order. */
    private candidates(selectFrom: string | undefined, recipient?: Host): Host[] {
        const sf = selectFrom ?? 'HIDDEN';
        return this.hostsSorted.filter(
            (h) =>
                !h.isDisabled &&
                h.uuid !== recipient?.uuid &&
                (sf === 'ALL' || (sf === 'HIDDEN' && h.isHidden) || (sf === 'NOT_HIDDEN' && !h.isHidden)),
        );
    }

    /** Resolve one injectHosts entry the way the panel's xray-json generator does. */
    resolveEntry(tpl: TemplateMeta, index: number, e: InjectEntry, recipient?: Host): ResolvedPool {
        const sf = e.selectFrom ?? 'HIDDEN';
        const cands = this.candidates(sf, recipient);
        let picked: Host[] = [];
        const missing: string[] = [];
        const skipped: ResolvedPool['skipped'] = [];
        let selector = '';
        let note: string | undefined;
        const sel = e.selector;
        if (sel.type === 'uuids') {
            selector = `uuids(${sel.values.length})`;
            for (const u of sel.values) {
                const h = this.hostByUuid.get(u);
                if (!h) {
                    missing.push(u);
                    continue;
                }
                const c = cands.find((x) => x.uuid === u);
                if (c) picked.push(c);
                else skipped.push({ uuid: u, remark: h.remark, why: h.isDisabled ? 'disabled' : h.uuid === recipient?.uuid ? 'is the recipient' : `excluded by selectFrom=${sf}` });
            }
        } else if (sel.type === 'tagRegex' || sel.type === 'remarkRegex') {
            selector = `${sel.type}(${sel.pattern})`;
            let re: RegExp | null = null;
            try {
                re = new RegExp(sel.pattern);
            } catch (err) {
                note = `invalid regex: ${(err as Error).message}`;
            }
            if (re) {
                picked =
                    sel.type === 'tagRegex'
                        ? cands.filter((h) => (h.tags ?? []).some((t) => re!.test(t)))
                        : cands.filter((h) => re!.test(h.remark));
                if (sel.type === 'remarkRegex') note = 'matches the raw remark; the panel matches the rendered remark (templated remarks may differ)';
            }
        } else {
            selector = 'sameTagAsRecipient';
            if (!recipient) note = 'depends on the recipient host; resolved per visible host that uses this template';
            else picked = cands.filter((h) => (h.tags ?? []).some((t) => (recipient.tags ?? []).includes(t)));
        }
        const prefix = e.tagPrefix ?? 'proxy';
        const members: PoolMember[] = picked.map((h, i) => ({
            uuid: h.uuid,
            remark: h.remark,
            hidden: h.isHidden,
            outboundTag: e.useHostRemarkAsTag ? h.remark : e.useHostTagAsTag ? h.tags?.[0] || h.remark : i === 0 ? prefix : `${prefix}-${i + 1}`,
        }));
        return {
            template: tpl.name,
            templateUuid: tpl.uuid,
            index,
            selector,
            selectFrom: sf,
            tagPrefix: e.useHostRemarkAsTag ? '(remark)' : e.useHostTagAsTag ? '(host tag)' : prefix,
            members,
            missing,
            skipped,
            note,
        };
    }

    /** Visible (non-hidden, enabled) hosts that render a given template, i.e. the "locations" using it. */
    recipientsOf(tpl: TemplateMeta, defaultTplUuid?: string): Host[] {
        return this.hostsSorted.filter(
            (h) => !h.isDisabled && (h.xrayJsonTemplateUuid === tpl.uuid || (!h.xrayJsonTemplateUuid && defaultTplUuid === tpl.uuid)),
        );
    }
}

export function injectEntries(tpl: Template): InjectEntry[] {
    const rw = tpl.templateJson?.remnawave as Any | undefined;
    return Array.isArray(rw?.injectHosts) ? (rw!.injectHosts as InjectEntry[]) : [];
}

/**
 * Outbound tags a rendered template will contain and routing references that
 * point nowhere (the failure mode where a pool empties and its location silently routes to block).
 */
export function routingIssues(tpl: Template, pools: ResolvedPool[]): string[] {
    const j = tpl.templateJson;
    if (!j) return [];
    const issues: string[] = [];
    const tags = new Set<string>();
    for (const o of (j.outbounds ?? []) as Any[]) if (o?.tag) tags.add(o.tag);
    for (const p of pools) for (const m of p.members) tags.add(m.outboundTag);
    if ((j.remnawave as Any)?.addVirtualHostAsOutbound) tags.add('proxy');
    const balancers = ((j.routing?.balancers ?? []) as Any[]).filter(Boolean);
    const balancerTags = new Set(balancers.map((b) => b.tag));
    const tagList = [...tags];
    for (const b of balancers) {
        for (const pre of (b.selector ?? []) as string[]) {
            if (!tagList.some((t) => t.startsWith(pre))) issues.push(`balancer ${b.tag}: selector "${pre}" matches no outbound`);
        }
        if (b.fallbackTag && !tags.has(b.fallbackTag)) issues.push(`balancer ${b.tag}: fallbackTag "${b.fallbackTag}" does not exist`);
    }
    ((j.routing?.rules ?? []) as Any[]).forEach((r, i) => {
        if (r?.outboundTag && !tags.has(r.outboundTag)) issues.push(`routing rule #${i}: outboundTag "${r.outboundTag}" does not exist`);
        if (r?.balancerTag && !balancerTags.has(r.balancerTag)) issues.push(`routing rule #${i}: balancerTag "${r.balancerTag}" does not exist`);
    });
    for (const p of pools) {
        if (!p.members.length && !p.note?.startsWith('depends')) issues.push(`injectHosts #${p.index} ${p.selector} resolves to no host`);
        if (p.missing.length) issues.push(`injectHosts #${p.index}: ${p.missing.length} uuid(s) point to deleted hosts`);
        if (p.note?.startsWith('invalid')) issues.push(`injectHosts #${p.index}: ${p.note}`);
    }
    return issues;
}
