// Validates a ui.json read from stdin (PearUI v1, plan.md Phase 14 C1); prints {"errors":[...]} and exits 0.
// Used by the Pear MCP `validate_game` tool. Run from Web/: npx vite-node packages/pear-ui/bin/validate.ts < ui.json
import { readFileSync } from 'node:fs';
import { validate } from '../src/validate';

let errors: string[];
try { errors = validate(JSON.parse(readFileSync(0, 'utf8'))); } catch (e) { errors = [`ui.json is not valid JSON: ${(e as Error).message}`]; }
console.log(JSON.stringify({ errors }));
