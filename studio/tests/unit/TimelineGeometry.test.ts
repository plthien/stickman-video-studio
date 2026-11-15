import { describe, expect, it } from 'vitest';
import { editorTracks } from '../../src/renderer/features/editor/EditorTimeline';
import { timelineX, PX_PER_SECOND } from '../../src/renderer/features/editor/timelineScale';
describe('native timeline geometry never invents scene, voice or caption tracks', () => {
  it('has six empty lanes without an actual project projection', () => {
    expect(editorTracks([])).toHaveLength(6);
    expect(editorTracks([]).every(track=>track.clips.length===0)).toBe(true);
    expect(editorTracks([{id:'one',title:'Real',duration:10,caption:'',status:'native',color:''}]).every(track=>track.clips.length===0)).toBe(true);
  });
  it('uses only exact supplied native track clip coordinates', () => {
    const source={Scenes:[{label:'SHOT-01',start:0,duration:4},{label:'SHOT-02',start:4,duration:5}],Captions:[{label:'Actual words',start:1,duration:2}]};
    const tracks=editorTracks([],source);
    expect(tracks.find(track=>track.name==='Scenes')?.clips).toEqual(source.Scenes);
    expect(tracks.find(track=>track.name==='Captions')?.clips).toEqual(source.Captions);
    expect(tracks.find(track=>track.name==='Narration')?.clips).toEqual([]);
    expect(timelineX(9)).toBe(88+9*PX_PER_SECOND);
  });
});
