import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { Config } from '../config.js';
import { Fleet } from './fleet.js';
import { Change, diffJson, hashOf } from './jsonedit.js';
import { Output } from './output.js';
import { BackupKind, StateStore } from './state.js';

export interface Ctx {
    client: RemnawaveClient;
    fleet: Fleet;
    out: Output;
    state: StateStore;
    config: Config;
}

/** One object a write tool is going to change. */
export interface PlanTarget {
    kind: BackupKind;
    uuid: string;
    name: string;
    /** What gets backed up (the full object as the panel returned it). */
    backup: unknown;
    /** The compared part before / after (config, templateJson, host fields …). */
    before: unknown;
    after: unknown;
    /** Problems that stop the apply. */
    blockers?: string[];
    warnings?: string[];
    /** Extra info for the dry-run report. */
    info?: Record<string, unknown>;
    /** True when this target is created, not changed (no backup, no before). */
    create?: boolean;
    write: () => Promise<unknown>;
    /** Re-read the stored value in the same shape as `after`, to verify the write. */
    readBack?: () => Promise<unknown>;
}

export const applyParams = {
    apply: z
        .boolean()
        .default(false)
        .describe('false (default) = dry run: show the exact diff and a planHash. true = write; requires planHash from the dry run'),
    planHash: z.string().optional().describe('planHash returned by the dry run; the apply is refused if the panel changed since'),
};

interface PlanOpts {
    apply: boolean;
    planHash?: string;
    /** Max changes listed per target in the report. */
    changeLimit?: number;
}

function summarize(t: PlanTarget, changes: Change[], total: number) {
    return {
        target: `${t.kind} ${t.name}`,
        uuid: t.uuid,
        ...(t.create ? { create: true } : {}),
        changes: total,
        ...(total > changes.length ? { shown: changes.length } : {}),
        diff: changes,
        ...(t.blockers?.length ? { blockers: t.blockers } : {}),
        ...(t.warnings?.length ? { warnings: t.warnings } : {}),
        ...(t.info ? { info: t.info } : {}),
    };
}

/**
 * Dry-run / apply protocol shared by every tool that edits panel objects:
 * build the change against fresh data → show the diff and a planHash →
 * on apply, rebuild, insist on the same planHash, back up, write, re-read, compare.
 */
export async function runPlan(ctx: Ctx, tool: string, opts: PlanOpts, build: () => Promise<PlanTarget[]>) {
    // always plan against fresh data: the owner edits the panel in parallel
    ctx.fleet.invalidateBase();
    const targets = await build();
    const limit = opts.changeLimit ?? 60;
    const diffs = targets.map((t) => diffJson(t.before, t.after, limit));
    const changed = targets.filter((_, i) => diffs[i].total > 0);
    const planHash = hashOf(targets.map((t) => [t.kind, t.uuid, hashOf(t.before), hashOf(t.after)]));
    const blockers = targets.flatMap((t) => (t.blockers ?? []).map((b) => `${t.name}: ${b}`));
    const report = targets.map((t, i) => summarize(t, diffs[i].changes, diffs[i].total)).filter((r) => r.changes > 0 || r.blockers || r.warnings);

    if (!opts.apply) {
        return {
            mode: 'dry-run',
            planHash,
            targets: targets.length,
            changed: changed.length,
            ...(blockers.length ? { blocked: blockers } : {}),
            report,
            next: changed.length
                ? blockers.length
                    ? 'Resolve the blockers first (see the tool parameters for explicit overrides).'
                    : `To write: call ${tool} again with the same arguments plus apply:true, planHash:"${planHash}".`
                : 'Nothing to change.',
        };
    }

    if (ctx.config.readonly) throw new Error('server is in read-only mode (REMNAWAVE_READONLY=true)');
    if (!opts.planHash) throw new Error('apply requires planHash from a dry run of the same call');
    if (!changed.length) return { mode: 'nothing-to-change', planHash };
    if (opts.planHash !== planHash) {
        return {
            mode: 'aborted',
            reason: 'the panel changed since the dry run (or the arguments differ); review the fresh plan',
            planHash,
            report,
        };
    }
    if (blockers.length) return { mode: 'aborted', reason: 'blocked', blocked: blockers };

    const results: Array<Record<string, unknown>> = [];
    for (const t of changed) {
        const backup = t.create ? undefined : ctx.state.backup(t.kind, t.uuid, t.name, tool, t.backup);
        const summary = `${diffJson(t.before, t.after, 1).total} change(s)`;
        try {
            const res = await t.write();
            let verified: unknown = 'not checked';
            if (t.readBack) {
                const back = await t.readBack();
                const d = diffJson(t.after, back, 10);
                verified = d.total === 0 ? 'ok' : { mismatch: d.total, diff: d.changes };
            }
            const createdUuid = t.create ? (res as { response?: { uuid?: string } })?.response?.uuid : undefined;
            ctx.state.log({ tool, target: `${t.kind} ${t.name} ${createdUuid ?? t.uuid}`, summary, backup, ok: true });
            results.push({ target: `${t.kind} ${t.name}`, uuid: createdUuid ?? t.uuid, written: true, verified, backup });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            ctx.state.log({ tool, target: `${t.kind} ${t.name} ${t.uuid}`, summary, backup, ok: false, error: msg });
            results.push({ target: `${t.kind} ${t.name}`, uuid: t.uuid, written: false, error: msg, backup });
            const rest = changed.slice(changed.indexOf(t) + 1).map((x) => x.name);
            return { mode: 'partial', stoppedAt: t.name, notAttempted: rest, results };
        }
    }
    return { mode: 'applied', planHash, results };
}

/**
 * For direct (non-plan) writes: optional backup, run, journal the outcome.
 * Returns the write result; errors are journaled and rethrown.
 */
export async function journaled<T>(
    ctx: Ctx,
    tool: string,
    target: string,
    summary: string,
    fn: () => Promise<T>,
    backup?: { kind: BackupKind; uuid: string; name?: string; data: unknown },
): Promise<{ result: T; backup?: string }> {
    if (ctx.config.readonly) throw new Error('server is in read-only mode (REMNAWAVE_READONLY=true)');
    const file = backup ? ctx.state.backup(backup.kind, backup.uuid, backup.name, tool, backup.data) : undefined;
    try {
        const result = await fn();
        ctx.state.log({ tool, target, summary, backup: file, ok: true });
        return { result, backup: file };
    } catch (e) {
        ctx.state.log({ tool, target, summary, backup: file, ok: false, error: e instanceof Error ? e.message : String(e) });
        throw e;
    }
}

/** Throw with all contract issues listed, before the request leaves. */
export function assertValid(issues: string[], what: string) {
    if (issues.length) throw new Error(`${what} does not pass the panel contract:\n  - ${issues.join('\n  - ')}`);
}
