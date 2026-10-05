#!/bin/sh
# Leave-one-character-out evaluation: for each companion, fit the per-frame
# classifier and the change model on the other three, and evaluate the whole
# engine on the clips of the one it never saw. Then fit the shipped models
# on all four.
#
#   sh scripts/eval/loco.sh [source] [model] [evaluate args...]
#
# Needs .eval/synth (scripts/synth/render.mjs) and .eval/obs
# (scripts/eval/perceive.mjs).
set -e
SRC=${1:-mp-first}
MODEL=${2:-logreg}
shift 2 || true
CHARS="yusuf maryam ahmad aisha"
mkdir -p .eval/loco
node scripts/eval/run.mjs dump-features --source "$SRC" > ".eval/features-$SRC.csv" 2>/dev/null
for held in $CHARS; do
  train=$(echo $CHARS | tr ' ' '\n' | grep -v "^$held$" | paste -sd, -)
  python scripts/eval/fit.py ".eval/features-$SRC.csv" --model "$MODEL" --train-chars "$train" \
    --out ".eval/loco/posture-$held.json" --change-out ".eval/loco/change-$held.json" > ".eval/loco/fit-$held.log"
done
node scripts/eval/run.mjs evaluate --source "$SRC" --loco .eval/loco "$@"
# The shipped models see all four companions.
python scripts/eval/fit.py ".eval/features-$SRC.csv" --model "$MODEL" --all > .eval/loco/fit-all.log
