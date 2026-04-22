import { createTelegramBot } from '@bluecairn/integrations/telegram'
import { env } from '../env.js'

/**
 * Module-singleton grammY `Bot` used by the webhook route to call
 * `answerCallbackQuery` on inline-button taps (BLU-24). One instance per
 * process is intentional — grammY holds no connection state for simple
 * REST calls and a shared instance keeps cross-package bot config in one
 * factory (`@bluecairn/integrations/telegram`).
 */
export const bot = createTelegramBot(env.TELEGRAM_BOT_TOKEN)
