import { defineConfig, type Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { cp } from 'node:fs/promises'
import { resolve } from 'node:path'

const RUNTIME_ASSETS = fileURLToPath(new URL('./public/assets', import.meta.url))

// Release asset boundary. public/ holds two very different things: the ~1.3MB of atlases, fonts and
// audio the game fetches from /assets/, and public/progress/ -- 125MB of gauntlet evidence (including
// an 83MB reference video) that the dev server must keep serving and a release build must never
// contain. Vite's publicDir is all-or-nothing, so it is switched OFF for `command === 'build'` and
// only public/assets is copied by hand. With publicDir false every code path that can reach public/
// during a build is dead, so this prevents the copy rather than cleaning up after it.
// `vite dev` and `vite preview` both resolve config with command 'serve', so the progress-index
// middleware below and every /progress and /assets request in dev are untouched.
function runtimeAssets(): Plugin {
  let dest = ''
  return {
    name: 'bardo-runtime-assets',
    apply: 'build',
    configResolved(config) { dest = resolve(config.root, config.build.outDir, 'assets') },
    // closeBundle, not writeBundle: it runs once after the bundle and its sourcemaps are on disk, so
    // the copy MERGES into dist/assets (which the bundle shares) instead of racing or being wiped.
    async closeBundle() { await cp(RUNTIME_ASSETS, dest, { recursive: true }) },
  }
}

export default defineConfig(({ command }) => ({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  publicDir: command === 'build' ? false : 'public',
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
  }, runtimeAssets()],
  build: { target: 'es2022', sourcemap: true },
}))
