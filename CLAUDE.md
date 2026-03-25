# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VHF14 is a marine radio monitor system designed to capture, transcribe, and analyze VHF marine radio communications. The system is built as a microservices architecture using Docker Compose for orchestration.

## Architecture

The system consists of four main services:

### Core Services
- **recorder** - Captures VHF radio audio to WAV files in `shared/recordings/`
- **transcriber** - Uses Whisper AI to convert audio recordings to text, stores results in Redis
- **extractor** - Uses Ollama (phi3 model) to extract structured information from transcriptions
- **map** - Web interface (port 3000) for visualizing radio communications on a map

### Infrastructure Services  
- **redis** - Message broker and data store (port 6379)
- **ollama** - Local LLM inference server (port 11434) running phi3 model

## Development Commands

### Environment Setup
```bash
# Start all services
make up
# OR
docker compose up -d

# Stop all services  
make down
# OR
docker compose down

# View logs from all services
make logs
# OR 
docker compose logs -f

# View logs from specific service
docker compose logs -f <service-name>
```

### Recording and Processing
```bash
# Start radio recording (runs locally, not in container)
make record
# OR
cd services/recorder && python recorder.py

# Pull/update the LLM model
make pull-model
# OR
docker compose exec ollama ollama pull phi3

# Clean recorded audio files
make clean
# OR 
rm -f shared/recordings/*.wav
```

### Service Management
```bash
# Rebuild and restart specific service
docker compose up --build <service-name>

# Access service shell for debugging
docker compose exec <service-name> /bin/bash

# Check service health
docker compose ps
```

## Configuration

### Environment Variables
Configure in `.env` file:
- `MAPBOX_TOKEN` - Required for map service visualization
- `OLLAMA_MODEL` - LLM model for information extraction (default: phi3)
- `WHISPER_MODEL` - Speech recognition model (default: base.en)

### Data Flow
1. **recorder** saves audio files to `shared/recordings/*.wav`
2. **transcriber** monitors recordings, transcribes audio, stores text in Redis
3. **extractor** processes transcriptions through LLM, extracts structured data
4. **map** service serves web interface showing processed communications

### Service Dependencies
- transcriber depends on Redis
- extractor depends on Redis + Ollama  
- map depends on Redis
- All services restart automatically unless stopped

## Development Notes

### File Structure
- `shared/recordings/` - Audio files shared between recorder and transcriber
- `services/<name>/` - Individual service codebases
- `docker-compose.yml` - Service definitions and networking
- `Makefile` - Common development commands

### Service Communication
- Services communicate through Redis message queues
- Ollama API used for LLM inference at http://ollama:11434
- Map service exposes web interface on port 3000

### Health Checks
All services include health checks:
- Redis: `redis-cli ping`
- Ollama: API endpoint availability
- Other services restart if unhealthy