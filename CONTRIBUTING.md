# Contributing

Thanks for contributing to Metapi.

## Development Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment template:

```bash
cp .env.example .env
```

3. Run migration and start development:

```bash
npm run db:migrate
npm run dev
```

## Quality Checks

Run before opening a PR:

```bash
npm test
npm run build
```

## Pull Request Guidelines

- Keep PRs focused and small.
- Add or update tests for behavior changes.
- Update docs when user-facing behavior/config changes.
- Avoid committing runtime data (`data/`) or temporary files (`tmp/`).

## Commit Messages

Use concise messages with clear scope, for example:

- `feat: add token route health guard`
- `fix: handle empty model list in dashboard`
- `docs: clarify docker env setup`
