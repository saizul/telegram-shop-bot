import type { Logger } from '../logger.js';
import { TelegramApiError, type TelegramApi } from '../telegram/api.js';
import type { AllowedUpdate, Update } from '../telegram/types.js';

export const ALLOWED_UPDATES: AllowedUpdate[] = ['message', 'callback_query'];

export interface PollingOptions {
  api: TelegramApi;
  handle: (update: Update) => Promise<void>;
  logger: Logger;
  /** Long-polling timeout in seconds. Default 30. */
  timeout?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  /** Stop after this many getUpdates calls (tests). */
  maxIterations?: number;
}

/**
 * Long polling loop: getUpdates with a moving offset. Updates of one batch are handled in
 * parallel (the bot serialises per user). Errors back off exponentially up to 30 s.
 */
export async function runPolling(options: PollingOptions): Promise<void> {
  const { api, handle, logger, signal } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // Polling and a webhook cannot be active together.
  await api.deleteWebhook({ drop_pending_updates: false });
  let offset: number | undefined;
  let failures = 0;
  for (let i = 0; !signal?.aborted && (options.maxIterations === undefined || i < options.maxIterations); i++) {
    try {
      const updates = await api.getUpdates(
        { ...(offset !== undefined ? { offset } : {}), timeout: options.timeout ?? 30, allowed_updates: ALLOWED_UPDATES },
        signal,
      );
      failures = 0;
      if (updates.length === 0) continue;
      offset = Math.max(...updates.map((u) => u.update_id)) + 1;
      await Promise.all(updates.map((u) => handle(u)));
    } catch (err) {
      if (signal?.aborted) break;
      failures++;
      const retryAfter = err instanceof TelegramApiError && err.retryAfter ? err.retryAfter * 1000 : 0;
      const delay = Math.max(retryAfter, Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)));
      logger.error('getUpdates failed', { error: (err as Error).message, retryInMs: delay });
      if (err instanceof TelegramApiError && err.errorCode === 409) {
        logger.error('another bot instance or a webhook is using this token');
      }
      await sleep(delay);
    }
  }
}
