import pytest


def pytest_addoption(parser):
    parser.addoption(
        "--audio",
        action="store",
        default=None,
        help="Path to an audio file (WAV, M4A, MP3, OGG, etc.) containing a vessel name and heading",
    )
