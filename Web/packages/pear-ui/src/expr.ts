// C1 expressions: `a.b.c`, `a == 'x'`, `a != 3`, `!a`, `a && b`, `a || 'fallback'`. No eval: unknown syntax is a path.
// `&&` binds tighter than `||` and yields its last term when all are truthy, so `x == 1 && 'red' || 'blue'` picks a value.

const LIT = /^(-?\d+(\.\d+)?|'[^']*'|"[^"]*"|true|false|null)$/;

function literal(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s[0] === "'" || s[0] === '"') return s.slice(1, -1);
  return Number(s);
}

export function lookup(scope: unknown, path: string): unknown {
  let cur: unknown = scope;
  for (const key of path.split('.')) {
    if (key === 'length' && (Array.isArray(cur) || typeof cur === 'string')) return cur.length;
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function term(scope: unknown, raw: string): unknown {
  let s = raw.trim();
  let negate = false;
  while (s.startsWith('!') && !s.startsWith('!=')) { negate = !negate; s = s.slice(1).trim(); }
  const m = /^(.+?)\s*(==|!=)\s*(.+)$/.exec(s);
  let v: unknown;
  if (m) {
    const l = operand(scope, m[1]), r = operand(scope, m[3]);
    // loose on number/string so `ev.state.round == 2` matches "2"
    const eq = l === r || (l !== undefined && r !== undefined && l !== null && r !== null && String(l) === String(r));
    v = m[2] === '==' ? eq : !eq;
  } else v = operand(scope, s);
  return negate ? !v : v;
}

const operand = (scope: unknown, s: string): unknown => (LIT.test(s.trim()) ? literal(s.trim()) : lookup(scope, s.trim()));

function conj(scope: unknown, expr: string): unknown {
  let v: unknown;
  for (const p of expr.split('&&')) { v = term(scope, p); if (!truthy(v)) return v; }
  return v;
}

/** Evaluates one expression against a view state (or any object). */
export function evalExpr(scope: unknown, expr: string): unknown {
  const parts = expr.split('||');
  let v: unknown;
  for (const p of parts) {
    v = conj(scope, p);
    if (v !== undefined && v !== null && v !== false && v !== '') return v;
  }
  return v;
}

export const truthy = (v: unknown): boolean => !(v === undefined || v === null || v === false || v === '' || v === 0);

/** `{{expr}}` interpolation. A string that is exactly one `{{expr}}` keeps the value's type. */
export function interpolate(scope: unknown, value: unknown): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{([^}]*)\}\}$/.exec(value);
    if (whole) return evalExpr(scope, whole[1]);
    return value.replace(/\{\{([^}]*)\}\}/g, (_, e: string) => {
      const v = evalExpr(scope, e);
      return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(scope, v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(scope, v)]));
  }
  return value;
}
