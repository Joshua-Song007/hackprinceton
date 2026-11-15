## Status: Staged — Studio colors: keep charcoal, Pear accents (web Studio)
- Scope: `Web/studio` and `Web/packages/pear-runtime`. Native Studio untouched. No git. Existing comments kept; inaccurate ones flagged at the end, not edited.
- Neutrals unchanged (bg-window #232427, bg-panel #2a2b2f, bg-field #1d1e21, bg-hover #34353a, viewport #3d3e43, lines, text, text-secondary).
- Decision defaults, change if the user says so:
  - the gallery and login drop their green override and use the same charcoal tokens (one palette);
  - warn, error and Live keep their current hues (see Kept).

### 1. `Web/studio/src/studio-tokens.css` (values only; the comments stay as they are)
- Dark block (`:root, [data-theme="dark"]`):
  - `--accent` #4b93f8 → #C2EFB3 (Tea; 11.0:1 on panel, 12.9:1 on field, 8.3:1 on viewport)
  - `--on-accent` #0b1a2e → #285943 (Emerald, the kit's ink-on-accent; 6.3:1 on Tea)
  - `--bg-selected` #1f3a63 → #24402F (green-tinted charcoal; text 9.0:1)
  - `--ok` #5cc27a → #C2EFB3 (11.0:1)
  - add `--selection: #E5B181` (Sandy; 5.6:1 on viewport, 7.4:1 on panel), documented in a new comment line
  - `--focus` stays the alias of `--accent`
- Light block (`[data-theme="light"]`):
  - `--accent` #0a63d6 → #285943 (Emerald; 7.4:1 on panel)
  - `--on-accent` #ffffff → #F4FAEF (Paper; 7.6:1 on Emerald)
  - `--bg-selected` #d7e6fb → #D5E6D6 (text 12.9:1)
  - `--ok` #227a3a → #285943 (7.4:1)
  - add `--selection: #764134` (Clay; 4.2:1 on the light viewport)
- Kept: `--warn`, `--error`, `--live`, `--on-live`, `--axis-x/y/z`.
  - warn and error stay amber and red because the kit's pale peach pair is 1.12:1 apart (hue 29° vs 11°);
  - Live orange (hue 27°) must not blend into Sandy, so Sandy is not used near the toolbar or status bar;
  - axes stay conventional red/green/blue.
- No `--link` or `--info` tokens exist in the Studio and nothing reads them; none added.

### 2. `Web/packages/pear-runtime/src/viewport.ts`
- `ViewportColors` gains `selection: string`.
- `DARK_VIEWPORT_COLORS`: `accent` '#4b93f8' → '#C2EFB3'; add `selection: '#E5B181'`.
- `TOKENS` gains `selection: '--selection'` (the Record is typed by `keyof ViewportColors`, so the compiler enforces it).
- In `rebuild()`: a selected entity uses `c.selection` for its fill and edges (was `c.accent`). The self-player pin (`p.self ? c.accent`) stays on `accent`.
- Why: Tea against the white unselected edges is 1.02:1, so the selection would disappear. WebGL lines are 1 px, so the cue is hue plus the existing 0.35 vs 0.15 fill opacity; no line-width change.

### 3. `Web/studio/src/theme.css`
- Remove the gallery's green override: the 2 comment lines and the `:root:not([data-theme="light"]) .scr { ... }` block. The gallery and login now inherit the global tokens, so sheets and menus match over the gallery (closes the Phase 11 sheet item for colors).
- `.menu button[disabled]` opacity .4 → .55 (kept consistent with the button rule below).
- Keep the `.scr` size and layout rules unchanged.

### 4. `Web/studio/src/studio-components.css`
- `.om-btn:disabled` opacity .4 → .55.
- Add `.om-btn--danger { color: var(--error); }` and `.om-btn--danger:hover { border-color: var(--error); }`.

### 5. `Web/studio/src/ui.ts` and `Web/studio/src/explorer.ts`
- `button()` options `variant` gains `'danger'` (class `om-btn--danger`).
- `explorer.ts`: the script-row "Delete" button and the sheet's "Delete script" button use `variant: 'danger'`. (The delete confirmation sheet already exists.)

### 6. `Web/studio/src/thumbnail.ts`
- `THUMB_STYLE` 'pear-dark-1' → 'pear-charcoal-1': previews were rendered with the green viewport ground and must re-render on the charcoal one.

### 7. Tests
- `Web/studio/test/screens.test.ts`: no change needed (stamp test uses `thumbStamp`).
- Add `Web/packages/pear-runtime/test/runtime.test.ts` case (or the nearest existing viewport colors test): `DARK_VIEWPORT_COLORS.selection` is not equal to `.accent` and not equal to `.text`; `readViewportColors()` falls back to the defaults when the page has no tokens.
- Contrast guard in the same place: a pure helper in the test computes WCAG ratios; assert on the dark token values: Tea on panel/field/viewport ≥ 4.5, Emerald on Tea ≥ 4.5, text on `--bg-selected` ≥ 7, Sandy on viewport ≥ 3, and Tea vs `--text` edge colour < 1.2 (documents why `--selection` exists).

### 8. Manual check (cannot run in node)
- Run `Deploy/dev.sh`:
  - editor: Publish button, tab underline, checkboxes, focus ring, menu hover rows (full Tea fill with Emerald text), explorer selection;
  - viewport: a selected entity reads clearly against white edges and the gizmo;
  - Live mode: toolbar and status bar stay orange and distinct from the Sandy selection;
  - gallery and login: charcoal with Tea accent, no green;
  - light theme: Emerald accent;
  - disabled "Stop" readable;
  - script-row Delete in coral text.

### 9. After apply
- Append `### 2026-11-14 — Studio colors` to `.claude/planHistory/phase-08.md` under `## Later changes` (Paths line, text, exact-path item lines).
- `plan.md` Phase 11: tick nothing; the item for `Web/studio/src/studio-tokens.css` stays open for the full Pear restyle (fonts, radii). Add "(Changed 2026-11-14: accent, selection and ok colors done; see planHistory/phase-08.md)" to the Phase 11 intro line; the sheet-and-menu line in `Web/studio/src/theme.css` is covered by this change.
- Flag for the user (inaccurate once applied, not edited):
  - `studio-tokens.css` comments on `--accent` ("the viewport selection outline"), `--bg-selected`, `--ok`, and the header "generated from tokens.json" (no generator exists);
  - the `viewport.ts` `DARK_VIEWPORT_COLORS` doc ("Dark theme values of tokens.css");
  - `theme.css` Phase 8 gallery comment is unaffected.
- Then reset this file to Clear.

### Not built (OPEN)
- Kit state colors for warn and error (pale peach pair too close; revisit with an icon-led design).
- Paper-light polish beyond the accent swap; Fraunces and Geist; kit radii (4 and 10 px) versus Studio 5 and 10.
- Underline rule for links: none exist in the Studio UI today (only download anchors); add one when a text link appears.
