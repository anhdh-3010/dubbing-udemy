import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // No top-level `use.headless` here: the one test in this suite loads the
  // built extension via chromium.launchPersistentContext() directly, which
  // is a raw Playwright API call, not the `browser`/`context`/`page`
  // fixtures the `test` function provides — Playwright never reads `use`
  // for that call. Setting `use.headless` here would look like it controls
  // the run and silently not. The real switch is the HEADLESS constant in
  // tests/e2e/dubbing.spec.ts.
  webServer: {
    command: 'node scripts/serve-fixtures.mjs',
    port: 5599,
    reuseExistingServer: !process.env.CI,
  },
})
