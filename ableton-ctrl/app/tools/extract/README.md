# Rhythm Extract — training and bench

Offline tools for the analysis in `src/extract/`. Nothing here ships in the app.

The drum classifier (`src/extract/model.ts`, weights in `modelWeights.ts`) is trained on
synthesized drum performances built from the sample content that comes with MPC Beats.
That content provides real one-shots (808, 909, acoustic, house, trap, hip-hop and DnB kits),
drum-free loops, pitched one-shots, and twelve finished demo songs. Only the trained weights are
kept in the repo, never any audio.

```bash
sh prepare.sh                      # MPC Beats content → ./data (22.05 kHz mono WAV, git-ignored)
node bench.ts                      # whole analysis: known patterns scored, demo songs printed as lanes
node train.ts                      # train and report on held-out kits and loops
node train.ts write ../../src/extract/modelWeights.ts
```

Node 22.6+ runs these `.ts` files directly. `prepare.sh` needs macOS (`afconvert`) and MPC Beats
installed. Set `DATA=…` to keep the converted audio elsewhere.

**What training does:** it renders random 6–10 s performances at 70–175 BPM. Each takes one
held-in sample per drum, often under a drum-free loop and a rhythmic bass or stab part. It runs
`listen()` on them and labels every detected onset with the drums placed within 30 ms. A quarter
of the one-shots and loops are held out and used only for the reported numbers and the
per-output thresholds.
