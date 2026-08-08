import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the `@/*` -> `./src/*` mapping in jsconfig.json.
      '@': path.resolve(rootDir, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Placeholder Supabase credentials. Several modules construct the Supabase
    // client at import time and throw without these. No network call is made —
    // these tests only exercise pure logic.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example-test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
