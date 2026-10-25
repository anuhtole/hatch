#!/usr/bin/env bash
# Install the genuine Monotype Garamond (Office's GARA.ttf family) as the
# "Garamond" font family, so LibreOffice/Quick Look/Word and the shipped PDF
# all render the canonical résumé font instead of substituting Times.
# B-14: required for the resume pipeline's faithful render + Word PDF export.
set -euo pipefail
SRC="/Applications/Microsoft Word.app/Contents/Resources/DFonts"
DEST="$HOME/Library/Fonts"
for f in GARA.ttf GARABD.ttf GARABDIT.ttf GARAIT.ttf; do
  if [[ -f "$SRC/$f" ]]; then cp "$SRC/$f" "$DEST/"; echo "installed $f → $DEST"; else echo "MISSING: $SRC/$f"; fi
done
echo "Garamond family installed. Verify: fc-list | grep -i garamond  (or render via Word)."
