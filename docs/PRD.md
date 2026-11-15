# Meal Note — PRD v1.1 (confirmed MVP)

## Goal
Owner records meals in Notion; Pilates instructor reviews ONLY owner-shared meals in a mobile web app and leaves ONE overall written assessment per day. Review persists to Notion.

## Users
- Owner: enters meals and photos in Notion, sets share checkbox, reads feedback in Notion.
- Instructor: opens secret link, selects date, views shared meals, writes/edits single daily review.

## Confirmed decisions
| Topic | Policy |
|---|---|
| Meal CRUD | Notion only |
| Share scope | `공유 여부` checked records only |
| Instructor access | Secret share link, no account login |
| Feedback | One free-text daily overall review, not per-meal |
| Persistence | Notion `Daily Review` DB |
| Edit feedback | Allowed, update existing row |
| Empty day | No new review if no shared meals; previously saved review still readable/editable |
| Meal duration | `식사 시작` and `식사 종료` date-times, `식사 소요시간` Notion formula |
| Privacy | `식사 메모` always private; `공유 메모` instructor-visible |
| Timezone | Asia/Seoul |

## In scope
- Date picker / previous and next day; shared meals grouped by selected day, sorted by start time.
- Meal image(s), title, category, start/end time, duration, food content, shared note.
- Daily feedback editor, save/edit, loading/success/failure states.
- Secure link exchange and revocable session; basic error, empty and mobile states.

## Out of scope
Meal creation/edit/delete from app; owner web portal; per-meal feedback; AI analysis; nutrition calculations; social feed; instructor account registration; notifications; offline sync; analytics dashboard.

## UX policy
- Instructor can see dates with no shared meals but cannot create a *new* review for those dates.
- Feedback must not be empty or whitespace-only.
- On save error, preserve unsaved draft and offer retry.
- Do not label a day “healthy/unhealthy” automatically; only instructor writes qualitative feedback.
- Instructor UI is read-only for meal data.

## Open implementation decisions (not product-policy changes)
- Choose production-grade persistent token/session store and concurrency control; Vercel KV/Redis or Postgres are candidates, not preselected.
- Whether photo delivery is short-lived signed URL or authorized server proxy, based on privacy and performance testing.
- Secret-link lifetime, rotation UI/operator procedure, session TTL, rate limits: choose secure defaults and document.
