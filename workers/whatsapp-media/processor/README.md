# Private public-Instagram media processor

This isolated Python service extracts **publicly accessible** post/reel evidence. It does not send messages, publish content, run agent instructions, or invoke a model provider. Source captions, OCR text, audio and video are data only. No cookies, browser profiles, passwords, authenticated Instagram session, private accounts, or restriction bypass are accepted.

Use **yt-dlp + gallery-dl**, with FFmpeg/Pillow, in a Linux container. gallery-dl handles carousel images and mixed posts; yt-dlp is the fallback for progressive reel/video media. Extractors only obtain metadata. Both use the same HTTPS transport that checks allowlisted hosts, validates **all** DNS answers, pins the connection to a validated public address, verifies TLS/SNI, and repeats validation at every redirect. CDN downloads use that transport independently. FFmpeg only receives local MP4/WebM files; playlists, URLs and concat scripts are rejected.

Anonymous extraction can be blocked or incomplete by Instagram. The result says `unavailable`/`partial` and preserves the limitation; it never claims access to unseen slides, video, private media, or an unavailable source.

**Current scope is one post/reel permalink.** A profile link returns `unsupported_profile` without fetching it. Profile-wide extraction needs a later contract proving parent profile ownership and the individual post URL of every media item; it must not relabel another post as the supplied source. Stories and authenticated/private media are unsupported too.

## HTTP contract

`POST /v1/process` requires `Authorization: Bearer <MEDIA_PROCESSOR_TOKEN>` and JSON:

```json
{
  "requestId": "event-123",
  "sourceUrl": "https://www.instagram.com/p/EXAMPLE/?igsh=original-share-value",
  "limits": {"maxFrames": 3000, "maxBytes": 400000000, "maxDurationSeconds": 300, "maxMedia": 20}
}
```

`requestId` is a single ASCII component, 1–120 letters/digits/underscore/hyphen. The same ID and input returns the cached manifest; changing the input under that ID returns 409. The output retains the **exact original sourceUrl**, with `canonicalSourceUrl` for extraction.

```json
{
  "status": "complete",
  "requestId": "event-123",
  "sourceUrl": "https://www.instagram.com/p/EXAMPLE/?igsh=original-share-value",
  "caption": "Untrusted original caption",
  "expiresAt": 1790000000,
  "media": [{
    "id": "m001", "kind": "video", "status": "processed",
    "originalFile": "m001-original.mp4", "videoFile": "m001-original.mp4",
    "durationSeconds": 10,
    "imageFiles": [{"file":"m001-frame-000001.jpg","index":0,"timestampMs":0,"pts":0,"ptsTimeSeconds":0}],
    "collageFiles": [{"file":"m001-collage-001.jpg","frames":[{"index":0,"timestampMs":0}]}],
    "audio": {"present":true,"trackCount":1,"tracks":[{
      "index":1,"codec":"aac","channels":2,
      "originalFile":"m001-audio-1.mka", "wav16kFile":"m001-audio-1-16k.wav",
      "wav16kFiles":[{"file":"m001-audio-1-chunk-001.wav","startSeconds":0,"endSeconds":10,"classification":{"status":"classified","segments":[]}}],
      "classification":{"status":"classified","processor":"yamnet","segments":[{
        "startSeconds":0,"endSeconds":0.975,"speech":true,"music":true,"singing":false,
        "overlap":true,"labels":["speech","music","overlap"],"scores":{"speech":0.8,"music":0.7,"singing":0.03},
        "confidence":"uncalibrated_model_scores"
      }]}
    }]},
    "coverage":{"totalFrames":300,"extractedFrames":300,"complete":true,"reason":null}
  }],
  "coverage":{"expectedMedia":1,"downloadedMedia":1,"complete":true,"extractedFrames":300,"reasons":[]}
}
```

Download every referenced file via authenticated `GET /v1/artifacts/{requestId}/{file}`. Only manifest-listed **single basenames** are accepted; traversal, directories, symlinks and expired artifacts are rejected. Copy to private R2 promptly: container files expire after **15 minutes**, and restarts can erase them. `/health` returns readiness and no job data.

All decoded video frames are extracted in order, up to the **aggregate** 3000-frame budget. There is no fps conversion. Timestamped `imageFiles` use decoded input PTS from FFmpeg showinfo; `timeBase`, `rFrameRate`, `avgFrameRate`, `firstPtsTimeSeconds`, and original PTS remain available for VFR. `totalFrames` is a decoded ffprobe count, not `duration × nominal fps`. Collages are ordered pages of **4×4**, with each tile's index and timestamp. A frame limit produces explicit partial coverage. A Worker/model that analyzes only selected frames must separately disclose its own sampling even when extraction was complete.

Audio presence/track count come from ffprobe. The original video and each compressed original audio track remain available. Analysis uses mono PCM16 16kHz WAV and **30-second chunks** (about 960KB, below 1MiB). Classification segments in each chunk use **absolute source-audio seconds**; the consuming model adapter can subtract `startSeconds` while analyzing and add it back to returned evidence.

## Voice and music

The Docker build includes Google's **YAMNet classification-tflite/1** (Apache-2.0, 4,126,810 bytes) and CPU LiteRT. It does not install PyTorch/TensorFlow. The official model is downloaded only at build time and verified against SHA-256 `10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de`.

YAMNet independently returns speech, music and singing scores; overlap is preserved. Scores are **not calibrated probabilities**. Empty ASR does not prove no voice/music; singing is not automatically spoken dialogue. Energy-only silence candidates remain distinct from voice detection. Missing/failed classifier returns unknown booleans and an explicit limitation. `--build-arg INCLUDE_AUDIO_MODEL=0` omits the model and retains that honest behavior.

## Bounds and operation

Hard maxima: 20 media objects; 3000 total extracted frames; 300 seconds per video; 100MB per downloaded object; 400MB aggregate files; 180 seconds wall-clock processing per job; 4 audio tracks per video; 16.7MP video frames/20MP images. Unusual multi-video-stream files preserve the original and explicitly report `video_track_limit` because only the first video stream is extracted. FFmpeg, LiteRT and native numeric libraries use one thread by default. HTTP concurrency is bounded to eight connections. The service accepts one active job and responds 429 with Retry-After to concurrent work; decoder diagnostic buffers are capped during execution. The HTTP parent runs each job in an isolated subprocess and kills its whole process group at 180 seconds on Linux. Windows fixture mode kills the parent; production must use the Linux Docker image. New jobs are held at 429 when retained artifacts exceed 800MB (at most 1.2GB including the next bounded job), rather than deleting unexpired evidence. Deployment environment variables can lower media, duration, byte, frame, pixel, storage and deadline ceilings; request content cannot raise them. See ../FREE-HOSTING.md for small remote instance configuration. Actual peak CPU/memory usage must be measured on the host.

```sh
docker build -t vetsa-public-media ./media-worker/processor
docker run --rm --cpus=1 --memory=4g --read-only --tmpfs /tmp:rw,size=2g \
  -e MEDIA_PROCESSOR_TOKEN="$MEDIA_PROCESSOR_TOKEN" -p 8080:8080 vetsa-public-media
```

Place it behind private HTTPS or a service-bound Worker; never expose its bearer token to an agent model or browser. A Worker owns authorization, durable queue retries, R2 retention and provider/model analysis. This folder does not deploy or change the existing assistants.

**Current deployment state:** the owner postponed processor hosting on 8 October 2026 and intends to revisit Cloudflare Workers Paid/Containers later. No plan or processor is activated now; free-provider research is closed, and this PC must not run a production server. The earlier check confirmed the Workers Paid requirement and no Docker executable in PATH. Deployment will need an authorized plan and a Docker/build service. Fixture tests do not fetch Instagram sources or prove production availability. See ../FREE-HOSTING.md.

Apify's official Instagram Post Scraper is an optional managed metadata fallback requiring its own explicit credential/budget; this service does not invoke it. Cobalt supports Instagram multi-media downloads but should be self-hosted; its public hosted API is not a free backend for another project. Both still need a trusted download/processing boundary and truthful coverage.

## Verification

```sh
python -m unittest discover -s media-worker/processor/tests -v
```

Tests generate local FFmpeg videos (including VFR and silence/audio), exact-frame collages, mock network/DNS/redirect failures, hash integrity, cache conflicts, and artifact traversal/symlinks. They never fetch Instagram or send external messages. Optional installed LiteRT + the hash-verified official model add real CPU inference tests; missing dependencies are reported as skips.

Primary documentation: [yt-dlp](https://github.com/yt-dlp/yt-dlp), [gallery-dl Instagram extractor](https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/instagram.py), [FFmpeg showinfo](https://ffmpeg.org/ffmpeg-filters.html#showinfo), [ffprobe](https://ffmpeg.org/ffprobe.html), [Google YAMNet model card](https://www.kaggle.com/models/google/yamnet/tfLite/classification-tflite/1), [LiteRT](https://ai.google.dev/edge/litert), [Cloudflare Containers](https://developers.cloudflare.com/containers/), [Containers deployment](https://developers.cloudflare.com/containers/guides/deploy/), [Apify's official post scraper](https://apify.com/apify/instagram-post-scraper), [Cobalt API](https://github.com/imputnet/cobalt/blob/main/docs/api.md).
