import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hasEditableExtension, hasTextExtension } from 'common/textFiles'
import { isEditableFile } from 'common/filesystem/paths'

describe('editable text files', () => {
  it('distinguishes raw text from Markdown, rejecting binary extensions', () => {
    for (const file of ['query.SQL', 'notes.txt', 'data.json', 'settings.yaml', 'app.log']) {
      expect(hasEditableExtension(file)).toBe(true)
      expect(hasTextExtension(file)).toBe(true)
    }
    expect(hasEditableExtension('note.md')).toBe(true)
    expect(hasTextExtension('note.md')).toBe(false)
    for (const file of ['image.png', 'archive.zip', 'program.exe', 'note.sql.png']) {
      expect(hasEditableExtension(file)).toBe(false)
    }
  })

  it('accepts files and symlink targets but not directories or missing files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-text-policy-'))
    try {
      const file = path.join(dir, 'query.sql')
      fs.writeFileSync(file, 'SELECT 1;')
      const link = path.join(dir, 'shortcut')
      fs.symlinkSync(file, link)
      expect(isEditableFile(file)).toBe(true)
      expect(isEditableFile(link)).toBe(true)
      expect(isEditableFile(dir)).toBe(false)
      expect(isEditableFile(path.join(dir, 'missing.txt'))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
