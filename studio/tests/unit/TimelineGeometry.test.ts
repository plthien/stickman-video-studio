import { describe, expect, it } from 'vitest';
import { editorTracks } from '../../src/renderer/features/editor/EditorTimeline';
import { timelineX, PX_PER_SECOND } from '../../src/renderer/features/editor/timelineScale';
import { shots } from '../../src/renderer/features/storyboard/StoryboardWorkspace';

describe('30-second editor time geometry', () => {
  it('maps scene clip spans to cumulative time', () => {
    const scenes = editorTracks(shots)[0].clips;
    expect(scenes.map(item => [item.start, item.duration])).toEqual([
      [0, 4], [4, 5], [9, 4], [13, 6], [19, 5], [24, 6]
    ]);
    expect(scenes.map(item => timelineX(item.start))).toEqual([88, 192, 322, 426, 582, 712]);
    expect(timelineX(30)).toBe(88 + 30 * PX_PER_SECOND);
  });
  it('keeps non-scene track metadata explicitly timed and bounded', () => {
    const tracks = editorTracks(shots);
    expect(tracks).toHaveLength(6);
    for (const track of tracks) for (const clip of track.clips) {
      expect(clip.start).toBeGreaterThanOrEqual(0);
      expect(clip.duration).toBeGreaterThan(0);
      expect(clip.start + clip.duration).toBeLessThanOrEqual(30);
    }
  });
});
