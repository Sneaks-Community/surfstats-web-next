import { afterEach, describe, expect, it, vi } from 'vitest';

const THEME_VARS = [
  'THEME_PRIMARY',
  'THEME_SECONDARY',
  'THEME_LIGHT_PRIMARY',
  'THEME_LIGHT_SECONDARY',
  'THEME_DARK_PRIMARY',
  'THEME_DARK_SECONDARY',
  'THEME_LIGHT_BACKGROUND',
  'THEME_DARK_BACKGROUND',
];

// The config is cached at module scope, so each case needs a fresh module.
async function styles(env: Record<string, string> = {}) {
  vi.resetModules();
  Object.assign(process.env, env);
  const { generateThemeStyles } = await import('../lib/theme-config');
  return generateThemeStyles();
}

afterEach(() => {
  for (const name of THEME_VARS) process.env[name] = '';
});

// SEC-3: these values are injected as CSS from the root layout, so an unknown
// family used to throw a TypeError and 500 every route.
describe('generateThemeStyles', () => {
  it('emits the emerald/cyan defaults with nothing set', async () => {
    const css = await styles();

    expect(css).toContain('--color-primary: #10b981');
    expect(css).not.toContain('undefined');
  });

  it('applies valid families', async () => {
    const css = await styles({ THEME_PRIMARY: 'blue', THEME_DARK_BACKGROUND: 'slate' });

    expect(css).toContain('--color-primary: #3b82f6');
    expect(css).not.toContain('undefined');
  });

  it('falls back to the default for unknown, mis-cased, or prototype values', async () => {
    for (const value of ['notacolor', 'Emerald', 'blue-500', 'constructor', 'toString', '']) {
      const css = await styles({ THEME_PRIMARY: value });

      expect(css, value).toContain('--color-primary: #10b981');
      expect(css, value).not.toContain('undefined');
    }
  });

  it('lets a per-scheme override win over the shared family', async () => {
    const css = await styles({ THEME_PRIMARY: 'blue', THEME_DARK_PRIMARY: 'rose' });

    expect(css).toContain('--color-primary: #f43f5e');
  });
});
