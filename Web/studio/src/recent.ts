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
  /** `shared` for a cloud game owned by another account; everything else is `solo`. */
  scope: 'solo' | 'shared';
}

/** One list for the projects screen: newest activity first (the later of the last edit and the last Open pressed here), rows without a time last in their given order. */
export function mergeProjects(games: readonly { id: string; title: string; updated_at: string; owner_id?: string }[], recents: readonly RecentEntry[], hasDraft: boolean, opened: Readonly<Record<string, number>> = {}, draftAt?: number, accountId?: string): ProjectRow[] {
  const rows: ProjectRow[] = [
    ...games.map((g): ProjectRow => ({ kind: 'cloud', key: g.id, title: g.title, time: Date.parse(g.updated_at) || undefined, opened: opened[`cloud:${g.id}`], stamp: g.updated_at, scope: accountId && g.owner_id && g.owner_id !== accountId ? 'shared' : 'solo' })),
    ...recents.map((r): ProjectRow => ({ kind: 'local', key: r.id, title: r.name, time: r.savedAt, recent: r, opened: opened[`local:${r.id}`], stamp: String(r.savedAt), scope: 'solo' })),
    ...(hasDraft ? [{ kind: 'draft', key: 'draft', title: 'Autosaved draft', time: draftAt, opened: opened['draft:draft'], stamp: String(draftAt ?? 0), scope: 'solo' } as ProjectRow] : []),
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

export type SortKey = 'activity' | 'edited' | 'opened' | 'name';
export const SORT_KEYS: readonly SortKey[] = ['activity', 'edited', 'opened', 'name'];
export const SORT_LABELS: Readonly<Record<SortKey, string>> = { activity: 'Last activity', edited: 'Last edited', opened: 'Last opened', name: 'Name' };

/** Newest first; a missing value sorts after every real one. */
const newestFirst = (a: number | undefined, b: number | undefined): number => (a === undefined ? (b === undefined ? 0 : 1) : b === undefined ? -1 : b - a);
const latest = (r: ProjectRow): number | undefined => (r.time === undefined && r.opened === undefined ? undefined : Math.max(r.time ?? -Infinity, r.opened ?? -Infinity));

/** A new, stably sorted list: ties and missing values keep the given order (names tie by key). */
export function sortProjects(rows: readonly ProjectRow[], key: SortKey): ProjectRow[] {
  const compare: Record<SortKey, (a: ProjectRow, b: ProjectRow) => number> = {
    activity: (a, b) => newestFirst(latest(a), latest(b)),
    edited: (a, b) => newestFirst(a.time, b.time),
    opened: (a, b) => newestFirst(a.opened, b.opened),
    name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) || a.key.localeCompare(b.key),
  };
  return rows.map((r, i) => ({ r, i })).sort((x, y) => compare[key](x.r, y.r) || x.i - y.i).map((x) => x.r);
}

/** Rows whose title contains `query` (trimmed, any case); an empty query keeps every row. */
export function filterProjects(rows: readonly ProjectRow[], query: string): ProjectRow[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : [...rows];
}

export interface ProjectStats { total: number; solo: number; shared: number; cloud: number; local: number }

/** Counts for the profile column; the autosaved draft counts as on this computer. */
export function projectStats(rows: readonly ProjectRow[]): ProjectStats {
  const count = (test: (r: ProjectRow) => boolean) => rows.filter(test).length;
  return { total: rows.length, solo: count((r) => r.scope === 'solo'), shared: count((r) => r.scope === 'shared'), cloud: count((r) => r.kind === 'cloud'), local: count((r) => r.kind !== 'cloud') };
}

const SORT_STORE = 'pear.studio.gallery.sort';
type SortStorage = Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage = (): SortStorage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

/** The saved sort, or `activity` when none is saved or storage is unavailable. */
export function loadSort(storage: SortStorage | null = browserStorage()): SortKey {
  try {
    const saved = storage?.getItem(SORT_STORE);
    return SORT_KEYS.find((k) => k === saved) ?? 'activity';
  } catch { return 'activity'; }
}

export function saveSort(key: SortKey, storage: SortStorage | null = browserStorage()): void {
  try { storage?.setItem(SORT_STORE, key); } catch { /* storage blocked: the sort is a convenience */ }
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
