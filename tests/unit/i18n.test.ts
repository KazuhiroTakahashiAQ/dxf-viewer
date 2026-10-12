import { describe, expect, it } from 'vitest';

import { t } from '../../src/i18n';

describe('i18n', () => {
  it('returns the English string', () => {
    expect(t('app.title')).toBe('DXF Viewer');
  });
});
