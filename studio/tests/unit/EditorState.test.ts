import { describe, expect, it } from 'vitest';
import { shotIndexAtTime, shotStartTime, timelineDuration } from '../../src/renderer/features/editor/useEditorState';
import type { Shot } from '../../src/renderer/types/app';

// Test-owned scenes are not imported into the production renderer.
const testShots: Shot[] = [
  {id:'T01',title:'First',duration:4,caption:'',status:'test',color:''},
  {id:'T02',title:'Second',duration:5,caption:'',status:'test',color:''},
  {id:'T03',title:'Third',duration:6,caption:'',status:'test',color:''}
];
describe('editor timeline only accepts explicit native data', () => {
  it('has no fixture scenes or duration in production', () => {
    expect(timelineDuration).toBe(0);
    expect(shotIndexAtTime(0)).toBe(-1);
    expect(shotStartTime(1)).toBe(0);
  });
  it('resolves exact shot boundaries using supplied test-only data', () => {
    expect(shotIndexAtTime(0,testShots)).toBe(0);
    expect(shotIndexAtTime(3.99,testShots)).toBe(0);
    expect(shotIndexAtTime(4,testShots)).toBe(1);
    expect(shotIndexAtTime(9,testShots)).toBe(2);
    expect(shotIndexAtTime(15,testShots)).toBe(2);
    expect(shotStartTime(1,testShots)).toBe(4);
    expect(shotStartTime(2,testShots)).toBe(9);
  });
});
