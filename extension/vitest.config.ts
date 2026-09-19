import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/player/**', 'src/entrypoints/**'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          include: ['src/player/**/*.test.ts', 'src/entrypoints/**/*.test.ts'],
          environment: 'jsdom',
          // jsdom@27's dependency chain (parse5, @asamuzakjp/css-color) ships
          // ESM-only builds that Node 20.17's worker `require()` cannot load
          // without this flag. Node >=20.19 supports require(esm) natively;
          // this can be dropped once the toolchain's Node is upgraded past that.
          execArgv: ['--experimental-require-module', '--disable-warning=ExperimentalWarning'],
        },
      },
    ],
  },
})
