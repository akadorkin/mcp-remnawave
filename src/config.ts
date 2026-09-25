import os from 'node:os';
import path from 'node:path';

export interface Config {
    baseUrl: string;
    apiToken: string;
    apiKey?: string;
    cfAccessClientId?: string;
    cfAccessClientSecret?: string;
    readonly: boolean;
    /** Where backups, the write journal and oversized outputs are kept. */
    stateDir: string;
    /** Tool output larger than this many characters is written to a file instead. */
    maxOutputChars: number;
    /** Object keys whose values are masked in every tool output. */
    redactKeys: string[];
    /** Per-request timeout for panel calls, ms. */
    requestTimeoutMs: number;
    /** URL prefix of public subscriptions, `<prefix>/<shortUuid>` (default `<baseUrl>/api/sub`). */
    subBaseUrl: string;
    /** shortUuid used by subscription_fetch when none is given (a monitoring account, never a real user). */
    probeShortUuid?: string;
}

const DEFAULT_REDACT = ['privateKey', 'mldsa65Seed'];

export function loadConfig(): Config {
    const env = process.env;
    const baseUrl = env.REMNAWAVE_BASE_URL;
    const apiToken = env.REMNAWAVE_API_TOKEN;

    if (!baseUrl) {
        throw new Error('REMNAWAVE_BASE_URL environment variable is required');
    }
    if (!apiToken) {
        throw new Error('REMNAWAVE_API_TOKEN environment variable is required');
    }

    const stateHome = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
    const redact = env.REMNAWAVE_REDACT_KEYS;

    return {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiToken,
        apiKey: env.REMNAWAVE_API_KEY,
        cfAccessClientId: env.CF_ACCESS_CLIENT_ID,
        cfAccessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
        readonly: env.REMNAWAVE_READONLY === 'true',
        stateDir: env.REMNAWAVE_STATE_DIR || path.join(stateHome, 'remnawave-mcp'),
        maxOutputChars: Number(env.REMNAWAVE_MAX_OUTPUT_CHARS) || 40000,
        redactKeys:
            redact === undefined
                ? DEFAULT_REDACT
                : redact
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
        requestTimeoutMs: Number(env.REMNAWAVE_TIMEOUT_MS) || 60000,
        subBaseUrl: (env.REMNAWAVE_SUB_BASE_URL || `${baseUrl.replace(/\/+$/, '')}/api/sub`).replace(/\/+$/, ''),
        probeShortUuid: env.REMNAWAVE_PROBE_SHORT_UUID || undefined,
    };
}
