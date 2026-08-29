# Approved masters

An image lands here only by human decision, recorded as a hash-verified receipt beside the master
(`<name>.approval.json`, written by `pnpm art approve`). Everything generated afterwards is
conditioned on this pool, so consistency compounds instead of being re-argued per asset — and so
does any fault that gets approved by accident. This is the one deliberate human checkpoint in the
pipeline; spend it. A master that changes after approval no longer matches its receipt, and
production compilation stops until a human re-approves or restores it.

Generation resolves this pool by stable path order, never modification time. When capped, the
lexicographically LAST files win — under the `…-vN` naming convention that is the newest versions,
which is what new work should be conditioned on. Retro Diffusion receives at most the last four
PNGs; PixelLab's bitforge takes exactly ONE style image, so a spec aimed at it must name one
deliberate master rather than a directory — the adapter rejects a pool instead of picking silently.
Name files deliberately: path order is provider input order.
