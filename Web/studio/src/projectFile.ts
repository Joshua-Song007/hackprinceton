// Project files on disk: `*.pear.json` = a ProjectSnapshot in a small versioned envelope.
// File System Access API where the browser has it (Chromium, WebView2); download + <input type=file> elsewhere.
import type { ProjectSnapshot } from './project';

export const FILE_FORMAT = 'pear-project';
export const FILE_VERSION = 1;
export const FILE_EXTENSION = '.pear.json';

export function serializeProject(snapshot: ProjectSnapshot): string {
  return JSON.stringify({ format: FILE_FORMAT, v: FILE_VERSION, ...snapshot }, null, 2) + '\n';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSourceMap = (v: unknown): v is Record<string, string> => isRecord(v) && Object.values(v).every((s) => typeof s === 'string');

/** Throws an Error whose message is a sentence for the user. A file is untrusted input, so every field is checked. */
export function parseProjectFile(text: string): ProjectSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON, so it is not an Pear project.');
  }
  if (!isRecord(raw) || raw.format !== FILE_FORMAT) throw new Error('That file is not an Pear project (missing "format": "pear-project").');
  if (raw.v !== FILE_VERSION) throw new Error(`This project file is version ${String(raw.v)}; this Studio opens version ${FILE_VERSION}.`);
  if (!isRecord(raw.scene)) throw new Error('The project file has no scene.');
  if (!isSourceMap(raw.clientScripts) || !isSourceMap(raw.serverScripts)) throw new Error('The project file has script sources that are not text.');
  const gameId = raw.gameId ?? null;
  const version = raw.version ?? null;
  if ((gameId !== null && typeof gameId !== 'string') || (version !== null && typeof version !== 'number')) throw new Error('The project file has a bad cloud link.');
  return { scene: raw.scene, clientScripts: raw.clientScripts, serverScripts: raw.serverScripts, gameId, version };
}

/** The slice of FileSystemFileHandle used here (lib.dom does not type the picker APIs everywhere). */
export interface FileHandleLike {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
interface PickerWindow {
  showSaveFilePicker?: (o: unknown) => Promise<FileHandleLike>;
  showOpenFilePicker?: (o: unknown) => Promise<FileHandleLike[]>;
}
const picker = (): PickerWindow => window as unknown as PickerWindow;
const PICKER_TYPES = [{ description: 'Pear project', accept: { 'application/json': [FILE_EXTENSION, '.json'] } }];
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export const safeFileName = (projectName: string): string => (projectName.replace(/[^A-Za-z0-9._ -]+/g, '').trim() || 'project') + FILE_EXTENSION;

export interface SavedFile {
  name: string;
  /** Present only with the File System Access API; lets the next Save overwrite without asking. */
  handle: FileHandleLike | null;
}

/**
 * Writes the snapshot. With a handle, overwrites it silently; without, asks where (picker) or downloads (no picker).
 * Resolves null when the user cancels the picker.
 */
export async function saveProjectFile(snapshot: ProjectSnapshot, suggestedName: string, handle: FileHandleLike | null): Promise<SavedFile | null> {
  const text = serializeProject(snapshot);
  const pick = picker().showSaveFilePicker;
  if (!handle && pick) {
    try {
      handle = await pick.call(window, { suggestedName, types: PICKER_TYPES });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  if (handle) {
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return { name: handle.name, handle };
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: suggestedName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { name: suggestedName, handle: null };
}

export interface OpenedFile extends SavedFile {
  snapshot: ProjectSnapshot;
}

/** Resolves null when the user cancels. Throws a sentence-style Error for a file that is not a project. */
export async function openProjectFile(): Promise<OpenedFile | null> {
  const pick = picker().showOpenFilePicker;
  if (pick) {
    let handles: FileHandleLike[];
    try {
      handles = await pick.call(window, { types: PICKER_TYPES, multiple: false });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    const handle = handles[0];
    if (!handle) return null;
    return { name: handle.name, handle, snapshot: parseProjectFile(await (await handle.getFile()).text()) };
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: `${FILE_EXTENSION},.json,application/json` });
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  return file ? { name: file.name, handle: null, snapshot: parseProjectFile(await file.text()) } : null;
}
