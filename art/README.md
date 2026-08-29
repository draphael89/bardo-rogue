# art/

Source, specs and approved masters for the art pipeline. Compiled output lives in `public/assets/`.

    art/specs/       versioned compile + generation specs (checked in)
    art/source/      editable generator output a compile spec points at
    art/references/  reference imagery for art direction
    art/approved/    masters a human has approved; the style reference pool for later generations
    art/palette/     the canon palette: canon.json is the source, the rest is emitted by `pnpm palette`
    .art-cache/      disposable candidates and compile reports (gitignored)

Run `pnpm art` with no arguments for the commands. `ART_DIRECTION.md` §12 is the contract; the audit
behind it is `docs/ART_PIPELINE_AUDIT.md`, and the reconciliation of the two competing plans is
`docs/ART_PIPELINE_SYNTHESIS.md`.
