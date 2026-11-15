# Acceptance & QA checklist

| ID | Scenario | Expected |
|---|---|---|
| AC-01 | Select date with shared meals | Only checked meals on selected KST date appear |
| AC-02 | Uncheck previously shared meal | Meal absent from every API/UI response after refresh |
| AC-03 | Private `식사 메모` populated | No private text in network payload, HTML, logs or UI |
| AC-04 | Meal images present/expired | Authorized images render; expired URLs refresh; no public access |
| AC-05 | Previous/next date | Correct KST day and sorted meals |
| AC-06 | First daily feedback save | Exactly one Notion Daily Review created |
| AC-07 | Edit existing feedback | Same Notion page updated; createdAt preserved |
| AC-08 | Two concurrent saves | No duplicate daily reviews |
| AC-09 | Notion write failure | Error shown, draft retained, retry works |
| AC-10 | Invalid/missing/revoked secret link | No meal/review access; no sensitive data returned |
| AC-11 | Rotate link | Old link and old sessions rejected |
| AC-12 | iPhone Safari | No horizontal overflow, usable tap targets, keyboard accessible |
| AC-13 | KST 23:59 / 00:00 | Records correctly partition across dates |
| AC-14 | Notion data changed | Refresh displays latest allowed data |
| AC-15 | No meals, no review | Empty state, new feedback disabled |
| AC-16 | No meals, existing review | Existing feedback visible and editable |
| AC-17 | Missing end time | Duration blank; no fake value |
| AC-18 | Invalid end before start | Warning displayed, no negative duration |
| AC-19 | Meal CRUD attempt through web app | No write UI/endpoints for meals |
| AC-20 | Blank/whitespace feedback | Save disabled or 400 response |
| AC-21 | Image/media API without session | 401/403, no image bytes leaked |
| AC-22 | Notion returns duplicate date reviews | 409/operator alert; no silent overwrite |

## QA conventions
For a formal TC workbook, preserve the user's established **14 columns** exactly: No, 0depth, 1depth, 2depth, 3depth, 기능, 사전조건, 절차, 예상결과, 기획서, QA확인결과, JIRA, 비고, 담당자. Button action wording: `[버튼명] 선택`. Number expected results. This file is an acceptance checklist, not a substitute for a full TC workbook.
