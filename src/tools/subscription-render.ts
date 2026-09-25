import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Any } from '../core/fleet.js';
import { Ctx } from '../core/plan.js';
import { run } from './helpers.js';

/** Real client User-Agents: the panel picks the format (and the template) by UA. */
const CLIENTS: Record<string, string> = {
    happ: 'Happ/4.12.0/ios/2606121423535',
    incy: 'INCY/3.5.8/android Dalvik/2.1.0',
    v2rayng: 'v2rayNG/1.10.16',
    streisand: 'Streisand/1.6.40',
    clash: 'clash-verge/v2.2.3',
    mihomo: 'mihomo/1.19.10',
    singbox: 'SFA/1.12.0 (sing-box 1.12.0)',
    curl: 'curl/8.5.0',
};

interface Rendered {
    client: string;
    status: number;
    contentType: string;
    bytes: number;
    gzipBytes: number;
    sha256: string;
    ms: number;
    format: string;
    summary: Any;
    file?: string;
    body: string;
}

function analyse(body: string, contentType: string): { format: string; summary: Any } {
    const t = body.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
        try {
            const j = JSON.parse(t);
            if (Array.isArray(j)) {
                const cfgs = j.map((c: Any) => ({
                    remarks: c?.remarks ?? '?',
                    kb: Math.round(JSON.stringify(c).length / 102.4) / 10,
                    outbounds: c?.outbounds?.length ?? 0,
                    rules: c?.routing?.rules?.length ?? 0,
                    balancers: c?.routing?.balancers?.length ?? 0,
                }));
                const sections: Any = {};
                for (const c of j as Any[]) for (const [k, v] of Object.entries(c ?? {})) sections[k] = (sections[k] ?? 0) + JSON.stringify(v).length;
                for (const k of Object.keys(sections)) sections[k] = `${Math.round(sections[k] / 1024)} KB`;
                return {
                    format: 'xray-json',
                    summary: {
                        configs: cfgs.length,
                        largest: [...cfgs].sort((a, b) => b.kb - a.kb).slice(0, 8),
                        sections,
                        remarks: cfgs.map((c) => c.remarks),
                    },
                };
            }
            if (Array.isArray(j?.outbounds)) {
                return { format: 'sing-box', summary: { outbounds: j.outbounds.length, types: [...new Set(j.outbounds.map((o: Any) => o.type))] } };
            }
            return { format: 'json', summary: { keys: Object.keys(j).slice(0, 20) } };
        } catch {
            /* fall through */
        }
    }
    if (/^proxies:|\nproxies:/m.test(body) || contentType.includes('yaml')) {
        const names = [...body.matchAll(/^\s*-\s*\{?\s*name:\s*"?([^",}\n]+)/gm)].map((m) => m[1].trim());
        return { format: 'clash-yaml', summary: { proxiesApprox: names.length, groups: (body.match(/^\s*proxy-groups:/m) ? 'yes' : 'no'), sample: names.slice(0, 10) } };
    }
    try {
        const dec = Buffer.from(t, 'base64').toString('utf8');
        const links = dec.split('\n').filter((l) => /^[a-z0-9]+:\/\//i.test(l.trim()));
        if (links.length) {
            const byProto: Any = {};
            for (const l of links) {
                const p = l.split(':')[0];
                byProto[p] = (byProto[p] ?? 0) + 1;
            }
            return {
                format: 'base64-links',
                summary: { links: links.length, byProtocol: byProto, remarks: links.map((l) => decodeURIComponent(l.split('#')[1] ?? '')).slice(0, 80) },
            };
        }
    } catch {
        /* not base64 */
    }
    return { format: 'text', summary: { lines: body.split('\n').length, head: body.slice(0, 200) } };
}

function perConfigHashes(body: string): Map<string, string> | null {
    try {
        const j = JSON.parse(body);
        if (!Array.isArray(j)) return null;
        const m = new Map<string, string>();
        j.forEach((c: Any, i: number) => m.set(String(c?.remarks ?? `#${i}`), crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 12)));
        return m;
    } catch {
        return null;
    }
}

export function registerSubscriptionRenderTools(server: McpServer, ctx: Ctx) {
    const dir = path.join(ctx.config.stateDir, 'subs');

    async function fetchOne(short: string, client: string, ua: string): Promise<Rendered> {
        const t0 = Date.now();
        // no x-hwid header on purpose: sending one for a real user would take a device slot
        const res = await fetch(`${ctx.config.subBaseUrl}/${encodeURIComponent(short)}`, {
            headers: { 'User-Agent': ua, Accept: '*/*' },
            signal: AbortSignal.timeout(ctx.config.requestTimeoutMs),
        });
        const body = await res.text();
        const ms = Date.now() - t0;
        const ct = res.headers.get('content-type') ?? '';
        const { format, summary } = analyse(body, ct);
        return {
            client,
            status: res.status,
            contentType: ct,
            bytes: Buffer.byteLength(body),
            gzipBytes: zlib.gzipSync(body).length,
            sha256: crypto.createHash('sha256').update(body).digest('hex'),
            ms,
            format,
            summary,
            body,
        };
    }

    server.tool(
        'subscription_fetch',
        `Render a subscription exactly as a client app gets it (by User-Agent) and summarise it: size (raw and gzip), sha256, format, per-config sizes and remarks. Saves bodies and a snapshot file; pass compareTo=<snapshot file> later to see what changed (per remark for xray-json) — the "subscription is byte-identical after my change" check. Defaults to the monitoring account (REMNAWAVE_PROBE_SHORT_UUID). Never sends x-hwid. Client presets: ${Object.keys(CLIENTS).join(', ')}.`,
        {
            shortUuid: z.string().optional().describe('Subscription short uuid; default = monitoring account from env'),
            clients: z.array(z.string()).default(['happ']).describe('Preset names, or "custom:<User-Agent>"'),
            compareTo: z.string().optional().describe('Snapshot file from an earlier call'),
            showRemarks: z.boolean().default(false).describe('Include the full list of config remarks'),
        },
        ({ shortUuid, clients, compareTo, showRemarks }) =>
            run(async () => {
                const short = shortUuid ?? ctx.config.probeShortUuid;
                if (!short) throw new Error('no shortUuid given and REMNAWAVE_PROBE_SHORT_UUID is not set');
                const rendered: Rendered[] = [];
                for (const c of clients) {
                    const ua = c.startsWith('custom:') ? c.slice(7) : CLIENTS[c];
                    if (!ua) throw new Error(`unknown client preset ${c}; use one of ${Object.keys(CLIENTS).join(', ')} or custom:<UA>`);
                    rendered.push(await fetchOne(short, c, ua));
                }
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                const tag = crypto.createHash('sha256').update(short).digest('hex').slice(0, 8);
                for (const r of rendered) {
                    r.file = path.join(dir, `${stamp}-${tag}-${r.client.replace(/[^\w]+/g, '_')}.txt`);
                    fs.writeFileSync(r.file, r.body, { mode: 0o600 });
                }
                const snapshot = {
                    takenAt: new Date().toISOString(),
                    subject: tag,
                    clients: Object.fromEntries(rendered.map((r) => [r.client, { sha256: r.sha256, bytes: r.bytes, file: r.file }])),
                };
                const snapFile = path.join(dir, `${stamp}-${tag}-snapshot.json`);
                fs.writeFileSync(snapFile, JSON.stringify(snapshot, null, 1), { mode: 0o600 });

                let comparison: Any | undefined;
                if (compareTo) {
                    const prev = JSON.parse(fs.readFileSync(compareTo, 'utf8')) as typeof snapshot;
                    comparison = {};
                    for (const r of rendered) {
                        const p = prev.clients[r.client];
                        if (!p) {
                            comparison[r.client] = 'not in baseline';
                            continue;
                        }
                        if (p.sha256 === r.sha256) {
                            comparison[r.client] = 'identical';
                            continue;
                        }
                        const before = p.file && fs.existsSync(p.file) ? fs.readFileSync(p.file, 'utf8') : '';
                        const a = perConfigHashes(before);
                        const b = perConfigHashes(r.body);
                        if (a && b) {
                            comparison[r.client] = {
                                bytes: `${p.bytes} → ${r.bytes}`,
                                added: [...b.keys()].filter((k) => !a.has(k)),
                                removed: [...a.keys()].filter((k) => !b.has(k)),
                                changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)),
                            };
                        } else {
                            const la = new Set(before.split('\n'));
                            const lb = r.body.split('\n');
                            comparison[r.client] = { bytes: `${p.bytes} → ${r.bytes}`, linesNotInBaseline: lb.filter((l) => !la.has(l)).length };
                        }
                    }
                }
                return {
                    subject: `${short.slice(0, 4)}… (${tag})`,
                    snapshot: snapFile,
                    results: rendered.map(({ body: _b, summary, ...r }) => ({
                        ...r,
                        sha256: r.sha256.slice(0, 16),
                        kb: Math.round(r.bytes / 102.4) / 10,
                        gzipKb: Math.round(r.gzipBytes / 102.4) / 10,
                        summary: showRemarks ? summary : { ...summary, remarks: summary.remarks ? `${summary.remarks.length} (showRemarks:true to list)` : undefined },
                    })),
                    ...(comparison ? { comparison } : {}),
                };
            }),
    );
}
