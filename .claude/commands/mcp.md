---
description: Scaffold a new MCP server with one example tool and a capability contract
argument-hint: <server-name>
---

Task: scaffold a new MCP server — `$ARGUMENTS`.

1. Read `docs/adr/0003-mcp-as-tool-protocol.md` before designing tools.
2. Create `packages/mcp-servers/$ARGUMENTS/` with:
   - `package.json` — workspace package. Strict deps. No vendor SDK in devDependencies that belong in the integration package.
   - `src/index.ts` — MCP server entry.
   - `src/tools/<tool-name>.ts` — one file per tool. Zod-validated inputs.
   - `README.md` — capability contract: inputs, outputs, failure modes, idempotency key shape.
3. If this server wraps a vendor API, put the SDK adapter under `packages/integrations/<vendor>/`. Integrations are SDK adapters only — no business logic, no agent-visible policy.
4. Every mutating tool takes an explicit idempotency key and is safe to retry.
5. Tests: each tool gets a happy-path and an error-path test against a mocked vendor API.

Present the tool contracts first. Wait for approval before implementing bodies.
