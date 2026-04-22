# Tech Stack

## Language & Runtime
- **TypeScript** — strict mode, targeting ES2020+
- **Node.js** — runs in the VS Code Extension Host

## Core Frameworks & Libraries
- **VS Code API** (`vscode`) — Comments API, Diagnostics API, SecretStorage, StatusBar, OutputChannel, Commands
- **`@modelcontextprotocol/sdk`** — official MCP client; uses `StreamableHTTPClientTransport`
- **`fast-check`** — property-based testing
- **Vitest** — unit and property-based test runner

## Extension Packaging
- Standard VS Code extension structure with `package.json` as the manifest
- Configuration contributions declared under `codeReview.*` namespace in `package.json`
- Auth token stored via `vscode.ExtensionContext.secrets` (never in `settings.json`)

## Testing Layers
| Layer | Tool | Scope |
|---|---|---|
| Unit tests | Vitest | Pure logic, no VS Code API (mocked) |
| Property-based tests | Vitest + fast-check | Correctness properties, min 100 iterations each |
| Integration tests | Vitest + in-process mock HTTP server | MCP connection lifecycle, file transfer |
| E2E extension tests | VS Code Extension Test Runner | Commands, diagnostics, comment threads in Extension Development Host |

## Common Commands
```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (development)
npm run watch

# Run unit + property-based tests (single run, no watch)
npx vitest run

# Run extension E2E tests
npm run test:extension

# Package the extension
npx vsce package

# Lint
npm run lint
```

## Key Conventions
- All errors are logged to the `"Code Review"` VS Code Output Channel with ISO 8601 timestamps
- Reconnection uses exponential backoff: 1 s → 2 s → 4 s (3 attempts max)
- Parallel file transfers use `Promise.all`
- Property-based test files include a tag comment: `// Feature: vscode-code-review-extension, Property N: <property_text>`
