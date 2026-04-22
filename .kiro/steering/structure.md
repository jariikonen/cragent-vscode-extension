# Project Structure

## Root Layout
```
vscode-code-review-extension/
├── src/                        # All TypeScript source
│   ├── extension.ts            # activate / deactivate entry point; wires all services
│   ├── config/
│   │   └── ConfigurationManager.ts
│   ├── connection/
│   │   ├── ConnectionManager.ts
│   │   └── MCPClient.ts        # Thin wrapper around @modelcontextprotocol/sdk
│   ├── review/
│   │   ├── ReviewSessionManager.ts
│   │   └── FileTransferService.ts
│   ├── display/
│   │   ├── FindingDisplayManager.ts
│   │   ├── CommentController.ts
│   │   └── DiagnosticCollection.ts
│   ├── ui/
│   │   ├── StatusBarManager.ts
│   │   └── OutputChannelLogger.ts
│   └── models/
│       └── Finding.ts          # Finding interface + RawFindingResult + parser
├── test/
│   ├── unit/                   # Vitest unit tests (no VS Code API)
│   ├── property/               # Vitest + fast-check property-based tests
│   ├── integration/            # Vitest + mock HTTP server
│   └── extension/              # VS Code Extension Test Runner (E2E)
├── package.json                # Extension manifest + codeReview.* config contributions
├── tsconfig.json
└── .kiro/
    ├── specs/
    │   └── vscode-code-review-extension/
    │       ├── requirements.md
    │       ├── design.md
    │       └── tasks.md
    └── steering/
```

## Architectural Layers

```
extension.ts (entry point)
    │
    ├── ConfigurationManager   — reads settings, manages SecretStorage auth token
    ├── ConnectionManager      — MCP client lifecycle, reconnect backoff
    ├── ReviewSessionManager   — session orchestration, cancellation, progress UI
    │       └── FileTransferService  — file enumeration, timestamp filtering, parallel transfer
    ├── FindingDisplayManager  — sort/filter logic, coordinates both display surfaces
    │       ├── CommentController   — vscode.comments (inline threads)
    │       └── DiagnosticCollection — vscode.languages.diagnostics (Problems panel)
    ├── StatusBarManager       — connection/review status bar item
    └── OutputChannelLogger    — structured logging to "Code Review" output channel
```

## Key Conventions

- **One class per file**; file name matches the exported class name
- **`src/models/Finding.ts`** is the single source of truth for the `Finding` interface, `RawFindingResult`, the parser, and the severity-mapping function
- **No VS Code API imports in unit-tested files** — inject `vscode` dependencies via constructor so they can be mocked in Vitest
- **Commands** are registered in `extension.ts` and delegate immediately to the appropriate service method
- **Configuration namespace**: all settings live under `codeReview.*` in `package.json` contributions
- **Auth token key**: `codeReview.authToken` in `vscode.ExtensionContext.secrets`
- **Output channel name**: `"Code Review"` (used consistently for logging and the open-channel command)
- **`CommentThread.contextValue`**: always `"codeReviewFinding"` to enable context-menu commands
