import type { Node, PearUI } from './types';

export const NODE_TYPES = ['column', 'row', 'stack', 'text', 'button', 'image', 'timer', 'list', 'gauge', 'spacer', 'map', 'sensor', 'effect'];

/** Structural errors in a ui.json (empty = valid). Unknown node types are allowed: they render nothing. */
export function validate(ui: unknown): string[] {
  const errs: string[] = [];
  const u = ui as Partial<PearUI>;
  if (!u || typeof u !== 'object') return ['ui.json must be an object'];
  if (u.pearui !== 1) errs.push('pearui must be 1');
  if (!u.screens || typeof u.screens !== 'object') errs.push('screens must be an object');
  if (!Array.isArray(u.route) || u.route.length === 0) errs.push('route must be a non-empty array');
  else {
    u.route.forEach((r, i) => {
      if (!r || typeof r.screen !== 'string') errs.push(`route[${i}].screen must be a string`);
      else if (u.screens && !(r.screen in u.screens)) errs.push(`route[${i}].screen "${r.screen}" is not in screens`);
    });
    if (u.route[u.route.length - 1]?.when !== undefined) errs.push('last route entry must have no "when" (the default)');
  }
  const walk = (n: Node, at: string) => {
    if (!n || typeof n !== 'object' || typeof n.type !== 'string') { errs.push(`${at}: node needs a string type`); return; }
    if (n.type === 'button' && !n.action) errs.push(`${at}: button needs an action`);
    if (n.type === 'sensor' && (!n.kind || !n.event)) errs.push(`${at}: sensor needs kind and event`);
    if (n.type === 'list' && (!n.items || !n.item)) errs.push(`${at}: list needs items and item`);
    n.children?.forEach((c, i) => walk(c, `${at}.children[${i}]`));
    if (n.item) walk(n.item, `${at}.item`);
  };
  for (const [k, n] of Object.entries(u.screens ?? {})) walk(n as Node, `screens.${k}`);
  return errs;
}
