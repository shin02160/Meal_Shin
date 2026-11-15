# Codex implementation plan

## Phase 0 — repository inspection
Identify framework, deployment, styling, test framework, existing environment configuration and Notion integration. Report conflicts; do not overwrite unrelated app functionality.

## Phase 1 — server integration
Implement typed Notion adapter, schema mapping, KST date boundaries, allowlist projection and image strategy. Add mock tests proving private meals and private notes cannot leak.

## Phase 2 — authentication
Implement high-entropy secret link exchange, revocable server session, middleware/API guards, no-store headers and rate limiting. Add tests for revoked/expired tokens.

## Phase 3 — review persistence
Implement read + atomic upsert by date with persistent lock/key mapping, duplicate conflict handling and Notion error recovery. Add concurrent save tests.

## Phase 4 — instructor UI
Build responsive date navigation, meal cards, photo gallery, daily feedback textarea and save/edit status. Follow `design/DESIGN_SYSTEM.md` and `design/prototype.html`. No meal creation controls.

## Phase 5 — verification and handoff
Run typecheck, lint, unit, integration (with test data), accessibility and iPhone Safari smoke tests. Provide screenshots, known limitations, env var setup, token rotation procedure and deployment checklist.

## Done when
All mandatory acceptance cases pass; no secrets/private meal data in browser or logs; shared-only query enforced server-side; review updates do not duplicate; mobile layout usable; deployment setup documented. If real Notion access is unavailable, report unverified integration and do not claim end-to-end completion.
