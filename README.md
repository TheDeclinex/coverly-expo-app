# Coverly Mobile

Coverly is an AI-assisted home contents inventory app for households.

It helps users:
- Create properties and rooms.
- Scan rooms/photos to detect contents.
- Record item evidence and replacement values.
- Compare estimated contents value against insured cover.
- Prepare future claim-ready evidence packs.

Tagline:

> Know what you own.

This repository contains the Expo / React Native mobile app.

## Suggested local development flow

```bash
npm install
npx expo start
```

Use Expo Go for ordinary UI and JavaScript changes.

Use a development build for native dependencies such as native billing, custom native modules, or app-store-like testing.

## Git workflow

Recommended branch structure:

```text
main          stable / production-ready
dev           active development
feature/*     individual changes
```

Example:

```bash
git checkout dev
git pull origin dev
git checkout -b feature/room-completion-ring

# make changes

git status
git diff
git add .
git commit -m "Improve room completion ring styling"
git push origin feature/room-completion-ring
```

## Repo documentation

Important project context lives in `/docs`.

AI assistants and developers should read:

1. `AGENTS.md`
2. `docs/coverly-context.md`
3. Relevant feature-specific docs
