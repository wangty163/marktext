# Obsidian comparison baseline

Audited on 2026-08-25 on macOS (Apple Silicon): MarkText `0.20.0-dev` and
Obsidian `1.13.4`. The comparison used the same temporary vault, including
English/CJK filenames, nested folders, hidden files, front matter, Markdown
links, wiki links, highlight syntax, task lists, tables, code, math, Mermaid,
raw HTML, and unsafe HTML. MarkText was also exercised by its desktop unit,
Electron E2E, Muya unit, type, lint, build, package, and installed-app checks.

This is a product comparison, not the existing muyajs migration scoreboard.
“Comparable” means the common user outcome is covered; it does not imply an
identical UI.

## Results

| Area | MarkText result | Compared with Obsidian | Evidence / next gap |
|---|---|---|---|
| Launch and folder opening | Comparable | Both open a local folder/vault without conversion | Manual same-folder run; `launch.spec.ts`, `close-folder.spec.ts` |
| File tree and nested/CJK files | Comparable | Both browse nested Markdown files and CJK names | Manual same-folder run; `new-file-collapsed-folder-3439.spec.ts` |
| Hidden files | Different default | MarkText exposes dotfiles; Obsidian hides them by default | Manual `.hidden-note.md` check; decide via a preference only if users ask |
| Tabs and dirty state | Comparable | MarkText has multi-tab switching, close actions, overflow, per-tab cursor/scroll/undo, and saved indicators | `tabs.spec.ts`, `tab-switch-cursor.spec.ts`, `parity-source-undo-saved.spec.ts` |
| External file changes | Comparable | Reload and undo remain safe | `external-reload-undo.spec.ts`, `issue-1861-filechange.spec.ts` |
| WYSIWYG and source editing | Comparable | MarkText offers WYSIWYG, source, focus, and typewriter modes; Obsidian offers source/live preview/reading views | `view-modes.spec.ts`, source-mode E2E suite |
| Common Markdown | Comparable | Headings, emphasis, strike, quotes, lists, tasks, rules, code, links, and images render and round-trip | Same-document manual run; `all-blocks-roundtrip.spec.ts`, `fixture-render.spec.ts` |
| GFM tables and task lists | Comparable | Both support tables and interactive tasks | Table/list unit suites; `task-list-autocheck.spec.ts` |
| Obsidian `==highlight==` | Comparable after this audit | MarkText now parses it live, preserves source, exports `<mark>`, and honors escapes/nesting | `markHighlight.spec.ts` |
| CJK and inline boundaries | Comparable | CJK bold and locale-sensitive heading paths are covered | `strong-cjk.spec.ts`, `parity-cursor-lang.spec.ts` |
| Math | Comparable | Inline/block math render; source underscores remain literal | `source-math.spec.ts` and Muya math tests |
| Diagrams | Comparable or broader | Mermaid works in both; MarkText also has PlantUML and additional diagram integrations | Manual Mermaid run; `plantuml.spec.ts` |
| Front matter / properties | Partial | MarkText preserves and edits raw front matter; Obsidian adds typed Properties UI | Manual same-document run; `frontMatter.spec.ts`; typed property editor is P2 |
| Standard Markdown links | Comparable | Both open standard links and heading anchors | Link unit suite; anchor-copy/scroll E2E |
| Wiki links | Missing | Obsidian resolves `[[note]]`, aliases, headings, and blocks; MarkText currently treats them as text | P1 knowledge-link foundation |
| Rename-safe links | Missing | Obsidian can update internal links after rename | Build only after wiki-link resolution exists |
| Backlinks / unlinked mentions | Missing | Obsidian maintains incoming-link context | P1 after a vault link index exists |
| Outline / TOC | Comparable | Both expose heading navigation and live updates | `toc-panel-content.spec.ts`, `toc-scroll.spec.ts`, `source-toc-scroll.spec.ts` |
| In-document find/replace | Comparable | Find, replace, counts, selection prefill, and reopen behavior are covered | `find-replace.spec.ts`, `find-reopen-select-3458.spec.ts` |
| Vault text/file search | Comparable for local search | MarkText streams ripgrep text and file results; Obsidian adds richer query operators and property search | `ripgrep-search.spec.ts`; advanced query grammar is P2 |
| Quick open / command palette | Comparable | Both provide keyboard-first navigation/actions | `command-palette.spec.ts`, menu sanity E2E |
| Editing commands and menus | Comparable | Paragraph/format/menu state, shortcuts, table wizard, and quick insert are covered | Paragraph/menu/accelerator E2E; loose-list source-gap semantics corrected in this audit |
| Images | Partial | Relative paths, edit tools, viewer, paste, and drag/drop engine paths exist; real OS bitmap clipboard and file drag remain manual QA | Image E2E/unit suites; `PARITY_QA.md` |
| Export | Strong | MarkText exports offline-styled HTML and PDF with working heading anchors | Export unit suite; `export-pdf.spec.ts` |
| Themes and preferences | Comparable at editor level | Light/dark themes, code colors, layout, typography, Markdown, image, and spellcheck preferences exist | `themes.spec.ts`, `layout-toggles.spec.ts`, preference unit suites |
| Internationalization | Comparable for supported locales | Shell and editor locale refresh are covered | `i18n-shell.spec.ts`, locale unit tests |
| Accessibility | Partial / unscored | Keyboard menus and native semantics work, but no complete WCAG/VoiceOver audit was found | P1 manual VoiceOver, focus-order, contrast, and reduced-motion pass |
| Security | Comparable baseline | Raw scripts remain inert; context isolation and XSS regressions are covered | Manual malicious fixture; `xss.spec.ts`, `context-isolation.spec.ts` |
| Crash/recovery resilience | Strong automated baseline | Selection, paragraph conversion, history, and source-mode crash paths have regressions | crash E2E suite and Muya history tests |
| Large vault / large note performance | Unscored | No repeatable MarkText-vs-Obsidian benchmark exists yet | P1 benchmark startup, search, 10k files, 1 MB note, typing latency, and memory |
| Split panes and saved workspaces | Missing | Obsidian supports a composable multi-pane workspace; MarkText is tab-centric | P2 only if knowledge-workspace parity is the goal |
| Embeds and callouts | Missing/partial | Obsidian supports note/block embeds and callouts beyond standard Markdown images | P2 after internal links |
| Graph and local graph | Missing | Obsidian visualizes the link index | P3; depends on the P1 link index |
| Canvas and Bases | Missing | Obsidian includes structured visual/database surfaces | P3 separate projects, not editor-completion blockers |
| Templates, daily notes, bookmarks | Missing | Obsidian ships these as core plugins | P2 after the vault model |
| Community plugins and CSS snippets | Missing | Obsidian has a sandboxed extension ecosystem | Product-strategy decision; do not bolt this onto the editor ad hoc |
| Sync, Publish, mobile apps | Out of desktop-editor scope | Obsidian sells cross-device and publishing services | Separate products, not local editing defects |

Obsidian reference behavior is defined by its current official documentation:
[basic formatting](https://obsidian.md/help/Editing%2Band%2Bformatting/Basic%2Bformatting%2Bsyntax),
[internal links](https://obsidian.md/help/Linking%2Bnotes%2Band%2Bfiles/Internal%2Blinks),
and [properties](https://obsidian.md/help/Editing%2Band%2Bformatting/Properties).

## Completion target

“As complete as Obsidian” should be delivered in layers:

1. **Editor completion (P0/P1):** keep all current suites green; finish OS image
   manual QA, accessibility, and repeatable performance benchmarks. The
   Obsidian highlight syntax gap found in this audit is now closed.
2. **Knowledge-link completion (P1):** wiki-link parsing/autocomplete, one vault
   link index, rename-safe updates, backlinks, and heading/block targets. This
   shared foundation closes several high-frequency gaps without duplicate
   implementations.
3. **Metadata/workspace completion (P2):** typed properties, richer search,
   embeds/callouts, templates/daily notes/bookmarks, then split panes/workspaces.
4. **Separate product surfaces (P3):** graph, Canvas/Bases, plugins, sync,
   publishing, and mobile. Each needs an explicit product decision and should
   not block declaring the Markdown editor itself complete.

The next implementation should be the P1 link index, not Graph UI: wiki links,
rename updates, and backlinks all need that same data, while a graph without it
would be a disconnected second implementation.
