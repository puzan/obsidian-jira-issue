# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

An Obsidian plugin (`obsidian-jira-issue`) that renders Atlassian Jira issues, searches, and counts inside Obsidian notes via code fences (` ```jira-issue `, ` ```jira-search `, ` ```jira-count `) and inline tags (`JIRA:KEY-123`).

## Commands

Package manager is **pnpm** (see `pnpm-workspace.yaml`); CI uses `pnpm install --frozen-lockfile`.

- `pnpm install` — install dependencies
- `pnpm run dev` — esbuild in watch mode, outputs `main.js` for loading into an Obsidian vault
- `pnpm run build` — typecheck (`tsc -noEmit -skipLibCheck`) then production esbuild bundle
- `pnpm run test` — run the full Jest suite (TZ forced to UTC via `cross-env-shell`)
- `pnpm run test-watch` — Jest in watch mode
- Run a single test file: `pnpm run test -- test/utils.test.ts`
- Run tests matching a name: `pnpm run test -- -t "getAccountByAlias"`
- `pnpm run version <x.y.z>` — bumps `manifest.json`/`package.json`/`versions.json` (used by the release workflow, not for routine use)

There is an `.eslintrc` but no `lint` script in `package.json`; run `npx eslint src` directly if needed.

The `docs-gen/` directory is a separate Docusaurus site (its own `package.json`/`pnpm-lock.yaml`) for the public documentation at marc0l92.github.io/obsidian-jira-issue. It's excluded from the root Jest config (`modulePathIgnorePatterns: ['docs-gen']`) and has its own install/build steps in CI.

## Testing notes

- Jest uses `ts-jest`, `testEnvironment: node`, and resolves modules from `node_modules`, `src`, and `test` — so test files import with bare paths off those roots.
- Obsidian's API is mocked in `__mocks__/obsidian.ts` (currently: `addIcon`, `PluginSettingTab`, `requestUrl`). Extend this mock when new Obsidian APIs are exercised by tested code.
- `SettingsData` is a module-level singleton (see below); tests that touch code depending on it typically do `jest.mock('../src/settings', () => ({ SettingsData: { ... } }))` before importing the module under test, then mutate `SettingsData` directly (see `test/utils.test.ts`).
- Shared fixtures live in `test/testData.ts`.

## Architecture

### Global singletons, not dependency injection

The plugin avoids passing state through constructors; instead several modules export mutable singleton objects that are imported wherever needed:

- `SettingsData` (`src/settings.ts`) — the live plugin settings object (accounts, cache TTL, columns, etc.). Loaded/saved by `JiraIssueSettingTab`, read directly by API/client/rendering code.
- `ObsidianApp` (`src/main.ts`) — the Obsidian `App` instance, set once in `onload()` and imported elsewhere instead of being threaded through function signatures.
- `ObjectsCache` (`src/objectsCache.ts`) — an in-memory TTL cache (TTL driven by `SettingsData.cacheTime`, parsed with `ms`). Keys are freeform strings; `api/apiBase.ts`'s `cacheWrapper` builds keys as `` `api-${func.name}-${JSON.stringify(args)}` ``.

### Layered API (`src/api/`)

`api/api.ts` assembles a single `API` object (also exposed on `window.$ji` for user scripting) from sub-modules, each adding a layer of behavior on top of the raw Jira client:

- `apiBase.ts` — thin, cached (`cacheWrapper`) wrappers directly over `JiraClient` (`src/client/jiraClient.ts`), which performs actual HTTP calls to Jira's REST/Agile APIs via Obsidian's `requestUrl`.
- `apiDefaulted.ts` — versions of base calls with default field sets / options applied.
- `apiMacro.ts` — higher-level composite operations (active sprint, velocity, worklogs by sprint/date) built from base calls.
- `apiChart.ts` — data shaped for chart rendering (worklog per day/user).

When adding a new Jira operation, add the raw call to `jiraClient.ts`, wrap it in `apiBase.ts`, and only add to `apiDefaulted`/`apiMacro`/`apiChart` if it needs defaults or composition.

### Multi-account model

Settings support multiple Jira accounts (`IJiraIssueAccountSettings[]` in `SettingsData.accounts`), each with its own host, auth type (`OPEN`/`BASIC`/`CLOUD`/`BEARER_TOKEN`), and per-account cache (status colors, custom field maps, JQL autocomplete data). Most client/API functions accept an optional `account` — when omitted, `jiraClient.ts`'s `sendRequest` iterates over all configured accounts and returns the first non-4xx response, so behavior differs meaningfully between "no account passed" and "specific account passed".

Jira also has a legacy REST API and a newer "2025" API (`use2025Api` per account, `path`/`path2025` and `queryParameters`/`queryParameters2025` pairs in `RequestOptions`); most request builders in `jiraClient.ts` carry both variants side by side.

### Rendering (`src/rendering/`)

Three code-fence processors registered in `main.ts` via `registerMarkdownCodeBlockProcessor`: `issueFenceRenderer.ts`, `searchFenceRenderer.ts`, `countFenceRenderer.ts`. Inline issue tags (`JIRA:KEY` / reading mode) are handled by two separate paths that must stay in sync: `inlineIssueRenderer.ts` (Markdown post-processor, reading view) and `inlineIssueViewPlugin.ts` (CodeMirror 6 `ViewPlugin`, live preview/editing view). Shared HTML-building helpers (status color maps, container/theme helpers) live in `renderingCommon.ts`. `renderTableColumns.ts` renders individual search-result table columns per `ESearchColumnsTypes`.

### Settings tab

`src/settings.ts` defines `JiraIssueSettingTab` (an Obsidian `PluginSettingTab`), `DEFAULT_SETTINGS`, and `DEFAULT_ACCOUNT`. It owns loading/saving `SettingsData` and exposes an `onChange` hook that `main.ts` uses to clear `ObjectsCache`, refresh the custom-fields cache, and re-render the live-preview view plugin whenever settings change.

### Interfaces

`src/interfaces/issueInterfaces.ts` and `src/interfaces/settingsInterfaces.ts` hold the TypeScript types/enums for Jira API shapes and plugin settings respectively — check these first when working with issue fields, search columns, or account config shapes.

## Build output

`esbuild.config.mjs` bundles `src/main.ts` to `main.js` at the repo root (per `manifest.json`/Obsidian plugin conventions); `styles.css` is hand-maintained, not generated. Releases zip `main.js`, `manifest.json`, and `styles.css` (see `.github/workflows/release.yml`).
