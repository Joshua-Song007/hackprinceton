## Status: Staged (audited)
Sign-in screen fixes from the critique. Web/studio only. Preserve all comments.

### Facts (read)
- Web/studio/src/loginScreen.ts: one `.scr-card.scr-login` (theme.css:216-217, 420 px) with the lockup, a Name row, Sign in, a note, "Developer sign-in" with Username / Password rows, "Sign in as developer", and the server button
- the server line is already a borderless button that opens the Settings sheet (`openSettingsSheet(prefs)`), but it reads as plain text
- `.sheet-actions`, `.sheet-note` and `.sheet-error` are styled only inside `dialog.sheet` (theme.css:164-167), so on this page the buttons sit at the left edge, the note is full-size body text, and the error lines ("Wrong username or password") are NOT red
- `.om-prop` is a 72 px label column + field (studio-components.css:40) with no gap between stacked rows; `.om-field input` has `padding: 0 6px 0 2px`, so typed text touches the border (the "green" in the Name field)
- name sign-in calls `account.signIn` with provider 'dev' (a personal account; empty name -> "Enter a name to sign in."); developer = `role: 'developer'`, who "may edit every game" (Backend/src/db.rs:93) and sees every game (account.ts:157)
- h1 "Pear Studio" exists but is `.sr-only`; the visible lockup says only "Pear"
- no test touches loginScreen.ts

### 1. Say what each path is (Web/studio/src/loginScreen.ts) — P1
- first section: h2 "Quick start", note "Any name works. Makes a personal account for testing: you see and publish your own games."
- divider text "or" (`el('p', { class: 'scr-or', 'aria-hidden': 'true' }, ['or'])`), then h2 "Developer account", note "For developer accounts: username and password. A developer sees and can edit every game."
- buttons keep their labels and aria-labels ("Sign in", "Sign in as developer"); the old note line and the "Developer sign-in" heading are replaced by the above
- the code header comment (dev sign-in is a stand-in until real auth exists) is not edited

### 2. One column, same widths, errors visible (loginScreen.ts untouched here; Web/studio/src/theme.css) — P2
- all new rules go AFTER theme.css:222 so they win ties with `.scr h2` and `.scr .om-btn--borderless`
- `.scr-login .om-prop { grid-template-columns: minmax(0, 1fr); gap: 4px; margin-top: 12px; }` (labels above their fields; gap between rows fixes the touching Username / Password inputs)
- `.scr-login .om-field input { padding-left: 10px; }` (typed text no longer touches the border)
- `.scr-login .sheet-actions { display: flex; margin-top: 16px; } .scr-login .sheet-actions .om-btn { flex: 1; }`
- `.scr-login .sheet-note { font-size: 12px; color: var(--text-secondary); margin: 4px 0 0; }`; `.scr-login h2 { color: var(--text); font-size: 15px; font-weight: 600; margin: 24px 0 4px; }`
- errors: `.scr .sheet-error { color: var(--error); font-size: 12px; margin: var(--space-2) 0 0; }` (same rule as the dialog one, for the whole screen area, so the Projects screen's error line is fixed too; the message text itself already says what is wrong, so colour is not the only signal)
- `.scr-or { text-align: center; color: var(--text-secondary); font-size: 12px; margin: 16px 0 0; }`

### 3. Product name (loginScreen.ts, theme.css) — P2
- visible `el('p', { class: 'scr-product', 'aria-hidden': 'true' }, ['Studio'])` right after the two lockup images (the sr-only h1 already covers screen readers)
- `.scr-login .scr-logo { margin-bottom: 4px; } .scr-product { text-align: center; margin: 0 0 16px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary); }`

### 4. Server line reads as clickable (loginScreen.ts, theme.css) — P2
- text `Server: <url> · Change`, `title` "Change the server in Settings" (set in `showServer`); `.scr-login .om-btn--borderless { text-decoration: underline; text-underline-offset: 2px; padding-left: 0; }` (after line 222)
- still opens `openSettingsSheet(prefs)`

### 5. Favicon in Safari (Web/studio/index.html, Web/studio/public) — P2
- cause (unconfirmed in the browser): the dev server serves /pear-studio-icon.svg correctly (200, image/svg+xml) but Safari does not use SVG favicons and caches icons per host; /favicon.ico is a 404
- add `public/favicon-32.png`: the 32 px heavy-outline version; the scratch render t32.png may be gone, so re-derive it from docs/brand-kit/assets/logo/pear-studio-icon.svg with the same transform (no handles, stroke 34, fill-opacity 0.32, no hairline ring) and `sips`
- add `public/favicon.ico` copied from src-tauri/icons/icon.ico
- index.html: keep the SVG link, add `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`
- NO apple-touch-icon: the icon has transparent rounded corners, which iOS fills black; this is a desktop tool
- the user may still have to clear Safari's cached icon for localhost

### 6. Polish (loginScreen.ts) — P3
- drop the "Username" / "Password" placeholders (labels above say it); keep "Your name"; aria-labels unchanged
- when a remembered name is pre-filled, the focus microtask also calls `name.select()` so typing replaces it
- Enter still submits per form; no behaviour change

### Not changing
- the two sign-in paths and their API calls (`account.signIn`, `account.signInDeveloper`), the Settings sheet, the lockup SVGs
- button styling beyond width: Sign in stays the mint primary (the recommended path), "Sign in as developer" stays secondary
- plan.md:296 still shows `loginScreen.ts` Developer sign-in unchecked although it is built; flagged for the user, not ticked here

### Verify
- `npm run typecheck`, `npx vitest run`, `npm run build --workspace studio` from Web/ (confirm dist has favicon-32.png and favicon.ico)
- no DOM tests for this screen: the user checks the login page, a wrong-password error and the tab icon in the browser

### Docs on apply
- planHistory/phase-08.md `## Later changes`: `### 2026-11-15 — Sign-in screen clarity` (Paths: loginScreen.ts, theme.css, index.html, public icons); plan.md Phase 8 Built line: dated note
- history hits: none for loginScreen.ts, scr-login or the lockups; plan.md line 296 mentions loginScreen.ts
