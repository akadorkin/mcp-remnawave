import { Any, FleetIndex, Inbound, Node, Profile, Squad } from './fleet.js';

const GiB = 1024 ** 3;
const gib = (b: unknown) => (typeof b === 'number' ? Math.round((b / GiB) * 100) / 100 : undefined);

/** Compact node row: what nodes_list used to bury under 2 MB of rawInbound. */
export function nodeRow(n: Node, idx?: FleetIndex): Any {
    const profUuid = n.configProfile?.activeConfigProfileUuid ?? null;
    return {
        uuid: n.uuid,
        name: n.name,
        address: n.address,
        country: n.countryCode,
        state: n.isDisabled ? 'disabled' : n.isConnected ? 'connected' : n.isConnecting ? 'connecting' : 'DISCONNECTED',
        lastStatusMessage: n.lastStatusMessage || undefined,
        profile: profUuid ? (idx?.profileByUuid.get(profUuid)?.name ?? profUuid) : null,
        inbounds: n.configProfile?.activeInbounds?.length ?? 0,
        hosts: idx ? (idx.hostsByNode.get(n.uuid) ?? []).filter((h) => !h.isDisabled).length : undefined,
        usersOnline: n.usersOnline,
        xrayUptimeMin: typeof n.xrayUptime === 'number' ? Math.round(n.xrayUptime / 60) : undefined,
        xray: n.versions?.xray,
        trafficUsedGiB: gib(n.trafficUsedBytes),
        tags: n.tags?.length ? n.tags : undefined,
        note: n.note || undefined,
    };
}

export function nodeDetail(n: Node, idx: FleetIndex): Any {
    const hosts = idx.hostsByNode.get(n.uuid) ?? [];
    const squads = new Map<string, number>();
    for (const ib of n.configProfile?.activeInbounds ?? []) for (const s of idx.squadsByInbound.get(ib.uuid) ?? []) squads.set(s.name, (squads.get(s.name) ?? 0) + 1);
    const sys = n.system as Any | undefined;
    return {
        ...nodeRow(n, idx),
        port: n.port,
        provider: n.provider?.name,
        ips: n.ips,
        trafficLimitGiB: gib(n.trafficLimitBytes),
        inboundTags: (() => {
            const tags = (n.configProfile?.activeInbounds ?? []).map((i) => i.tag);
            return tags.length > 60 ? `${tags.length} tags (first: ${tags.slice(0, 30).join(', ')} …) — inbounds_list {node} for all` : tags;
        })(),
        hostsBound: {
            visible: hosts.filter((h) => !h.isDisabled && !h.isHidden).length,
            hidden: hosts.filter((h) => !h.isDisabled && h.isHidden).length,
            disabled: hosts.filter((h) => h.isDisabled).length,
        },
        squadsReaching: Object.fromEntries(squads),
        system: sys
            ? {
                  cpus: sys.info?.cpus,
                  cpuModel: sys.info?.cpuModel,
                  memGiB: gib(sys.info?.memoryTotal),
                  memUsedGiB: gib(sys.stats?.memoryUsed),
                  load: sys.stats?.loadAvg,
                  uptimeH: typeof sys.stats?.uptime === 'number' ? Math.round(sys.stats.uptime / 3600) : undefined,
                  iface: sys.stats?.interface
                      ? {
                            name: sys.stats.interface.interface,
                            rxMbit: Math.round((sys.stats.interface.rxBytesPerSec * 8) / 1e6),
                            txMbit: Math.round((sys.stats.interface.txBytesPerSec * 8) / 1e6),
                        }
                      : undefined,
              }
            : undefined,
        versions: n.versions,
        lastStatusChange: n.lastStatusChange,
    };
}

export function profileRow(p: Profile): Any {
    const c = p.config ?? {};
    return {
        uuid: p.uuid,
        name: p.name,
        inbounds: p.inbounds?.length ?? 0,
        outbounds: c.outbounds?.length ?? 0,
        rules: c.routing?.rules?.length ?? 0,
        balancers: c.routing?.balancers?.length ?? 0,
        nodes: (p.nodes ?? []).map((n) => n.name),
        sizeKB: Math.round(JSON.stringify(c).length / 1024),
    };
}

export function squadRow(s: Squad, withTags = false): Any {
    return {
        uuid: s.uuid,
        name: s.name,
        members: s.info?.membersCount,
        inbounds: s.info?.inboundsCount ?? s.inbounds?.length,
        ...(withTags ? { inboundTags: (s.inbounds ?? []).map((i) => i.tag) } : {}),
    };
}

/** Pull the address/port an outbound points to, whatever the protocol. */
export function outboundTarget(o: Any): string | undefined {
    const s = o?.settings ?? {};
    const v = s.vnext?.[0] ?? s.servers?.[0];
    if (v?.address) return `${v.address}:${v.port ?? ''}`;
    if (s.address) return `${s.address}:${s.port ?? ''}`;
    if (o?.protocol === 'loopback') return `loopback→${s.inboundTag}`;
    return undefined;
}

function ruleMatch(r: Any): Any {
    const m: Any = {};
    for (const k of ['domain', 'ip', 'port', 'sourcePort', 'network', 'source', 'user', 'inboundTag', 'protocol', 'attrs', 'domainMatcher']) {
        const v = r[k];
        if (v === undefined) continue;
        if (Array.isArray(v)) m[k] = v.length > 6 ? `${v.slice(0, 5).join(', ')} … (+${v.length - 5})` : v.join(', ');
        else m[k] = v;
    }
    return m;
}

/** A readable summary of an xray config (profile or XRAY_JSON template). */
export function xraySummary(c: Any): Any {
    return {
        outbounds: ((c.outbounds ?? []) as Any[]).map((o) => ({ tag: o.tag, protocol: o.protocol, to: outboundTarget(o) })),
        balancers: ((c.routing?.balancers ?? []) as Any[]).map((b) => ({
            tag: b.tag,
            selector: b.selector,
            strategy: b.strategy?.type,
            fallbackTag: b.fallbackTag,
        })),
        rules: ((c.routing?.rules ?? []) as Any[]).map((r, i) => ({
            i,
            ...(r.ruleTag ? { ruleTag: r.ruleTag } : {}),
            match: ruleMatch(r),
            to: r.outboundTag ? `outbound:${r.outboundTag}` : r.balancerTag ? `balancer:${r.balancerTag}` : '?',
        })),
        dns: c.dns ? { servers: (c.dns.servers ?? []).length, queryStrategy: c.dns.queryStrategy } : undefined,
        observatory: c.observatory ?? c.burstObservatory ? { subjectSelector: (c.observatory ?? c.burstObservatory).subjectSelector } : undefined,
    };
}

export function inboundRow(ib: Inbound & { profileName?: string }, idx?: FleetIndex): Any {
    const raw = ib.rawInbound ?? {};
    const rs = raw.streamSettings?.realitySettings;
    const sn: string[] | undefined = rs?.serverNames;
    return {
        tag: ib.tag,
        uuid: ib.uuid,
        profile: ib.profileName,
        port: ib.port,
        listen: raw.listen,
        protocol: ib.type,
        network: ib.network,
        security: ib.security,
        ...(rs ? { dest: rs.dest ?? rs.target, serverNames: sn ? (sn.length > 3 ? `${sn.slice(0, 3).join(', ')} … (+${sn.length - 3})` : sn.join(', ')) : undefined } : {}),
        ...(idx
            ? {
                  nodes: (idx.nodesByInbound.get(ib.uuid) ?? []).map((n) => n.name),
                  squads: (idx.squadsByInbound.get(ib.uuid) ?? []).map((s) => s.name),
                  hosts: (idx.hostsByInbound.get(ib.uuid) ?? []).filter((h) => !h.isDisabled).length,
              }
            : {}),
    };
}
