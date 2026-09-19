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
})
