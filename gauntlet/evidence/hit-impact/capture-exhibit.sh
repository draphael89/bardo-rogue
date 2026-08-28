set -e
E=$1; T=${2:-6}
POSE='until(()=>first()); place(176,136); const e=first(); e.x=e.px=206; e.y=e.py=136;'
pnpm strip -- --scenario wave1 --seed 1 --from 90 --frames 1 --cols 1 --zoom 4 --crop 186,118,96,66 --out "$E/_exh.png" \
  --eval "$POSE g.setInput({attack:true,aimX:1,aimY:0}); g.step(1); g.step($T)" 2>&1 | tail -4
node -e "require('sharp')('$E/_exh.png').extract({left:4,top:64,width:384,height:264}).png().toFile('$E/exhibit.png').then(()=>console.log('exhibit ok'))"
rm -f "$E/_exh.png" "$E/_exh.png.json"
