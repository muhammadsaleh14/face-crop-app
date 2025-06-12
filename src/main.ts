// src/main.ts
import { ViteSSG, type ViteSSGContext } from 'vite-ssg'
import { createHead } from '@vueuse/head'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/main.css'

// The `ViteSSG` function is the new entry point for your app.
// It handles both development and build modes correctly.
export const createApp = ViteSSG(
  // 1st argument: The root Vue component
  App,

  // 2nd argument: Router options. For a simple SPA, an empty routes array is fine.
  // Vite-SSG will automatically create a '/' route for your App component.
  { routes: [] },

  // 3rd argument: A setup function where you install plugins.
  // We use `ViteSSGContext` to get proper type inference for the 'app' property.
  ({ app }: ViteSSGContext) => {
    // This is where you install Vue plugins, just like you did before.
    const head = createHead()
    const pinia = createPinia()

    app.use(head)
    app.use(pinia)
  },
)
