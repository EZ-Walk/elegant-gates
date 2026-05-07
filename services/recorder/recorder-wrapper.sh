#!/bin/bash
# VHF14 Recorder Wrapper - handles crashes and restarts
# Run via launchd for automatic supervision

cd /Users/ez/Projects/vhf14/services/recorder
source .venv/bin/activate

LOG="/Users/ez/Projects/vhf14/shared/recordings/recorder.log"
RESTART_DELAY=5

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [wrapper] $1" >> "$LOG"
}

log "Recorder wrapper started"

while true; do
    log "Starting recorder..."
    python recorder.py --device 0 >> "$LOG" 2>&1
    EXIT_CODE=$?
    
    log "Recorder exited with code $EXIT_CODE"
    
    if [ $EXIT_CODE -eq 0 ]; then
        log "Clean exit, stopping wrapper"
        break
    fi
    
    log "Crash detected, restarting in ${RESTART_DELAY}s..."
    sleep $RESTART_DELAY
done
