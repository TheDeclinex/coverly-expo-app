# Replit, GitHub, and Codex Workflow

## Goal

Use paid ChatGPT/Codex locally for code changes while reducing reliance on Replit AI credits.

## Recommended source of truth

GitHub should be the source of truth.

Replit should be treated as:
- A cloud workspace.
- A preview/runtime environment.
- A place to compare/deploy if useful.

## Standard workflow

```bash
git checkout dev
git pull origin dev

# use Codex locally

npm install
npx expo start

git status
git diff
git add .
git commit -m "Describe focused change"
git push origin dev
```

Then in Replit:

```bash
git pull origin dev
npm install
```

## Avoid

- Repeated manual export/import when Git pull/push will work.
- Editing the same file in Replit and locally at the same time.
- Letting Replit become the only updated copy.
- Committing `.env` or secrets.
- Making broad AI changes without reviewing the diff.

## Prompt pattern for Codex

Use this style:

```text
Read AGENTS.md and docs/coverly-context.md first.

Task:
[describe one focused change]

Constraints:
- Do not change Supabase schema.
- Do not change billing.
- Preserve existing route structure.
- Use existing styling constants where possible.

Done looks like:
- [clear acceptance criteria]

Before editing:
- Show the files you expect to touch.
- Ask if the change requires a migration or new dependency.
```

## Prompt pattern for Replit Planner mode

For larger Replit tasks:

```text
Use Planner mode first. Do not implement yet.

Read AGENTS.md and relevant docs.

Task:
[describe change]

Please produce:
1. Files affected.
2. Current behaviour.
3. Proposed behaviour.
4. Implementation steps.
5. Risks.
6. Test plan.
7. Anything that would affect production migration.
```

## When to still use Replit AI

Replit AI may still be useful for:
- Cloud environment-specific debugging.
- Replit deployment issues.
- Quick fixes inside the hosted workspace.
- Comparing local vs Replit behaviour.

But ordinary app code changes can be done locally with Codex.
