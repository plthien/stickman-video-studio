// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {validateAlignment} from '../../src/main/alignment';

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

});
