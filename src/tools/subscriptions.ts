import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Any, FleetIndex, InjectEntry, injectEntries, routingIssues, Template, TemplateMeta } from '../core/fleet.js';
import { allPools } from '../core/hostops.js';
import { applyOps, resolve } from '../core/jsonedit.js';
import { applyParams, Ctx, PlanTarget, runPlan } from '../core/plan.js';
import { xraySummary } from '../core/views.js';
import { run } from './helpers.js';
import { OPS_HELP, opSchema, toOps } from './inbounds.js';

const tplRef = z.string().describe('Template name or uuid (XRAY_JSON wins on name clashes)');

/** Templates are edited as JSON; YAML ones as {yaml: "<decoded text>"} so replace_string works on them. */
function tplDoc(t: Template): Any {
    if (t.templateJson) return t.templateJson;
    if (t.encodedTemplateYaml) return { yaml: Buffer.from(t.encodedTemplateYaml, 'base64').toString('utf8') };
    return {};
}

function tplBody(t: Template, doc: Any): Record<string, unknown> {
    if (t.templateJson || !t.encodedTemplateYaml) return { uuid: t.uuid, templateJson: doc };
    return { uuid: t.uuid, encodedTemplateYaml: Buffer.from(String(doc.yaml ?? ''), 'utf8').toString('base64') };
}

async function defaultTplUuid(ctx: Ctx): Promise<string | undefined> {
    const list = await ctx.fleet.templateList();
    return list.find((t) => t.templateType === 'XRAY_JSON' && t.name === 'Default')?.uuid;
}

function injectorProblems(doc: Any): string[] {
    const rw = doc?.remnawave;
    if (!rw) return [];
    const out: string[] = [];
    ((rw.injectHosts ?? []) as InjectEntry[]).forEach((e, i) => {
        const s = e?.selector as Any;
        if (!s || !['uuids', 'tagRegex', 'remarkRegex', 'sameTagAsRecipient'].includes(s.type)) out.push(`injectHosts #${i}: unknown selector type`);
        if (s?.type === 'uuids' && (!Array.isArray(s.values) || !s.values.length)) out.push(`injectHosts #${i}: uuids selector with no values (panel rejects the template)`);
        if ((s?.type === 'tagRegex' || s?.type === 'remarkRegex') && typeof s.pattern === 'string') {
            try {
                new RegExp(s.pattern);
            } catch (err) {
                out.push(`injectHosts #${i}: invalid regex ${s.pattern}: ${(err as Error).message}`);
            }
        }
        if (!e.tagPrefix && !e.useHostRemarkAsTag && !e.useHostTagAsTag) out.push(`injectHosts #${i}: needs tagPrefix, useHostRemarkAsTag or useHostTagAsTag`);
        if (e.selectFrom && !['ALL', 'HIDDEN', 'NOT_HIDDEN'].includes(e.selectFrom)) out.push(`injectHosts #${i}: bad selectFrom ${e.selectFrom}`);
    });
    return out;
}

function poolsOf(idx: FleetIndex, t: Template, doc: Any) {
    return injectEntries({ ...t, templateJson: doc }).map((e, i) => idx.resolveEntry(t, i, e));
}

/** Build a plan target for a template edit, with injector validation and pool/routing checks. */
export function templateTarget(ctx: Ctx, idx: FleetIndex, t: Template, after: Any, recipients: number, extra?: Partial<PlanTarget>): PlanTarget {
    const before = tplDoc(t);
    const blockers = injectorProblems(after);
    const warnings: string[] = [];
    if (t.templateType === 'XRAY_JSON' && t.templateJson) {
        const tb = { ...t, templateJson: before };
        const ta = { ...t, templateJson: after };
        const was = new Set(routingIssues(tb, poolsOf(idx, t, before)));
        for (const i of routingIssues(ta, poolsOf(idx, t, after))) if (!was.has(i)) warnings.push(i);
    }
    const kb = (v: unknown) => Math.round(JSON.stringify(v).length / 102.4) / 10;
    return {
        kind: 'sub-template',
        uuid: t.uuid,
        name: `${t.name} (${t.templateType})`,
        backup: t,
        before,
        after,
        blockers,
        warnings,
        info: { sizeKB: `${kb(before)} → ${kb(after)}`, visibleHostsUsingIt: recipients },
        write: () => ctx.client.updateSubscriptionTemplate(tplBody(t, after)),
        readBack: async () => tplDoc(((await ctx.client.getSubscriptionTemplate(t.uuid)) as Any).response as Template),
        ...extra,
    };
}

async function selectTemplates(ctx: Ctx, sel: { templates?: string[]; nameRegex?: string; type?: string }): Promise<Template[]> {
    if (!sel.templates?.length && !sel.nameRegex && !sel.type) throw new Error('select templates with templates, nameRegex or type');
    const list = await ctx.fleet.templateList();
    let metas: TemplateMeta[] = list;
    if (sel.templates?.length) metas = await Promise.all(sel.templates.map((r) => ctx.fleet.findTemplate(r)));
    if (sel.type) metas = metas.filter((m) => m.templateType === sel.type);
    if (sel.nameRegex) {
        const re = new RegExp(sel.nameRegex);
        metas = metas.filter((m) => re.test(m.name));
    }
    const out: Template[] = [];
    for (const m of metas) out.push(await ctx.fleet.template(m.uuid, true));
    return out;
}

export function registerSubscriptionTools(server: McpServer, ctx: Ctx) {
    const { client, fleet } = ctx;
    const readonly = ctx.config.readonly;

    server.tool(
        'subscriptions_list',
        'List subscriptions with pagination',
        { start: z.number().int().default(0), size: z.number().int().default(25) },
        ({ start, size }) => run(() => client.getSubscriptions(start, size)),
    );

    server.tool('subscriptions_get_by_id', 'Get subscription of a user by numeric user id', { userId: z.number().int() }, ({ userId }) =>
        run(() => client.getSubscriptionById(userId)),
    );

    server.tool('subscriptions_get_by_username', 'Get subscription by username', { username: z.string() }, ({ username }) =>
        run(() => client.getSubscriptionByUsername(username)),
    );

    server.tool('subscriptions_get_by_short_uuid', 'Get subscription by short UUID', { shortUuid: z.string() }, ({ shortUuid }) =>
        run(() => client.getSubscriptionByShortUuid(shortUuid)),
    );

    server.tool('subscription_info', 'Public subscription info (what the client app sees) by short UUID', { shortUuid: z.string() }, ({ shortUuid }) =>
        run(() => client.getSubscriptionInfo(shortUuid)),
    );

    server.tool(
        'subscriptions_get_raw_by_short_uuid',
        'Raw subscription (hosts with resolved links) by short UUID',
        { shortUuid: z.string(), withDisabledHosts: z.boolean().optional() },
        ({ shortUuid, withDisabledHosts }) => run(() => client.getSubscriptionByShortUuidRaw(shortUuid, withDisabledHosts)),
    );

    server.tool('subscriptions_get_connection_keys', 'Connection keys (links) of a user by numeric user id', { userId: z.number().int() }, ({ userId }) =>
        run(() => client.getConnectionKeysByUserId(userId)),
    );

    server.tool(
        'subscription_request_history_list',
        'Subscription request history (paginated, filterable)',
        {
            start: z.number().int().default(0),
            size: z.number().int().default(50),
            filters: z.array(z.object({ id: z.string(), value: z.string() })).optional(),
            sorting: z.array(z.object({ id: z.string(), desc: z.boolean() })).optional(),
        },
        (p) => run(() => client.getSubscriptionRequestHistory(p)),
    );

    server.tool('subscription_request_history_stats', 'Subscription request history statistics', {}, () =>
        run(() => client.getSubscriptionRequestHistoryStats()),
    );

    server.tool(
        'sub_templates_list',
        'List subscription templates with type and how many visible hosts (locations) render with each',
        { type: z.string().optional().describe('XRAY_JSON, MIHOMO, SINGBOX, CLASH, STASH') },
        ({ type }) =>
            run(async () => {
                const [list, idx, def] = await Promise.all([fleet.templateList(), fleet.index(), defaultTplUuid(ctx)]);
                return list
                    .filter((t) => !type || t.templateType === type)
                    .map((t) => ({
                        uuid: t.uuid,
                        name: t.name,
                        type: t.templateType,
                        ...(t.templateType === 'XRAY_JSON'
                            ? { usedBy: idx.recipientsOf(t, def).filter((h) => !h.isHidden).length }
                            : {}),
                    }));
            }),
    );

    server.tool(
        'sub_template_read',
        `Read a subscription template. view: summary (size, locations using it, outbounds/balancers/rules, pools) | pools (every injectHosts entry resolved to member hosts as the panel does it, with outbound tags and problems) | path (subtree) | raw. ${OPS_HELP.split('\n')[0]}`,
        {
            template: tplRef,
            view: z.enum(['summary', 'pools', 'path', 'raw']).default('summary'),
            path: z.string().optional(),
        },
        ({ template, view, path }) =>
            run(async () => {
                const meta = await fleet.findTemplate(template);
                const [t, idx, def] = await Promise.all([fleet.template(meta.uuid), fleet.index(), defaultTplUuid(ctx)]);
                const doc = tplDoc(t);
                if (view === 'raw') return doc;
                if (view === 'path') {
                    if (!path) throw new Error('view=path needs path');
                    const r = resolve(doc, path);
                    return { template: t.name, path, pointer: r.pointer, value: r.value };
                }
                const pools = poolsOf(idx, t, doc);
                const recipients = t.templateType === 'XRAY_JSON' ? idx.recipientsOf(t, def) : [];
                if (view === 'pools') {
                    return {
                        template: t.name,
                        pools: pools.map((p) => ({
                            index: p.index,
                            selector: p.selector,
                            selectFrom: p.selectFrom,
                            tagPrefix: p.tagPrefix,
                            members: p.members.map((m) => `${m.outboundTag} ← ${m.remark} (${m.uuid})`),
                            ...(p.missing.length ? { missingUuids: p.missing } : {}),
                            ...(p.skipped.length ? { skipped: p.skipped } : {}),
                            ...(p.note ? { note: p.note } : {}),
                        })),
                        issues: routingIssues(t, pools),
                    };
                }
                return {
                    uuid: t.uuid,
                    name: t.name,
                    type: t.templateType,
                    sizeKB: Math.round(JSON.stringify(doc).length / 102.4) / 10,
                    locations: recipients.filter((h) => !h.isHidden).map((h) => h.remark),
                    ...(t.templateJson ? xraySummary(t.templateJson) : { yamlLines: String(doc.yaml ?? '').split('\n').length }),
                    pools: pools.map((p) => ({ index: p.index, selector: p.selector, prefix: p.tagPrefix, members: p.members.length, first: p.members[0]?.remark })),
                    issues: routingIssues(t, pools),
                };
            }),
    );

    server.tool(
        'pools_audit',
        'Audit every template\'s pools the way the panel resolves them: empty pools, uuids pointing to deleted/disabled hosts, broken regexes, balancer selectors / fallbackTags / rule outbounds that point to nothing, templates no visible host uses.',
        {
            templates: z.array(z.string()).optional(),
            onlyIssues: z.boolean().default(true),
        },
        ({ templates, onlyIssues }) =>
            run(async () => {
                const [idx, def] = await Promise.all([fleet.index(), defaultTplUuid(ctx)]);
                const tpls = templates?.length ? await selectTemplates(ctx, { templates }) : await fleet.templates({ type: 'XRAY_JSON' });
                const rows = tpls.map((t) => {
                    const pools = allPools(idx, [t]);
                    const issues = routingIssues(t, pools);
                    const skippedRefs = pools.flatMap((p) => p.skipped.map((s) => `#${p.index}: ${s.remark} (${s.why})`));
                    const users = idx.recipientsOf(t, def).filter((h) => !h.isHidden);
                    return {
                        template: t.name,
                        locations: users.length,
                        pools: pools.map((p) => `#${p.index} ${p.selector} → ${p.members.length} (${p.members[0]?.remark ?? '—'})`),
                        ...(issues.length ? { issues } : {}),
                        ...(skippedRefs.length ? { skippedRefs } : {}),
                        ...(!users.length ? { unused: true } : {}),
                    };
                });
                const withIssues = rows.filter((r) => r.issues || r.skippedRefs);
                return {
                    templates: rows.length,
                    withIssues: withIssues.length,
                    unused: rows.filter((r) => r.unused).map((r) => r.template),
                    rows: onlyIssues ? withIssues : rows,
                };
            }),
    );

    server.tool('sub_settings_get', 'Get global subscription settings', {}, () => run(() => client.getSubscriptionSettings()));

    if (readonly) return;

    server.tool(
        'sub_template_patch',
        `Edit one or many subscription templates with path operations (no need to resend a 160 KB template to change one line). Select targets by names/uuids, nameRegex and/or type. Dry run by default; apply with the planHash; each template is backed up, written with retries and re-read to verify. Checks injectHosts validity and reports routing references / pools the edit breaks. YAML templates are edited as {yaml: text}.
With skipInapplicable, templates where an op cannot apply (path missing, selector not matching) are skipped instead of failing the whole batch.
${OPS_HELP}`,
        {
            templates: z.array(z.string()).optional().describe('Template names/uuids'),
            nameRegex: z.string().optional(),
            type: z.string().optional().describe('Restrict to a template type, e.g. XRAY_JSON'),
            ops: z.array(opSchema).min(1),
            skipInapplicable: z.boolean().default(false),
            ...applyParams,
        },
        (p) =>
            run(() =>
                runPlan(ctx, 'sub_template_patch', { ...p, changeLimit: 25 }, async () => {
                    const [tpls, idx, def] = await Promise.all([selectTemplates(ctx, p), fleet.index(), defaultTplUuid(ctx)]);
                    if (!tpls.length) throw new Error('no templates selected');
                    const ops = toOps(p.ops);
                    const targets: PlanTarget[] = [];
                    const skipped: string[] = [];
                    for (const t of tpls) {
                        let res;
                        try {
                            res = applyOps(tplDoc(t), ops);
                        } catch (e) {
                            if (p.skipInapplicable) {
                                skipped.push(`${t.name}: ${(e as Error).message}`);
                                continue;
                            }
                            throw new Error(`${t.name}: ${(e as Error).message}`);
                        }
                        const recips = idx.recipientsOf(t, def).filter((h) => !h.isHidden).length;
                        const tg = templateTarget(ctx, idx, t, res.doc as Any, recips);
                        tg.info = { ...tg.info, ops: res.results.map((r) => `${r.op} ${r.pointer ?? r.path}${r.note ? ` — ${r.note}` : ''}`) };
                        targets.push(tg);
                    }
                    if (skipped.length && targets[0]) targets[0].info = { ...targets[0].info, skippedTemplates: skipped };
                    if (!targets.length) throw new Error(`no template could take these ops:\n  - ${skipped.join('\n  - ')}`);
                    return targets;
                }),
            ),
    );

    server.tool(
        'sub_templates_update',
        'Replace a template wholesale (templateJson or encodedTemplateYaml) or rename it. Prefer sub_template_patch. Same dry-run/apply protocol and injector checks.',
        {
            template: tplRef,
            templateJson: z.record(z.unknown()).optional().describe('Full template object; replaces the stored one'),
            encodedTemplateYaml: z.string().optional().describe('base64 YAML'),
            ...applyParams,
        },
        (p) =>
            run(() =>
                runPlan(ctx, 'sub_templates_update', p, async () => {
                    const meta = await fleet.findTemplate(p.template);
                    const [t, idx, def] = await Promise.all([fleet.template(meta.uuid, true), fleet.index(), defaultTplUuid(ctx)]);
                    let after: Any;
                    if (p.templateJson) after = p.templateJson as Any;
                    else if (p.encodedTemplateYaml) after = { yaml: Buffer.from(p.encodedTemplateYaml, 'base64').toString('utf8') };
                    else throw new Error('give templateJson or encodedTemplateYaml');
                    return [templateTarget(ctx, idx, t, after, idx.recipientsOf(t, def).length)];
                }),
            ),
    );

    server.tool(
        'pools_edit',
        'Edit explicit (uuids) host pools across all XRAY_JSON templates at once: add a host next to an anchor host wherever the anchor is listed, remove hosts from every pool, or swap one host for another in place. tagRegex pools are not touched (they follow host tags). Refuses to leave a uuids selector empty. Dry run by default.',
        {
            add: z
                .array(z.object({ host: z.string(), after: z.string().optional(), before: z.string().optional() }))
                .optional()
                .describe('Insert host next to the anchor in every uuids pool that lists the anchor'),
            remove: z.array(z.string()).optional().describe('Host uuids to drop from every uuids pool'),
            swap: z.array(z.object({ old: z.string(), new: z.string() })).optional().describe('Replace old uuid with new in place'),
            templates: z.array(z.string()).optional().describe('Limit to these templates (names/uuids)'),
            ...applyParams,
        },
        (p) =>
            run(() =>
                runPlan(ctx, 'pools_edit', { ...p, changeLimit: 20 }, async () => {
                    const [idx, def] = await Promise.all([fleet.index(), defaultTplUuid(ctx)]);
                    const full = (u: string) => idx.host(u).uuid;
                    // removed hosts may already be deleted: accept unknown full uuids there
                    const fullOrRaw = (u: string) => (idx.hostByUuid.has(u) ? u : u.length === 36 ? u : full(u));
                    const add = (p.add ?? []).map((a) => {
                        if (!a.after === !a.before) throw new Error('each add needs exactly one of after / before');
                        return { host: full(a.host), after: a.after ? full(a.after) : undefined, before: a.before ? full(a.before) : undefined };
                    });
                    const swap = (p.swap ?? []).map((s) => ({ old: fullOrRaw(s.old), new: full(s.new) }));
                    const remove = (p.remove ?? []).map(fullOrRaw);
                    const label = (u: string) => idx.hostByUuid.get(u)?.remark ?? u;
                    const tpls = p.templates?.length ? await selectTemplates(ctx, { templates: p.templates }) : await fleet.templates({ type: 'XRAY_JSON' }, true);
                    const targets: PlanTarget[] = [];
                    let anchorsSeen = 0;
                    let alreadyListed = 0;
                    for (const t of tpls) {
                        if (!t.templateJson?.remnawave?.injectHosts) continue;
                        const doc = structuredClone(t.templateJson) as Any;
                        const notes: string[] = [];
                        (doc.remnawave.injectHosts as InjectEntry[]).forEach((e, i) => {
                            if (e.selector.type !== 'uuids') return;
                            const vals = e.selector.values;
                            for (const s of swap) {
                                const k = vals.indexOf(s.old);
                                if (k >= 0) {
                                    if (vals.includes(s.new)) vals.splice(k, 1);
                                    else vals[k] = s.new;
                                    notes.push(`#${i}: swap ${label(s.old)} → ${label(s.new)}`);
                                }
                            }
                            for (const a of add) {
                                const anchor = (a.after ?? a.before)!;
                                const k = vals.indexOf(anchor);
                                if (k < 0) continue;
                                anchorsSeen++;
                                if (vals.includes(a.host)) {
                                    alreadyListed++;
                                    continue;
                                }
                                vals.splice(a.after ? k + 1 : k, 0, a.host);
                                notes.push(`#${i}: + ${label(a.host)} ${a.after ? 'after' : 'before'} ${label(anchor)}`);
                            }
                            for (const r of remove) {
                                const k = vals.indexOf(r);
                                if (k >= 0) {
                                    vals.splice(k, 1);
                                    notes.push(`#${i}: − ${label(r)}`);
                                }
                            }
                        });
                        if (!notes.length) continue;
                        const tg = templateTarget(ctx, idx, t, doc, idx.recipientsOf(t, def).filter((h) => !h.isHidden).length);
                        tg.info = { ...tg.info, edits: notes };
                        targets.push(tg);
                    }
                    if (!targets.length) {
                        throw new Error(
                            `nothing to change: anchors found in ${anchorsSeen} uuids pool(s), the host was already listed in ${alreadyListed}; swap/remove matched nothing`,
                        );
                    }
                    return targets;
                }),
            ),
    );

}
