import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const releaseDirectory = resolve('release')
const expectNotarized = process.argv.includes('--notarized')
const expectedTeamIdentifier = 'YF9662K2Y4'
const expectedBundleIdentifier = 'com.bardorogue.game'
const expectedAuthority = 'Authority=Developer ID Application: Infinity Growth Digital, Inc. (YF9662K2Y4)'

function fail(message: string): never {
  throw new Error(message)
}

function shellQuote(value: string): string {
  return JSON.stringify(value)
}

function run(command: string, args: string[], capture = false): string {
  console.log(`$ ${command} ${args.map(shellQuote).join(' ')}`)
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })

  if (result.error) fail(`${command} failed to start: ${result.error.message}`)
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    fail(`${command} exited with status ${result.status}${output ? `:\n${output}` : ''}`)
  }

  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function findMainApps(directory: string): string[] {
  const matches: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && entry.name === 'Bardo Rogue.app') {
      matches.push(path)
    } else if (entry.isDirectory() && !entry.name.endsWith('.app')) {
      matches.push(...findMainApps(path))
    }
  }
  return matches
}

function oneArtifact(extension: string): string {
  const matches = readdirSync(releaseDirectory)
    .filter((name) => name.endsWith(extension))
    .map((name) => join(releaseDirectory, name))
  if (matches.length !== 1) {
    fail(`Expected exactly one ${extension} artifact in ${releaseDirectory}, found ${matches.length}`)
  }
  return matches[0]
}

function plistValue(infoPlist: string, key: string): string {
  return run('plutil', ['-extract', key, 'raw', '-o', '-', infoPlist], true).trim()
}

function assertIncludes(output: string, expected: string, label: string): void {
  if (!output.includes(expected)) fail(`${label} is missing ${expected}`)
}

function verifySigningDetails(path: string, label: string): void {
  const signingDetails = run('codesign', ['-dvvv', '--entitlements', ':-', path], true)
  assertIncludes(signingDetails, expectedAuthority, `${label} signature`)
  assertIncludes(signingDetails, `TeamIdentifier=${expectedTeamIdentifier}`, `${label} signature`)
  if (!/flags=.*\bruntime\b/.test(signingDetails)) fail(`${label} signature is missing Hardened Runtime`)
  assertIncludes(signingDetails, 'com.apple.security.cs.allow-jit', `${label} entitlements`)
  assertIncludes(signingDetails, 'com.apple.security.cs.allow-unsigned-executable-memory', `${label} entitlements`)
  if (signingDetails.includes('com.apple.security.cs.allow-dyld-environment-variables')) {
    fail(`${label} entitlements unexpectedly allow DYLD environment variables`)
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function verifyPackagedCopy(path: string, label: string): void {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', path])
  verifySigningDetails(path, label)
  if (expectNotarized) {
    run('xcrun', ['stapler', 'validate', path])
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', path])
  }
}

if (!existsSync(releaseDirectory)) fail(`Release directory does not exist: ${releaseDirectory}`)

const apps = findMainApps(releaseDirectory)
if (apps.length !== 1) fail(`Expected exactly one Bardo Rogue.app, found ${apps.length}`)

const app = apps[0]
const dmg = oneArtifact('.dmg')
const zip = oneArtifact('.zip')
const infoPlist = join(app, 'Contents', 'Info.plist')

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
verifySigningDetails(app, 'Main app')

const helperDirectory = join(app, 'Contents', 'Frameworks')
const helpers = readdirSync(helperDirectory)
  .filter((name) => name.startsWith('Bardo Rogue Helper') && name.endsWith('.app'))
  .map((name) => join(helperDirectory, name))
if (helpers.length !== 4) fail(`Expected four signed Electron helper apps, found ${helpers.length}`)
for (const helper of helpers) {
  verifySigningDetails(helper, basename(helper))
}

const bundleIdentifier = plistValue(infoPlist, 'CFBundleIdentifier')
if (bundleIdentifier !== expectedBundleIdentifier) {
  fail(`Expected bundle identifier ${expectedBundleIdentifier}, found ${bundleIdentifier}`)
}

const executableName = plistValue(infoPlist, 'CFBundleExecutable')
const executable = join(app, 'Contents', 'MacOS', executableName)
if (!existsSync(executable)) fail(`Bundle executable does not exist: ${executable}`)
const architectures = run('lipo', ['-archs', executable], true).trim().split(/\s+/)
if (architectures.length !== 1 || architectures[0] !== 'arm64') {
  fail(`Expected an arm64-only executable, found: ${architectures.join(' ')}`)
}

const iconName = plistValue(infoPlist, 'CFBundleIconFile')
const icon = join(app, 'Contents', 'Resources', iconName)
if (!existsSync(icon)) fail(`Configured app icon does not exist in the bundle: ${icon}`)

run('hdiutil', ['verify', dmg])
run('unzip', ['-tqq', zip])

const archiveCheckDirectory = mkdtempSync(join(tmpdir(), 'bardo-release-verify-'))
const zipDirectory = join(archiveCheckDirectory, 'zip')
const dmgDirectory = join(archiveCheckDirectory, 'dmg')
let dmgAttached = false
try {
  mkdirSync(zipDirectory)
  run('unzip', ['-q', zip, '-d', zipDirectory])
  verifyPackagedCopy(join(zipDirectory, 'Bardo Rogue.app'), 'ZIP app')

  mkdirSync(dmgDirectory)
  run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', dmgDirectory, dmg])
  dmgAttached = true
  const dmgApp = join(dmgDirectory, 'Bardo Rogue.app')
  verifyPackagedCopy(dmgApp, 'DMG app')
} finally {
  if (dmgAttached) run('hdiutil', ['detach', dmgDirectory])
  rmSync(archiveCheckDirectory, { recursive: true, force: true })
}

if (expectNotarized) {
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app])
  run('xcrun', ['stapler', 'validate', app])
} else {
  console.log('Notarization checks skipped. Use pnpm desktop:verify:notarized for release artifacts.')
}

const checksumLines = await Promise.all(
  [dmg, zip].map(async (path) => `${await sha256(path)}  ${basename(path)}`),
)
const checksumFile = join(releaseDirectory, 'SHA256SUMS.txt')
writeFileSync(checksumFile, `${checksumLines.join('\n')}\n`)

console.log(`Verified ${app}`)
console.log(`Wrote ${checksumFile}`)
