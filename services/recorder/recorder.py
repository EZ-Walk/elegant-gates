#!/usr/bin/env python3
"""
VHF14 Recorder - Captures audio from default microphone and saves to WAV files.
Runs locally (not in Docker) and saves to shared/recordings/ directory.
"""

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

SAMPLE_RATE = 16000  # 16kHz is optimal for Whisper
CHANNELS = 1
CHUNK_DURATION = 30  # seconds per recording file
OUTPUT_DIR = Path(__file__).parent.parent.parent / "shared" / "recordings"


def list_devices():
    """Print all available audio input devices."""
    print("Available audio input devices:")
    print("-" * 60)
    devices = sd.query_devices()
    for i, device in enumerate(devices):
        if device["max_input_channels"] > 0:
            marker = " (default)" if i == sd.default.device[0] else ""
            print(f"  [{i}] {device['name']}{marker}")
            print(f"      Channels: {device['max_input_channels']}, "
                  f"Sample rate: {int(device['default_samplerate'])} Hz")
    print("-" * 60)


def record_chunk(device=None, duration=CHUNK_DURATION):
    """Record a single chunk of audio and return as numpy array."""
    print(f"  Recording {duration}s chunk... ", end="", flush=True)
    audio = sd.rec(
        int(duration * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="float32",
        device=device,
    )
    sd.wait()
    print("done.")
    return audio


def save_recording(audio: np.ndarray, output_dir: Path) -> Path:
    """Save audio array to a timestamped WAV file."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"recording_{timestamp}.wav"
    filepath = output_dir / filename
    sf.write(str(filepath), audio, SAMPLE_RATE)
    return filepath


def upload_recording(filepath: Path, remote: str, cleanup: bool) -> None:
    """Rsync a WAV file to a remote destination, then optionally delete the local copy."""
    try:
        subprocess.run(
            ["rsync", "-az", str(filepath), remote],
            check=True,
            capture_output=True,
        )
        print(f"  Uploaded to {remote}")
        if cleanup:
            filepath.unlink()
            print(f"  Deleted local copy: {filepath.name}")
    except subprocess.CalledProcessError as e:
        print(f"  WARNING: rsync failed: {e.stderr.decode().strip()}", file=sys.stderr)


def run_recorder(duration: int, device=None, remote: str = None, cleanup: bool = False):
    """
    Main recording loop.

    Args:
        duration: Total recording duration in seconds. 0 = infinite.
        device: Audio device index or None for default.
        remote: Optional rsync destination (e.g. user@host:/path/to/recordings/).
        cleanup: If True, delete local WAV after successful rsync.
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"VHF14 Recorder started")
    print(f"Output directory: {OUTPUT_DIR.resolve()}")
    print(f"Sample rate: {SAMPLE_RATE} Hz, Channels: {CHANNELS}")
    print(f"Chunk size: {CHUNK_DURATION}s")
    if duration > 0:
        print(f"Total duration: {duration}s")
    else:
        print("Duration: infinite (Ctrl+C to stop)")
    print("-" * 60)

    start_time = time.time()
    chunk_count = 0

    try:
        while True:
            elapsed = time.time() - start_time

            if duration > 0 and elapsed >= duration:
                print(f"\nTarget duration of {duration}s reached. Stopping.")
                break

            chunk_count += 1
            chunk_dur = CHUNK_DURATION
            if duration > 0:
                remaining = duration - elapsed
                chunk_dur = min(CHUNK_DURATION, remaining)
                if chunk_dur <= 0:
                    break

            print(f"[{datetime.now().strftime('%H:%M:%S')}] Chunk #{chunk_count}", end=" ")

            audio = record_chunk(device=device, duration=chunk_dur)
            filepath = save_recording(audio, OUTPUT_DIR)
            print(f"  Saved: {filepath.name}")
            if remote:
                upload_recording(filepath, remote, cleanup)

    except KeyboardInterrupt:
        print("\n\nRecording stopped by user.")
    except Exception as e:
        print(f"\nError during recording: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Total chunks recorded: {chunk_count}")


def main():
    parser = argparse.ArgumentParser(
        description="VHF14 Radio Recorder - captures audio in 30-second WAV chunks",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python recorder.py                     # Record indefinitely
  python recorder.py --duration 300      # Record for 5 minutes
  python recorder.py --list-devices      # Show available audio devices
  python recorder.py --device 2          # Use device index 2
        """,
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=0,
        metavar="SECONDS",
        help="Total recording duration in seconds (default: 0 = infinite)",
    )
    parser.add_argument(
        "--device",
        type=int,
        default=None,
        metavar="INDEX",
        help="Audio device index (default: system default)",
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List available audio input devices and exit",
    )
    parser.add_argument(
        "--remote",
        type=str,
        default=None,
        metavar="DEST",
        help="Rsync destination for uploading recordings (e.g. user@host:/path/to/recordings/)",
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Delete local WAV file after successful rsync upload (requires --remote)",
    )

    args = parser.parse_args()

    if args.list_devices:
        list_devices()
        sys.exit(0)

    run_recorder(duration=args.duration, device=args.device, remote=args.remote, cleanup=args.cleanup)


if __name__ == "__main__":
    main()
