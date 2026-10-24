# -*- coding: utf-8 -*-
"""Export launcher UI SVG without page background for the website."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

SRC = Path(__file__).resolve().parents[2] / "exeyta-launcher-mockups.svg"
if not SRC.exists():
    SRC = Path(r"C:\Users\Nazar\exeyta-launcher-mockups.svg")
DST = Path(__file__).resolve().parents[1] / "assets" / "launcher-ui.svg"

NS = {"svg": "http://www.w3.org/2000/svg"}
ET.register_namespace("", "http://www.w3.org/2000/svg")


def main():
    text = SRC.read_text(encoding="utf-8")
    m = re.search(r"<g clip-path=\"url\(#win\)\">(.*)</g>\s*</svg>", text, re.DOTALL)
    if not m:
        raise SystemExit("clip group not found")
    inner = m.group(1)
    defs_m = re.search(r"<defs>.*?</defs>", text, re.DOTALL)
    defs = defs_m.group(0) if defs_m else "<defs></defs>"
    out = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="28 22 1864 1036" width="1864" height="1036">\n'
        f"{defs}\n"
        f"<g>{inner}</g>\n"
        "</svg>\n"
    )
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(out, encoding="utf-8")
    ET.fromstring(out.encode("utf-8"))
    print("OK", DST)


if __name__ == "__main__":
    main()
