# Autotile: 4-bit edges and the 47-tile blob

Autotiling picks a wall or floor tile from its neighbours so edges and corners join without
hand placement. Room tile indices live in `src/sim/arena.ts`; the room sheet is 8 columns of
16 px, so index = row * 8 + col.

## 4-bit, 16 tiles (edges only)

Bit per cardinal neighbour of the same material: N = 1, E = 2, S = 4, W = 8.

    0  isolated        8  cap east
    1  cap south       9  corner SE
    2  cap west       10  horizontal
    3  corner SW      11  edge south
    4  cap north      12  corner NE
    5  vertical       13  edge east
    6  corner NW      14  edge north
    7  edge west      15  centre

Enough for straight walls and outer corners. Inner corners look wrong because the diagonal
neighbour is ignored.

## 8-bit blob, 47 tiles (edges and inner corners)

Add the four diagonals, but a diagonal counts only when both cardinals next to it are set.
That rule collapses the 256 raw masks to 47 distinct tiles.

    mask = 0
    if N              mask |= 1
    if NE and N and E mask |= 2
    if E              mask |= 4
    if SE and S and E mask |= 8
    if S              mask |= 16
    if SW and S and W mask |= 32
    if W              mask |= 64
    if NW and N and W mask |= 128

Out-of-bounds neighbours count as "same material" for walls (so the arena border stays solid)
and as "empty" for floor.

## Building the lookup

- Draw the 47 tiles once. Lay them out in a fixed order and record `mask -> sheet index` in a
  table in the tile tool, not in the sim.
- Compute the mask per cell at room build time, once. Never per tick.
- Test every tile by rendering a 3x3 block, a plus, a ring, and an L. Seams show there first.

## Variation

- Make 3-4 variants of the plain floor and centre wall tiles and pick one from the room seed
  with the sim RNG (`src/sim/rng.ts`), never `Math.random`.
- Keep variants at the same value range so the pattern does not draw the eye.

## Tile hygiene

- 16 px, square pixels, same palette ramps as the actors, same light direction.
- Edges of a repeating tile must match its own opposite edge. Test by tiling 4x4.
- No outline on floor tiles. Walls take a 1 px dark edge on the side facing the floor only.
