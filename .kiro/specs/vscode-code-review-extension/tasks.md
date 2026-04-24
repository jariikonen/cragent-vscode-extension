# Implementation Tasks

## Task List

- [x] 1. Project scaffolding
  - [x] 1.1 Create `package.json` with extension manifest: `name`, `displayName`, `publisher`, `engines.vscode`, `activationEvents`, `main`, `contributes.commands` (placeholder entries), `contributes.configuration` schema for all `codeReview.*` settings (serverUrl, requestTimeoutMs, showInformationFindings, sortField, filter.min* fields), and `devDependencies` for TypeScript, Vitest, fast-check, @modelcontextprotocol/sdk, @vscode/test-cli
  - [x] 1.2 Create `tsconfig.json` with `strict: true`, `target: "ES2020"`, `module: "commonjs"`, `outDir: "out"`, `rootDir: "src"`, and `lib: ["ES2020"]`
  - [x] 1.3 Create `src/extension.ts` with stub `activate(context)` and `deactivate()` exports that compile cleanly (no logic yet — just the function signatures and a console.log)
  - [x] 1.4 Verify: `npm install` succeeds, `npm run compile` produces `out/extension.js` with no TypeScript errors

- [x] 2. Core data models and Finding parser
  - [x] 2.1 Create `src/models/Finding.ts` defining the `Finding` interface, `RawFindingResult` interface, `parseFinding(raw: unknown): Finding | null` function (returns `null` and logs a warning when any required field is missing), `mapSeverity(score: number): vscode.DiagnosticSeverity` function (thresholds: ≤0.33 → Information, ≤0.66 → Warning, else Error), and a `clampScore(score: number): number` helper
  - [x] 2.2 Write unit tests in `test/unit/Finding.test.ts` covering: valid full parse, valid parse without optional suggestion, each required field missing individually (8 cases), severity boundary values (0.0, 0.33, 0.34, 0.66, 0.67, 1.0), and score clamping for out-of-range inputs
  - [x] 2.3 Write property-based test in `test/property/Finding.property.test.ts` for **Property 1 — Finding Serialization Round-Trip**: generate arbitrary valid `Finding` objects, serialize with `JSON.stringify`, deserialize with `JSON.parse`, assert all fields are identical. Tag: `// Feature: vscode-code-review-extension, Property 1: Finding Serialization Round-Trip`. Validates: Requirements 3.5
  - [x] 2.4 Write property-based test for **Property 2 — Invalid Finding Rejection**: generate `RawFindingResult` objects with at least one required field set to `undefined`, assert `parseFinding` returns `null`. Tag: `// Feature: vscode-code-review-extension, Property 2: Invalid Finding Rejection`. Validates: Requirements 3.2
  - [x] 2.5 Write property-based test for **Property 10 — Severity Threshold Mapping**: generate `fc.float({ min: 0, max: 1 })` values, assert `mapSeverity` returns the correct `DiagnosticSeverity` per threshold; also generate out-of-range values and assert they are clamped before mapping. Tag: `// Feature: vscode-code-review-extension, Property 10: Severity Threshold Mapping`. Validates: Requirements 3.3, 4.2
  - [x] 2.6 Verify: `npx vitest run test/unit/Finding.test.ts test/property/Finding.property.test.ts` passes all tests

- [x] 3. Configuration management
  - [x] 3.1 Create `src/config/ConfigurationManager.ts` implementing the `ConfigurationManager` interface: `getConfig()` reads all `codeReview.*` workspace settings (including `maxConcurrentTransfers`) and returns a typed `ExtensionConfig` object; `getAuthToken()` reads from `vscode.ExtensionContext.secrets` under key `codeReview.authToken`; `setAuthToken(token)` writes to `SecretStorage`; `onDidChangeConfig(listener)` wraps `vscode.workspace.onDidChangeConfiguration`; `isLocalAddress(url)` returns `true` for hostnames `localhost`, `127.0.0.1`, and `::1`
  - [x] 3.2 Write unit tests in `test/unit/ConfigurationManager.test.ts` covering: `isLocalAddress` returns `true` for all three local hostnames and `false` for a remote hostname, `getConfig` returns correct defaults when no settings are overridden (mock `vscode.workspace.getConfiguration`)
  - [x] 3.3 Write property-based test for **Property 8 — URL Validation Correctness**: generate strings with `fc.oneof(fc.webUrl(), fc.string())`, assert the validator accepts valid WHATWG URLs and rejects all others. Tag: `// Feature: vscode-code-review-extension, Property 8: URL Validation Correctness`. Validates: Requirements 6.2
  - [x] 3.4 Verify: `npx vitest run test/unit/ConfigurationManager.test.ts test/property/` passes; manually confirm `codeReview.*` settings appear in VS Code Settings UI after `npm run compile`
  - [x] 3.5 Commit: `git add src/config/ test/unit/ConfigurationManager.test.ts test/property/ && git commit -m "feat(config): implement ConfigurationManager with settings and auth token management

- Add ConfigurationManager interface implementation for reading codeReview.* settings
- Implement getConfig() to return typed ExtensionConfig object
- Add getAuthToken()/setAuthToken() for SecretStorage integration
- Implement onDidChangeConfig() wrapper for configuration change events
- Add isLocalAddress() helper for localhost detection (localhost, 127.0.0.1, ::1)
- Add unit tests for isLocalAddress and getConfig with mocked VS Code APIs
- Add Property 8 test for URL validation correctness with WHATWG URL standard
- All tests passing"`

- [x] 4. Logging infrastructure
  - [x] 4.1 Create `src/ui/OutputChannelLogger.ts` implementing a logger that wraps `vscode.window.createOutputChannel("Code Review")`; expose `log(level: 'info'|'warn'|'error', message: string, context?: object)` which writes lines prefixed with an ISO 8601 timestamp and level; expose `show()` to reveal the channel; implement `dispose()`
  - [x] 4.2 Write unit tests in `test/unit/OutputChannelLogger.test.ts` covering: log lines include ISO 8601 timestamp prefix, log lines include the level string, `show()` calls the underlying channel's `show()` method (mock the `vscode.OutputChannel`)
  - [x] 4.3 Verify: `npx vitest run test/unit/OutputChannelLogger.test.ts` passes
  - [x] 4.4 Commit: `git add src/ui/ test/unit/OutputChannelLogger.test.ts && git commit -m "feat(logging): implement OutputChannelLogger with ISO 8601 timestamps

- Add OutputChannelLogger wrapping vscode.window.createOutputChannel
- Implement log() method with level-based logging (info/warn/error)
- Add ISO 8601 timestamp prefix to all log entries
- Implement show() to reveal output channel and dispose() for cleanup
- Add unit tests for timestamp formatting, level inclusion, and show() method
- All tests passing"`

- [x] 5. MCP connection layer
  - [x] 5.1 Create `src/connection/MCPClient.ts` as a thin wrapper around `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`; constructor accepts `serverUrl: string` and an optional `authToken: string | undefined`; expose `connect()`, `disconnect()`, `callTool(name, args)`, and `readonly isConnected`; when `authToken` is provided and the URL is not a local address, attach `Authorization: Bearer <token>` header to every request
  - [x] 5.2 Create `src/connection/ConnectionManager.ts` implementing the `ConnectionManager` interface; `connect()` instantiates `MCPClient` using current config and calls `connect()`; on failure, retries up to 3 times with delays of 1 s, 2 s, 4 s (exponential backoff); after all retries exhausted, shows a VS Code error notification; `disconnect()` calls `MCPClient.disconnect()`; `onDidChangeConnection` fires on state changes
  - [x] 5.3 Write unit tests in `test/unit/ConnectionManager.test.ts` covering: successful connect sets `isConnected = true`, failed connect triggers retry sequence with correct delay values (mock timers), all 3 retries exhausted shows error notification, `disconnect()` sets `isConnected = false`
  - [x] 5.4 Write property-based test for **Property 9 — Remote Address Authentication**: generate non-local hostnames (using `fc.domain()` filtered to exclude `localhost`, `127.0.0.1`, `::1`) and random token strings, assert the `Authorization: Bearer <token>` header is present; generate local hostnames and assert no `Authorization` header is added. Tag: `// Feature: vscode-code-review-extension, Property 9: Remote Address Authentication`. Validates: Requirements 1.3, 1.4
  - [x] 5.5 Verify: `npx vitest run test/unit/ConnectionManager.test.ts test/property/` passes
  - [x] 5.6 Commit: `git add src/connection/ test/unit/ConnectionManager.test.ts test/property/ && git commit -m "feat(connection): implement MCP connection layer with retry logic

- Add MCPClient wrapper around @modelcontextprotocol/sdk with StreamableHTTPClientTransport
- Implement connect(), disconnect(), callTool() methods and isConnected property
- Add conditional Authorization Bearer token header for remote addresses
- Implement ConnectionManager with exponential backoff retry (1s, 2s, 4s delays)
- Add onDidChangeConnection event emitter for connection state changes
- Add unit tests for connection lifecycle and retry sequence with mocked timers
- Add Property 9 test for remote address authentication header logic
- All tests passing"`

- [x] 6. File transfer service
  - [x] 6.1 Create `src/review/FileTransferService.ts` implementing `FileTransferService`; `queryIndexTimestamp()` calls the MCP tool to retrieve the index timestamp and returns `{ timestamp: string | null }`; `buildAndTransfer(uris, sinceTimestamp, concurrency?)` implements a fused stat → filter → read → transfer pipeline with a bounded concurrency pool — a fixed number of worker coroutines (controlled by the `concurrency` parameter, default `DEFAULT_MAX_CONCURRENT_TRANSFERS = 5`) pull URIs from a shared index, stat each file, check the timestamp filter, read content only for files that pass, transfer immediately, and move on; returns the number of files actually transferred; individual file failures are logged and skipped without aborting the batch
  - [x] 6.2 Write unit tests in `test/unit/FileTransferService.test.ts` covering: `buildAndTransfer` with `sinceTimestamp = null` includes all files, with a timestamp includes only newer files, with a timestamp equal to a file's `lastModified` excludes that file (strictly after), empty URI list returns empty array, concurrency limit is respected (max concurrent transfers ≤ configured value), individual file failures do not abort the batch
  - [x] 6.3 Write property-based test for **Property 3 — Incremental Sync Correctness**: generate a list of file descriptors with random ISO timestamps and a random `sinceTimestamp` (or `null`), call `buildAndTransfer` and assert the number of transferred files equals exactly the subset with `lastModified > sinceTimestamp` when non-null, or all files when null; verify no file with `lastModified <= sinceTimestamp` appears in the transfer calls. Tag: `// Feature: vscode-code-review-extension, Property 3: Incremental Sync Correctness`. Validates: Requirements 2.5
  - [x] 6.4 Verify: `npx vitest run test/unit/FileTransferService.test.ts test/property/` passes
  - [x] 6.5 Commit: `git add src/review/FileTransferService.ts test/unit/FileTransferService.test.ts test/property/ && git commit -m "feat(review): implement FileTransferService with bounded concurrency pool

- Add FileTransferService for workspace file enumeration and transfer
- Implement queryIndexTimestamp() to retrieve server-side index timestamp
- Implement buildAndTransfer() with fused stat/filter/read/transfer pipeline
- Use bounded concurrency pool (default 5 workers) instead of unbounded Promise.all
- Add configurable concurrency via codeReview.maxConcurrentTransfers setting (1–50)
- Individual file failures are logged and skipped without aborting the batch
- Add unit tests for timestamp filtering, concurrency limits, and error resilience
- Add Property 3 test for incremental sync correctness with random timestamps
- All tests passing"`

- [x] 7. Review session management
  - [x] 7.1 Create `src/review/ReviewSessionManager.ts` implementing `ReviewSessionManager`; `startSession(scope)` creates a `ReviewSession` with a unique `id` and `CancellationTokenSource`; if a session already exists for the same URI, cancels it before starting the new one; calls `FileTransferService.buildAndTransfer` to send files (passing the configured `maxConcurrentTransfers` as the concurrency limit) and then calls the MCP review tool; shows a VS Code progress notification while the session runs; on completion calls `FindingDisplayManager.applyFindings`; on cancellation or error, logs to `OutputChannelLogger` and shows appropriate notification
  - [x] 7.2 Write unit tests in `test/unit/ReviewSessionManager.test.ts` covering: starting a session for a URI that has no active session creates a new session, starting a session for a URI with an existing active session cancels the old session first, `cancelSession(uri)` cancels the session for that URI, `cancelSession()` with no argument cancels all active sessions
  - [x] 7.3 Verify: `npx vitest run test/unit/ReviewSessionManager.test.ts` passes
  - [x] 7.4 Commit: `git add src/review/ReviewSessionManager.ts test/unit/ReviewSessionManager.test.ts && git commit -m "feat(review): implement ReviewSessionManager with session orchestration

- Add ReviewSessionManager for review session lifecycle management
- Implement startSession() with unique session IDs and CancellationTokenSource
- Add single-session-per-file enforcement (cancel existing before starting new)
- Integrate FileTransferService for file transfers and MCP review tool invocation
- Add VS Code progress notification during active sessions
- Implement cancelSession() for single URI and all sessions
- Add error handling with OutputChannelLogger integration
- Add unit tests for session creation, cancellation, and replacement logic
- All tests passing"`

- [x] 8. Finding display — diagnostics
  - [x] 8.1 Create `src/display/DiagnosticCollection.ts` wrapping `vscode.languages.createDiagnosticCollection("codeReview")`; expose `setFindings(uri, findings)` which converts each `Finding` to a `vscode.Diagnostic` (using `mapSeverity` for severity, 0-indexed line range, message as diagnostic message); expose `clearUri(uri)` and `clearAll()`; implement `dispose()`
  - [x] 8.2 Write unit tests in `test/unit/DiagnosticCollection.test.ts` covering: `setFindings` produces one diagnostic per finding, each diagnostic has the correct range and severity, `clearUri` removes only that URI's diagnostics, `clearAll` removes all diagnostics (mock `vscode.languages.createDiagnosticCollection`)
  - [x] 8.3 Verify: `npx vitest run test/unit/DiagnosticCollection.test.ts` passes
  - [x] 8.4 Commit: `git add src/display/DiagnosticCollection.ts test/unit/DiagnosticCollection.test.ts && git commit -m "feat(display): implement DiagnosticCollection for Problems panel integration

- Add DiagnosticCollection wrapping vscode.languages.createDiagnosticCollection
- Implement setFindings() to convert Finding objects to vscode.Diagnostic entries
- Use mapSeverity() for severity threshold mapping (Information/Warning/Error)
- Add clearUri() for single-file clearing and clearAll() for workspace clearing
- Implement dispose() for cleanup
- Add unit tests for diagnostic creation, range/severity mapping, and clearing operations
- All tests passing"`

- [x] 9. Finding display — inline comments
  - [x] 9.1 Create `src/display/CommentController.ts` wrapping `vscode.comments.createCommentController("codeReview", "Code Review")`; expose `setFindings(uri, findings)` which creates one `vscode.CommentThread` per finding at the correct range; each thread has `contextValue = "codeReviewFinding"`, a first comment with `body = finding.message` and `label = "P: X.XX | S: X.XX | C: X.XX | I: X.XX"`, and an optional second reply comment with `body = finding.suggestion` when present; expose `clearUri(uri)`, `clearAll()`, `dismissThread(thread)`; implement `dispose()`
  - [x] 9.2 Write unit tests in `test/unit/CommentController.test.ts` covering: `setFindings` creates one thread per finding, thread range matches finding line numbers, first comment body equals `finding.message`, label matches the score format pattern, suggestion reply is present when `finding.suggestion` is defined and absent when it is not, `dismissThread` disposes the thread (mock `vscode.comments`)
  - [x] 9.3 Write property-based test for **Property 7 — Comment Content Fidelity**: generate arbitrary `Finding` objects with optional `suggestion` fields, apply to `CommentController`, assert first comment body equals `finding.message`, label matches `"P: X.XX | S: X.XX | C: X.XX | I: X.XX"` with correct values, suggestion reply present iff `finding.suggestion` is defined. Tag: `// Feature: vscode-code-review-extension, Property 7: Comment Content Fidelity`. Validates: Requirements 5.2, 5.3
  - [x] 9.4 Verify: `npx vitest run test/unit/CommentController.test.ts test/property/` passes
  - [x] 9.5 Commit: `git add src/display/CommentController.ts test/unit/CommentController.test.ts test/property/ && git commit -m "feat(display): implement CommentController for inline comment threads

- Add CommentController wrapping vscode.comments.createCommentController
- Implement setFindings() to create CommentThread per finding with correct range
- Add contextValue 'codeReviewFinding' for context menu integration
- Format comment label as 'P: X.XX | S: X.XX | C: X.XX | I: X.XX' with 2 decimal places
- Add optional suggestion reply comment when finding.suggestion is present
- Implement clearUri(), clearAll(), and dismissThread() methods
- Add unit tests for thread creation, range mapping, label formatting, and suggestion handling
- Add Property 7 test for comment content fidelity with optional suggestions
- All tests passing"`

- [x] 10. FindingDisplayManager coordination
  - [x] 10.1 Create `src/display/FindingDisplayManager.ts` implementing `FindingDisplayManager`; constructor accepts `CommentController` and `DiagnosticCollection` instances; `applyFindings(uri, findings)` applies current sort/filter options then calls both `setFindings` on each delegate; `clearFindings(uri)` delegates to both; `clearAllFindings()` delegates to both; `dismissThread(thread)` delegates to `CommentController`; `updateSortFilter(options)` stores the new options and re-applies them to all currently held findings across all URIs
  - [x] 10.2 Write unit tests in `test/unit/FindingDisplayManager.test.ts` covering: `applyFindings` calls both delegates with the filtered/sorted list, `clearFindings` calls both delegates, `updateSortFilter` re-applies to all URIs without a new session, sort descending by each of the four fields, filter excludes findings below each threshold
  - [x] 10.3 Write property-based test for **Property 4 — Information Finding Filter**: generate lists of `Finding` objects with random `severity` scores, assert that when `showInformationFindings = false` the filtered list contains no findings with `severity <= 0.33` and all findings with `severity > 0.33` are preserved. Tag: `// Feature: vscode-code-review-extension, Property 4: Information Finding Filter`. Validates: Requirements 6.5
  - [x] 10.4 Write property-based test for **Property 5 — Diagnostic–Comment Consistency**: generate a list of `Finding` objects and a `showInformationFindings` flag, apply findings, assert the set of file URIs with diagnostics equals the set with comment threads and each has exactly one entry per finding. Tag: `// Feature: vscode-code-review-extension, Property 5: Diagnostic–Comment Consistency`. Validates: Requirements 4.1, 4.2, 5.1
  - [x] 10.5 Write property-based test for **Property 6 — Session Replacement Idempotence**: generate two sequential lists of `Finding` objects for the same URI, apply the first then the second, assert the final state equals the state produced by applying only the second list. Tag: `// Feature: vscode-code-review-extension, Property 6: Session Replacement Idempotence`. Validates: Requirements 4.3, 5.4
  - [x] 10.6 Write property-based test for **Property 11 — Sort Order Correctness**: generate a list of `Finding` objects with random scores and a random sort field, apply `updateSortFilter`, assert the resulting display order is non-increasing on the chosen score field. Tag: `// Feature: vscode-code-review-extension, Property 11: Sort Order Correctness`. Validates: Requirements 8.1
  - [x] 10.7 Write property-based test for **Property 12 — Filter Threshold Correctness**: generate a list of `Finding` objects with random scores and random minimum thresholds, apply `updateSortFilter`, assert displayed findings are exactly those where all four scores meet or exceed their thresholds. Tag: `// Feature: vscode-code-review-extension, Property 12: Filter Threshold Correctness`. Validates: Requirements 8.2
  - [x] 10.8 Verify: `npx vitest run test/unit/FindingDisplayManager.test.ts test/property/` passes all tests
  - [x] 10.9 Commit: `git add src/display/FindingDisplayManager.ts test/unit/FindingDisplayManager.test.ts test/property/ && git commit -m "feat(display): implement FindingDisplayManager with sort/filter coordination

- Add FindingDisplayManager coordinating CommentController and DiagnosticCollection
- Implement applyFindings() with sort/filter logic applied to both display surfaces
- Add clearFindings() and clearAllFindings() delegating to both controllers
- Implement updateSortFilter() to re-apply options to all URIs without new session
- Add dismissThread() delegating to CommentController
- Add unit tests for delegation, sort/filter application, and multi-URI coordination
- Add Property 4 test for information finding filter (severity <= 0.33)
- Add Property 5 test for diagnostic-comment consistency across both surfaces
- Add Property 6 test for session replacement idempotence
- Add Property 11 test for sort order correctness (descending by chosen field)
- Add Property 12 test for filter threshold correctness (all scores meet thresholds)
- All tests passing"`

- [ ] 11. Status bar
  - [ ] 11.1 Create `src/ui/StatusBarManager.ts` implementing `StatusBarManager`; constructor creates a `vscode.StatusBarItem` with `alignment = Left`; `setConnected(serverUrl)` sets text to `"$(check) Code Review: Connected"` and tooltip to the server URL; `setDisconnected()` sets text to `"$(x) Code Review: Disconnected"`; `setReviewing()` sets text to `"$(sync~spin) Code Review: Reviewing…"`; `dispose()` disposes the status bar item; the item is always visible (call `show()` in constructor)
  - [ ] 11.2 Write unit tests in `test/unit/StatusBarManager.test.ts` covering: `setConnected` sets the correct text and tooltip, `setDisconnected` sets the correct text, `setReviewing` sets the correct text, `dispose` disposes the underlying item (mock `vscode.window.createStatusBarItem`)
  - [ ] 11.3 Verify: `npx vitest run test/unit/StatusBarManager.test.ts` passes
  - [ ] 11.4 Commit: `git add src/ui/StatusBarManager.ts test/unit/StatusBarManager.test.ts && git commit -m "feat(ui): implement StatusBarManager for connection status display

- Add StatusBarManager wrapping vscode.StatusBarItem with left alignment
- Implement setConnected() with check icon and server URL tooltip
- Implement setDisconnected() with x icon
- Implement setReviewing() with spinning sync icon
- Add dispose() for cleanup and show() in constructor for visibility
- Add unit tests for text/tooltip updates and disposal
- All tests passing"`

- [ ] 12. VS Code commands wiring
  - [ ] 12.1 Flesh out `src/extension.ts` `activate(context)`: instantiate all services (`OutputChannelLogger`, `ConfigurationManager`, `MCPClient`, `ConnectionManager`, `FileTransferService`, `ReviewSessionManager`, `DiagnosticCollection`, `CommentController`, `FindingDisplayManager`, `StatusBarManager`); wire `ConnectionManager.onDidChangeConnection` to `StatusBarManager`; register all commands listed below; push all disposables to `context.subscriptions`; call `ConnectionManager.connect()` and show a one-time auth warning if the URL is remote and no token is set; pass `ConfigurationManager.getConfig().maxConcurrentTransfers` to `ReviewSessionManager` for use with `FileTransferService.buildAndTransfer`
  - [ ] 12.2 Register the following commands in `package.json` `contributes.commands` and in `extension.ts`:
    - `codeReview.reviewFile` — "Code Review: Review Current File" → `ReviewSessionManager.startSession({ kind: 'file', uri })`
    - `codeReview.reviewSelection` — "Code Review: Review Selection" → `ReviewSessionManager.startSession({ kind: 'selection', uri, range })`
    - `codeReview.reviewWorkspace` — "Code Review: Review Workspace" → `ReviewSessionManager.startSession({ kind: 'workspace' })`
    - `codeReview.clearFindings` — "Code Review: Clear All Findings" → `FindingDisplayManager.clearAllFindings()`
    - `codeReview.dismissThread` — "Code Review: Dismiss" (context menu on `codeReviewFinding`) → `FindingDisplayManager.dismissThread(thread)`
    - `codeReview.setAuthToken` — "Code Review: Set Authentication Token" → `ConfigurationManager.setAuthToken(token)` (prompt via `vscode.window.showInputBox`)
    - `codeReview.openOutputChannel` — "Code Review: Open Output Channel" → `OutputChannelLogger.show()`
  - [ ] 12.3 Verify: `npm run compile` succeeds with no errors; open the Extension Development Host (`F5`) and confirm all 7 commands appear in the Command Palette under "Code Review"
  - [ ] 12.4 Commit: `git add src/extension.ts package.json && git commit -m "feat(extension): wire all services and commands in activate()

- Instantiate all services in activate() with proper dependency injection
- Wire ConnectionManager.onDidChangeConnection to StatusBarManager for status updates
- Register 7 commands: reviewFile, reviewSelection, reviewWorkspace, clearFindings, dismissThread, setAuthToken, openOutputChannel
- Add command contributions to package.json with proper titles and context menus
- Push all disposables to context.subscriptions for cleanup
- Add initial connection attempt and remote auth token warning
- Verify all commands appear in Command Palette"`

- [ ] 13. Integration tests
  - [ ] 13.1 Create `test/integration/connection.test.ts`: start an in-process mock HTTP MCP server in `beforeAll`; test full connection lifecycle (connect → call tool → disconnect); verify `ConnectionManager.isConnected` transitions correctly
  - [ ] 13.2 Create `test/integration/fileTransfer.test.ts`: test workspace review with a non-null index timestamp — verify only files with `lastModified` after the timestamp are sent to the mock server; test with `null` timestamp — verify all files are sent
  - [ ] 13.3 Create `test/integration/parallelTransfer.test.ts`: mock server tracks concurrent request count; send multiple files via `buildAndTransfer` with a specific concurrency limit; assert all transfers complete, the mock server received all payloads, and the maximum concurrent requests never exceeded the configured concurrency limit
  - [ ] 13.4 Create `test/integration/reconnection.test.ts`: simulate server drop by stopping the mock server mid-session; verify `ConnectionManager` attempts reconnect up to 3 times with the correct backoff delays (1 s, 2 s, 4 s) before emitting a failure
  - [ ] 13.5 Verify: `npx vitest run test/integration/` passes all integration tests
  - [ ] 13.6 Commit: `git add test/integration/ && git commit -m "test(integration): add integration tests for MCP connection and file transfer

- Add connection.test.ts for full connection lifecycle with mock HTTP MCP server
- Add fileTransfer.test.ts for incremental sync with null and non-null timestamps
- Add parallelTransfer.test.ts to verify Promise.all concurrency with receipt timestamps
- Add reconnection.test.ts for exponential backoff retry logic (1s, 2s, 4s delays)
- All integration tests passing"`

- [ ]* 14. E2E extension tests
  - [ ]* 14.1 Create `test/extension/commands.test.ts`: open the Extension Development Host; verify all 7 "Code Review" commands are registered and appear in the Command Palette
  - [ ]* 14.2 Create `test/extension/diagnostics.test.ts`: trigger a mock review session via `vscode.commands.executeCommand('codeReview.reviewFile')`; assert `vscode.languages.getDiagnostics(uri)` is populated with the expected findings
  - [ ]* 14.3 Create `test/extension/comments.test.ts`: after a mock review session, assert `vscode.comments` has comment threads at the correct file URIs and line ranges
  - [ ]* 14.4 Create `test/extension/clear.test.ts`: after populating findings, invoke `codeReview.clearFindings`; assert both diagnostics and comment threads are empty
  - [ ]* 14.5 Create `test/extension/statusBar.test.ts`: assert the status bar item text changes to the connected state after activation and to the reviewing state during an active session
  - [ ]* 14.6 Verify: `npm run test:extension` passes all E2E tests inside the Extension Development Host
  - [ ]* 14.7 Commit: `git add test/extension/ && git commit -m "test(e2e): add end-to-end extension tests in Development Host

- Add commands.test.ts to verify all 7 commands are registered in Command Palette
- Add diagnostics.test.ts to verify DiagnosticCollection population after review
- Add comments.test.ts to verify CommentThread creation at correct URIs and ranges
- Add clear.test.ts to verify clearFindings removes both diagnostics and threads
- Add statusBar.test.ts to verify status bar text changes during connection and review
- All E2E tests passing in Extension Development Host"`
