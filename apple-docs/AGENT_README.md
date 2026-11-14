# AGENT_README

Local copy of Apple developer documentation for the motion platform. Read these rules first.

1. Files in `raw/` marked `official-doc` (or `wwdc`) in `manifest.json` are the source of truth. They beat blogs, forums, and our own notes.
2. Always check the availability tags before using an API. They are in the JSON comment at the top of each `.md` file and copied into `manifest.json`. An empty list means the page lists none, not "all versions".
3. Forum files are unofficial. (Currently none were saved; see manifest.)
4. If official docs and our notes disagree, trust the docs and report the disagreement.
5. Never edit files in `raw/`. If something is missing, write NOT FOUND; do not guess API names, paths, or versions.
6. Rates and device lists in WWDC transcripts are from the session date (2023) and may be stale.
7. These files are Apple copyrighted material. Do not commit this folder to a public repo.

See `INDEX.md` for what each file covers and `CLAIMS_CHECK.md` for verified claims.
