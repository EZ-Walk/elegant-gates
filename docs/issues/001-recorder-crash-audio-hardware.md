# Issue #001: Recorder crashes on audio hardware disconnect

**Status:** Mitigated  
**Severity:** Medium  
**Date:** 2026-03-27 11:59 PDT  
**Reporter:** 🦞 Lobster (IT Manager)

## Summary

The VHF14 recorder process crashed after ~30 seconds of operation due to an audio hardware error.

## Error

```
||PaMacCore (AUHAL)|| Error on line 2744: err=''stop'', msg=Audio Hardware Not Running
Error during recording: Error starting stream: Internal PortAudio error [PaErrorCode -9986]
```

## Impact

- Only 1 recording captured before crash
- ~2 hours of potential VHF traffic missed
- No automatic recovery

## Root Cause

PortAudio detected the audio hardware stopped. Likely causes:
1. iPhone mic disconnected (USB/Continuity interrupted)
2. macOS audio system reset
3. System sleep affecting audio (less likely with pmset fixes)

## Resolution

- **Immediate:** Manually restarted recorder at 11:59 PDT
- **Recommended:** Add auto-restart logic to recorder.py

## Action Items

- [ ] Add try/except with auto-restart in recorder.py
- [ ] Create launchd service for recorder with KeepAlive
- [ ] Add health check to watchdog script
- [ ] Alert on recorder death

## Lessons Learned

Recorder runs outside Docker (needs hardware access) and has no supervision. Any audio glitch kills the pipeline silently.
