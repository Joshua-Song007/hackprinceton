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
  /** ms since epoch of the last edit (cloud `updated_at`, local save, draft autosave); undefined when unknown (a draft saved before its time was recorded). */
  time?: number | undefined;
  recent?: RecentEntry;
  /** ms since epoch of the last Open pressed in this browser; undefined when never opened here. */
  opened?: number | undefined;
  /** Changes whenever the project's content does; a cached thumbnail is valid only for the same stamp. */
  stamp: string;
}

/** One list for the projects screen: newest activity first (the later of the last edit and the last Open pressed here), rows without a time last in their given order. */
export function mergeProjects(games: readonly { id: string; title: string; updated_at: string }[], recents: readonly RecentEntry[], hasDraft: boolean, opened: Readonly<Record<string, number>> = {}, draftAt?: number): ProjectRow[] {
  const rows: ProjectRow[] = [
    ...games.map((g): ProjectRow => ({ kind: 'cloud', key: g.id, title: g.title, time: Date.parse(g.updated_at) || undefined, opened: opened[`cloud:${g.id}`], stamp: g.updated_at })),
    ...recents.map((r): ProjectRow => ({ kind: 'local', key: r.id, title: r.name, time: r.savedAt, recent: r, opened: opened[`local:${r.id}`], stamp: String(r.savedAt) })),
    ...(hasDraft ? [{ kind: 'draft', key: 'draft', title: 'Autosaved draft', time: draftAt, opened: opened['draft:draft'], stamp: String(draftAt ?? 0) } as ProjectRow] : []),
  ];
  // Newest activity first: the later of the last edit and the last Open pressed here.
  const t = (r: ProjectRow) => Math.max(r.time ?? -Infinity, r.opened ?? -Infinity);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => t(b.r) - t(a.r) || a.i - b.i).map((x) => x.r);
}

/** "Opened 14 Nov 2026, 14:05"; `label` "Opened" reads "Not opened here" and "Edited" reads "Not saved yet" when the time is unknown. Locale and zone are for tests. */
export function formatWhen(ms: number | undefined, label: 'Opened' | 'Edited', locale?: string, timeZone?: string): string {
  if (ms === undefined) return label === 'Opened' ? 'Not opened here' : 'Not saved yet';
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
  return `${label} ${format.format(ms)}`;
}

const OPENED = 'opened';
const MAX_OPENED = 200;

/** Last Open per project in this browser, keyed `kind:key` (the backend has no such field). */
export const loadOpened = async (): Promise<Record<string, number>> => (await withStore('readonly', (st) => st.get(OPENED) as IDBRequest<Record<string, number> | undefined>)) ?? {};

/** Keeps the newest `max` entries, so the map cannot grow without bound. */
export function capOpened(map: Readonly<Record<string, number>>, max = MAX_OPENED): Record<string, number> {
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, max));
}

/** Storage failures are ignored: "last opened" is a convenience. */
export async function markOpened(kind: ProjectRow['kind'], key: string, now = Date.now()): Promise<void> {
  try {
    const next = capOpened({ ...(await loadOpened()), [`${kind}:${key}`]: now });
    await withStore('readwrite', (st) => st.put(next, OPENED));
  } catch { /* private mode or no IndexedDB */ }
}

export async function forgetOpened(kind: ProjectRow['kind'], key: string): Promise<void> {
  try {
    const { [`${kind}:${key}`]: _gone, ...rest } = await loadOpened();
    await withStore('readwrite', (st) => st.put(rest, OPENED));
  } catch { /* ignore */ }
}

export interface Thumb { stamp: string; url: string }
const THUMBS = 'thumbs';
const MAX_THUMBS = 60;

/** The cached preview for `key` when it was rendered for the same `stamp`, else undefined. */
export const thumbHit = (cache: Readonly<Record<string, Thumb>>, key: string, stamp: string): string | undefined => (cache[key]?.stamp === stamp ? cache[key]!.url : undefined);

export const loadThumbs = async (): Promise<Record<string, Thumb>> => (await withStore('readonly', (st) => st.get(THUMBS) as IDBRequest<Record<string, Thumb> | undefined>)) ?? {};

/** Oldest entries (insertion order) go first once more than `MAX_THUMBS` are kept. Storage failures are ignored. */
export async function saveThumb(key: string, stamp: string, url: string): Promise<void> {
  try {
    const { [key]: _old, ...rest } = await loadThumbs();
    const next = Object.fromEntries(Object.entries({ ...rest, [key]: { stamp, url } }).slice(-MAX_THUMBS));
    await withStore('readwrite', (st) => st.put(next, THUMBS));
  } catch { /* private mode or no IndexedDB */ }
}

export async function dropThumb(key: string): Promise<void> {
  try {
    const { [key]: _gone, ...rest } = await loadThumbs();
    await withStore('readwrite', (st) => st.put(rest, THUMBS));
  } catch { /* ignore */ }
}

export async function forgetRecent(id: string): Promise<void> {
  try { await store(removeRecent(await loadRecent(), id)); } catch { /* ignore */ }
}
