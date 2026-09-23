import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const scriptPath = new URL('./install-local-macos.sh', import.meta.url)

async function fixture (t, { config = true, runner = true, collectionExit = 0 } = {}) {
  // A separate tree (including spaces) keeps every case away from the real
  // build and app. Even the success case uses --dry-run after collection.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'marktext install-preflight-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const desktop = path.join(root, 'packages/desktop')
  const bin = path.join(desktop, 'node_modules/.bin')
  const script = path.join(root, 'scripts/install-local-macos.sh')
  const log = path.join(root, 'collection.log')
  await fs.mkdir(bin, { recursive: true })
  await fs.mkdir(path.dirname(script), { recursive: true })
  await fs.copyFile(scriptPath, script)
  if (config) await fs.writeFile(path.join(desktop, 'playwright.config.ts'), '// fixture')
  if (runner) {
    await fs.writeFile(path.join(bin, 'playwright'), `#!/usr/bin/env bash
printf '%s\\n' "$PWD" "$MARKTEXT_E2E_EXECUTABLE" "$@" > "$PREFLIGHT_LOG"
if [[ "$COLLECTION_EXIT" != 0 ]]; then
  echo 'No tests found' >&2
fi
exit "$COLLECTION_EXIT"
`, { mode: 0o755 })
  }
  return {
    desktop,
    log,
    run: (...specs) => execFileAsync('bash', [script, '--dry-run', ...specs], {
      cwd: root,
      env: {
        ...process.env,
        MARKTEXT_INSTALL_ARCH: 'arm64',
        PREFLIGHT_LOG: log,
        COLLECTION_EXIT: String(collectionExit)
      }
    })
  }
}

function noInstallSteps (error) {
  assert.doesNotMatch(error.stdout, /electron-vite|electron-builder|\+ mv|\+ cp/)
  return true
}

test('missing config fails before collection, build or app replacement', async t => {
  const setup = await fixture(t, { config: false })
  await assert.rejects(setup.run('case.spec.ts'), error => {
    assert.equal(error.code, 2)
    assert.match(error.stderr, /Playwright config not found/)
    return noInstallSteps(error)
  })
  await assert.rejects(fs.access(setup.log), { code: 'ENOENT' })
})

test('missing Playwright executable fails without any install steps', async t => {
  const setup = await fixture(t, { runner: false })
  await assert.rejects(setup.run('case.spec.ts'), error => {
    assert.equal(error.code, 2)
    assert.match(error.stderr, /Playwright executable not found/)
    return noInstallSteps(error)
  })
})

test('test collection failure propagates before build or app replacement', async t => {
  const setup = await fixture(t, { collectionExit: 1 })
  await assert.rejects(setup.run('missing.spec.ts'), error => {
    assert.equal(error.code, 1)
    assert.match(error.stderr, /No tests found/)
    return noInstallSteps(error)
  })
  assert.match(await fs.readFile(setup.log, 'utf8'), /--list\nmissing\.spec\.ts\n$/)
})

test('dry run collects the exact filters from the desktop package before printing install steps', async t => {
  const setup = await fixture(t)
  const { stdout } = await setup.run('first.spec.ts', 'second case.spec.ts')
  assert.deepEqual((await fs.readFile(setup.log, 'utf8')).trimEnd().split('\n'), [
    setup.desktop,
    '/Applications/MarkText.app/Contents/MacOS/marktext',
    'test',
    `--config=${setup.desktop}/playwright.config.ts`,
    '--list',
    'first.spec.ts',
    'second case.spec.ts'
  ])
  assert.match(stdout, /electron-vite/)
  assert.match(stdout, /Dry run complete/)
})
