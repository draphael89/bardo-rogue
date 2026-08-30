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

type RunCommand = (command: string, args: string[], stdio?: 'pipe' | 'inherit') => string | void

const run: RunCommand = (command, args, stdio = 'inherit') => {
  if (stdio === 'pipe') return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio })
  execFileSync(command, args, { cwd: ROOT, stdio })
}

function verifyProductionCheckout(runCommand: RunCommand): void {
  // Refresh the production ref before checking it; a stale local origin/main is not release proof.
  runCommand('git', ['fetch', '--quiet', 'origin', 'refs/heads/main:refs/remotes/origin/main'])
  assertProductionCheckout({
    status: runCommand('git', ['status', '--porcelain=v1', '--untracked-files=normal'], 'pipe') as string,
    head: runCommand('git', ['rev-parse', 'HEAD'], 'pipe') as string,
    originMain: runCommand('git', ['rev-parse', 'origin/main'], 'pipe') as string,
  })
}

export function deploySite(runCommand: RunCommand = run): void {
  verifyProductionCheckout(runCommand)
  runCommand('pnpm', ['site:build'])
  // Building is intentionally outside the first check. Refresh again so a main commit that lands
  // during the build cannot be published over the newer production source.
  verifyProductionCheckout(runCommand)
  runCommand('pnpm', ['exec', 'wrangler', 'pages', 'deploy', 'site/dist', '--project-name=playbardo', '--branch=main'])
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) deploySite()
