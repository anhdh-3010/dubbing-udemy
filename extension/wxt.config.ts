import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Udemy Dubbing',
    description: 'Lồng tiếng Việt cho bài giảng Udemy theo thời gian thực',
    permissions: ['storage'],
    host_permissions: [
      'https://www.udemy.com/*',
      'https://*.udemycdn.com/*',
      'http://127.0.0.1/*',
    ],
  },
  hooks: {
    // Only a `--mode e2e` build (see package.json's "test:e2e" script) gets
    // the local fixture origin added to every content script's `matches`.
    // Baking it into the `manifest.content_scripts` config above
    // unconditionally would ship a permanent grant that exists only for
    // tests/e2e/dubbing.spec.ts.
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.mode !== 'e2e') return
      for (const script of manifest.content_scripts ?? []) {
        script.matches ??= []
        script.matches.push('http://127.0.0.1:5599/*')
      }
    },
  },
})
