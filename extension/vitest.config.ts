import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The environment split below is maintained as two hand-synced glob
    // lists: the node project's `exclude` and the jsdom project's `include`.
    // Every directory that needs a DOM must be listed in both places —
    // added to jsdom's `include` and to node's `exclude`. Forgetting the
    // `exclude` half does not drop the directory; it silently double-runs
    // its test files under both environments.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/player/**', 'src/entrypoints/**'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          include: ['src/player/**/*.test.ts', 'src/entrypoints/**/*.test.ts'],
          environment: 'jsdom',
        },
      },
    ],
  },
})
