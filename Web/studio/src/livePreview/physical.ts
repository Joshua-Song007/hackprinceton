import { validateUsis } from '@pear/core';
import { quatToEuler } from '../project';
import { normalizeLobby, type PreviewKind } from './helpers';

export type PreviewRole = 'phone' | 'referee';
export type PreviewSource = 'simulator' | 'browser' | 'companion';
export interface PhysicalJoin { gameId: string; lobby: string; kind: PreviewKind; role: PreviewRole }

/** The dedicated hosted player accepts the same 1–12 character lobby contract as /play. */
export function physicalPlayerUrl(base: string, join: PhysicalJoin): string {
  const url = new URL('player.html', `${base.replace(/\/+$/, '')}/`);
  url.search = new URLSearchParams({ game: join.gameId, lobby: join.lobby, kind: join.kind, role: join.role }).toString();
  return url.href;
}

export function parsePhysicalJoin(search: string): PhysicalJoin | null {
  const p = new URLSearchParams(search);
  const gameId = p.get('game')?.trim() ?? '';
  const lobby = p.get('lobby') ?? '';
  const kind = p.get('kind');
  const role = p.get('role');
  if (!gameId || !lobby || normalizeLobby(lobby) !== lobby || !['phone', 'ipad'].includes(kind ?? '') || !['phone', 'referee'].includes(role ?? '')) return null;
  return { gameId, lobby, kind: kind as PreviewKind, role: role as PreviewRole };
}

export function phoneReachable(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !['localhost', '0.0.0.0', '[::1]'].includes(u.hostname) && !u.hostname.endsWith('.localhost') && !u.hostname.startsWith('127.');
  } catch { return false; }
}

/** USIS orientation is Pear Y-up; use the editor's YXZ Euler convention, in degrees. Never reinterpret metre positions as GPS. */
export function companionMotion(deviceId: string, input: unknown): { pitch: number; roll: number; yaw: number } | null {
  const valid = validateUsis(input);
  if (!valid.ok || valid.packet.deviceId !== deviceId || valid.packet.source !== 'live' || !valid.packet.ch?.orientation) return null;
  const [pitch, yaw, roll] = quatToEuler(valid.packet.ch.orientation);
  return { pitch, roll, yaw };
}

/** A reserved browser slot must not sign in a hidden simulated player. */
export const needsPreviewSession = (source: PreviewSource): boolean => source !== 'browser';

/** Native Companion squeeze only; browser pointer events are not Pencil Pro squeeze. */
export function companionSqueeze(deviceId: string, input: unknown): { deviceId: string; seq: number } | null {
  const valid = validateUsis(input);
  if (!valid.ok || valid.packet.deviceId !== deviceId || valid.packet.source !== 'live' || valid.packet.ch?.gesture?.type !== 'squeeze') return null;
  return { deviceId, seq: valid.packet.seq };
}
