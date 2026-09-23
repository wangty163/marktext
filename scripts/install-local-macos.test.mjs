import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const scriptPath = new URL('./install-local-macos.sh', import.meta.url)

async function fixture (t, {
  config = true, runner = true, collectionExit = 0,
  processes = '', processExit = 0, reopened = false
} = {}) {
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
  const mockBin = path.join(root, 'mock-bin')
  const processLog = path.join(root, 'process-check.log')
  await fs.mkdir(mockBin)
  await fs.writeFile(path.join(mockBin, 'ps'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$PROCESS_LOG"
if [[ "$PROCESS_EXIT" != 0 ]]; then exit "$PROCESS_EXIT"; fi
if [[ "$REOPENED" == true && $(wc -l < "$PROCESS_LOG") -gt 1 ]]; then
  printf '  456 /Applications/MarkText.app/Contents/MacOS/marktext\\n'
else
  printf '%s\\n' "$PROCESSES"
fi
`, { mode: 0o755 })
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
  const runArgs = (...args) => execFileAsync('bash', [script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${mockBin}${path.delimiter}${process.env.PATH}`,
      PROCESS_LOG: processLog,
      PROCESSES: processes,
      PROCESS_EXIT: String(processExit),
      REOPENED: String(reopened),
      MARKTEXT_INSTALL_ARCH: 'arm64',
      PREFLIGHT_LOG: log,
      COLLECTION_EXIT: String(collectionExit)
    }
  })
  return {
    desktop,
    log,
    processLog,
    runArgs,
    run: (...specs) => runArgs('--dry-run', ...specs)
  }
}

function noInstallSteps (error) {
  assert.doesNotMatch(error.stdout, /electron-vite|electron-builder|\+ mv|\+ cp/)
  return true
}

test('help exits without configuration, test collection or process inspection', async t => {
  const setup = await fixture(t, { config: false, runner: false, processExit: 1 })
  for (const args of [['--help'], ['-h'], ['--dry-run', '--help'], ['case.spec.ts', '--help']]) {
    const result = await setup.runArgs(...args)
    assert.match(result.stdout, /Usage: scripts\/install-local-macos\.sh/)
    assert.equal(result.stderr, '')
    noInstallSteps(result)
  }
  await assert.rejects(fs.access(setup.log), { code: 'ENOENT' })
  await assert.rejects(fs.access(setup.processLog), { code: 'ENOENT' })
})

test('unknown options cannot bypass required test collection or change the output location', async t => {
  const setup = await fixture(t)
  for (const option of ['--pass-with-no-tests', '--output=/tmp/other', '--dryrun']) {
    await assert.rejects(setup.run('case.spec.ts', option), error => {
      assert.equal(error.code, 2)
      assert.match(error.stderr, /Unknown option/)
      return noInstallSteps(error)
    })
  }
  await assert.rejects(fs.access(setup.log), { code: 'ENOENT' })
  await assert.rejects(fs.access(setup.processLog), { code: 'ENOENT' })
})

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
  assert.deepEqual((await fs.readFile(setup.processLog, 'utf8')).trim().split('\n'), [
    '-axo pid=,comm=', '-axo pid=,comm='
  ])
})

test('running installed main process fails before build or replacement', async t => {
  const setup = await fixture(t, {
    processes: '  123 /Applications/MarkText.app/Contents/MacOS/marktext'
  })
  await assert.rejects(setup.run('case.spec.ts'), error => {
    assert.equal(error.code, 3)
    assert.match(error.stderr, /still running \(PID: 123\).*quit normally/)
    return noInstallSteps(error)
  })
})

test('unavailable process snapshot fails closed before build or replacement', async t => {
  const setup = await fixture(t, { processExit: 1 })
  await assert.rejects(setup.run('case.spec.ts'), error => {
    assert.equal(error.code, 3)
    assert.match(error.stderr, /Cannot inspect running applications/)
    return noInstallSteps(error)
  })
})

test('another executable or a command mentioning the app path does not block installation', async t => {
  const setup = await fixture(t, {
    processes: [
      '  123 /tmp/MarkText.app/Contents/MacOS/marktext',
      '  124 /bin/sh /Applications/MarkText.app/Contents/MacOS/marktext',
      '  125 /Applications/MarkText.app/Contents/MacOS/marktext-other'
    ].join('\n')
  })
  const { stdout } = await setup.run('case.spec.ts')
  assert.match(stdout, /Dry run complete/)
})

test('an app reopened during packaging blocks replacement at the second check', async t => {
  const setup = await fixture(t, { reopened: true })
  await assert.rejects(setup.run('case.spec.ts'), error => {
    assert.equal(error.code, 3)
    assert.match(error.stdout, /electron-builder/)
    assert.doesNotMatch(error.stdout, /\+ mv|\+ cp/)
    assert.match(error.stderr, /still running \(PID: 456\)/)
    return true
  })
})
