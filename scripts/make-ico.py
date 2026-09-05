#!/usr/bin/env python3
"""Wrap PNG files into a single .ico (PNG-in-ICO, supported by every modern
browser). Stdlib only — this machine has no ImageMagick.

    python3 scripts/make-ico.py out.ico 16.png 32.png 48.png
"""
import struct
import sys


def png_size(data: bytes) -> tuple[int, int]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    w, h = struct.unpack(">II", data[16:24])
    return w, h


def main(out: str, pngs: list[str]) -> None:
    blobs = [open(p, "rb").read() for p in pngs]
    header = struct.pack("<HHH", 0, 1, len(blobs))
    entries, offset = b"", 6 + 16 * len(blobs)
    for blob in blobs:
        w, h = png_size(blob)
        entries += struct.pack(
            "<BBBBHHII", w if w < 256 else 0, h if h < 256 else 0, 0, 0, 1, 32, len(blob), offset
        )
        offset += len(blob)
    with open(out, "wb") as f:
        f.write(header + entries + b"".join(blobs))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
