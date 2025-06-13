// vite.config.ts
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// By removing `defineConfig`, we can add custom properties like `ssgOptions`
// without TypeScript complaining. Vite will still understand this configuration perfectly.
export default {
  plugins: [vue(), vueDevTools()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // vite-ssg options are configured here
  ssgOptions: {
    // This tells vite-ssg which routes to prerender. For your app, it's just the homepage.
    includedRoutes: () => ['/'], // Wrap the array in a function
    // This will generate a sitemap.xml for you, which is great for SEO.
    sitemap: {
      // IMPORTANT: Replace this with your actual production domain!
      hostname: 'https://your-domain.com',
    },
  },

  base: process.env.NODE_ENV === 'production' ? '/' : '/',
}
