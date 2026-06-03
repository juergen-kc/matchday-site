# Tier-1 fixtures host (`seed-latest.json`)

This directory is published via GitHub Pages at:

    https://juergen-kc.github.io/matchday-site/data/seed-latest.json

The Matchday app fetches it once on launch (and on pull-to-refresh) and **adopts it only if its
`meta.version` is newer** than the version it already has, after validating it. Anything else — older
version, malformed, offline — is ignored, and the app keeps its current (bundled or cached) data.
See `docs/p1-tier1-remote-fixtures-spec.md` and `Sources/MatchdayKit/Loader/SeedValidator.swift`.

`seed-latest.json` starts identical to the bundled seed (`meta.version: 1`), so until a real update
it is a clean no-op.

## Updating during the tournament

Same schema as the bundled `worldcup26-seed.json` — you are just filling in resolved knockout slots
(and correcting any group time/venue changes).

1. Edit `seed-latest.json`:
   - **Bump `meta.version`** (must strictly increase, e.g. 1 → 2 → 3 — clients adopt on this).
   - Resolve knockout slots as the bracket fills: set `home`/`away` to the real team names,
     `kickoff_utc` (canonical instant), `venue` (a real venue key), `date`, and flip
     `status` to `"confirmed"`. Leave `home_source`/`away_source` — they're harmless once resolved.
2. **Validate** (the same invariants the app enforces at adopt time):

       scripts/validate_fixtures.py site/data/seed-latest.json --min-version 2

3. Commit + push this `site/` to the `matchday-site` repo. Done — no App Store update needed.

## Cadence / automation

Bracket fill-in is only useful **June 28 – July 19, 2026**. A handful of edits cover it (group stage
resolves, then each knockout round's draw).

A *fully autonomous* cron that scrapes results and auto-pushes is fragile. The robust shape is
**semi-automated**: a job that prepares the edit and runs `validate_fixtures.py` as a gate, then
either opens a PR / notifies for a one-click approve, or (if you trust the source) pushes. Keep the
validator in the loop so a bad fetch can never reach devices.
