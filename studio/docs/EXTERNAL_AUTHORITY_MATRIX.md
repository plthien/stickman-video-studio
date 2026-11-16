# External ChatGPT authority matrix v1

This matrix is the audit map used by `externalAuthority.ts`. Source files are hashed when a task is frozen; a missing applicable source fails closed.

| Operation | Script KEEP | Native KEEP | Studio execution / omitted from ChatGPT |
|---|---|---|---|
| Author | brief, premise, hook, causal narrative, continuity, style, voice/sound intentions; B4 opening/threat/narration | approved script, real word/caption timing, shot/action/camera, assets/rights, native audio, style runtime; B4 picture/audio/asset/QA | CLI commands, provider calls, paths, cache/fingerprint implementation, approvals |
| Review | original task, immutable artifact, narrative/continuity/style gates | original task, immutable artifact, timing/shot/action/sound/style gates | technical validation and renderer PASS remain Studio/native-owned |
| Correct | complete script grammar; selected sections editable, remaining sections locked | complete project v1 grammar and ledgers; selected targets editable, remaining targets locked | no generated program, new DSL, local command or provider action |
| Recheck | source, schema, locks, findings and artifact hash | source, schema, locks, findings, native evidence and artifact hash | original native validator is executed by Studio only |
| Media review | script/voice intent plus transferred audio/image evidence | transferred MP4/audio/frames, coverage ranges, SHAs and associations | a path/report alone never proves picture, motion or sound |

Style source: selected B1-B4 reference. Script additionally uses the narrative portions of `autopilot.md`; Native uses runtime, production-QA and sound-system authorities. B4 Script retains opening constraints; B4 Native retains opening and audio direction. `SKILL.md` remains a traceable authority for both stages, but terminal/agent-only mechanics are not emitted as model jobs.
