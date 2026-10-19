#!/usr/bin/env python3
"""Check the actual embedded PCM, its reproducibility, peak and short duration."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import struct

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tones", root / "generate_tones.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
header = (root / "src/trace_prompt_audio.h").read_text()
manifest = json.loads((root / "tone-patterns.json").read_text())
assert len(manifest) == 6
for item, pattern in zip(manifest, module.PATTERNS):
    block = re.search(r"prompt_pcm_%d\[\] = \{(.*?)\};" % item["id"], header, re.S)[1]
    pcm = bytes(int(v) for v in re.findall(r"\d+", block))
    assert pcm == module.render(pattern[1], pattern[2], pattern[3])
    assert hashlib.sha256(pcm).hexdigest() == item["sha256"]
    samples = struct.unpack("<" + "h" * (len(pcm) // 2), pcm)
    assert max(abs(v) for v in samples) == 32767
    assert samples[0] == samples[-1] == 0
    assert len(pcm) * 1000 // 16000 == item["durationMs"] <= 355
    assert sum(samples) / len(samples) < 10
assert len({item["sha256"] for item in manifest}) == 6
driver = (root / "src/trace_speaker.c").read_text()
assert "sample = CLAMP(sample, -32767, 32767);" in driver
print("PASS: six distinct deterministic wordless PCM clips; 100% digital peak; <=355 ms; smooth endpoints; driver permits full peak")
