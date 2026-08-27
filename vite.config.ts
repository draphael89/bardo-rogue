import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: true },
  preview: { host: true },
  plugins: [{
    name: 'progress-index',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/progress' || req.url === '/progress/') req.url = '/progress/index.html'
        next()
      })
    },
  }],
  build: { target: 'es2022', sourcemap: true },
})
