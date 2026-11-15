#!/usr/bin/env node
import { ConfigError } from './config.js';
import { main } from './app.js';

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    process.stderr.write(`Configuration error: ${err.message}\nSee .env.example for all settings.\n`);
  } else {
    process.stderr.write(`Fatal: ${(err as Error).stack ?? String(err)}\n`);
  }
  process.exit(1);
});
