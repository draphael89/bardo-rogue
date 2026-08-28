# Bardo Rogue — the gauntlet prompt

I want you to finish Bardo Rogue, a browser action-roguelike, at the level of Enter the Gungeon's
combat density and pixel-art dungeon craft and Hades' melee weight and run structure. It should be
utterly perfect: every hit lands with the full feedback chain, every enemy telegraphs, every frame
looks authored rather than assembled. It runs at a locked 60 fps in a normal browser. The theme is
the bardo, the space between death and rebirth.

Break it into the smallest pieces that can each be judged on their own and fan out sub-agents so
every piece gets its own builder. Pieces that touch shared state get one owner working in sequence;
never two agents on coupled work at the same time. The simulation in `src/sim/` is pure and
deterministic and must stay that way: no DOM, no pixi, no `Math.random`, no `Date`. Every gameplay
and feel number lives in `src/tuning.ts`. Keep `pnpm typecheck` and `pnpm test` green; if you change
the sim, regenerate the pinned replay hashes with `pnpm record-bots` and never hand-edit one.

Every piece also gets a separate, fresh sub-agent as its critic. The critic looks only at the real
thing — rendered screenshots, tick-labelled motion strips for anything that moves, `__game.state()`
traces for behaviour, and headless metrics for balance — never at code and never at the builder's
notes. It compares ours blind, side by side, in both orders, against real screenshots of the bar. It
is a harsh critic whose default assumption is that it CAN tell which one is ours. "Good for a web
game" is a loss. "Good for AI" is a loss. It names the single biggest gap, points at the file and
frame where it shows, and sends the piece back.

Never copy the reference's art, names, characters, lore, or composition. Copying the bar's layout is
itself a gap under Originality, not progress.

/loop on every piece until its critic genuinely cannot tell which one the professionals shipped.
After each wave, one fresh agent inspects the whole game and smooths the seams: one art style, one
feel, no joins. Keep the progress page current so I can watch it from my phone. Don't stop until
every critic is utterly wowed, or until I stop the run.

The worktree is shared and every other lane's work in it is uncommitted. Never run `git stash`,
`git reset --hard`, or `git checkout -- <path>` here. This is not a style rule: at 21:07 on wave 1 a
capture agent ran `git stash && <capture three frames> && git stash pop` to get a clean "before"
baseline, and for two minutes every lane in the run was reverted to the pre-gauntlet commit. Work
came back; the frames captured inside that window did not, and they showed old code while claiming
to show new. If you need a baseline capture, make a throwaway worktree
(`git worktree add /tmp/bardo-base <commit>`) and capture there. If you need to know what changed,
read `git diff`.
