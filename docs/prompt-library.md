# Prompt Library

## Codex: focused UI change

```text
Read AGENTS.md and docs/ux-decisions.md first.

Task:
Improve [screen/component] so it feels more polished and aligned with Coverly’s teal/slate/soft-white brand.

Constraints:
- Do not change Supabase schema.
- Do not change billing.
- Reuse existing colors/constants where practical.
- Avoid adding dependencies.

Done looks like:
- [specific visual/functional acceptance criteria]
- App still runs in Expo Go.
- Provide a concise test checklist.
```

## Codex: image reliability

```text
Read AGENTS.md, docs/image-handling.md, and docs/data-model-and-supabase.md first.

Task:
Investigate and fix image display reliability for [property/room/item/scan review].

Constraints:
- Store storage paths in DB, not signed URLs.
- Use existing signed URL helpers/hooks if present.
- Do not weaken RLS.
- Do not change bucket name.

Before editing:
- Identify current upload path.
- Identify current DB field.
- Identify current display resolver.

Done looks like:
- Image persists after reload.
- Image displays on relevant screens.
- Missing image fallback works.
- Errors are debuggable.
```

## Codex: replacement pricing

```text
Read AGENTS.md and docs/replacement-pricing-spec.md first.

Task:
Build/extend the replacement pricing UI for item detail.

Constraints:
- Use existing replacement-price-search backend/function.
- Do not create a new backend path unless necessary.
- Respect existing entitlement checks.
- Keep UI mobile-first.

Done looks like:
- User can search replacement options.
- Results show image/title/retailer/price.
- Filter pills work.
- User can tap “Use this listing”.
- Item value updates clearly.
```

## Codex: onboarding

```text
Read AGENTS.md, docs/coverly-context.md, and docs/ux-decisions.md first.

Task:
Improve first-user onboarding and empty states.

Constraints:
- Keep flow simple.
- Do not require unnecessary fields.
- Do not block users from exploring.
- Do not change auth.

Done looks like:
- User creates first property.
- User can enter insured contents value.
- User lands on a guided next-step screen.
- Empty rooms/items screens tell the user what to do next.
```

## Replit Planner mode: larger task

```text
Use Planner mode first. Do not implement yet.

Read AGENTS.md and the relevant docs in /docs.

Task:
[task]

Return:
1. Current behaviour.
2. Proposed behaviour.
3. Files/components likely affected.
4. Data/schema implications.
5. Billing/entitlement implications.
6. Risks.
7. Step-by-step implementation plan.
8. Test plan.
9. Production migration notes.
```
