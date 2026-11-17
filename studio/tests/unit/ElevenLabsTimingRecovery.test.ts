// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {captureAlignmentPin,eligibleAlignmentResponse,persistAlignmentResponse,validateAlignment,publishAlignment} from '../../src/main/alignment';
import {readState,writeState,sha} from '../../src/main/services';
import {appPath,fixture,cleanup} from './SixIssueFixtures';
afterEach(cleanup);

describe('ElevenLabs provider timing: evidence-grounded zero-duration repair',()=>{
  const transcript='One two';
  const characters=[
    {text:'O',start:0,end:.06},{text:'n',start:.06,end:.12},
    {text:'e',start:.12,end:.2},{text:' ',start:.2,end:.25},
    {text:'t',start:.3,end:.36},{text:'w',start:.36,end:.42},
    {text:'o',start:.42,end:.5}
  ];
  it('uses exact same-response character bounds for a provider zero-duration word',()=>{
    const raw={words:[{text:'One',start:0,end:0,loss:.01},
      {text:'two',start:.3,end:.5,loss:.02}],characters};
    const result=validateAlignment(raw,transcript,1);
    expect(result).toEqual([{word:'One',start:0,end:.2,loss:.01},
      {word:'two',start:.3,end:.5,loss:.02}]);
    expect(raw.words[0]).toEqual({text:'One',start:0,end:0,loss:.01});
  });
  it('rejects ungrounded zero-duration word instead of inventing timestamps',()=>{
    const raw={words:[{text:'One',start:0,end:0},{text:'two',start:.3,end:.5}]};
    expect(()=>validateAlignment(raw,transcript,1))
      .toThrow(/index=0 reason=ZERO_DURATION_WITHOUT_POSITIVE_CHARACTER_EVIDENCE/);
  });
  it('rejects characters that cannot provide an exact matching word',()=>{
    const raw={words:[{text:'One',start:0,end:0},{text:'two',start:.3,end:.5}],
      characters:[{text:'O',start:0,end:.2},{text:'X',start:.2,end:.3}]};
    expect(()=>validateAlignment(raw,transcript,1)).toThrow(/CHARACTER_TEXT_MISMATCH/);
  });
  it('still blocks overlapping and beyond-WAV timing, with actionable index',()=>{
    expect(()=>validateAlignment({words:[{text:'One',start:0,end:.4},
      {text:'two',start:.3,end:.5}]},transcript,1))
      .toThrow(/index=1 reason=OVERLAPPING_OR_OUT_OF_ORDER/);
    expect(()=>validateAlignment({words:[{text:'One',start:0,end:.4},
      {text:'two',start:.5,end:1.2}]},transcript,1))
      .toThrow(/index=1 reason=BEYOND_ACCEPTED_WAV_DURATION/);
  });
  it('still requires exact transcript word coverage',()=>{
    expect(()=>validateAlignment({words:[{text:'One',start:0,end:.3},
      {text:'tree',start:.4,end:.6}]},transcript,1))
      .toThrow(/WORD_SEQUENCE_MISMATCH/);
  });
  it('AL-01/02: malformed provider word at index 1 cannot block complete character evidence',()=>{
    const raw={characters,words:[
      {text:'One',start:0,end:.2,loss:.01},
      {text:'   ',start:.2,end:.24,loss:'bad'}
    ]};
    expect(validateAlignment(raw,transcript,62.96)).toEqual([
      {word:'One',start:0,end:.2,loss:.01},
      {word:'two',start:.3,end:.5}
    ]);
  });
  it('AL-03/04/05: rejects invalid character time, transcript and audio bounds',()=>{
    expect(()=>validateAlignment({characters:[{text:'One two',start:'0',end:.8}]},
      transcript,62.96)).toThrow(/CHARACTER_TIMING_INVALID/);
    expect(()=>validateAlignment({characters:[{text:'One Two',start:0,end:.8}]},
      transcript,62.96)).toThrow(/CHARACTER_TEXT_MISMATCH/);
    expect(()=>validateAlignment({characters:[{text:'One two',start:0,end:63}]},
      transcript,62.96)).toThrow(/CHARACTER_TIMING_INVALID/);
  });
  it('AL-06: preserves strict word-only fallback and rejects malformed vendor words',()=>{
    expect(validateAlignment({words:[{word:'One',start:0,end:.2},
      {word:'two',start:.3,end:.5}]},transcript,62.96)).toHaveLength(2);
    expect(()=>validateAlignment({words:[{word:'One',start:0,end:.2},
      {word:'  ',start:.2,end:.24}]},transcript,62.96))
      .toThrow(/index=1 reason=MISSING_OR_INVALID_WORD/);
    expect(()=>validateAlignment({words:[{word:'One',start:'0',end:.2},
      {word:'two',start:.3,end:.5}]},transcript,62.96))
      .toThrow(/index=0 reason=MISSING_OR_INVALID_TIMESTAMP/);
  });

  it('AL-07/08/09: failed normalization retains bounded response and prior WAV and approvals',()=>{
    const {root,voicePath}=fixture(),pin=captureAlignmentPin(root);
    const before=readState(root),bytes=fs.readFileSync(path.join(root,voicePath));
    const invalid={characters:[{text:'Wrong',start:0,end:.6}],
      words:[{text:'   ',start:.2,end:.24}]};
    const evidencePath=persistAlignmentResponse(root,pin,invalid);
    expect(fs.existsSync(path.join(root,evidencePath))).toBe(true);
    expect(()=>validateAlignment(invalid,'One two three',30)).toThrow(/CHARACTER_TEXT_MISMATCH/);
    expect(eligibleAlignmentResponse(root)).toEqual(invalid);
    expect(readState(root).alignment).toEqual(before.alignment);
    expect(fs.readFileSync(path.join(root,voicePath))).toEqual(bytes);
    const next=readState(root);
    next.approvedScript!.text='Changed transcript';
    next.approvedScript!.sections=[{id:'opening',text:'Changed transcript'}];
    next.approvedScript!.sha256=sha('Changed transcript');
    writeState(root,next);
    expect(eligibleAlignmentResponse(root)).toBe(null);
  });
  it('AL-11: a project/script change during caption conversion blocks stale alignment publication',async()=>{
    const {root,voicePath}=fixture(),pin=captureAlignmentPin(root);
    const prior=readState(root).alignment,wav=fs.readFileSync(path.join(root,voicePath));
    const raw={words:[{text:'One',start:.1,end:.3},{text:'two',start:.35,end:.6},
      {text:'three',start:.65,end:.9}]};
    const words=validateAlignment(raw,'One two three',30);
    const runner=async()=>{
      const state=readState(root);
      state.approvedScript!.revision+=1;
      writeState(root,state);
      return{code:0,stdout:'',stderr:''};
    };
    await expect(publishAlignment(appPath,root,raw,words,'One two three',
      'ELEVENLABS',pin,runner)).rejects.toThrow(/changed during alignment/);
    expect(readState(root).alignment).toEqual(prior);
    expect(fs.readFileSync(path.join(root,voicePath))).toEqual(wav);
  });

});
