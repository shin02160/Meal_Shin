# Meal Note design system — v1.1

## Design direction
Calm, warm, mobile-first diary. The instructor's daily workflow is: select date → scan meals → write one review → save. Prefer clean information hierarchy over decorative analytics.

## Tokens
- Background `#F8F7F5`, surface `#FFFFFF`, surface-alt `#F2F0F7`.
- Primary `#7354B4`, primary-hover `#60439F`, primary-light `#EEE8F9`.
- Text `#252333`, muted `#706B7C`, border `#E8E4EC`.
- Success `#207A5A`, error `#B64242`.
- Radius: card 20px, control 12px, pill 999px.
- Spacing scale: 4, 8, 12, 16, 24, 32px.
- Type: system sans Korean fallback (`Pretendard`, `Apple SD Gothic Neo`, `Noto Sans KR`, sans-serif). Do not bundle licensed fonts without permission.
- Content max width: 480px for single-column mobile, 760px for tablet.

## Components
- Top brand bar, date selector, meal summary, meal card (optional image, times, duration), one daily feedback textarea, sticky/visible save button, toast/inline error.
- Meal cards are **read-only**; never show Add Meal/Edit Meal controls.
- Feedback editor has one field per date, not one per meal.
- Empty states: no shared meals; no review; invalid link; Notion error; saving/saved.
- Accessible contrast, keyboard focus rings, labels, descriptive image alt text, 44px touch targets.

## Responsive rules
- 320–480px: single column, meal photo 84px, text wraps, bottom save button not hidden behind keyboard.
- 481–900px: centered content; larger photo, consistent spacing.
- Do not infer a nutrition score or medical judgment from meal timing.

## Deliverables
- `prototype.html`: static interactive UX demonstration with fictional example meals and local-only review state. Not connected to Notion; no network calls.
- `reference-concept.png`: previously generated visual mood board; contains illustrative food and layout, not authoritative text/data.
