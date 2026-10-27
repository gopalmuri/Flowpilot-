import { describe, it, expect } from 'vitest';
import { formatMs, formatRunDuration } from '../utils/formatRunDuration';

describe('formatRunDuration', () => {
  it('does not show a growing number for runs waiting on a human', () => {
    expect(formatRunDuration({ status: 'PAUSED', duration_ms: 9741160 })).toBe('Waiting for approval');
  });
  it('describes running runs instead of showing partial time', () => {
    expect(formatRunDuration({ status: 'RUNNING', duration_ms: 1200 })).toBe('In progress');
  });
  it('formats terminal durations at sensible scales', () => {
    expect(formatRunDuration({ status: 'COMPLETED', duration_ms: 526 })).toBe('526ms');
    expect(formatMs(20610)).toBe('20.61s');
    expect(formatMs(185_000)).toBe('3m 5s');
    expect(formatMs(9_951_630)).toBe('2h 45m');
  });
  it('falls back to a dash when unknown', () => {
    expect(formatRunDuration({ status: 'COMPLETED' })).toBe('-');
  });
});
