import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

interface ProductionCheckout {
  status: string
  head: string
  originMain: string
}

export function assertProductionCheckout(checkout: ProductionCheckout): void {
  if (checkout.status.trim()) throw new Error('site deploy refused: the checkout has uncommitted or untracked files')

  const head = checkout.head.trim()
  const originMain = checkout.originMain.trim()
  if (!head || !originMain || head !== originMain) {
    throw new Error(`site deploy refused: HEAD ${head || '(missing)'} is not origin/main ${originMain || '(missing)'}`)
  }
}

const run = (command: string, args: string[], stdio: 'pipe' | 'inherit' = 'inherit') =>
  execFileSync(command, args, { cwd: ROOT, encoding: stdio === 'pipe' ? 'utf8' : undefined, stdio })

export function deploySite(): void {
  // Refresh the production ref before checking it; a stale local origin/main is not release proof.
  run('git', ['fetch', '--quiet', 'origin', 'refs/heads/main:refs/remotes/origin/main'])
  assertProductionCheckout({
    status: run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], 'pipe') as string,
    head: run('git', ['rev-parse', 'HEAD'], 'pipe') as string,
    originMain: run('git', ['rev-parse', 'origin/main'], 'pipe') as string,
  })
  run('pnpm', ['site:build'])
  run('pnpm', ['exec', 'wrangler', 'pages', 'deploy', 'site/dist', '--project-name=playbardo', '--branch=main'])
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) deploySite()
