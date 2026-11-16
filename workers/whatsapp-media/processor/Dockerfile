FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 \
    MEDIA_JOB_DIRECTORY=/tmp/vetsa-public-media \
    YAMNET_MODEL_PATH=/app/models/yamnet-classification.tflite
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
ARG INCLUDE_AUDIO_MODEL=1
RUN if [ "$INCLUDE_AUDIO_MODEL" = "1" ]; then python fetch_model.py; fi
RUN useradd --uid 10001 --create-home processor \
    && mkdir -p /tmp/vetsa-public-media && chown processor:processor /tmp/vetsa-public-media
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"
CMD ["python", "server.py"]
