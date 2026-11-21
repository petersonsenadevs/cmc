# cmc — Claude Message Control

A Claude Code plugin that lets you decide **when** your messages reach the agent: hold what you type while it
works, and release it when you want, without interrupting the turn.

> Status: work in progress. Phase 1 (hold and release) is being built.

## Requirements

- Claude Code 2.1.330 or newer
- Node.js 20 or newer (no npm dependencies, no build step)

## Try it from a checkout

```
claude --plugin-dir .
```

## Development

```
npm test        # node --test
npm run lint    # syntax check of every module
claude plugin validate .
```

## Author

Peterson Sena (r3v3rs3)
