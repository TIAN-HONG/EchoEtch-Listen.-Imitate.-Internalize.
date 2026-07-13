# EchoEtch · 声刻

**Listen it. Etch it. Speak it.**

EchoEtch is a five-step intensive listening and shadowing prototype designed to turn authentic English audio into speaking ability.

## Learning flow

1. Blind listening and dictation
2. Compare, correct, and analyse
3. Review and listen again
4. Shadow the original rhythm and emotion
5. Recite at full speed

## BBC and TED learning material workflow

The prototype supports legally obtained BBC Learning English, TED, TED-Ed, and other authentic audio. It detects natural pauses locally, aligns pasted English transcript sentences, and turns each generated segment into a five-step practice unit.

- Audio stays in the browser and is not uploaded to a server.
- Audio and MP4 files can be selected or dragged directly onto the source importer.
- MP4 video and audio files over 100 MB can be converted locally to a mono 64 kbps AAC learning track with progress and cancellation controls.
- Audio files are intentionally excluded from this Git repository.
- Programme title, official source URL, transcript, and segment timestamps can be saved locally.
- Pasted BBC/TED page links are recognized, attributed, and can be opened from the interface.
- A normal BBC/TED webpage is not an audio file and is not scraped for embedded media.
- Direct audio URLs can be imported only when the source server permits browser CORS access.
- Audio is automatically split after selection using local pause detection.
- Pasted transcripts are split by punctuation and aligned to nearby pauses.
- Learners can select any generated sentence and fine-tune its start/end time.
- Imported files are limited to 800 MB, with a performance warning above 200 MB. MP4 is supported when it contains a browser-decodable audio track; AAC audio is recommended. MP3 and WAV remain the most compatible formats.
- The repository does not redistribute BBC or TED audio, videos, or complete transcripts.

## Run locally

Open `index.html` in a modern browser. For the most reliable microphone support, serve the folder from a local web server.

```bash
python server.py
```

Then open `http://127.0.0.1:8765`. The local server disables browser caching so interface and JavaScript changes take effect after a normal refresh.

## Tech

- HTML
- CSS
- Vanilla JavaScript
- Web Speech API
- MediaRecorder API
- Local browser audio playback
- Web Audio API pause detection and transcript alignment
