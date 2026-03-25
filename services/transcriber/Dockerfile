FROM python:3.11-slim

# Install system dependencies required by Whisper / audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY transcriber.py .

# Recordings directory is mounted as a volume at runtime
RUN mkdir -p /app/recordings

CMD ["python", "-u", "transcriber.py"]
