// Recent local projects: the last few projects saved or opened in this browser (the web cannot list a folder).
import { withStore, type ProjectSnapshot } from './project';

export interface RecentEntry { id: string; name: string; savedAt: number; snapshot: ProjectSnapshot }
export const MAX_RECENT = 10;
const KEY = 'recent';

/** Newest first, one entry per id, capped. */
export function pushRecent(list: readonly RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX_RECENT);
}

export const removeRecent = (list: readonly RecentEntry[], id: string): RecentEntry[] => list.filter((e) => e.id !== id);

export const loadRecent = async (): Promise<RecentEntry[]> => (await withStore('readonly', (st) => st.get(KEY) as IDBRequest<RecentEntry[] | undefined>)) ?? [];
const store = (list: RecentEntry[]) => withStore('readwrite', (st) => st.put(list, KEY));

/** `id` is the file name when there is one, else the project name. Storage failures are ignored: recents are a convenience. */
export async function rememberRecent(id: string, snapshot: ProjectSnapshot): Promise<void> {
  try {
    const name = typeof snapshot.scene.name === 'string' && snapshot.scene.name ? snapshot.scene.name : 'Untitled';
    await store(pushRecent(await loadRecent(), { id, name, savedAt: Date.now(), snapshot: structuredClone(snapshot) }));
  } catch { /* private mode or no IndexedDB */ }
}

export interface ProjectRow {
  kind: 'cloud' | 'local' | 'draft';
  key: string;
  title: string;
  /** ms since epoch; undefined when unknown (the draft). */
  time?: number | undefined;
  recent?: RecentEntry;
}

/** One list for the projects screen: newest first, rows without a time last in their given order. */
export function mergeProjects(games: readonly { id: string; title: string; updated_at: string }[], recents: readonly RecentEntry[], hasDraft: boolean): ProjectRow[] {
  const rows: ProjectRow[] = [
    ...games.map((g): ProjectRow => ({ kind: 'cloud', key: g.id, title: g.title, time: Date.parse(g.updated_at) || undefined })),
    ...recents.map((r): ProjectRow => ({ kind: 'local', key: r.id, title: r.name, time: r.savedAt, recent: r })),
    ...(hasDraft ? [{ kind: 'draft', key: 'draft', title: 'Autosaved draft' } as ProjectRow] : []),
  ];
  const t = (r: ProjectRow) => r.time ?? -Infinity;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => t(b.r) - t(a.r) || a.i - b.i).map((x) => x.r);
}

export async function forgetRecent(id: string): Promise<void> {
  try { await store(removeRecent(await loadRecent(), id)); } catch { /* ignore */ }
}
