# Product Overview

This is a **VS Code extension** that integrates an AI-powered code review agent into the editor via the Model Context Protocol (MCP).

## What It Does

- Connects to an external MCP server hosting a code review agent
- Lets developers submit code for automated review directly from VS Code (single file, selection, or entire workspace)
- Surfaces review findings as:
  - **Inline comment threads** (VS Code Comments API)
  - **Editor diagnostics** (VS Code Diagnostics API / Problems panel)

## Key Concepts

- **Finding**: A single review result with `filePath`, `startLine`, `endLine`, `message`, and four numeric scores (`severity`, `confidence`, `importance`, `priority`) each in [0.0, 1.0]
- **Severity mapping**: `0.0–0.33` → Information, `0.34–0.66` → Warning, `0.67–1.0` → Error
- **Incremental workspace review**: Uses a server-side index timestamp to avoid re-sending unchanged files
- **Auth**: Local MCP servers (localhost / 127.0.0.1 / ::1) need no token; remote servers require a Bearer token stored in VS Code `SecretStorage`

## Target Users

Developers who want AI code review feedback without leaving their editor.
