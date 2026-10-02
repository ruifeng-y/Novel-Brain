# Novel Brain Core Engine

Novel Brain's core engine maintains a canonical narrative representation and routes AI output through validation, review, and a coherent commit boundary.

## Design Boundaries

- Committed manuscript text and committed narrative facts are canonical state.
- AI output is candidate state and never writes directly to canonical state.
- `Canon`, `StoryState`, and `Manuscript` are domain concepts, not monolithic aggregates.
- `NarrativeCommit` coordinates one coherent canonical transition.
- Tasks and candidates use `basedOnVersionSet`, not a global novel version.
- Memory and retrieval data is derived and rebuildable.

## Local Commands

```bash
npm install
npm run typecheck
npm test -- --run
docker compose up -d postgres
export DATABASE_URL=postgresql://novelbrain:novelbrain@localhost:5434/novelbrain?schema=public
npx prisma migrate dev
npm run test:integration -- --run
```

The deterministic runtime proves the engine pipeline without requiring an external model provider.
