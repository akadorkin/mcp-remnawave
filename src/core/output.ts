import fs from 'node:fs';
import path from 'node:path';
import { Config } from '../config.js';

export type ToolResponse = {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
};

export const REDACTED = '«redacted»';

/**
 * Output policy shared by every tool:
 *  - secrets (REALITY privateKey, mldsa65Seed …) are masked, because panel responses
 *    for nodes/squads/profiles embed every inbound with its server keys;
 *  - anything larger than maxOutputChars goes to a file under stateDir/out and the
 *    tool returns a short summary plus the path, instead of a 2 MB blob that the
 *    client rejects anyway.
 */
export class Output {
    private redactKeys: Set<string>;
    private outDir: string;

    constructor(private config: Config) {
        this.redactKeys = new Set(config.redactKeys);
        this.outDir = path.join(config.stateDir, 'out');
    }

    redact<T>(data: T): T {
        if (!this.redactKeys.size) return data;
        const walk = (v: unknown): unknown => {
            if (Array.isArray(v)) return v.map(walk);
            if (v && typeof v === 'object') {
                const out: Record<string, unknown> = {};
                for (const [k, val] of Object.entries(v)) {
                    out[k] = this.redactKeys.has(k) && val !== null && val !== '' ? REDACTED : walk(val);
                }
                return out;
            }
            return v;
        };
        return walk(data) as T;
    }

    /** Write data (already redacted by the caller if needed) to a file and return its path. */
    save(label: string, data: unknown, ext = 'json'): string {
        fs.mkdirSync(this.outDir, { recursive: true, mode: 0o700 });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = path.join(this.outDir, `${label.replace(/[^\w.-]+/g, '_')}-${stamp}.${ext}`);
        fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
        return file;
    }

    ok(label: string, data: unknown): ToolResponse {
        const safe = this.redact(data ?? { success: true });
        let text = JSON.stringify(safe);
        if (text.length <= this.config.maxOutputChars) {
            if (text.length < 6000) text = JSON.stringify(safe, null, 1);
            return { content: [{ type: 'text', text }] };
        }
        const file = this.save(label, safe);
        const summary = {
            truncated: true,
            reason: `result is ${text.length} chars (limit ${this.config.maxOutputChars}); full JSON saved to a file`,
            savedTo: file,
            hint: 'Read or jq the file for details, or call again with filters / a narrower view.',
            shape: describe(safe),
        };
        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 1) }] };
    }

    error(e: unknown): ToolResponse {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }

    async run(label: string, fn: () => Promise<unknown>): Promise<ToolResponse> {
        try {
            return this.ok(label, await fn());
        } catch (e) {
            return this.error(e);
        }
    }
}

/** A tiny structural description of a value: keys, array lengths, first item keys. */
function describe(v: unknown, depth = 0): unknown {
    if (Array.isArray(v)) {
        return depth > 2 ? `array(${v.length})` : { array: v.length, item: v.length ? describe(v[0], depth + 1) : null };
    }
    if (v && typeof v === 'object') {
        if (depth > 2) return 'object';
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v).slice(0, 40)) out[k] = describe(val, depth + 1);
        return out;
    }
    return typeof v;
}
