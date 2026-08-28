# The blind-comparison exhibit for the READ: a charger's dash passing through the i-frames.
# One frame, 4x NEAREST, no labels. $2 selects how many ticks past the `dodged` event.
set -e
E=$1; T=${2:-1}; U=${3:-http://localhost:5173}
C="const c=first(); until(()=>c.state==='dash',1200); until(()=>Math.hypot(c.x-p().x,c.y-p().y)<26,900); const a=Math.atan2(c.y-p().y,c.x-p().x); g.setInput({dodge:true,moveX:Math.cos(a),moveY:Math.sin(a),aimX:Math.cos(a),aimY:Math.sin(a)}); g.step(1); g.step($((1+T)));"
pnpm strip -- --url "$U" --scenario charger-swarm --seed 1 --frames 1 --cols 1 --zoom 4 --crop player,96,66 --out "$E/_exh2.png" --eval "$C" 2>&1 | tail -3
node -e "require('sharp')('$E/_exh2.png').extract({left:4,top:64,width:384,height:264}).png().toFile('$E/exhibit-through.png').then(()=>console.log('exhibit-through ok'))"
rm -f "$E/_exh2.png" "$E/_exh2.png.json"
