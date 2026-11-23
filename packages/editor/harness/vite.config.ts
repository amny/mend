// Test harness for the editor package (Playwright E2E). Serves fixtures/ byte for byte at /fixtures/<name>.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url))

const serveFixtures = (): Plugin => ({
  name: 'mend-serve-fixtures',
  configureServer(server) {
    server.middlewares.use('/fixtures/', (req, res, next) => {
      const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0] ?? '')
      if (!/^[\w.-]+\.html$/.test(name)) {
        next()
        return
      }
      readFile(fixturesDir + name).then(
        (bytes) => {
          res.setHeader('content-type', 'application/octet-stream')
          res.end(bytes)
        },
        (error: unknown) => {
          res.statusCode = 404
          res.end(`fixture not found: ${name} (${String(error)})`)
        },
      )
    })
  },
})

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [serveFixtures()],
  server: { port: 5174, strictPort: true },
})
