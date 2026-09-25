import fs from 'node:fs';
import path from 'node:path';
import { Config } from '../config.js';

export type BackupKind = 'config-profile' | 'sub-template' | 'host' | 'node' | 'squad' | 'other';

export interface BackupRecord {
    kind: BackupKind;
    uuid: string;
    name?: string;
    takenAt: string;
    /** Tool that was about to write. */
    reason: string;
    /** The object exactly as the panel returned it before the write. */
    data: unknown;
}

export interface JournalEntry {
    at: string;
    tool: string;
    target: string;
    summary: string;
    backup?: string;
    ok: boolean;
    error?: string;
}

/**
 * Backups and the write journal. Every tool that changes the panel takes a
 * backup of the object it is about to overwrite and appends a journal line,
 * so any change made through this server can be looked up and rolled back
 * without digging in the panel's own pg dumps.
 */
export class StateStore {
    readonly backupDir: string;
    readonly journalFile: string;

    constructor(config: Config) {
        this.backupDir = path.join(config.stateDir, 'backups');
        this.journalFile = path.join(config.stateDir, 'journal.jsonl');
    }

    backup(kind: BackupKind, uuid: string, name: string | undefined, reason: string, data: unknown): string {
        const dir = path.join(this.backupDir, kind);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeName = (name ?? uuid).replace(/[^\w.-]+/g, '_').slice(0, 60);
        const file = path.join(dir, `${stamp}-${safeName}-${uuid.slice(0, 8)}.json`);
        const rec: BackupRecord = { kind, uuid, name, takenAt: new Date().toISOString(), reason, data };
        fs.writeFileSync(file, JSON.stringify(rec, null, 1), { mode: 0o600 });
        return file;
    }

    readBackup(file: string): BackupRecord {
        const abs = path.isAbsolute(file) ? file : path.join(this.backupDir, file);
        const rec = JSON.parse(fs.readFileSync(abs, 'utf8')) as BackupRecord;
        if (!rec || !rec.kind || !rec.uuid || rec.data === undefined) throw new Error(`${abs} is not a backup made by this server`);
        return rec;
    }

    listBackups(filter?: { kind?: string; contains?: string }, limit = 50) {
        const out: Array<{ file: string; kind: string; size: number; mtime: string }> = [];
        if (!fs.existsSync(this.backupDir)) return out;
        for (const kind of fs.readdirSync(this.backupDir)) {
            if (filter?.kind && kind !== filter.kind) continue;
            const dir = path.join(this.backupDir, kind);
            if (!fs.statSync(dir).isDirectory()) continue;
            for (const f of fs.readdirSync(dir)) {
                if (filter?.contains && !f.includes(filter.contains)) continue;
                const st = fs.statSync(path.join(dir, f));
                out.push({ file: path.join(dir, f), kind, size: st.size, mtime: st.mtime.toISOString() });
            }
        }
        return out.sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, limit);
    }

    log(entry: Omit<JournalEntry, 'at'>) {
        fs.mkdirSync(path.dirname(this.journalFile), { recursive: true, mode: 0o700 });
        const line: JournalEntry = { at: new Date().toISOString(), ...entry };
        fs.appendFileSync(this.journalFile, JSON.stringify(line) + '\n', { mode: 0o600 });
    }

    journal(limit = 30, contains?: string): JournalEntry[] {
        if (!fs.existsSync(this.journalFile)) return [];
        const lines = fs.readFileSync(this.journalFile, 'utf8').trim().split('\n').filter(Boolean);
        const parsed = lines.map((l) => JSON.parse(l) as JournalEntry);
        const f = contains ? parsed.filter((e) => JSON.stringify(e).includes(contains)) : parsed;
        return f.slice(-limit).reverse();
    }
}
