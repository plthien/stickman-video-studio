import { describe, expect, it } from 'vitest';
import { shotIndexAtTime, shotStartTime, timelineDuration } from '../../src/renderer/features/editor/useEditorState';

describe('editor timeline model', () => {
  it('resolves exact shot boundaries deterministically', () => {
    expect(shotIndexAtTime(0)).toBe(0);
    expect(shotIndexAtTime(3.99)).toBe(0);
    expect(shotIndexAtTime(4)).toBe(1);
    expect(shotIndexAtTime(8.99)).toBe(1);
    expect(shotIndexAtTime(9)).toBe(2);
    expect(shotIndexAtTime(timelineDuration)).toBe(5);
  });
  it('exposes cumulative shot starts', () => {
    expect(shotStartTime(0)).toBe(0);
    expect(shotStartTime(1)).toBe(4);
    expect(shotStartTime(2)).toBe(9);
  });
});
