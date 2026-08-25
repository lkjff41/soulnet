"""Regenerate dsh/packages/sidebar/src/client/brand-assets.ts from a square PNG
(the SoulMirror app icon): downscale to 128px and inline as a data URI.

    python dsh/scripts/brand-asset.py <icon.png>

Needs Pillow. The product's source icon lives in the product repository
(web/favicon.png, 1024px); it is not part of this repository.
"""
import base64
import io
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "packages" / "sidebar" / "src" / "client" / "brand-assets.ts"
SIZE = 128


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    image = Image.open(sys.argv[1]).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    data = base64.b64encode(buffer.getvalue()).decode("ascii")
    OUT.write_text(
        "/**\n"
        " * The SoulMirror app icon (web/favicon.png of the product, 1024px) downscaled to 128px and\n"
        " * inlined, so the brand slots need no asset route. Regenerate with dsh/scripts/brand-asset.py.\n"
        " */\n"
        f"export const SOULMIRROR_ICON_{SIZE} = 'data:image/png;base64,{data}'\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {OUT} ({len(buffer.getvalue())} PNG bytes)")


if __name__ == "__main__":
    main()
