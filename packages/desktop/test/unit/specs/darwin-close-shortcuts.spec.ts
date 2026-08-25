import { describe, expect, it } from 'vitest'
import keybindingsDarwin from 'main_renderer/keyboard/keybindingsDarwin'

describe('macOS close shortcuts', () => {
  it('routes Command+W through the tab-aware close action', () => {
    expect(keybindingsDarwin.get('file.close-tab')).toBe('Command+W')
    expect(keybindingsDarwin.get('file.close-window')).toBe('Command+Shift+W')
  })
})
