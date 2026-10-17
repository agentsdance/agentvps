import fs from 'node:fs/promises';
await fs.rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
