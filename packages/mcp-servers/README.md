# @bluecairn/mcp-servers

BlueCairn's MCP (Model Context Protocol, ADR-0003) tool servers. Each
subdirectory under `src/` hosts one capability domain. M1 ships **Comms**;
M2+ adds Documents, Memory, POS, Accounting, Reviews (see `docs/ROADMAP.md`).

## Comms MCP

Abstraction over the outbound side of the tenant's primary channel. In M1
the only channel kind is Telegram (ADR-0009); the wrapper is designed so
adding WhatsApp / SMS / Voice later means adding a new kind in
`send_message`, not a new tool.

### Tools

| Name              | Status | Purpose                                                       |
| ----------------- | ------ | ------------------------------------------------------------- |
| `send_message`    | M1     | Send a text (optionally with inline keyboard) to a thread.    |
| `send_email`      | M2+    | Send an email via Gmail. Deferred per ROADMAP.                |
| `schedule_call`   | M5+    | Schedule a Vapi voice call.                                   |

### `send_message` contract

Input (UUIDs as strings, `idempotency_key` is a free-form string chosen by
the caller — typically `${agent_run_id}:${action_id}`):

```ts
{
  tenant_id: string,        // uuid
  thread_id: string,        // uuid, MUST belong to tenant
  text: string,
  reply_markup?: {
    inline_keyboard: [[{ text, callback_data?, url? }]]
  },
  idempotency_key: string,
  agent_run_id: string,     // uuid, links the tool_call to agent_runs
  correlation_id: string    // uuid
}
```

Output (success):

```ts
{
  tool_call_id: string,         // uuid — row in tool_calls
  message_id: string,           // uuid — row in messages (outbound)
  telegram_message_id: number,  // Telegram's own message_id
  cached: boolean               // true if this was a replay (no re-send)
}
```

Error kinds: `tenant_mismatch` | `thread_not_found` | `unsupported_channel`
| `duplicate_pending` | `telegram_error` | `db_error`. `telegram_error`
carries the underlying classified kind (rate_limit, forbidden, etc.).

### Idempotency

`tool_calls.idempotency_key` is scoped per `(tenant_id, mcp_server)`.
Calling `send_message` twice with the same key:

- First call hits Telegram, inserts `tool_calls` + `messages` rows, returns `cached: false`.
- Second call returns the first call's result with `cached: true` — no extra
  Telegram send, no duplicate DB rows.

If the first call is still in flight (`status='running'`) OR ended in
`error`, the second call gets `duplicate_pending`. Caller's responsibility
to decide whether to retry with a new key.

### Invocation

**In-process (M1 default)** — apps/workers imports the handler directly:

```ts
import { sendMessage } from '@bluecairn/mcp-servers'
// ...
const result = await sendMessage(deps, input)
```

**Stdio MCP (future / manual)**:

```bash
doppler run --config dev -- bun run --cwd packages/mcp-servers comms:stdio
```

then attach an MCP client like `npx @modelcontextprotocol/inspector`.

### Tenant scoping

Per ADR-0006, every call verifies `tenant_id === channel.tenant_id`
resolved from `thread_id`. Mismatches get `tenant_mismatch`, never silent
cross-tenant writes. The channel lookup runs under the admin DB client
(pre-tenant-context, matches the webhook pattern); all subsequent writes
(tool_calls, messages, threads) go through `withTenant` so RLS still
applies to the system role's fallback path.
