set -e
E=$1; EXTRA=${2:-}
mkdir -p "$E"
POSE='until(()=>first()); place(176,136); const e=first(); e.x=e.px=206; e.y=e.py=136;'
pnpm strip -- --scenario wave1 --seed 1 --from 90 --frames 12 --every 2 --crop 160,80,160,110 --out "$E/strip.png" \
  --eval "$POSE $EXTRA g.setInput({attack:true,aimX:1,aimY:0}); g.step(1); g.step(4)" 2>&1 | tail -6
pnpm strip -- --scenario wave1 --seed 1 --from 90 --frames 12 --every 2 --crop 160,80,160,110 --out "$E/strip-idle.png" \
  --eval "$POSE $EXTRA g.step(5)" 2>&1 | tail -6
