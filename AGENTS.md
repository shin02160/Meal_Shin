# Codex instructions — Meal Note

You are implementing an MVP for one diary owner and one Pilates instructor. Use polite Korean UI copy. Review the existing repository, then propose a concise implementation plan before editing. Work in small, reviewable commits. Avoid unrelated refactors.

**Hard constraints**
- Food entries are CREATED/EDITED/DELETED in Notion ONLY. No meal-write endpoints or client meal-entry form.
- Instructor sees only records with `공유 여부 = true`. The server must project only approved fields, never send `식사 메모` or other private properties.
- One daily feedback per KST calendar day; editing replaces the existing review, not a new row.
- Instructor access is via revocable secret link, no username/password login in MVP. Treat link as bearer credential. Token and Notion API credentials never appear in logs, analytics, response payloads or source control.
- Do not recreate or rename existing Notion DBs/columns without explicit approval. Existing Meal Log has `식사 시작`, `식사 종료`, `식사 소요시간` formula; Daily Review is already created.
- No live data in design samples; mockups must be labeled sample.
- Confirm actual Notion API responses and database schema before shipping. No assumption that Notion enforces uniqueness or that formula fields are SQL-queryable.
- Run tests and build; document gaps and any unverified integration behaviors.

**Implementation**: Next.js App Router, TypeScript, responsive CSS. Server-side Notion adapter, secure session, data projection, error handling. Do not invent credentials or deploy without user instruction. Read docs/IMPLEMENTATION_PLAN.md.
