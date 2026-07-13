import argparse
import json
import os
import re
from pathlib import Path

import av
from faster_whisper import WhisperModel


def format_srt_time(seconds):
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{milliseconds:03}"


def find_cached_model(model_name):
    cache_name = f"models--{model_name.replace('/', '--')}"
    model_root = Path.home() / ".cache" / "huggingface" / "hub" / cache_name
    ref = model_root / "refs" / "main"
    if not ref.exists():
        return model_name
    snapshot = model_root / "snapshots" / ref.read_text(encoding="utf-8").strip()
    return str(snapshot) if snapshot.exists() else model_name


def media_duration(path):
    with av.open(str(path)) as container:
        return float(container.duration / av.time_base)


def transcribe(input_path, model_name):
    duration = media_duration(input_path)
    model_path = find_cached_model(model_name)
    print(f"Loading speech model: {model_path}", flush=True)
    model = WhisperModel(
        model_path,
        device="cpu",
        compute_type="int8",
        cpu_threads=max(2, (os.cpu_count() or 4) - 2),
        local_files_only=Path(model_path).exists(),
    )
    segments, info = model.transcribe(
        str(input_path),
        language="en",
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350},
        condition_on_previous_text=True,
    )
    output = []
    for index, segment in enumerate(segments, 1):
        words = []
        for word in segment.words or []:
            words.append(
                {
                    "text": word.word,
                    "start": round(word.start, 3),
                    "end": round(word.end, 3),
                    "probability": round(word.probability, 4),
                }
            )
        output.append(
            {
                "id": index,
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": segment.text.strip(),
                "avg_logprob": round(segment.avg_logprob, 4),
                "no_speech_prob": round(segment.no_speech_prob, 4),
                "words": words,
            }
        )
        percent = min(100, segment.end / duration * 100)
        print(f"Transcribing: {percent:5.1f}%  {segment.text.strip()[:72]}", flush=True)
    metadata = {
        "language": info.language,
        "language_probability": round(info.language_probability, 4),
        "duration": round(duration, 3),
        "model": model_name,
    }
    return output, metadata


def join_word_text(words):
    text = "".join(word["text"] for word in words).strip()
    return re.sub(r"\s+([,.;:!?])", r"\1", re.sub(r"\s+", " ", text))


def build_learning_segments(raw_segments, media_length):
    words = [word for segment in raw_segments for word in segment["words"]]
    if not words:
        return [
            {
                "id": index,
                "text": segment["text"],
                "start": segment["start"],
                "end": segment["end"],
            }
            for index, segment in enumerate(raw_segments, 1)
        ]

    groups = []
    current = []
    for index, word in enumerate(words):
        current.append(word)
        next_word = words[index + 1] if index + 1 < len(words) else None
        gap = max(0, next_word["start"] - word["end"]) if next_word else 9
        elapsed = word["end"] - current[0]["start"]
        terminal = bool(re.search(r"[.!?][\"']?$", word["text"].strip()))
        soft_break = bool(re.search(r"[,;:][\"']?$", word["text"].strip()))
        should_cut = (
            (terminal and elapsed >= 0.9)
            or (gap >= 1.05 and elapsed >= 2.0)
            or (elapsed >= 15 and (soft_break or gap >= 0.45))
            or elapsed >= 19
        )
        if should_cut:
            groups.append(current)
            current = []
    if current:
        groups.append(current)

    stitched = []
    index = 0
    while index < len(groups):
        group = groups[index]
        text = join_word_text(group)
        duration = group[-1]["end"] - group[0]["start"]
        terminal = bool(re.search(r"[.!?][\"']?$", text))
        if not terminal and duration < 3.8 and index + 1 < len(groups):
            groups[index + 1] = group + groups[index + 1]
        else:
            stitched.append(group)
        index += 1

    merged = []
    for group in stitched:
        text = join_word_text(group)
        duration = group[-1]["end"] - group[0]["start"]
        if merged and (len(text.split()) < 3 or duration < 1.1):
            merged[-1].extend(group)
        else:
            merged.append(group)

    lessons = []
    for index, group in enumerate(merged, 1):
        text = join_word_text(group)
        start = max(0, group[0]["start"] - 0.12)
        end = min(media_length, group[-1]["end"] + 0.18)
        word_count = len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text))
        duration = max(0.1, end - start)
        confidence = float(sum(word["probability"] for word in group) / len(group))
        lessons.append(
            {
                "id": index,
                "text": text,
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": round(duration, 3),
                "word_count": word_count,
                "speech_rate_wpm": round(word_count / duration * 60),
                "confidence": round(confidence, 4),
                "needs_review": bool(confidence < 0.88),
                "study": {
                    "translation": "",
                    "vocabulary": [],
                    "patterns": [],
                    "grammar": [],
                    "pronunciation": [],
                },
            }
        )
    return lessons


def parse_official_ted_cues(html_path):
    html = html_path.read_text(encoding="utf-8")
    pattern = re.compile(r'"__typename":"Cue","text":"((?:\\.|[^"\\])*)","time":(\d+)')
    cues = []
    for encoded_text, milliseconds in pattern.findall(html):
        try:
            text = json.loads(f'"{encoded_text}"')
        except json.JSONDecodeError:
            continue
        text = re.sub(r"\s+", " ", text).strip().replace(" --", " --")
        cues.append({"start": int(milliseconds) / 1000, "text": text})
    if not cues:
        raise RuntimeError("No TED transcript cues found in the supplied HTML")
    return cues


def build_official_lessons(cues, media_length, offset):
    groups = []
    current = []
    for index, cue in enumerate(cues):
        if re.fullmatch(r"\([^)]*\)", cue["text"]):
            if current:
                groups.append(current)
                current = []
            continue
        current.append(cue)
        next_start = cues[index + 1]["start"] if index + 1 < len(cues) else cue["start"] + 4
        elapsed = next_start - current[0]["start"]
        terminal = bool(re.search(r"[.!?][\"']?$", cue["text"]))
        if (terminal and elapsed >= 0.8) or elapsed >= 14:
            groups.append(current)
            current = []
    if current:
        groups.append(current)

    lessons = []
    for index, group in enumerate(groups, 1):
        text = " ".join(cue["text"] for cue in group)
        text = re.sub(r"\s+", " ", text).replace(" -- ", " -- ").strip()
        start = max(0, group[0]["start"] + offset - 0.12)
        final_cue_index = cues.index(group[-1])
        next_start = cues[final_cue_index + 1]["start"] if final_cue_index + 1 < len(cues) else group[-1]["start"] + 4
        end = min(media_length, next_start + offset - 0.08)
        duration = max(0.1, end - start)
        word_count = len(re.findall(r"[A-Za-z]+(?:[’'][A-Za-z]+)?", text))
        lessons.append(
            {
                "id": index,
                "text": text,
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": round(duration, 3),
                "word_count": word_count,
                "speech_rate_wpm": round(word_count / duration * 60),
                "confidence": 1.0,
                "needs_review": False,
                "study": {
                    "translation": "",
                    "vocabulary": [],
                    "patterns": [],
                    "grammar": [],
                    "pronunciation": [],
                },
            }
        )
    return lessons


def write_srt(path, lessons):
    blocks = []
    for lesson in lessons:
        blocks.append(
            f"{lesson['id']}\n"
            f"{format_srt_time(lesson['start'])} --> {format_srt_time(lesson['end'])}\n"
            f"{lesson['text']}"
        )
    path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8-sig")


def extract_learning_audio(input_path, output_path):
    print("Extracting mono AAC learning track...", flush=True)
    with av.open(str(input_path)) as source, av.open(str(output_path), "w") as target:
        audio_stream = next((stream for stream in source.streams if stream.type == "audio"), None)
        if audio_stream is None:
            raise RuntimeError("The source file does not contain an audio track")
        output_stream = target.add_stream("aac", rate=44_100)
        output_stream.bit_rate = 64_000
        output_stream.layout = "mono"
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=44_100)
        for frame in source.decode(audio_stream):
            for converted in resampler.resample(frame):
                for packet in output_stream.encode(converted):
                    target.mux(packet)
        for converted in resampler.resample(None):
            for packet in output_stream.encode(converted):
                target.mux(packet)
        for packet in output_stream.encode(None):
            target.mux(packet)
    print(f"Learning audio: {output_path}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Prepare a TED video for EchoEtch")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="Systran/faster-whisper-small")
    parser.add_argument("--source-url", default="")
    parser.add_argument("--speaker", default="")
    parser.add_argument("--title", default="")
    parser.add_argument("--reuse-transcript", action="store_true")
    parser.add_argument("--official-html", type=Path)
    parser.add_argument("--transcript-offset", type=float, default=0)
    parser.add_argument("--skip-audio", action="store_true")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    raw_path = args.output / "raw-whisper.json"
    if args.reuse_transcript and raw_path.exists():
        cached = json.loads(raw_path.read_text(encoding="utf-8-sig"))
        raw_segments = cached["segments"]
        metadata = cached["metadata"]
        print(f"Reusing timestamped transcript: {raw_path}", flush=True)
    else:
        raw_segments, metadata = transcribe(args.input, args.model)
    if args.official_html:
        cues = parse_official_ted_cues(args.official_html)
        lessons = build_official_lessons(cues, metadata["duration"], args.transcript_offset)
        transcript = " ".join(lesson["text"] for lesson in lessons).strip()
        metadata["transcript_source"] = "TED official transcript"
        metadata["transcript_offset_seconds"] = args.transcript_offset
    else:
        lessons = build_learning_segments(raw_segments, metadata["duration"])
        transcript = " ".join(segment["text"] for segment in raw_segments).strip()
        metadata["transcript_source"] = "faster-whisper"
    lesson_data = {
        "schema_version": 1,
        "source": {
            "type": "ted",
            "title": args.title or args.input.stem,
            "speaker": args.speaker,
            "official_url": args.source_url,
            "local_media_name": args.input.name,
            "learning_audio": "learning-audio.m4a",
        },
        "metadata": {
            **metadata,
            "sentence_count": len(lessons),
            "transcript_review_required": metadata.get("transcript_source") != "TED official transcript",
        },
        "segments": lessons,
    }
    raw_path.write_text(
        json.dumps({"metadata": metadata, "segments": raw_segments}, ensure_ascii=False, indent=2),
        encoding="utf-8-sig",
    )
    (args.output / "lesson.json").write_text(
        json.dumps(lesson_data, ensure_ascii=False, indent=2), encoding="utf-8-sig"
    )
    (args.output / "transcript.txt").write_text(transcript + "\n", encoding="utf-8-sig")
    write_srt(args.output / "subtitles.srt", lessons)
    if not args.skip_audio:
        extract_learning_audio(args.input, args.output / "learning-audio.m4a")
    print(f"Prepared {len(lessons)} learning sentences in {args.output}", flush=True)


if __name__ == "__main__":
    main()
