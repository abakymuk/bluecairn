import { Bot } from 'grammy'

/**
 * Single factory for grammY `Bot` instances. Consumers (apps/api webhook,
 * packages/mcp-servers comms) call this instead of `new Bot(...)` directly so
 * we have one place to add future config — timeouts, retry policy, HTTP
 * client swap, or a proxy layer — without touching every caller.
 *
 * Keep this module purely configurational: no network I/O at construction
 * time, no env reads (callers own their env). The factory should stay cheap
 * enough to call at module load.
 */
export const createTelegramBot = (token: string): Bot => {
  return new Bot(token)
}
