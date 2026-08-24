import { describe, expect, it } from 'vitest'
import keybindingsDarwin from 'main_renderer/keyboard/keybindingsDarwin'

describe('macOS close shortcuts', () => {
  it('closes the window with Command+W', () => {
    expect(keybindingsDarwin.get('file.close-window')).toBe('Command+W')
    expect(keybindingsDarwin.get('file.close-tab')).toBe('Command+Shift+W')
  })
})
