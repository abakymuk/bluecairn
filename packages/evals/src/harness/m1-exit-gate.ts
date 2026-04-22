#!/usr/bin/env bun
/**
 * BLU-29 — M1 exit-gate harness (v1).
 *
 * Drives N synthetic Telegram messages through a DEDICATED per-run
 * harness tenant against staging (or dev), then measures the full
 * observable pipeline:
 *
 *   Phase A (always):
 *     A0. t_webhook_sent          — harness POSTs to /webhooks/telegram
 *     A1. t_webhook_ack           — API returns 200
 *     A2. t_ops_console_visible   — the query ops-web's /threads list
 *                                    runs (threads + LATERAL latest-msg)
 *                                    sees the new inbound message.
 *                                    ★ This is the ROADMAP Month-1 gate
 *                                    ("appears in the ops console within
 *                                    10 seconds") literal.
 *     A3. t_agent_run_completed   — agent_runs row reaches
 *                                    status='completed' with tokens +
 *                                    cost_cents NOT NULL.
 *     A4. t_approval_prompt_sent  — tool_calls row with
 *                                    idempotency_key='approval-prompt:<action>'
 *                                    reaches status='success'. This is
 *                                    the only honest proof that
 *                                    action.gate completed step 3 —
 *                                    earlier stages can succeed while
 *                                    the Telegram send sits in retry.
 *
 *   Phase B (optional, with --auto-approve):
 *     B0. Craft callback_query with real approval_request_id
 *     B1. POST /webhooks/telegram
 *     B2. t_action_executed       — actions.status='executed' AND
 *                                    tool_calls idempotency
 *                                    'action-dispatch:<action>' status=success
 *
 * Preflight fails fast if any of (DATABASE_URL_ADMIN,
 * TELEGRAM_WEBHOOK_SECRET, HARNESS_TELEGRAM_CHAT_ID, api/health,
 * workers/health, ops-web/health) is missing or unreachable.
 *
 * Fixture: a NEW tenant per run (slug `harness-exit-gate-<ISO>`) with a
 * single telegram channel mapped to HARNESS_TELEGRAM_CHAT_ID — a real
 * chat Vlad provisions once (separate from bluecairn-internal so harness
 * runs don't contaminate the live operator thread).
 *
 * Concurrency defaults to 1. Parallelism would measure Telegram 429 +
 * Inngest queue depth rather than the M1 gate reality.
 *
 * Usage:
 *
 *   doppler run --config stg -- bun run --cwd packages/evals harness:m1 \
 *     --messages 20 \
 *     --env staging \
 *     --api-base-url https://bluecairnapi-staging.up.railway.app \
 *     --ops-web-base-url https://ops-web-staging-staging.up.railway.app \
 *     --workers-base-url https://workers-staging-staging-8181.up.railway.app
 *
 *   # Phase B (also verifies auto-approve → dispatch):
 *   doppler run --config stg -- bun run --cwd packages/evals harness:m1 \
 *     --messages 10 --auto-approve --env staging
 *
 * Required env (via Doppler):
 *   DATABASE_URL_ADMIN            — table owner, bypasses RLS
 *   TELEGRAM_WEBHOOK_SECRET       — X-Telegram-Bot-Api-Secret-Token
 *   HARNESS_TELEGRAM_CHAT_ID      — real test chat id for the harness
 *                                   tenant's channel. Provision once.
 */

import { parseArgs } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'

// Resolve the reports dir relative to THIS file rather than `process.cwd()`.
// When invoked via `bun run --cwd packages/evals harness:m1`, cwd is
// already packages/evals, so the default `packages/evals/reports` doubled
// the prefix. Using `__dirname`-style resolution removes the ambiguity.
const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPORT_DIR = resolve(HARNESS_DIR, '..', '..', 'reports')

// ---------------------------------------------------------------------------
// Section 1 — CLI + env + types
// ---------------------------------------------------------------------------

interface HarnessArgs {
  messages: number
  env: 'staging' | 'dev'
  apiBaseUrl: string
  opsWebBaseUrl: string
  workersBaseUrl: string
  concurrency: number
  autoApprove: boolean
  reportDir: string
  timeoutMs: number
  // Pass criteria — defaults match the ROADMAP gate literal.
  visibleP95Ms: number
  approvalPromptP95Ms: number
  costCompletenessPct: number
  // Baseline-mode flag — name the report file `baseline-<date>.md` so it
  // escapes the `reports/*.md` gitignore and is committed as evidence.
  baseline: boolean
}

interface HarnessEnv {
  databaseUrlAdmin: string
  telegramWebhookSecret: string
  harnessTelegramChatId: string
}

function parseHarnessArgs(): HarnessArgs {
  const { values } = parseArgs({
    options: {
      messages: { type: 'string', default: '20' },
      env: { type: 'string', default: 'staging' },
      'api-base-url': { type: 'string' },
      'ops-web-base-url': { type: 'string' },
      'workers-base-url': { type: 'string' },
      concurrency: { type: 'string', default: '1' },
      'auto-approve': { type: 'boolean', default: false },
      'report-dir': { type: 'string' },
      'timeout-ms': { type: 'string', default: '60000' },
      'visible-p95-ms': { type: 'string', default: '10000' },
      'approval-prompt-p95-ms': { type: 'string', default: '20000' },
      'cost-completeness-pct': { type: 'string', default: '100' },
      baseline: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  })

  const envArg = values.env === 'dev' ? 'dev' : 'staging'
  const apiBaseUrl =
    (values['api-base-url'] as string | undefined) ??
    (envArg === 'staging' ? 'https://bluecairnapi-staging.up.railway.app' : 'http://localhost:3000')
  const opsWebBaseUrl =
    (values['ops-web-base-url'] as string | undefined) ??
    (envArg === 'staging'
      ? 'https://ops-web-staging-staging.up.railway.app'
      : 'http://localhost:3002')
  const workersBaseUrl =
    (values['workers-base-url'] as string | undefined) ??
    (envArg === 'staging'
      ? 'https://workers-staging-staging-8181.up.railway.app'
      : 'http://localhost:3001')

  return {
    messages: Number.parseInt(values.messages as string, 10),
    env: envArg,
    apiBaseUrl,
    opsWebBaseUrl,
    workersBaseUrl,
    concurrency: Number.parseInt(values.concurrency as string, 10),
    autoApprove: values['auto-approve'] === true,
    reportDir: (values['report-dir'] as string | undefined) ?? DEFAULT_REPORT_DIR,
    timeoutMs: Number.parseInt(values['timeout-ms'] as string, 10),
    visibleP95Ms: Number.parseInt(values['visible-p95-ms'] as string, 10),
    approvalPromptP95Ms: Number.parseInt(values['approval-prompt-p95-ms'] as string, 10),
    costCompletenessPct: Number.parseFloat(values['cost-completeness-pct'] as string),
    baseline: values.baseline === true,
  }
}

function readEnv(): HarnessEnv {
  const databaseUrlAdmin = process.env.DATABASE_URL_ADMIN
  const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  const harnessTelegramChatId = process.env.HARNESS_TELEGRAM_CHAT_ID
  const missing: string[] = []
  if (!databaseUrlAdmin) missing.push('DATABASE_URL_ADMIN')
  if (!telegramWebhookSecret) missing.push('TELEGRAM_WEBHOOK_SECRET')
  if (!harnessTelegramChatId) missing.push('HARNESS_TELEGRAM_CHAT_ID')
  if (missing.length > 0) {
    throw new PreflightError(
      `missing required env: ${missing.join(', ')}\n` +
        `  HARNESS_TELEGRAM_CHAT_ID = a REAL Telegram chat id (dedicated test chat, NOT the live internal thread) where approval prompts will land during the run. Provision once via Doppler stg; the harness creates a persistent 'harness-exit-gate' tenant bound to this chat id (reused across runs).`,
    )
  }
  return {
    databaseUrlAdmin: databaseUrlAdmin!,
    telegramWebhookSecret: telegramWebhookSecret!,
    harnessTelegramChatId: harnessTelegramChatId!,
  }
}

class PreflightError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'PreflightError'
  }
}

// ---------------------------------------------------------------------------
// Section 2 — Preflight: env + service health
// ---------------------------------------------------------------------------

async function preflight(args: HarnessArgs, _env: HarnessEnv): Promise<void> {
  const probes = [
    { name: 'api', url: `${args.apiBaseUrl}/health` },
    { name: 'workers', url: `${args.workersBaseUrl}/health` },
    { name: 'ops-web', url: `${args.opsWebBaseUrl}/api/health` },
  ]
  const results = await Promise.all(
    probes.map(async (p) => {
      try {
        const res = await fetch(p.url, { method: 'GET', signal: AbortSignal.timeout(5_000) })
        return { ...p, ok: res.ok, status: res.status }
      } catch (err) {
        return {
          ...p,
          ok: false,
          status: 0,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    throw new PreflightError(
      `service health probe failed:\n${failed
        .map((f) => `  - ${f.name} @ ${f.url} → ${f.status}${'error' in f ? ` (${f.error})` : ''}`)
        .join('\n')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Section 3 — Stable harness-tenant fixture (create-or-reuse)
// ---------------------------------------------------------------------------
//
// Originally we tried an ephemeral per-run tenant, but the append-only
// `audit_log` trigger + FK-to-actions-without-cascade make tenant DELETE
// fail after any pipeline run. That would leave the tenant stranded AND
// block subsequent runs' preflight ("chat_id already bound").
//
// Stable design: ONE persistent tenant with slug `harness-exit-gate`,
// ONE channel pointed at HARNESS_TELEGRAM_CHAT_ID, ONE thread. Runs
// reuse them. Per-run isolation is achieved via unique `runId` tagged
// into each synthetic message text (`[harness:<runId>] ping #N`). The
// harness tenant NEVER shares a chat_id with a live tenant (preflight
// enforces — if the chat_id is bound to anything but a slug starting
// with `harness-exit-gate`, we refuse).

const STABLE_HARNESS_SLUG = 'harness-exit-gate'

interface HarnessFixture {
  tenantId: string
  tenantSlug: string
  channelId: string
  channelExternalId: string // = HARNESS_TELEGRAM_CHAT_ID
  threadId: string
  runId: string
  reused: boolean
}

async function createFixture(args: {
  db: Sql
  harnessTelegramChatId: string
}): Promise<HarnessFixture> {
  const runId = crypto.randomUUID().slice(0, 8)

  // 1. Preflight: is the chat_id already bound to any channel?
  const [clash] = await args.db<
    { id: string; tenant_id: string; slug: string }[]
  >`
    SELECT c.id, c.tenant_id, t.slug
    FROM   channels c
    JOIN   tenants t ON t.id = c.tenant_id
    WHERE  c.kind = 'telegram' AND c.external_id = ${args.harnessTelegramChatId}
    LIMIT 1
  `
  if (clash && !clash.slug.startsWith(STABLE_HARNESS_SLUG)) {
    throw new PreflightError(
      `HARNESS_TELEGRAM_CHAT_ID ${args.harnessTelegramChatId} is already bound to tenant '${clash.slug}' (${clash.tenant_id}).\n` +
        `  The harness refuses to hijack a live tenant's channel. Use a DEDICATED test chat that no live tenant owns.`,
    )
  }

  // 2. Reuse existing harness tenant if present
  if (clash) {
    const [reusedThread] = await args.db<{ id: string }[]>`
      SELECT id FROM threads WHERE channel_id = ${clash.id}
      ORDER BY created_at ASC LIMIT 1
    `
    if (!reusedThread) {
      // Channel exists but thread missing — create one to complete the fixture.
      const [fresh] = await args.db<{ id: string }[]>`
        INSERT INTO threads (tenant_id, channel_id, kind)
        VALUES (${clash.tenant_id}, ${clash.id}, 'owner_primary')
        RETURNING id
      `
      if (!fresh) throw new Error('fixture: thread insert returned no rows')
      return {
        tenantId: clash.tenant_id,
        tenantSlug: clash.slug,
        channelId: clash.id,
        channelExternalId: args.harnessTelegramChatId,
        threadId: fresh.id,
        runId,
        reused: true,
      }
    }
    return {
      tenantId: clash.tenant_id,
      tenantSlug: clash.slug,
      channelId: clash.id,
      channelExternalId: args.harnessTelegramChatId,
      threadId: reusedThread.id,
      runId,
      reused: true,
    }
  }

  // 3. First-run provisioning: create stable tenant + channel + thread
  const [tenant] = await args.db<{ id: string }[]>`
    INSERT INTO tenants (slug, legal_name, display_name)
    VALUES (${STABLE_HARNESS_SLUG}, 'Harness Exit Gate LLC', 'Harness Exit Gate')
    RETURNING id
  `
  if (!tenant) throw new Error('fixture: tenant insert returned no rows')

  const [channel] = await args.db<{ id: string }[]>`
    INSERT INTO channels (tenant_id, kind, external_id, is_primary, active)
    VALUES (${tenant.id}, 'telegram', ${args.harnessTelegramChatId}, true, true)
    RETURNING id
  `
  if (!channel) throw new Error('fixture: channel insert returned no rows')

  const [thread] = await args.db<{ id: string }[]>`
    INSERT INTO threads (tenant_id, channel_id, kind)
    VALUES (${tenant.id}, ${channel.id}, 'owner_primary')
    RETURNING id
  `
  if (!thread) throw new Error('fixture: thread insert returned no rows')

  return {
    tenantId: tenant.id,
    tenantSlug: STABLE_HARNESS_SLUG,
    channelId: channel.id,
    channelExternalId: args.harnessTelegramChatId,
    threadId: thread.id,
    runId,
    reused: false,
  }
}

async function cleanupFixture(_db: Sql, _fixture: HarnessFixture): Promise<void> {
  // Stable tenant persists across runs — no cleanup. Per-run state is
  // grep-able by the `[harness:<runId>]` prefix in message text. Neon
  // branch resets are the periodic DB cleanup (matches BLU-24/25/27/28
  // test-suite posture for append-only audit rows).
}

// ---------------------------------------------------------------------------
// Section 4 — Driver (webhook POST + optional callback)
// ---------------------------------------------------------------------------

interface WebhookResult {
  messageExternalId: string
  telegramMessageId: number
  tWebhookSentMs: number
  tWebhookAckMs: number
  httpStatus: number
  textSent: string
}

async function postSyntheticMessage(args: {
  apiBaseUrl: string
  webhookSecret: string
  chatId: string
  fromUserId: number
  iteration: number
  runId: string
}): Promise<WebhookResult> {
  const telegramMessageId = Math.floor(Math.random() * 1e9) + args.iteration
  const text = `[harness:${args.runId}] ping #${args.iteration}`
  const update = {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: telegramMessageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number.parseInt(args.chatId, 10) },
      from: {
        id: args.fromUserId,
        first_name: 'Harness',
        username: `harness_bot_${args.runId}`,
      },
      text,
    },
  }

  const tSent = Date.now()
  const res = await fetch(`${args.apiBaseUrl}/webhooks/telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': args.webhookSecret,
    },
    body: JSON.stringify(update),
  })
  const tAck = Date.now()
  await res.text().catch(() => undefined)

  return {
    messageExternalId: String(telegramMessageId),
    telegramMessageId,
    tWebhookSentMs: tSent,
    tWebhookAckMs: tAck,
    httpStatus: res.status,
    textSent: text,
  }
}

async function postSyntheticApprovalCallback(args: {
  apiBaseUrl: string
  webhookSecret: string
  chatId: string
  approvalRequestId: string
  decision: 'approved' | 'rejected'
  fromUserId: number
}): Promise<{ httpStatus: number; tSentMs: number }> {
  const callback = {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: `harness-cb-${crypto.randomUUID().slice(0, 8)}`,
      data: `approval:${args.approvalRequestId}:${args.decision}`,
      from: { id: args.fromUserId, first_name: 'Harness' },
      message: {
        message_id: Math.floor(Math.random() * 1e9),
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number.parseInt(args.chatId, 10) },
      },
      chat_instance: `harness-ci-${crypto.randomUUID().slice(0, 8)}`,
    },
  }
  const tSent = Date.now()
  const res = await fetch(`${args.apiBaseUrl}/webhooks/telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': args.webhookSecret,
    },
    body: JSON.stringify(callback),
  })
  await res.text().catch(() => undefined)
  return { httpStatus: res.status, tSentMs: tSent }
}

// ---------------------------------------------------------------------------
// Section 5 — Observer (4-stage polling; optional Phase B)
// ---------------------------------------------------------------------------

interface Observation {
  // Stage markers — null if the stage never completed within timeout
  tOpsConsoleVisibleMs: number | null
  tAgentRunCompletedMs: number | null
  tApprovalPromptSentMs: number | null
  tActionExecutedMs: number | null // Phase B only

  // Reference ids
  messageId: string | null
  agentRunId: string | null
  actionId: string | null
  approvalRequestId: string | null

  // Cost tracking (nullable is the pass criterion per BLU-27 note)
  inputTokens: number | null
  outputTokens: number | null
  costCents: number | null
  agentRunStatus: string | null
  actionStatus: string | null
  timedOut: boolean
}

async function observeMessage(args: {
  db: Sql
  fixture: HarnessFixture
  messageExternalId: string
  tWebhookSentMs: number
  timeoutMs: number
  autoApprove: boolean
  webhookSecret: string
  apiBaseUrl: string
  harnessTelegramChatId: string
  fromUserId: number
}): Promise<Observation> {
  const deadline = args.tWebhookSentMs + args.timeoutMs
  const pollIntervalMs = 400
  const obs: Observation = {
    tOpsConsoleVisibleMs: null,
    tAgentRunCompletedMs: null,
    tApprovalPromptSentMs: null,
    tActionExecutedMs: null,
    messageId: null,
    agentRunId: null,
    actionId: null,
    approvalRequestId: null,
    inputTokens: null,
    outputTokens: null,
    costCents: null,
    agentRunStatus: null,
    actionStatus: null,
    timedOut: false,
  }

  let callbackPosted = false

  while (Date.now() < deadline) {
    // Stage 2: ops-console visibility — the EXACT query ops-web's /threads
    // list runs (mirrors `listThreadsAcrossTenants` LATERAL join).
    if (obs.tOpsConsoleVisibleMs === null) {
      const [row] = await args.db<
        { thread_id: string; last_content: string | null; last_created_at: Date | null }[]
      >`
        SELECT
          t.id                       AS thread_id,
          lm.content                 AS last_content,
          lm.created_at              AS last_created_at
        FROM threads t
        LEFT JOIN LATERAL (
          SELECT content, created_at, external_message_id
          FROM messages
          WHERE thread_id = t.id
          ORDER BY created_at DESC
          LIMIT 1
        ) lm ON true
        WHERE t.id = ${args.fixture.threadId}
          AND lm.external_message_id = ${args.messageExternalId}
        LIMIT 1
      `
      if (row) {
        obs.tOpsConsoleVisibleMs = Date.now()
      }
    }

    // Stage 3: find the message row + the agent_run triggered by it.
    if (!obs.messageId) {
      const [msg] = await args.db<{ id: string }[]>`
        SELECT id FROM messages
        WHERE tenant_id = ${args.fixture.tenantId}
          AND external_message_id = ${args.messageExternalId}
        LIMIT 1
      `
      if (msg) obs.messageId = msg.id
    }

    if (obs.messageId && obs.tAgentRunCompletedMs === null) {
      const [run] = await args.db<
        {
          id: string
          status: string
          input_tokens: number | null
          output_tokens: number | null
          cost_cents: number | null
          completed_at: Date | null
        }[]
      >`
        SELECT id, status, input_tokens, output_tokens, cost_cents, completed_at
        FROM   agent_runs
        WHERE  tenant_id = ${args.fixture.tenantId}
          AND  trigger_kind = 'user_message'
          AND  trigger_ref = ${obs.messageId}
        ORDER  BY started_at DESC
        LIMIT  1
      `
      if (run) {
        obs.agentRunId = run.id
        obs.agentRunStatus = run.status
        obs.inputTokens = run.input_tokens
        obs.outputTokens = run.output_tokens
        obs.costCents = run.cost_cents
        if (run.status === 'completed') {
          obs.tAgentRunCompletedMs = run.completed_at
            ? run.completed_at.getTime()
            : Date.now()
        } else if (run.status === 'failed') {
          obs.tAgentRunCompletedMs = Date.now()
          break
        }
      }
    }

    // Stage 4: approval prompt really sent? This is the honest gate that
    // stage 3 doesn't prove. action.gate step 3 writes tool_calls with
    // idempotency='approval-prompt:<action_id>' and status='success' only
    // if the Telegram send returned OK.
    if (obs.agentRunId) {
      if (!obs.actionId) {
        const [action] = await args.db<{ id: string; status: string }[]>`
          SELECT id, status FROM actions
          WHERE tenant_id = ${args.fixture.tenantId}
            AND agent_run_id = ${obs.agentRunId}
            AND kind = 'send_message'
          ORDER BY created_at DESC
          LIMIT 1
        `
        if (action) {
          obs.actionId = action.id
          obs.actionStatus = action.status
        }
      }

      if (obs.actionId) {
        // approval_request + prompt-send tool_call
        if (!obs.approvalRequestId) {
          const [appr] = await args.db<{ id: string }[]>`
            SELECT id FROM approval_requests
            WHERE tenant_id = ${args.fixture.tenantId}
              AND action_id = ${obs.actionId}
            LIMIT 1
          `
          if (appr) obs.approvalRequestId = appr.id
        }

        if (obs.tApprovalPromptSentMs === null) {
          const [tc] = await args.db<
            { id: string; status: string; completed_at: Date | null }[]
          >`
            SELECT id, status, completed_at FROM tool_calls
            WHERE tenant_id = ${args.fixture.tenantId}
              AND agent_run_id = ${obs.agentRunId}
              AND mcp_server = 'comms'
              AND tool_name = 'send_message'
              AND idempotency_key = ${`approval-prompt:${obs.actionId}`}
              AND status = 'success'
            LIMIT 1
          `
          if (tc) {
            obs.tApprovalPromptSentMs = tc.completed_at
              ? tc.completed_at.getTime()
              : Date.now()
          }
        }
      }

      // Phase B: once approval prompt is sent and we have the request
      // id, craft a synthetic callback → observe dispatch.
      if (args.autoApprove && obs.tApprovalPromptSentMs && obs.approvalRequestId && !callbackPosted) {
        callbackPosted = true
        await postSyntheticApprovalCallback({
          apiBaseUrl: args.apiBaseUrl,
          webhookSecret: args.webhookSecret,
          chatId: args.harnessTelegramChatId,
          approvalRequestId: obs.approvalRequestId,
          decision: 'approved',
          fromUserId: args.fromUserId,
        })
      }

      if (args.autoApprove && obs.tActionExecutedMs === null && obs.actionId) {
        const [dispatched] = await args.db<
          {
            action_status: string
            tc_status: string | null
            tc_completed_at: Date | null
          }[]
        >`
          SELECT a.status AS action_status,
                 tc.status AS tc_status,
                 tc.completed_at AS tc_completed_at
          FROM actions a
          LEFT JOIN tool_calls tc
            ON tc.tenant_id = a.tenant_id
           AND tc.agent_run_id = a.agent_run_id
           AND tc.mcp_server = 'comms'
           AND tc.tool_name = 'send_message'
           AND tc.idempotency_key = ${`action-dispatch:${obs.actionId}`}
          WHERE a.id = ${obs.actionId}
          LIMIT 1
        `
        if (
          dispatched?.action_status === 'executed' &&
          dispatched.tc_status === 'success'
        ) {
          obs.tActionExecutedMs = dispatched.tc_completed_at
            ? dispatched.tc_completed_at.getTime()
            : Date.now()
        }
      }
    }

    // Termination conditions
    if (!args.autoApprove && obs.tApprovalPromptSentMs !== null) break
    if (args.autoApprove && obs.tActionExecutedMs !== null) break

    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  if (
    obs.tOpsConsoleVisibleMs === null ||
    obs.tAgentRunCompletedMs === null ||
    obs.tApprovalPromptSentMs === null ||
    (args.autoApprove && obs.tActionExecutedMs === null)
  ) {
    obs.timedOut = true
  }

  return obs
}

// ---------------------------------------------------------------------------
// Section 6 — Metrics + reporting
// ---------------------------------------------------------------------------

interface PerMessageRow {
  iteration: number
  httpStatus: number
  messageExternalId: string
  agentRunId: string | null
  approvalRequestId: string | null
  actionId: string | null
  agentRunStatus: string | null
  actionStatus: string | null
  timedOut: boolean
  tWebhookAckMs: number
  visibleLatencyMs: number | null
  agentCompletedLatencyMs: number | null
  approvalPromptLatencyMs: number | null
  actionExecutedLatencyMs: number | null // Phase B only
  inputTokens: number | null
  outputTokens: number | null
  costCents: number | null
  textSent: string
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx] ?? 0
}

interface Metrics {
  runs: number
  pass: boolean
  visible: { p50: number; p95: number; p99: number; max: number }
  agent: { p50: number; p95: number; p99: number; max: number }
  prompt: { p50: number; p95: number; p99: number; max: number }
  dispatch: { p50: number; p95: number; p99: number; max: number } | null
  costCompleteCount: number
  failureCount: number
  timedOutCount: number
  totalCostCents: number
  totalInputTokens: number
  totalOutputTokens: number
  thresholds: {
    visibleP95Ms: number
    approvalPromptP95Ms: number
    costCompletenessPct: number
  }
}

function bucket(rows: PerMessageRow[], pick: (r: PerMessageRow) => number | null) {
  const vals = rows
    .map(pick)
    .filter((v): v is number => v !== null && v >= 0)
    .sort((a, b) => a - b)
  return {
    p50: percentile(vals, 50),
    p95: percentile(vals, 95),
    p99: percentile(vals, 99),
    max: vals[vals.length - 1] ?? 0,
  }
}

function computeMetrics(
  rows: PerMessageRow[],
  thresholds: Metrics['thresholds'],
  phaseB: boolean,
): Metrics {
  const costComplete = rows.filter(
    (r) =>
      r.inputTokens !== null &&
      r.outputTokens !== null &&
      r.costCents !== null &&
      r.inputTokens > 0 &&
      r.outputTokens > 0,
  )
  const failures = rows.filter((r) => r.agentRunStatus === 'failed')
  const timedOut = rows.filter((r) => r.timedOut)
  const visible = bucket(rows, (r) => r.visibleLatencyMs)
  const prompt = bucket(rows, (r) => r.approvalPromptLatencyMs)
  const completenessPct = rows.length > 0 ? (100 * costComplete.length) / rows.length : 0

  const pass =
    rows.length > 0 &&
    failures.length === 0 &&
    timedOut.length === 0 &&
    visible.p95 <= thresholds.visibleP95Ms &&
    prompt.p95 <= thresholds.approvalPromptP95Ms &&
    completenessPct >= thresholds.costCompletenessPct

  return {
    runs: rows.length,
    pass,
    visible,
    agent: bucket(rows, (r) => r.agentCompletedLatencyMs),
    prompt,
    dispatch: phaseB ? bucket(rows, (r) => r.actionExecutedLatencyMs) : null,
    costCompleteCount: costComplete.length,
    failureCount: failures.length,
    timedOutCount: timedOut.length,
    totalCostCents: rows.reduce((s, r) => s + (r.costCents ?? 0), 0),
    totalInputTokens: rows.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
    totalOutputTokens: rows.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
    thresholds,
  }
}

function renderReport(args: {
  metrics: Metrics
  rows: PerMessageRow[]
  harness: HarnessArgs
  fixture: HarnessFixture
  startedAt: Date
  completedAt: Date
}): string {
  const { metrics: m, rows, harness, fixture, startedAt, completedAt } = args
  const verdict = m.pass ? 'PASS ✅' : 'FAIL ❌'
  const duration = ((completedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)

  const check = (label: string, threshold: string, observed: string, ok: boolean) =>
    `| ${label} | ${threshold} | ${observed} | ${ok ? '✅' : '❌'} |`

  const checks = [
    check(
      'P95 ops-console visible (★ ROADMAP gate)',
      `<${m.thresholds.visibleP95Ms}ms`,
      `${m.visible.p95}ms`,
      m.visible.p95 <= m.thresholds.visibleP95Ms,
    ),
    check(
      'P95 approval prompt sent',
      `<${m.thresholds.approvalPromptP95Ms}ms`,
      `${m.prompt.p95}ms`,
      m.prompt.p95 <= m.thresholds.approvalPromptP95Ms,
    ),
    check(
      'Cost+tokens completeness',
      `${m.thresholds.costCompletenessPct}%`,
      `${((100 * m.costCompleteCount) / Math.max(1, m.runs)).toFixed(1)}% (${m.costCompleteCount}/${m.runs})`,
      m.costCompleteCount === m.runs,
    ),
    check('Failures', '0', String(m.failureCount), m.failureCount === 0),
    check('Timeouts', '0', String(m.timedOutCount), m.timedOutCount === 0),
  ].join('\n')

  const perRow = rows
    .map(
      (r) =>
        `| ${r.iteration} | ${r.messageExternalId} | ${r.agentRunStatus ?? (r.timedOut ? 'TIMEOUT' : 'pending')} | ${r.visibleLatencyMs ?? '—'}ms | ${r.agentCompletedLatencyMs ?? '—'}ms | ${r.approvalPromptLatencyMs ?? '—'}ms${harness.autoApprove ? ` | ${r.actionExecutedLatencyMs ?? '—'}ms` : ''} | ${r.inputTokens ?? '—'}/${r.outputTokens ?? '—'} | ${r.costCents ?? '—'}¢ |`,
    )
    .join('\n')

  const perRowHeader = harness.autoApprove
    ? '| # | tg_msg_id | agent_run | visible | agent done | prompt sent | dispatched | in/out tok | cost |\n|---|---|---|---|---|---|---|---|---|'
    : '| # | tg_msg_id | agent_run | visible | agent done | prompt sent | in/out tok | cost |\n|---|---|---|---|---|---|---|---|'

  const costNote =
    m.totalCostCents === 0 && m.totalInputTokens > 0
      ? '\n> **Note**: `cost_cents` is INTEGER; Haiku-class calls (~$0.0002) round to 0. Tokens are populated (that is the completeness check). BLU-27 documented this precision trade-off.'
      : ''

  const phaseBSection = m.dispatch
    ? `

## Phase B (--auto-approve) — dispatch

| Metric | Value |
|---|---|
| P50 | ${m.dispatch.p50}ms |
| P95 | ${m.dispatch.p95}ms |
| P99 | ${m.dispatch.p99}ms |
| Max | ${m.dispatch.max}ms |
`
    : ''

  return `# M1 Exit Gate Report — ${startedAt.toISOString()}

**Verdict**: ${verdict}

- Env: ${harness.env}
- API: ${harness.apiBaseUrl}
- Workers: ${harness.workersBaseUrl}
- ops-web: ${harness.opsWebBaseUrl}
- Tenant (ephemeral): \`${fixture.tenantSlug}\` (id \`${fixture.tenantId}\`)
- Chat: ${fixture.channelExternalId}
- Messages sent: ${harness.messages}
- Concurrency: ${harness.concurrency}
- Auto-approve (Phase B): ${harness.autoApprove ? 'yes' : 'no'}
- Duration: ${duration}s

## Pass criteria

| Criterion | Threshold | Observed | Status |
|---|---|---|---|
${checks}

## Latency distribution (ms, from t_webhook_ack)

| Stage | P50 | P95 | P99 | Max |
|---|---|---|---|---|
| A2 ops-console visible (★) | ${m.visible.p50} | ${m.visible.p95} | ${m.visible.p99} | ${m.visible.max} |
| A3 agent_run completed | ${m.agent.p50} | ${m.agent.p95} | ${m.agent.p99} | ${m.agent.max} |
| A4 approval prompt sent | ${m.prompt.p50} | ${m.prompt.p95} | ${m.prompt.p99} | ${m.prompt.max} |
${phaseBSection}

## Cost tracking

- Runs with tokens+cost populated: **${m.costCompleteCount}/${m.runs}**
- Sum input tokens: ${m.totalInputTokens.toLocaleString()}
- Sum output tokens: ${m.totalOutputTokens.toLocaleString()}
- Sum cost_cents: ${m.totalCostCents}¢ (≈ $${(m.totalCostCents / 100).toFixed(2)})${costNote}

## Per-message runs

${perRowHeader}
${perRow}

---

Generated by \`packages/evals/src/harness/m1-exit-gate.ts\` at ${completedAt.toISOString()}.
`
}

// ---------------------------------------------------------------------------
// Section 7 — Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const harness = parseHarnessArgs()
  const startedAt = new Date()
  let exitCode = 1

  console.info(
    `[harness] env=${harness.env} messages=${harness.messages} concurrency=${harness.concurrency} auto-approve=${harness.autoApprove}`,
  )

  let env: HarnessEnv
  try {
    env = readEnv()
  } catch (err) {
    console.error(`[preflight] ${err instanceof Error ? err.message : err}`)
    return 2
  }

  try {
    await preflight(harness, env)
  } catch (err) {
    console.error(`[preflight] ${err instanceof Error ? err.message : err}`)
    return 2
  }

  const db = postgres(env.databaseUrlAdmin, { max: 4, prepare: false })
  let fixture: HarnessFixture | null = null

  try {
    fixture = await createFixture({ db, harnessTelegramChatId: env.harnessTelegramChatId })
    console.info(
      `[harness] fixture ready: tenant=${fixture.tenantSlug} thread=${fixture.threadId}`,
    )

    const rows: PerMessageRow[] = []
    const fromUserId = 900_000_000 + Math.floor(Math.random() * 1e8)

    const driveOne = async (iter: number): Promise<PerMessageRow> => {
      const sent = await postSyntheticMessage({
        apiBaseUrl: harness.apiBaseUrl,
        webhookSecret: env.telegramWebhookSecret,
        chatId: fixture!.channelExternalId,
        fromUserId,
        iteration: iter,
        runId: fixture!.runId,
      })

      if (sent.httpStatus !== 200) {
        return {
          iteration: iter,
          httpStatus: sent.httpStatus,
          messageExternalId: sent.messageExternalId,
          agentRunId: null,
          approvalRequestId: null,
          actionId: null,
          agentRunStatus: null,
          actionStatus: null,
          timedOut: true,
          tWebhookAckMs: sent.tWebhookAckMs,
          visibleLatencyMs: null,
          agentCompletedLatencyMs: null,
          approvalPromptLatencyMs: null,
          actionExecutedLatencyMs: null,
          inputTokens: null,
          outputTokens: null,
          costCents: null,
          textSent: sent.textSent,
        }
      }

      const obs = await observeMessage({
        db,
        fixture: fixture!,
        messageExternalId: sent.messageExternalId,
        tWebhookSentMs: sent.tWebhookSentMs,
        timeoutMs: harness.timeoutMs,
        autoApprove: harness.autoApprove,
        webhookSecret: env.telegramWebhookSecret,
        apiBaseUrl: harness.apiBaseUrl,
        harnessTelegramChatId: env.harnessTelegramChatId,
        fromUserId,
      })

      return {
        iteration: iter,
        httpStatus: sent.httpStatus,
        messageExternalId: sent.messageExternalId,
        agentRunId: obs.agentRunId,
        approvalRequestId: obs.approvalRequestId,
        actionId: obs.actionId,
        agentRunStatus: obs.agentRunStatus,
        actionStatus: obs.actionStatus,
        timedOut: obs.timedOut,
        tWebhookAckMs: sent.tWebhookAckMs,
        visibleLatencyMs:
          obs.tOpsConsoleVisibleMs !== null ? obs.tOpsConsoleVisibleMs - sent.tWebhookAckMs : null,
        agentCompletedLatencyMs:
          obs.tAgentRunCompletedMs !== null ? obs.tAgentRunCompletedMs - sent.tWebhookAckMs : null,
        approvalPromptLatencyMs:
          obs.tApprovalPromptSentMs !== null ? obs.tApprovalPromptSentMs - sent.tWebhookAckMs : null,
        actionExecutedLatencyMs:
          obs.tActionExecutedMs !== null ? obs.tActionExecutedMs - sent.tWebhookAckMs : null,
        inputTokens: obs.inputTokens,
        outputTokens: obs.outputTokens,
        costCents: obs.costCents,
        textSent: sent.textSent,
      }
    }

    // Concurrency control
    if (harness.concurrency <= 1) {
      for (let i = 0; i < harness.messages; i++) {
        const row = await driveOne(i)
        rows.push(row)
        const label = row.timedOut ? 'TIMEOUT' : (row.agentRunStatus ?? 'unknown')
        console.info(
          `[harness] ${i + 1}/${harness.messages} ${label} visible=${row.visibleLatencyMs ?? 'n/a'}ms prompt=${row.approvalPromptLatencyMs ?? 'n/a'}ms${harness.autoApprove ? ` dispatch=${row.actionExecutedLatencyMs ?? 'n/a'}ms` : ''}`,
        )
      }
    } else {
      // Simple semaphored parallelism — N in flight at once
      const queue = Array.from({ length: harness.messages }, (_, i) => i)
      const workers = Array.from({ length: harness.concurrency }, async () => {
        while (queue.length > 0) {
          const i = queue.shift()
          if (i === undefined) break
          const row = await driveOne(i)
          rows.push(row)
          console.info(
            `[harness] completed iter=${i} visible=${row.visibleLatencyMs ?? 'n/a'}ms`,
          )
        }
      })
      await Promise.all(workers)
      rows.sort((a, b) => a.iteration - b.iteration)
    }

    const completedAt = new Date()
    const metrics = computeMetrics(
      rows,
      {
        visibleP95Ms: harness.visibleP95Ms,
        approvalPromptP95Ms: harness.approvalPromptP95Ms,
        costCompletenessPct: harness.costCompletenessPct,
      },
      harness.autoApprove,
    )

    const report = renderReport({ metrics, rows, harness, fixture, startedAt, completedAt })

    const datePart = startedAt.toISOString().slice(0, 10)
    const fileName = harness.baseline
      ? `baseline-${datePart}.md`
      : `m1-exit-gate-${datePart}-${fixture.runId}.md`
    const reportPath = resolve(process.cwd(), harness.reportDir, fileName)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, report, 'utf8')

    console.info(`\n${report}`)
    console.info(`[harness] report → ${reportPath}`)

    exitCode = metrics.pass ? 0 : 1
  } catch (err) {
    console.error(
      `[harness] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    )
    exitCode = 2
  } finally {
    if (fixture) await cleanupFixture(db, fixture)
    await db.end()
  }

  return exitCode
}

main().then((code) => {
  process.exit(code)
})
