# EchoEtch · 声刻

**Listen it. Etch it. Speak it.**

EchoEtch is a mobile-first H5 prototype for learning from curated English listening courses. Each fixed course is prepared once, then reused without per-learner AI processing.

## Learning flow

1. Blind listening and dictation
2. Compare, correct, and analyse
3. Review and listen again
4. Shadow the original rhythm and emotion
5. Recite at full speed

## Fixed-course workflow

The default page is a course library. Opening a course loads its prepared audio, transcript, and sentence timestamps, then turns every sentence into a five-step practice unit.

- The current catalog contains the prepared Van Jones TED lesson with 173 timestamped sentences.
- Learners can select any sentence and continue from their last position.
- Completed sentences and course progress are stored in browser `localStorage`.
- Finishing the five-step flow marks the sentence complete and advances to the next sentence.
- Step 2 automatically marks a likely subject, predicate, object/complement, and easy-to-miss function words.
- The current sentence gets a Chinese machine-translation aid; results are cached locally and should be checked against the sentence structure.
- Selecting a word or phrase opens a Longman lookup panel; learners can review the English definition, write their own Chinese understanding, and choose whether to save it to the local vocabulary book.
- Prepared media remains outside Git. Public deployment must use licensed, self-produced, or redistribution-permitted material.

## Run locally

Open `index.html` in a modern browser. For the most reliable microphone support, serve the folder from a local web server.

```bash
python server.py
```

Then open `http://127.0.0.1:8767` for the course library. The local server disables browser caching so interface and JavaScript changes take effect after a normal refresh.

The prepared local TED course opens at:

```text
http://127.0.0.1:8767/?lesson=user-media%2Fvan-jones-kind-of-ai%2Flesson.json
```

## Tech

- HTML
- CSS
- Vanilla JavaScript
- Web Speech API
- MediaRecorder API
- Local browser audio playback
- Prepared lesson manifests with sentence timestamps
- Optional local Longman lookup proxy in `server.py`
