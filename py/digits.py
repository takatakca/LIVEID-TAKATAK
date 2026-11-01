"""Offline spoken-digit recognizer for TAKATAK LIVE ID.

Reads a 16 kHz mono 16-bit WAV on stdin, prints {"text": "..."} on stdout.
The search is restricted to a grammar of digit words, so the recognizer can only answer with digits.

English uses the en-us dictionary shipped with pocketsphinx. French digit words are added with
approximate pronunciations in the English phone set (experimental: calibrate with real voices, or use
SPEECH_PROVIDER=openai for French).
"""
import argparse
import json
import sys
import wave

from pocketsphinx import Config, Decoder

EN = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]

FR = {
    "fr_un": ["AH N", "AE N", "UH N"],
    "fr_deux": ["D ER", "D UH"],
    "fr_trois": ["T R W AA", "T W AA"],
    "fr_quatre": ["K AE T R", "K AA T R", "K AE T"],
    "fr_cinq": ["S AE NG K", "S AE N K"],
    "fr_six": ["S IY S"],
    "fr_sept": ["S EH T"],
    "fr_huit": ["W IY T", "Y W IY T"],
    "fr_neuf": ["N ER F", "N UH F"],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["en", "fr"], default="en")
    args = parser.parse_args()

    data = sys.stdin.buffer.read()
    import io

    with wave.open(io.BytesIO(data)) as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            print(json.dumps({"error": "unsupported_format"}))
            return 2
        rate = w.getframerate()
        frames = w.readframes(w.getnframes())

    config = Config(logfn="/dev/null", samprate=rate)
    decoder = Decoder(config)

    words = list(EN)
    if args.lang == "fr":
        for word, prons in FR.items():
            for i, pron in enumerate(prons):
                decoder.add_word(word if i == 0 else f"{word}({i + 1})", pron, i == len(prons) - 1 and word == list(FR)[-1])
            words.append(word)

    grammar = "#JSGF V1.0;\ngrammar digits;\npublic <digits> = ( %s )+ ;\n" % " | ".join(words)
    decoder.add_jsgf_string("digits", grammar)
    decoder.activate_search("digits")

    decoder.start_utt()
    decoder.process_raw(frames, full_utt=True)
    decoder.end_utt()
    hyp = decoder.hyp()
    print(json.dumps({"text": hyp.hypstr if hyp else ""}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
