# Dodge-roll evidence. Same seed, same crop box, every round.
# The press is ONE discrete edge (setInput clears edge fields after a step); never re-pressed per tick.
set -e
E=$1
U=${2:-http://localhost:5173}
mkdir -p "$E"
# arena is 416x240 in a 480x270 view, so arenaOffset = (32,15). Player parked at arena (160,118)
# = view (192,133): the whole 32 px roll to the right stays inside the fixed crop 176,88,128,96.
POSE='until(()=>first()); place(160,118);'
PRESS='g.setInput({dodge:true,moveX:1,moveY:0,aimX:1,aimY:0}); g.step(1);'

# 1) the prescribed strip: launch -> traversal -> landing, ticks 0..22 of a 24-tick roll
pnpm strip -- --url "$U" --scenario wave1 --seed 1 --from 90 --frames 12 --every 2 --crop 176,88,128,96 --out "$E/strip.png" \
  --eval "$POSE $PRESS" 2>&1 | tail -5

# 2) the landing half at tick resolution: the brake, the vulnerable tail, the crouch, the rise
pnpm strip -- --url "$U" --scenario wave1 --seed 1 --from 90 --frames 12 --every 1 --crop 176,88,128,96 --out "$E/strip-landing.png" \
  --eval "$POSE $PRESS g.step(10)" 2>&1 | tail -5

# 3) the read being rewarded: a brute's attack passing through the i-frames
# the brute's hit test runs on attack ticks 7..11, so the press lands at attack tick 2: the i-frame
# window (roll ticks 1..10) then covers the whole live window, and the roll goes THROUGH the swing.
# The brute commits its aim before the windup ends, so the player is moved out to 34 px: after the
# 24 px lunge the blow lands with the player still inside the cone, which is what a real late dodge
# looks like. Pressed at attack tick 5, so the hit test on attack tick 7 falls on roll tick 1.
THROUGH='const b=first(); near(b,22,0); until(()=>b.state==="windup"&&b.stateTick>=17,900); place(b.x+34,b.y); until(()=>b.state==="attack"&&b.stateTick>=5,900); g.setInput({dodge:true,moveX:-1,moveY:0,aimX:-1,aimY:0}); g.step(1);'
pnpm strip -- --url "$U" --scenario brute-only --seed 1 --frames 12 --every 1 --crop player,128,96 --out "$E/strip-through.png" \
  --eval "$THROUGH" 2>&1 | tail -5
