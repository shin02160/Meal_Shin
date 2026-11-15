# Meal Note — technical specification

## Architecture
Next.js App Router + TypeScript on Vercel (suggested), server-only Notion SDK/API adapter, persistent token/session and locking store. Client receives a **whitelisted projection** of shared meals. Never use client-side Notion API access.

```
Notion Meal Log → server Notion adapter → privacy filter/projection → authenticated instructor UI
Instructor feedback → authenticated API → per-date atomic lock → Notion Daily Review
Secret link (#token=...) → browser POST exchange → server hash validation → HttpOnly session
```

## Existing Notion schema
### Meal Log (data source `4186d8c5-8de1-81e1-be59-000b0724740b`)
| Property | Type | Notes |
|---|---|---|
| 기록명 | Title | visible |
| 식사 시작 | Date with time | required by workflow, KST |
| 식사 종료 | Date with time | optional |
| 식사 소요시간 | Formula | derived, may be blank or `시간 확인 필요` |
| 식사 구분 | Select | 아침, 점심, 저녁, 간식, 야식 |
| 식단 사진 | Files | multiple |
| 음식 내용 | Rich text | visible |
| 식사 메모 | Rich text | **private; NEVER expose** |
| 공유 메모 | Rich text | visible |
| 공유 여부 | Checkbox | default unchecked |
| 생성 일시 | Created time | system |
| 수정 일시 | Last edited time | system |

### Daily Review (data source `4186d8c5-8de1-810b-94f4-000bf0a3e048`)
| Property | Type | Notes |
|---|---|---|
| 리뷰명 | Title | `YYYY-MM-DD 식단 리뷰` |
| 리뷰 날짜 | Date (date-only) | canonical date key |
| 강사 총평 | Rich text | nonblank on save |
| 리뷰 상태 | Select | 완료 |
| 작성 일시 | Date with time | immutable after creation |
| 수정 일시 | Date with time | update on each save |

No Relation is required in MVP; date joins logically. Notion does NOT provide a uniqueness constraint on `리뷰 날짜`.

## Data access rules
1. Authenticate request before querying or serving any meal or image data.
2. Query meals with `공유 여부 = true` and `식사 시작` in `[KST 00:00, next KST 00:00)`, with correct timezone offsets. Filter **again on server** and map to explicit allowlist: id, title, category, startAt, endAt, durationMinutes/displayDuration, foods, sharedNote, authorizedImages.
3. NEVER return `식사 메모`, internal integration metadata, unrelated pages, or unshared records. Do not fetch/forward all properties to browser.
4. For review GET/PUT, scope to authenticated instructor and one canonical `YYYY-MM-DD` date.
5. A formula may be unavailable through Notion SQL-like query; use Notion API property retrieval or calculate UI duration from validated timestamps. Notion remains the source of truth for stored formula.
6. Notion file URLs expire. Re-fetch as needed; do not store indefinitely. If proxying images, authorize every request, disable public caching and prevent SSRF/open redirects.
7. Notion rich text may have length/block limits. Validate and split into supported segments when necessary; return actionable errors.

## Proposed API contract
- `POST /api/auth/link` body `{token}`: verify hashed token, set HttpOnly Secure SameSite=Lax session, return minimal success; rate limit. Never log token.
- `POST /api/auth/logout`: invalidate session.
- `GET /api/meals?date=YYYY-MM-DD`: shared-only meal array sorted by startAt, server projection.
- `GET /api/reviews/YYYY-MM-DD`: `{date, feedback, status, updatedAt}` or `{date, feedback:"", status:"missing"}`.
- `PUT /api/reviews/YYYY-MM-DD` body `{feedback:string}`: upsert one review; return saved review.

Sample meal response (fictional):
```json
{"date":"2026-11-15","meals":[{"id":"sample-meal-1","title":"점심","category":"점심","startAt":"2026-11-15T11:28:00+09:00","endAt":"2026-11-15T11:53:00+09:00","durationMinutes":25,"foods":"항정국밥, 항정수육, 순대 1알","sharedNote":"","images":[]}]}
```

## Review upsert and duplicate prevention
- Validate date and nonempty feedback; reject unsupported length.
- Acquire distributed lock keyed by date (single-process mutex is NOT sufficient on serverless).
- Under lock, query matching reviews; if one exists update it, else create. If multiple exist from legacy/manual editing, do not silently pick or delete: return conflict and flag operator repair.
- On creation, set `작성 일시` and `수정 일시`; on edit, only `수정 일시`.
- Release lock in finally; use store that provides atomic lock or unique date-key mapping. Reconcile Notion write ambiguity (timeout after successful creation) by re-query before retry.
- Do not create a review when no shared meals exist and no review exists; allow editing an existing review even if meals later become private.

## Authentication design
- High-entropy random bearer token, hashed at rest (e.g. SHA-256 for uniformly random 256-bit token), constant-time compare; rotate/revoke on demand.
- Share as `https://<domain>/review#token=<secret>` so URL fragment is not sent in HTTP request; client exchanges token via POST and removes fragment via `history.replaceState` immediately. Disable third-party analytics on auth flow.
- Session is opaque, revocable, short-lived, stored server-side, cookie `HttpOnly; Secure; SameSite=Lax; Path=/`; validate session for each API and media request.
- Rotate token invalidates old token AND associated sessions; limit failed attempts, set no-store headers and conservative CSP.
- A bearer link is transferable: any recipient with the link can act as instructor. Document this risk to owner.

## Error and operational requirements
- `400` invalid date/input, `401` missing/expired session, `403` revoked access, `404` unsupported route, `409` duplicate review conflict, `429` rate limited, `502/503` Notion unavailable.
- Keep form draft in memory during retry; do not claim saved until server confirms.
- Use `Cache-Control: private, no-store` for personal API responses; sanitize server logs; secrets via Vercel env vars.
- Keep tests for timezone boundaries, shared/unshared filtering, error handling, concurrent PUT, and session revocation.

## Environment variable names (examples, never commit values)
```
NOTION_TOKEN=
NOTION_MEAL_LOG_DATA_SOURCE_ID=4186d8c5-8de1-81e1-be59-000b0724740b
NOTION_DAILY_REVIEW_DATA_SOURCE_ID=4186d8c5-8de1-810b-94f4-000bf0a3e048
AUTH_STORE_URL=
AUTH_STORE_TOKEN=
SESSION_SIGNING_SECRET=
```
Validate which Notion API version supports data-source IDs before coding; do not silently substitute database IDs.
