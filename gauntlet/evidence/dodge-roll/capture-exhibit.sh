# The blind-comparison exhibit: one frame, 4x NEAREST, no labels.
# Tick 6 of the roll — the whole language in one frame: launch dust behind, the hot streak while the
# i-frames are live, the body low and stretched along the travel, the blade tucked in.
set -e
E=$1; T=${2:-6}; U=${3:-http://localhost:5173}
POSE='until(()=>first()); place(160,118);'
pnpm strip -- --url "$U" --scenario wave1 --seed 1 --from 90 --frames 1 --cols 1 --zoom 4 --crop player,96,66 --out "$E/_exh.png" \
  --eval "$POSE g.setInput({dodge:true,moveX:1,moveY:0,aimX:1,aimY:0}); g.step(1); g.step($T)" 2>&1 | tail -3
node -e "require('sharp')('$E/_exh.png').extract({left:4,top:64,width:384,height:264}).png().toFile('$E/exhibit.png').then(()=>console.log('exhibit ok'))"
rm -f "$E/_exh.png" "$E/_exh.png.json"
