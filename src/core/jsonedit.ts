import crypto from 'node:crypto';

/*
 * Surgical edits of large JSON documents (xray config profiles, subscription templates).
 *
 * The panel only accepts whole documents, and a profile is 300+ inbounds or a template
 * carries a 160 KB whitelist, so "send the full config back" is where edits used to go
 * wrong. Here the caller describes the change as a list of operations on paths, the
 * engine applies them to a fresh copy, and the result is diffed before anything is sent.
 *
 * Paths are JSON-Pointer-like, with selectors for array elements:
 *   /outbounds[tag=relay-out]/settings/vnext/0/address
 *   /routing/rules[outboundTag=block][network=tcp,udp]/port
 *   /routing/rules[inboundTag~=vless-5443]          (~= : array field contains the value)
 *   /remnawave/injectHosts/0/selector/values
 * A selector must match exactly one element; zero or several matches is an error,
 * never a guess (a loose match once rewrote `dest` on 13 unrelated inbounds).
 */

export type Cond = { key: string; op: '=' | '~='; value: string };
export type Segment = { kind: 'key'; key: string } | { kind: 'index'; index: number | '-' } | { kind: 'select'; conds: Cond[] };

export function parsePath(p: string): Segment[] {
    if (p === '' || p === '/') return [];
    if (!p.startsWith('/')) throw new Error(`path must start with "/": ${p}`);
    const segs: Segment[] = [];
    let i = 1;
    let buf = '';
    const flushKey = () => {
        if (buf === '') return;
        const key = buf.replace(/~1/g, '/').replace(/~0/g, '~');
        if (/^\d+$/.test(key)) segs.push({ kind: 'index', index: Number(key) });
        else if (key === '-') segs.push({ kind: 'index', index: '-' });
        else segs.push({ kind: 'key', key });
        buf = '';
    };
    while (i < p.length) {
        const ch = p[i];
        if (ch === '/') {
            flushKey();
            i++;
            continue;
        }
        if (ch === '[') {
            flushKey();
            const conds: Cond[] = [];
            // one or more consecutive [..] blocks = AND on the same array
            while (p[i] === '[') {
                let j = i + 1;
                let body = '';
                while (j < p.length && p[j] !== ']') {
                    if (p[j] === '\\' && j + 1 < p.length) {
                        body += p[j + 1];
                        j += 2;
                        continue;
                    }
                    body += p[j++];
                }
                if (p[j] !== ']') throw new Error(`unclosed [ in path ${p}`);
                const m = body.match(/^([^=~]+?)(~=|=)(.*)$/s);
                if (!m) throw new Error(`bad selector [${body}] in ${p}: expected [key=value] or [key~=value]`);
                conds.push({ key: m[1].trim(), op: m[2] as '=' | '~=', value: m[3] });
                i = j + 1;
            }
            segs.push({ kind: 'select', conds });
            continue;
        }
        buf += ch;
        i++;
    }
    flushKey();
    return segs;
}

function getDotted(o: unknown, key: string): unknown {
    let cur: unknown = o;
    for (const part of key.split('.')) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

function matches(el: unknown, conds: Cond[]): boolean {
    return conds.every((c) => {
        const v = getDotted(el, c.key);
        if (c.op === '~=') return Array.isArray(v) ? v.map(String).includes(c.value) : typeof v === 'string' && v.split(',').includes(c.value);
        if (v === undefined || v === null) return c.value === 'null' && v === null;
        if (typeof v === 'object') return JSON.stringify(v) === c.value;
        return String(v) === c.value;
    });
}

function segLabel(s: Segment): string {
    if (s.kind === 'key') return '/' + s.key.replace(/~/g, '~0').replace(/\//g, '~1');
    if (s.kind === 'index') return '/' + s.index;
    return s.conds.map((c) => `[${c.key}${c.op}${c.value}]`).join('');
}

export function formatPath(segs: Segment[]): string {
    return segs.map(segLabel).join('') || '/';
}

type Container = Record<string, unknown> | unknown[];
export interface Resolved {
    parent: Container | null;
    key: string | number | null;
    value: unknown;
    exists: boolean;
    pointer: string;
}

/** Resolve a path. With `forCreate`, the last segment may be missing (key to add / '-' / index = length). */
export function resolve(doc: unknown, path: string | Segment[], forCreate = false): Resolved {
    const segs = typeof path === 'string' ? parsePath(path) : path;
    let parent: Container | null = null;
    let key: string | number | null = null;
    let cur: unknown = doc;
    let pointer = '';
    for (let n = 0; n < segs.length; n++) {
        const s = segs[n];
        const last = n === segs.length - 1;
        const where = formatPath(segs.slice(0, n + 1));
        if (s.kind === 'key') {
            if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) throw new Error(`${where}: parent is not an object`);
            const obj = cur as Record<string, unknown>;
            if (!(s.key in obj)) {
                if (last && forCreate) return { parent: obj, key: s.key, value: undefined, exists: false, pointer: pointer + segLabel(s) };
                throw new Error(`${where}: key "${s.key}" not found (have: ${Object.keys(obj).slice(0, 25).join(', ')})`);
            }
            parent = obj;
            key = s.key;
            cur = obj[s.key];
            pointer += segLabel(s);
        } else if (s.kind === 'index') {
            if (!Array.isArray(cur)) throw new Error(`${where}: parent is not an array`);
            const idx = s.index === '-' ? cur.length : s.index;
            if (idx >= cur.length) {
                if (last && forCreate && idx === cur.length) return { parent: cur, key: idx, value: undefined, exists: false, pointer: pointer + '/' + idx };
                throw new Error(`${where}: index ${idx} out of range (length ${cur.length})`);
            }
            parent = cur;
            key = idx;
            cur = cur[idx];
            pointer += '/' + idx;
        } else {
            if (!Array.isArray(cur)) throw new Error(`${where}: selector used on a non-array`);
            const hits: number[] = [];
            cur.forEach((el, i) => {
                if (matches(el, s.conds)) hits.push(i);
            });
            if (hits.length !== 1) {
                throw new Error(
                    `${where}: selector matched ${hits.length} elements${hits.length ? ` (indexes ${hits.slice(0, 10).join(', ')})` : ''}; it must match exactly one`,
                );
            }
            parent = cur;
            key = hits[0];
            cur = cur[hits[0]];
            pointer += '/' + hits[0];
        }
    }
    return { parent, key, value: cur, exists: true, pointer: pointer || '/' };
}

export type Op =
    | { op: 'replace'; path: string; value: unknown }
    | { op: 'set'; path: string; value: unknown }
    | { op: 'add'; path: string; value: unknown }
    | { op: 'remove'; path: string }
    | { op: 'test'; path: string; value: unknown }
    | { op: 'move'; from: string; path: string }
    | { op: 'copy'; from: string; path: string }
    | { op: 'merge'; path: string; value: Record<string, unknown> }
    | { op: 'insert'; path: string; position: 'before' | 'after'; value: unknown }
    | {
          op: 'array_add';
          path: string;
          values: unknown[];
          position?: 'end' | 'start';
          before?: unknown;
          after?: unknown;
          allowDuplicates?: boolean;
      }
    | { op: 'array_remove'; path: string; values: unknown[]; ignoreMissing?: boolean }
    | {
          op: 'replace_string';
          path?: string;
          find: string;
          replace: string;
          regex?: boolean;
          keys?: string[];
          expect?: number;
      };

export interface OpResult {
    op: string;
    path: string;
    pointer?: string;
    note?: string;
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

function setAt(r: Resolved, value: unknown, insert = false) {
    if (!r.parent) throw new Error('cannot replace the document root; use a path below it');
    if (Array.isArray(r.parent)) {
        if (insert) r.parent.splice(r.key as number, 0, value);
        else r.parent[r.key as number] = value;
    } else (r.parent as Record<string, unknown>)[r.key as string] = value;
}

function removeAt(r: Resolved) {
    if (!r.parent) throw new Error('cannot remove the document root');
    if (Array.isArray(r.parent)) r.parent.splice(r.key as number, 1);
    else delete (r.parent as Record<string, unknown>)[r.key as string];
}

function mergePatch(target: unknown, patch: unknown): unknown {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(patch);
    const base: Record<string, unknown> = target && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
    for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete base[k];
        else base[k] = mergePatch(base[k], v);
    }
    return base;
}

/** Apply ops to a copy of doc. Throws on the first op that cannot be applied exactly. */
export function applyOps(doc: unknown, ops: Op[]): { doc: unknown; results: OpResult[] } {
    const out = clone(doc);
    const results: OpResult[] = [];
    ops.forEach((o, n) => {
        const tag = `op #${n + 1} (${o.op})`;
        try {
            switch (o.op) {
                case 'replace': {
                    const r = resolve(out, o.path);
                    if (same(r.value, o.value)) {
                        results.push({ op: o.op, path: o.path, pointer: r.pointer, note: 'already has this value' });
                        break;
                    }
                    setAt(r, clone(o.value));
                    results.push({ op: o.op, path: o.path, pointer: r.pointer });
                    break;
                }
                case 'set': {
                    const r = resolve(out, o.path, true);
                    if (r.exists && same(r.value, o.value)) {
                        results.push({ op: o.op, path: o.path, pointer: r.pointer, note: 'already has this value' });
                        break;
                    }
                    setAt(r, clone(o.value), !r.exists && Array.isArray(r.parent));
                    results.push({ op: o.op, path: o.path, pointer: r.pointer, note: r.exists ? 'replaced' : 'created' });
                    break;
                }
                case 'add': {
                    const r = resolve(out, o.path, true);
                    const isArr = Array.isArray(r.parent);
                    if (!isArr && r.exists) throw new Error(`${o.path} already exists; use replace or set`);
                    setAt(r, clone(o.value), isArr);
                    results.push({ op: o.op, path: o.path, pointer: r.pointer });
                    break;
                }
                case 'remove': {
                    const r = resolve(out, o.path);
                    removeAt(r);
                    results.push({ op: o.op, path: o.path, pointer: r.pointer });
                    break;
                }
                case 'test': {
                    const r = resolve(out, o.path);
                    if (!same(r.value, o.value)) {
                        throw new Error(`test failed at ${o.path}: found ${truncate(JSON.stringify(r.value), 200)}`);
                    }
                    results.push({ op: o.op, path: o.path, pointer: r.pointer, note: 'ok' });
                    break;
                }
                case 'move':
                case 'copy': {
                    const from = resolve(out, o.from);
                    const val = clone(from.value);
                    if (o.op === 'move') removeAt(from);
                    const to = resolve(out, o.path, true);
                    setAt(to, val, Array.isArray(to.parent));
                    results.push({ op: o.op, path: o.path, pointer: to.pointer, note: `from ${from.pointer}` });
                    break;
                }
                case 'merge': {
                    const r = resolve(out, o.path);
                    if (!r.value || typeof r.value !== 'object' || Array.isArray(r.value)) throw new Error(`${o.path} is not an object`);
                    const merged = mergePatch(r.value, o.value);
                    if (same(merged, r.value)) {
                        results.push({ op: o.op, path: o.path, pointer: r.pointer, note: 'no change' });
                        break;
                    }
                    setAt(r, merged);
                    results.push({ op: o.op, path: o.path, pointer: r.pointer });
                    break;
                }
                case 'insert': {
                    const r = resolve(out, o.path);
                    if (!Array.isArray(r.parent)) throw new Error(`${o.path} is not an array element`);
                    const at = (r.key as number) + (o.position === 'after' ? 1 : 0);
                    r.parent.splice(at, 0, clone(o.value));
                    results.push({ op: o.op, path: o.path, pointer: r.pointer, note: `inserted at index ${at}` });
                    break;
                }
                case 'array_add': {
                    const r = resolve(out, o.path);
                    if (!Array.isArray(r.value)) throw new Error(`${o.path} is not an array`);
                    const arr = r.value;
                    const added: unknown[] = [];
                    const skipped: unknown[] = [];
                    let at: number;
                    if (o.before !== undefined || o.after !== undefined) {
                        const anchor = o.before !== undefined ? o.before : o.after;
                        const idx = arr.findIndex((x) => same(x, anchor));
                        if (idx < 0) throw new Error(`anchor ${JSON.stringify(anchor)} not found in ${o.path}`);
                        at = o.before !== undefined ? idx : idx + 1;
                    } else at = o.position === 'start' ? 0 : arr.length;
                    for (const v of o.values) {
                        if (!o.allowDuplicates && arr.some((x) => same(x, v))) {
                            skipped.push(v);
                            continue;
                        }
                        arr.splice(at++, 0, clone(v));
                        added.push(v);
                    }
                    results.push({
                        op: o.op,
                        path: o.path,
                        pointer: r.pointer,
                        note: `added ${added.length}${skipped.length ? `, already present ${skipped.length}` : ''}`,
                    });
                    break;
                }
                case 'array_remove': {
                    const r = resolve(out, o.path);
                    if (!Array.isArray(r.value)) throw new Error(`${o.path} is not an array`);
                    const arr = r.value;
                    let removed = 0;
                    const missing: unknown[] = [];
                    for (const v of o.values) {
                        const before = arr.length;
                        for (let i = arr.length - 1; i >= 0; i--) if (same(arr[i], v)) arr.splice(i, 1);
                        if (arr.length === before) missing.push(v);
                        removed += before - arr.length;
                    }
                    if (missing.length && !o.ignoreMissing) {
                        throw new Error(`${missing.length} value(s) not found in ${o.path}: ${truncate(JSON.stringify(missing), 300)} (set ignoreMissing to allow)`);
                    }
                    results.push({ op: o.op, path: o.path, pointer: r.pointer, note: `removed ${removed}${missing.length ? `, missing ${missing.length}` : ''}` });
                    break;
                }
                case 'replace_string': {
                    const scope = o.path ?? '/';
                    const r = resolve(out, scope);
                    const re = o.regex ? new RegExp(o.find, 'g') : null;
                    let count = 0;
                    const places: string[] = [];
                    const walk = (v: unknown, ptr: string, key: string | null): unknown => {
                        if (typeof v === 'string') {
                            if (o.keys && (key === null || !o.keys.includes(key))) return v;
                            let hits = 0;
                            const nv = re
                                ? v.replace(re, (...m) => {
                                      hits++;
                                      return o.replace.replace(/\$(\d)/g, (_, d) => String(m[Number(d)] ?? ''));
                                  })
                                : v.split(o.find).join(o.replace);
                            if (!re) hits = v.split(o.find).length - 1;
                            if (hits) {
                                count += hits;
                                if (places.length < 30) places.push(ptr);
                            }
                            return nv;
                        }
                        if (Array.isArray(v)) return v.map((x, i) => walk(x, `${ptr}/${i}`, key));
                        if (v && typeof v === 'object') {
                            const res: Record<string, unknown> = {};
                            for (const [k, x] of Object.entries(v)) res[k] = walk(x, `${ptr}/${k}`, k);
                            return res;
                        }
                        return v;
                    };
                    const nv = walk(r.value, r.pointer === '/' ? '' : r.pointer, typeof r.key === 'string' ? r.key : null);
                    if (o.expect !== undefined && count !== o.expect) {
                        throw new Error(`replace_string expected ${o.expect} replacement(s) but found ${count}${places.length ? ` at ${places.slice(0, 10).join(', ')}` : ''}`);
                    }
                    if (r.parent) setAt(r, nv);
                    else {
                        // scope is the root: rewrite in place
                        const root = out as Record<string, unknown>;
                        for (const k of Object.keys(root)) delete root[k];
                        Object.assign(root, nv as Record<string, unknown>);
                    }
                    results.push({ op: o.op, path: scope, pointer: r.pointer, note: `${count} replacement(s)${places.length ? ` at ${places.slice(0, 10).join(', ')}${places.length > 10 ? ', …' : ''}` : ''}` });
                    break;
                }
                default:
                    throw new Error(`unknown op ${(o as { op: string }).op}`);
            }
        } catch (e) {
            throw new Error(`${tag}: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
    return { doc: out, results };
}

// ------------------------------------------------------------------ hashing

export function stableStringify(v: unknown): string {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    const keys = Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}';
}

export function hashOf(v: unknown): string {
    return crypto.createHash('sha256').update(stableStringify(v)).digest('hex').slice(0, 16);
}

// ------------------------------------------------------------------ diff

export interface Change {
    path: string;
    kind: 'changed' | 'added' | 'removed' | 'moved';
    before?: unknown;
    after?: unknown;
}

export function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + `… (${s.length} chars)` : s;
}

function preview(v: unknown, n = 300): unknown {
    if (v === undefined) return undefined;
    const s = JSON.stringify(v);
    if (s.length <= n) return v;
    if (Array.isArray(v)) return `[array of ${v.length}] ${truncate(s, n)}`;
    if (v && typeof v === 'object') return `{object: ${Object.keys(v).slice(0, 12).join(', ')}} ${truncate(s, n)}`;
    return truncate(s, n);
}

const IDENT_KEYS = ['tag', 'ruleTag', 'uuid', 'name'];

function elementLabel(el: unknown, i: number, arr: unknown[]): string {
    if (el && typeof el === 'object' && !Array.isArray(el)) {
        for (const k of IDENT_KEYS) {
            const v = (el as Record<string, unknown>)[k];
            if (typeof v === 'string' && arr.filter((x) => x && typeof x === 'object' && (x as Record<string, unknown>)[k] === v).length === 1) {
                return `[${k}=${v}]`;
            }
        }
    }
    return `/${i}`;
}

function identity(el: unknown): string | null {
    if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
    for (const k of IDENT_KEYS) {
        const v = (el as Record<string, unknown>)[k];
        if (typeof v === 'string' && v) return `${k}=${v}`;
    }
    return null;
}

function similarity(a: unknown, b: unknown): number {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return 0;
    const A = a as Record<string, unknown>;
    const B = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
    let eq = 0;
    for (const k of keys) if (k in A && k in B && stableStringify(A[k]) === stableStringify(B[k])) eq++;
    return keys.size ? eq / keys.size : 0;
}

/** Myers diff over element hashes; returns null when the edit distance is too large to be worth it. */
function myers(a: string[], b: string[], maxD = 600): Array<['=' | '-' | '+', number, number]> | null {
    const n = a.length;
    const m = b.length;
    const max = n + m;
    const off = max;
    const v = new Int32Array(2 * max + 2);
    const trace: Int32Array[] = [];
    for (let d = 0; d <= Math.min(max, maxD); d++) {
        trace.push(v.slice());
        for (let k = -d; k <= d; k += 2) {
            let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
                x++;
                y++;
            }
            v[off + k] = x;
            if (x >= n && y >= m) {
                // backtrack
                const script: Array<['=' | '-' | '+', number, number]> = [];
                let cx = n;
                let cy = m;
                for (let dd = d; dd > 0; dd--) {
                    const pv = trace[dd];
                    const kk = cx - cy;
                    const prevK = kk === -dd || (kk !== dd && pv[off + kk - 1] < pv[off + kk + 1]) ? kk + 1 : kk - 1;
                    const px = pv[off + prevK];
                    const py = px - prevK;
                    while (cx > px && cy > py) script.push(['=', --cx, --cy]);
                    if (cx === px) script.push(['+', cx, --cy]);
                    else script.push(['-', --cx, cy]);
                }
                while (cx > 0 && cy > 0) script.push(['=', --cx, --cy]);
                return script.reverse();
            }
        }
    }
    return null;
}

/** Structural diff of two JSON values. Arrays are aligned (Myers) so an insertion is one change, not a cascade. */
export function diffJson(a: unknown, b: unknown, limit = 300): { changes: Change[]; total: number } {
    const changes: Change[] = [];
    let total = 0;
    const push = (c: Change) => {
        total++;
        if (changes.length < limit) changes.push({ ...c, before: preview(c.before), after: preview(c.after) });
    };
    const walk = (x: unknown, y: unknown, p: string) => {
        if (stableStringify(x) === stableStringify(y)) return;
        const xo = x && typeof x === 'object';
        const yo = y && typeof y === 'object';
        if (Array.isArray(x) && Array.isArray(y)) {
            const hx = x.map(stableStringify);
            const hy = y.map(stableStringify);
            const prim = x.concat(y).every((e) => e === null || typeof e !== 'object');
            const script = myers(hx, hy);
            if (!script) {
                if (prim) {
                    const sx = new Set(hx);
                    const sy = new Set(hy);
                    const added = y.filter((_, i) => !sx.has(hy[i]));
                    const removed = x.filter((_, i) => !sy.has(hx[i]));
                    push({ path: p, kind: 'changed', before: `${x.length} items, removed: ${truncate(JSON.stringify(removed), 400)}`, after: `${y.length} items, added: ${truncate(JSON.stringify(added), 400)}` });
                } else push({ path: p, kind: 'changed', before: x, after: y });
                return;
            }
            // Within each run of deletions/insertions, pair elements that are "the same thing"
            // (same tag/uuid/…, or mostly equal fields) so an edit inside an element shows as a
            // field change rather than remove+add, and an insertion does not look like edits.
            let i = 0;
            while (i < script.length) {
                if (script[i][0] === '=') {
                    i++;
                    continue;
                }
                const dels: number[] = [];
                const ins: number[] = [];
                while (i < script.length && script[i][0] !== '=') {
                    if (script[i][0] === '-') dels.push(script[i][1]);
                    else ins.push(script[i][2]);
                    i++;
                }
                const usedIns = new Set<number>();
                const pairs = new Map<number, number>();
                if (!prim) {
                    for (const di of dels) {
                        const id = identity(x[di]);
                        if (!id) continue;
                        const hit = ins.find((yi) => !usedIns.has(yi) && identity(y[yi]) === id);
                        if (hit !== undefined) {
                            pairs.set(di, hit);
                            usedIns.add(hit);
                        }
                    }
                    for (const di of dels) {
                        if (pairs.has(di) || identity(x[di])) continue;
                        let best = -1;
                        let bestScore = 0.5;
                        for (const yi of ins) {
                            if (usedIns.has(yi) || identity(y[yi])) continue;
                            const sc = similarity(x[di], y[yi]);
                            if (sc >= bestScore) {
                                best = yi;
                                bestScore = sc;
                            }
                        }
                        if (best >= 0) {
                            pairs.set(di, best);
                            usedIns.add(best);
                        }
                    }
                }
                for (const di of dels) {
                    const yi = pairs.get(di);
                    if (yi !== undefined) walk(x[di], y[yi], p + elementLabel(y[yi], yi, y));
                    else push({ path: p + elementLabel(x[di], di, x), kind: 'removed', before: x[di] });
                }
                for (const yi of ins) if (!usedIns.has(yi)) push({ path: p + elementLabel(y[yi], yi, y), kind: 'added', after: y[yi] });
            }
            return;
        }
        if (xo && yo && !Array.isArray(x) && !Array.isArray(y)) {
            const X = x as Record<string, unknown>;
            const Y = y as Record<string, unknown>;
            for (const k of new Set([...Object.keys(X), ...Object.keys(Y)])) {
                const kp = `${p}/${k}`;
                if (!(k in Y) || Y[k] === undefined) {
                    if (X[k] !== undefined) push({ path: kp, kind: 'removed', before: X[k] });
                } else if (!(k in X) || X[k] === undefined) push({ path: kp, kind: 'added', after: Y[k] });
                else walk(X[k], Y[k], kp);
            }
            return;
        }
        push({ path: p || '/', kind: 'changed', before: x, after: y });
    };
    walk(a, b, '');
    return { changes, total };
}
