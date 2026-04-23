# Requirements Document

## Introduction

This feature is a VS Code extension that integrates a code review agent via the Model Context Protocol (MCP). The extension allows developers to submit code for automated review directly from the editor, then surfaces the agent's findings as inline comments (via VS Code's Comments API) and editor diagnostics (via VS Code's Diagnostics API). The goal is to bring AI-powered code review into the normal development workflow without leaving the editor.

## Glossary

- **Extension**: The VS Code extension being built by this spec.
- **MCP_Client**: The component within the Extension that communicates with the MCP Server using the Model Context Protocol.
- **MCP_Server**: The external server that hosts the code review agent and exposes it via the Model Context Protocol.
- **Review_Agent**: The AI code review agent accessible through the MCP_Server.
- **Finding**: A single code review result produced by the Review_Agent, containing numeric scores, a message, and a location (file, line range).
- **Comment_Controller**: The VS Code Comments API controller managed by the Extension to display Findings as inline review threads.
- **Diagnostic_Collection**: The VS Code DiagnosticCollection managed by the Extension to display Findings as editor diagnostics.
- **Review_Session**: A single invocation of the review workflow, from submission to display of all Findings.
- **Severity**: A numeric score (0.0–1.0) indicating how serious a Finding is. Mapped to VS Code DiagnosticSeverity using thresholds: 0.0–0.33 → Information, 0.34–0.66 → Warning, 0.67–1.0 → Error.
- **Confidence**: A numeric score (0.0–1.0) indicating how certain the Review_Agent is that a Finding is correct.
- **Importance**: A numeric score (0.0–1.0) indicating how significant the Finding is to code quality.
- **Priority**: A combined numeric score (0.0–1.0) derived from Confidence, Severity, and Importance; used as the default sort order for Findings.
- **Configuration**: The Extension's VS Code settings, including MCP server connection details and display preferences.
- **Context_Engine**: An optional component within the MCP_Server that maintains an indexed copy of previously reviewed source files and tracks when each file was last indexed.
- **Index_Timestamp**: A nullable field in the JSON response object returned by the MCP_Server in response to an index-timestamp query. When the Context_Engine has indexed files, the field contains an ISO 8601 datetime string representing when the most recent file was indexed. When the MCP_Server has no Context_Engine or no indexed files, the field is `null`.

---

## Requirements

### Requirement 1: MCP Server Connection

**User Story:** As a developer, I want the extension to connect to the MCP server hosting the code review agent, so that I can use the agent's capabilities from within VS Code.

#### Acceptance Criteria

1. THE Extension SHALL read the MCP server URL from the Configuration.
2. WHEN the Extension activates, THE MCP_Client SHALL establish a connection to the MCP_Server using Streamable HTTP transport and the URL specified in the Configuration.
3. WHEN the configured MCP server URL resolves to a local address (hostname is `localhost`, `127.0.0.1`, or `::1`), THE MCP_Client SHALL send requests without an authentication token.
4. WHEN the configured MCP server URL resolves to a non-local (remote) address, THE MCP_Client SHALL include the configured authentication token as a Bearer token in the Authorization header of each request.
5. IF the MCP_Server is unreachable at activation time, THEN THE Extension SHALL display a notification indicating the connection failed and the reason.
6. WHEN the Configuration changes, THE MCP_Client SHALL close the existing connection and re-establish a new connection using the updated Configuration values.
7. WHILE the MCP_Client is connected, THE Extension SHALL display a status bar item indicating the connection is active.
8. IF the connection to the MCP_Server is lost after activation, THEN THE MCP_Client SHALL attempt to reconnect up to 3 times with exponential backoff before reporting a connection failure to the user.

---

### Requirement 2: Code Submission for Review

**User Story:** As a developer, I want to submit code for review from the editor, so that I can get feedback on the code I am working on.

#### Acceptance Criteria

1. THE Extension SHALL provide a command, accessible from the Command Palette, to trigger a Review_Session for the currently active file.
2. THE Extension SHALL provide a command, accessible from the Command Palette, to trigger a Review_Session for all files in the current workspace.
3. WHEN a Review_Session is triggered for a file, THE MCP_Client SHALL send the file's full content and its language identifier to the Review_Agent via the MCP_Server.
4. WHEN a Review_Session is triggered for the workspace, THE MCP_Client SHALL send an Index_Timestamp query to the MCP_Server and parse the `timestamp` field from the JSON response object before transferring any file content.
5. WHEN the `timestamp` field in the Index_Timestamp response is a non-null ISO 8601 datetime string, THE MCP_Client SHALL send only the files whose last-modified time is after that timestamp to the Review_Agent; WHEN the `timestamp` field is `null`, THE MCP_Client SHALL send all workspace files to the Review_Agent.
6. WHEN transferring files to the MCP_Server for a workspace Review_Session, THE MCP_Client SHALL send file transfers using a bounded concurrency pool, where the maximum number of concurrent in-flight transfers is controlled by the `codeReview.maxConcurrentTransfers` Configuration setting (default: 5, minimum: 1, maximum: 50).
7. WHILE a Review_Session is in progress, THE Extension SHALL display a progress notification indicating the review is running.
8. IF a Review_Session is triggered while another Review_Session is already in progress for the same file, THEN THE Extension SHALL cancel the in-progress session and start the new one.
9. WHERE a file selection is active in the editor, THE Extension SHALL provide a command to trigger a Review_Session for only the selected lines.

---

### Requirement 3: Receiving and Parsing Review Findings

**User Story:** As a developer, I want the extension to receive and interpret the agent's findings, so that the results can be displayed accurately in the editor.

#### Acceptance Criteria

1. WHEN the Review_Agent returns results, THE MCP_Client SHALL parse each result into a Finding containing: filePath, startLine, endLine, message, confidence, severity, importance, priority, and an optional suggestion.
2. IF the Review_Agent returns a result that is missing a required field (filePath, startLine, endLine, message, confidence, severity, importance, or priority), THEN THE MCP_Client SHALL log a warning and skip that result.
3. THE MCP_Client SHALL map the Finding's severity score to VS Code DiagnosticSeverity using the following thresholds: 0.0–0.33 → Information, 0.34–0.66 → Warning, 0.67–1.0 → Error.
4. IF the Review_Agent returns an error response instead of findings, THEN THE Extension SHALL display the error message to the user and terminate the Review_Session.
5. FOR ALL valid Finding objects parsed from a Review_Agent response, serializing and deserializing the Finding SHALL produce an equivalent Finding object (round-trip property).

---

### Requirement 4: Displaying Findings as Diagnostics

**User Story:** As a developer, I want review findings to appear as editor diagnostics, so that I can see issues highlighted inline alongside other linting and compiler errors.

#### Acceptance Criteria

1. WHEN a Review_Session completes, THE Diagnostic_Collection SHALL be updated to contain all Findings for the reviewed file(s).
2. THE Diagnostic_Collection SHALL associate each Finding with the correct file URI and line range, and SHALL derive the VS Code DiagnosticSeverity from the Finding's severity score using the threshold mapping defined in Requirement 3.3.
3. WHEN a new Review_Session completes for a file, THE Diagnostic_Collection SHALL replace the previous Findings for that file with the new Findings.
4. THE Diagnostic_Collection SHALL retain all Findings until one of the following occurs: (a) the user explicitly invokes the clear command, or (b) the Extension is deactivated (VS Code session ends); closing a file SHALL NOT remove its Findings from the Diagnostic_Collection.
5. THE Extension SHALL provide a command to clear all Findings from the Diagnostic_Collection for the entire workspace.

---

### Requirement 5: Displaying Findings as Inline Comments

**User Story:** As a developer, I want review findings to appear as inline comment threads in the editor, so that I can read detailed feedback in context.

#### Acceptance Criteria

1. WHEN a Review_Session completes, THE Comment_Controller SHALL create a comment thread for each Finding at the corresponding file and line range.
2. THE Comment_Controller SHALL display the Finding's message as the comment body and all four scores as a label on the thread, starting with priority, in the format `"P: <priority> | S: <severity> | C: <confidence> | I: <importance>"` with each score formatted to 2 decimal places (e.g. `"P: 0.85 | S: 0.72 | C: 0.90 | I: 0.80"`).
3. WHERE a Finding includes a suggestion, THE Comment_Controller SHALL display the suggestion as a separate reply within the same comment thread.
4. WHEN a new Review_Session completes for a file, THE Comment_Controller SHALL remove all existing comment threads for that file and create new threads for the updated Findings.
5. THE Extension SHALL provide a command to dismiss all comment threads created by the Comment_Controller for the entire workspace.
6. WHEN a user dismisses an individual comment thread, THE Comment_Controller SHALL remove that thread and mark the corresponding Finding as dismissed for the duration of the Review_Session.

---

### Requirement 6: Configuration

**User Story:** As a developer, I want to configure the extension's connection and behavior, so that I can adapt it to my environment and preferences.

#### Acceptance Criteria

1. THE Extension SHALL expose the following Configuration settings in VS Code's settings UI: MCP server URL, authentication token (optional; stored in VS Code's SecretStorage), request timeout in milliseconds, maximum concurrent file transfers (integer, default: 5, minimum: 1, maximum: 50), whether to show information-severity findings, default sort field (one of: confidence, severity, importance, priority; default: priority), and minimum threshold values (0.0–1.0) for each of the four scores (confidence, severity, importance, priority).
2. THE Extension SHALL validate the MCP server URL on save and display an error in the settings UI if the value is not a valid URL.
3. WHEN the configured MCP server URL resolves to a remote (non-local) address and the authentication token is not set, THEN THE Extension SHALL display a one-time notification prompting the user to configure the authentication token.
4. WHEN the request timeout Configuration value is changed, THE MCP_Client SHALL apply the new timeout to all subsequent Review_Sessions without requiring an extension restart.
5. WHERE the show-information-severity setting is disabled, THE Extension SHALL omit information-severity Findings from both the Diagnostic_Collection and the Comment_Controller.

---

### Requirement 8: Sorting and Filtering Findings

**User Story:** As a developer, I want to sort and filter review findings by their numeric scores, so that I can focus on the most relevant issues first.

#### Acceptance Criteria

1. THE Extension SHALL allow the user to sort Findings by any of the four scores (confidence, severity, importance, priority), with priority as the default sort order; Findings with higher scores SHALL appear first.
2. THE Extension SHALL allow the user to set a minimum threshold (0.0–1.0) for any score, and SHALL exclude Findings whose score for that field is below the configured threshold.
3. WHEN sort field or filter thresholds are changed, THE Extension SHALL apply the updated sort and filter to both the Diagnostic_Collection display and the Comment_Controller threads without requiring a new Review_Session.
4. THE current sort field and per-score minimum thresholds SHALL be persisted in the Configuration settings so that they are restored across editor sessions.

---

### Requirement 7: Error Handling and Resilience

**User Story:** As a developer, I want the extension to handle errors gracefully, so that failures in the review agent do not disrupt my development workflow.

#### Acceptance Criteria

1. IF a Review_Session request to the MCP_Server exceeds the configured timeout, THEN THE Extension SHALL cancel the request, display a timeout notification to the user, and leave any previously displayed Findings unchanged.
2. IF the MCP_Server returns an HTTP error status, THEN THE Extension SHALL display the status code and a human-readable description to the user.
3. WHEN an unhandled exception occurs within the Extension, THE Extension SHALL log the exception details to the VS Code Output Channel named "Code Review" and display a generic error notification to the user.
4. THE Extension SHALL provide a command to open the "Code Review" Output Channel for diagnostic purposes.
