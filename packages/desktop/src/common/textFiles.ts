// Pure filename policy shared by the main process, preload and renderer.
export const MARKDOWN_EXTENSIONS: readonly string[] = Object.freeze([
  'markdown', 'mdown', 'mkdn', 'md', 'mkd', 'mdwn', 'mdtxt', 'mdtext', 'mdx', 'mmd'
])

export const TEXT_EXTENSIONS: readonly string[] = Object.freeze([
  'txt', 'text', 'sql', 'log', 'csv', 'tsv', 'json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg'
])

export const EDITABLE_EXTENSIONS: readonly string[] = Object.freeze([
  ...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS
])

export const hasTextExtension = (filename: string): boolean =>
  TEXT_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(`.${ext}`))

export const hasEditableExtension = (filename: string): boolean =>
  EDITABLE_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(`.${ext}`))
