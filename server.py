import json
import re
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


class LongmanParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = None
        self.active_depth = 0
        self.active_text = []
        self.values = {"word": [], "part_of_speech": [], "definitions": [], "examples": []}

    def handle_starttag(self, tag, attrs):
        if self.active:
            self.active_depth += 1
            return
        classes = set(dict(attrs).get("class", "").split())
        if classes & {"HWD", "POS", "DEF", "EXAMPLE"}:
            self.active = next(iter(classes & {"HWD", "POS", "DEF", "EXAMPLE"}))
            self.active_depth = 1
            self.active_text = []

    def handle_data(self, data):
        if self.active and data.strip():
            self.active_text.append(data.strip())

    def handle_endtag(self, tag):
        if self.active:
            self.active_depth -= 1
            if self.active_depth <= 0:
                key = "word" if self.active == "HWD" else "part_of_speech" if self.active == "POS" else "definitions" if self.active == "DEF" else "examples"
                value = re.sub(r"\s+", " ", " ".join(self.active_text)).strip()
                if value:
                    self.values[key].append(value)
                self.active = None
                self.active_depth = 0
                self.active_text = []


def lookup_longman(word):
    normalized = re.sub(r"[^A-Za-z0-9' -]", "", word).strip()
    if not normalized:
        raise ValueError("Invalid word")
    lower = normalized.lower()
    candidates = [lower]
    if " " not in lower:
        if lower.endswith("ies"):
            candidates.append(f"{lower[:-3]}y")
        if lower.endswith("ing"):
            stem = lower[:-3]
            candidates.extend([stem, f"{stem}e"])
        if lower.endswith("ed"):
            candidates.extend([lower[:-2], f"{lower[:-2]}e"])
        if lower.endswith("s"):
            candidates.append(lower[:-1])
    values = None
    url = ""
    for candidate in dict.fromkeys(candidates):
        url = f"https://www.ldoceonline.com/dictionary/{quote(candidate)}"
        request = Request(url, headers={"User-Agent": "EchoEtch local learning tool"})
        with urlopen(request, timeout=12) as response:
            html = response.read().decode("utf-8", errors="replace")
        parser = LongmanParser()
        parser.feed(html)
        values = parser.values
        if values["definitions"]:
            break
    return {
        "word": values["word"][0] if values["word"] else normalized,
        "part_of_speech": values["part_of_speech"][0] if values["part_of_speech"] else "",
        "definitions": list(dict.fromkeys(values["definitions"]))[:3],
        "examples": list(dict.fromkeys(values["examples"]))[:2],
        "url": url,
    }


def translate_sentence(text):
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        raise ValueError("Empty sentence")
    url = f"https://api.mymemory.translated.net/get?q={quote(normalized)}&langpair=en|zh-CN"
    request = Request(url, headers={"User-Agent": "EchoEtch local learning tool"})
    with urlopen(request, timeout=12) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))
    translated = payload.get("responseData", {}).get("translatedText", "").strip()
    if not translated:
        raise RuntimeError("No translation returned")
    return {"source": normalized, "translation": translated, "provider": "MyMemory"}


class NoCacheHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/longman":
            self.handle_longman(parse_qs(parsed.query).get("q", [""])[0])
            return
        if parsed.path == "/api/translate":
            self.handle_translate(parse_qs(parsed.query).get("q", [""])[0])
            return
        super().do_GET()

    def handle_longman(self, word):
        try:
            payload = lookup_longman(word)
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
        except (HTTPError, URLError, TimeoutError) as error:
            body = json.dumps({"error": "Longman 暂时无法访问", "detail": str(error)}, ensure_ascii=False).encode("utf-8")
            self.send_response(502)
        except ValueError as error:
            body = json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8")
            self.send_response(400)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_translate(self, text):
        try:
            body = json.dumps(translate_sentence(text), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
        except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
            body = json.dumps({"error": "暂时无法获取整句翻译", "detail": str(error)}, ensure_ascii=False).encode("utf-8")
            self.send_response(502)
        except ValueError as error:
            body = json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8")
            self.send_response(400)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8767), NoCacheHandler)
    print("EchoEtch is running at http://127.0.0.1:8767", flush=True)
    server.serve_forever()
