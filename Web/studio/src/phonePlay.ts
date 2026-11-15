// Play for a game that has nothing to draw (Quick Draw): two real phones join the published game, so Studio simulates no players and mounts no 3D scene.
import type { EntityDescription, SceneDescription } from '@pear/runtime';
import { publishLinks } from './publishView';
import { announce, button, el, openSheet } from './ui';

export interface PhoneLink { label: string; url: string }

const invisible = (e: EntityDescription): boolean => e.scale.every((s) => s === 0) && e.children.every(invisible);

/** A device game whose every entity is zero-scale: its players are phones, not avatars in a scene. HotPotato and screen games have visible entities. */
export function isPhoneOnly(scene: SceneDescription): boolean {
  return scene.runMode === 'device' && scene.entities.length > 0 && scene.entities.every(invisible);
}

/** The two phone pages of one published version of the game (the version pins which scripts the session runs). */
export function phoneLinks(serverUrl: string, gameId: string, version: number): PhoneLink[] {
  return publishLinks(serverUrl, gameId).map((l) => ({ ...l, url: `${l.url}&version=${version}` }));
}

// A phone cannot open localhost, and iOS grants motion access only on HTTPS.
const unreachableFromPhone = (url: string): boolean => {
  const u = new URL(url);
  return u.protocol === 'http:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
};

export function openPhoneSheet(links: PhoneLink[]): void {
  openSheet('Play on two phones', (body, close) => {
    body.append(
      el('p', {}, ['Open one link on each phone, tap Ready on both, and the countdown starts by itself.']),
      ...(links.some((l) => unreachableFromPhone(l.url))
        ? [el('p', { role: 'alert' }, ['These links will not work on a phone: phones need the server reachable over HTTPS (not localhost or http). The hosted server needs PEAR_DEV_SIGNIN=1.'])]
        : []),
      ...links.map((l) => el('div', { class: 'om-prop' }, [
        el('span', {}, [l.label]),
        el('div', { class: 'om-field' }, [
          el('a', { href: l.url, target: '_blank', rel: 'noreferrer' }, [l.url]),
          button('Copy', () => void navigator.clipboard.writeText(l.url).then(() => announce(`Copied ${l.label} link`)), { variant: 'small', ariaLabel: `Copy ${l.label} link` }),
        ]),
      ])),
      el('div', { class: 'sheet-actions' }, [button('Close', close)]),
    );
  });
}
