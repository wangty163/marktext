import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const scriptPath = new URL('./mergeUpdateMetadata.mjs', import.meta.url)

const createManifest = (version, url, sha512) => `version: ${version}
files:
  - url: ${url}
    sha512: ${sha512}
    size: 123
path: ${url}
sha512: ${sha512}
releaseDate: '2026-08-28T00:00:00.000Z'
`

test('merges file entries and removes architecture-specific manifests', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marktext-update-metadata-'))
  const x64Path = path.join(directory, 'latest-x64.yml')
  const arm64Path = path.join(directory, 'latest-arm64.yml')
  const outputPath = path.join(directory, 'latest.yml')

  try {
    await Promise.all([
      fs.writeFile(x64Path, createManifest('1.2.3', 'marktext-win-x64-1.2.3-setup.exe', 'x64hash')),
      fs.writeFile(
        arm64Path,
        createManifest('1.2.3', 'marktext-win-arm64-1.2.3-setup.exe', 'arm64hash')
      )
    ])

    await execFileAsync(process.execPath, [scriptPath.pathname, outputPath, x64Path, arm64Path])

    const output = await fs.readFile(outputPath, 'utf8')
    assert.match(output, /url: marktext-win-x64-1\.2\.3-setup\.exe/)
    assert.match(output, /url: marktext-win-arm64-1\.2\.3-setup\.exe/)
    assert.match(output, /path: marktext-win-x64-1\.2\.3-setup\.exe/)
    await assert.rejects(fs.access(x64Path))
    await assert.rejects(fs.access(arm64Path))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('rejects manifests with different versions', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marktext-update-metadata-'))
  const x64Path = path.join(directory, 'latest-x64.yml')
  const arm64Path = path.join(directory, 'latest-arm64.yml')

  try {
    await Promise.all([
      fs.writeFile(x64Path, createManifest('1.2.3', 'x64.exe', 'x64hash')),
      fs.writeFile(arm64Path, createManifest('1.2.4', 'arm64.exe', 'arm64hash'))
    ])

    await assert.rejects(
      execFileAsync(process.execPath, [
        scriptPath.pathname,
        path.join(directory, 'latest.yml'),
        x64Path,
        arm64Path
      ]),
      /different versions/
    )
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
