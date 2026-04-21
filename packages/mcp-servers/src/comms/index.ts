import { createDatabase } from '@bluecairn/db'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Bot } from 'grammy'
import { z } from 'zod'
import { sendMessage, type SendMessageDeps } from './tools/send-message.js'

/**
 * Comms MCP server — stdio transport entry (ADR-0003).
 *
 * Exposes `comms.send_message` as an MCP tool. In M1 the orchestrator +
 * Concierge run in-process in apps/workers and call `sendMessage` directly
 * (see `./tools/send-message.ts`). This stdio entry exists for standards
 * compliance and for future cross-process callers (third-party agents,
 * manual invocation via `mcp-inspector`, multi-tenant MCP routers, etc.).
 *
 * Run locally:
 *   doppler run --config dev -- bun run packages/mcp-servers/src/comms/index.ts
 * Then attach an MCP client (e.g. `npx @modelcontextprotocol/inspector`).
 */

const envSchema = z.object({
  DATABASE_URL_ADMIN: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
})

const env = envSchema.parse(process.env)

const deps: SendMessageDeps = {
  db: createDatabase(env.DATABASE_URL_ADMIN),
  bot: new Bot(env.TELEGRAM_BOT_TOKEN),
}

const server = new McpServer({
  name: 'bluecairn-comms',
  version: '0.1.0',
})

const inlineKeyboardButtonSchema = z.object({
  text: z.string().min(1),
  callback_data: z.string().min(1).optional(),
  url: z.string().url().optional(),
})

const inlineKeyboardMarkupSchema = z.object({
  inline_keyboard: z.array(z.array(inlineKeyboardButtonSchema)),
})

server.registerTool(
  'send_message',
  {
    title: 'Send Telegram message',
    description:
      'Send a text message (optionally with an inline keyboard) to the Telegram channel attached to the given thread. Idempotent on `idempotency_key`: a successful prior call returns the cached message id instead of re-sending.',
    inputSchema: {
      tenant_id: z.string().uuid(),
      thread_id: z.string().uuid(),
      text: z.string().min(1),
      reply_markup: inlineKeyboardMarkupSchema.optional(),
      idempotency_key: z.string().min(1),
      agent_run_id: z.string().uuid(),
      correlation_id: z.string().uuid(),
    },
  },
  async (args) => {
    const result = await sendMessage(deps, {
      tenantId: args.tenant_id,
      threadId: args.thread_id,
      text: args.text,
      ...(args.reply_markup !== undefined && { replyMarkup: args.reply_markup }),
      idempotencyKey: args.idempotency_key,
      agentRunId: args.agent_run_id,
      correlationId: args.correlation_id,
    })

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: {
                kind: result.error.kind,
                message: result.error.message,
                ...(result.error.telegramErrorKind !== undefined && {
                  telegram_error_kind: result.error.telegramErrorKind,
                }),
              },
            }),
          },
        ],
        isError: true,
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            tool_call_id: result.value.toolCallId,
            message_id: result.value.messageId,
            telegram_message_id: result.value.telegramMessageId,
            cached: result.value.cached,
          }),
        },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
