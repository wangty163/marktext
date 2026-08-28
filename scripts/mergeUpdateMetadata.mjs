import fs from 'node:fs/promises'

const [, , outputPath, ...inputPaths] = process.argv

if (!outputPath || inputPaths.length < 2) {
  throw new Error(
    'Usage: node scripts/mergeUpdateMetadata.mjs <output> <base-manifest> <manifest> [...]'
  )
}

const parseManifest = async (manifestPath) => {
  const source = await fs.readFile(manifestPath, 'utf8')
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const versionLine = lines.find((line) => line.startsWith('version:'))
  const filesStart = lines.findIndex((line) => line === 'files:')

  if (!versionLine || filesStart === -1) {
    throw new Error(`Invalid electron-builder update manifest: ${manifestPath}`)
  }

  let filesEnd = filesStart + 1
  while (filesEnd < lines.length && (lines[filesEnd].startsWith(' ') || !lines[filesEnd])) {
    filesEnd += 1
  }

  const fileLines = lines.slice(filesStart + 1, filesEnd)
  if (!fileLines.some((line) => line.startsWith('  - url:'))) {
    throw new Error(`No update files found in manifest: ${manifestPath}`)
  }

  return {
    manifestPath,
    lines,
    version: versionLine.slice('version:'.length).trim(),
    filesStart,
    filesEnd,
    fileLines
  }
}

const manifests = await Promise.all(inputPaths.map(parseManifest))
const [baseManifest] = manifests

for (const manifest of manifests.slice(1)) {
  if (manifest.version !== baseManifest.version) {
    throw new Error(
      `Cannot merge update metadata for different versions: ${baseManifest.version} and ${manifest.version}`
    )
  }
}

const seenUrls = new Set()
const mergedFileLines = []

for (const manifest of manifests) {
  let entry = []

  const flushEntry = () => {
    if (!entry.length) return

    const urlLine = entry.find((line) => line.startsWith('  - url:'))
    const url = urlLine?.slice('  - url:'.length).trim()
    if (!url) {
      throw new Error(`Malformed update file entry in manifest: ${manifest.manifestPath}`)
    }
    if (seenUrls.has(url)) {
      throw new Error(`Duplicate update file URL while merging metadata: ${url}`)
    }

    seenUrls.add(url)
    mergedFileLines.push(...entry)
    entry = []
  }

  for (const line of manifest.fileLines) {
    if (line.startsWith('  - url:')) flushEntry()
    if (line || entry.length) entry.push(line)
  }
  flushEntry()
}

const outputLines = [...baseManifest.lines]
outputLines.splice(
  baseManifest.filesStart + 1,
  baseManifest.filesEnd - baseManifest.filesStart - 1,
  ...mergedFileLines
)

await fs.writeFile(outputPath, `${outputLines.join('\n').replace(/\n+$/, '')}\n`)

for (const inputPath of inputPaths) {
  if (inputPath !== outputPath) await fs.unlink(inputPath)
}
