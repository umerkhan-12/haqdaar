import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Journal, SavedSettlement } from './rails.store';

/**
 * The simulated bank's book as one JSON file. Written to a temporary file and renamed, so a crash
 * mid-write never leaves half a book. Any disk problem is swallowed: the simulation then simply
 * runs from memory, as it did before.
 */
export function fileJournal(path: string): Journal {
  return {
    load() {
      try {
        const all: unknown = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(all) ? (all as SavedSettlement[]) : [];
      } catch {
        return [];
      }
    },
    save(all) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(`${path}.tmp`, JSON.stringify(all));
        renameSync(`${path}.tmp`, path);
      } catch {
        /* memory only */
      }
    },
  };
}
