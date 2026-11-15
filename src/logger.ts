export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One JSON object per line on stdout/stderr, easy to ship to any log collector. */
export function createLogger(level: LogLevel = 'info', write: (line: string, level: LogLevel) => void = defaultWrite): Logger {
  const min = ORDER[level];
  const log = (lvl: LogLevel) => (message: string, meta?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: lvl, message, ...meta }), lvl);
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

function defaultWrite(line: string, level: LogLevel): void {
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
