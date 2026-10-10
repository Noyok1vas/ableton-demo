#!/bin/sh
# Convert the MPC Beats sample content into the 22.05 kHz mono WAVs the
# training and bench scripts read. macOS only (uses afconvert).
#
#   sh prepare.sh [data-dir]      default: ./data (git-ignored)
set -e
OUT="${1:-$(dirname "$0")/data}"
KITS="/Library/Application Support/Akai/MPC/Content/com.akaipro.mpc.expansion.mpcbeatsproducerkits"
DEMOS="/Library/Application Support/Akai/MPC/Content/com.akaipro.mpc.expansion.mpcbeatsdemosandtemplates/Demos"
[ -d "$KITS" ] || { echo "MPC Beats content not found at $KITS"; exit 1; }
mkdir -p "$OUT/shots" "$OUT/beds" "$OUT/tonal" "$OUT/songs"
conv() { afconvert -f WAVE -d LEI16@22050 -c 1 "$1" "$2" 2>/dev/null || true; }
name() { echo "$1" | sed 's/\.WAV$//; s/[^A-Za-z0-9-]/_/g'; }

cd "$KITS"
for f in *.WAV; do
  case "$f" in
    *-Kick-*|*-Snare-*|*-Hat-*|*-HiHat-*|*-Cymbal-*|*-Tom-*|*Perc-909\ Tom*|*-Clap-*)
      conv "$f" "$OUT/shots/$(name "$f").wav" ;;
  esac
done
# Drum-free loops: the music under the drums.
ls | grep -i "Loop" | grep -viE "drum|perc|hat|kick|snare|top|beat|groove|clap|cym|ride|shaker|tamb" |
  while read -r f; do conv "$f" "$OUT/beds/$(name "$f").wav"; done
# Pitched one-shots: bass notes and stabs, the commonest false drums.
ls | grep -iE "\-(Bass|Synth|Keys|Stab|Chord|Pluck|Lead|Piano|Vox|Vocal|Pad|Brass|Guitar|Organ)-" | grep -viE "Loop" |
  while read -r f; do conv "$f" "$OUT/tonal/$(name "$f").wav"; done
# Finished songs, for listening checks.
for d in "$DEMOS"/*_\[ProjectData\]; do
  conv "$d/Project Preview.wav" "$OUT/songs/$(basename "$d" | sed 's/ Demo.*//; s/ /_/g').wav"
done
echo "shots $(ls "$OUT/shots" | wc -l)  beds $(ls "$OUT/beds" | wc -l)  tonal $(ls "$OUT/tonal" | wc -l)  songs $(ls "$OUT/songs" | wc -l)"
