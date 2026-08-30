// Every gameplay and feel number lives here. Units: px (1 tile = 16 px), ticks (60 Hz), px/s for speeds.
// Mutable on purpose: the debug API (window.__game.tuning) edits it live.

export const TICK_RATE = 60
export const TICK_MS = 1000 / TICK_RATE
export const DT = 1 / TICK_RATE

export interface SwingDef {
  startup: number; active: number; recovery: number
  damage: number; radius: number; arcDeg: number
  lunge: number           // px the body travels forward across the active window, on the blade's own curve
  windup: number          // px the body drifts backward across startup — the coil you can see
  hitstop: number; knockback: number
  chainFrom: number       // recovery tick from which a buffered attack chains into the next swing
  dodgeCancelFrom: number // recovery tick from which a dodge can cancel
  whiffPenalty: number    // extra recovery ticks, and a later chain, when the swing touched nothing
  moveCommit: number      // movement scale through startup + active (0 = planted)
  moveRecover: number     // movement scale at the first recovery tick; eases back to 1 by the end
  steerTicks: number      // startup ticks during which the swing angle still tracks the aim
  sweep: 1 | -1           // visual sweep direction
  heavy: boolean
}

export const tuning = {
  // The internal render target (ADR 0002): 640x360, integer-upscaled to the window; width is
  // adaptive (app.ts fitViewWidth). `worldScale` is the world-render scale: sim space (16px tiles)
  // draws onto the target at 1.5x, so tile art carries 24px per tile while every sim distance and
  // speed stays in sim px. Render-side only — the sim never reads this block.
  view: {
    width: 640, height: 360, worldScale: 1.5,
    // The follow camera (ADR 0001), the ONE home for camera feel. followLerp / lookaheadLerp
    // are per 60Hz frame (dt-corrected in camera.ts); lookahead is px the view leads the aim.
    // A room that fits the viewport collapses the clamp range (camera.ts clampFocus) and is
    // centred exactly, which is what keeps today's rooms static under the same code path.
    camera: { followLerp: 0.12, lookahead: 4, lookaheadLerp: 0.08 },
  },

  player: {
    radius: 5,
    // Vector-space ticks from rest to full speed, from full speed to rest, and to cross zero when
    // reversing. Sideways momentum brakes separately so a 90° correction stays crisp.
    maxSpeed: 95, accelTicks: 4, decelTicks: 3, turnTicks: 2,
    hp: 5,
    hurtIFrames: 40, hurtKnockback: 12, hurtHitstop: 4,
    // Damage gets one short, authored punctuation after hit-stop. Seven ticks are long enough for
    // the recoil silhouette to read, but still fit inside the existing 200 ms input buffers. A
    // little locomotion remains so the reaction feels like lost initiative, not a confiscated pad.
    hurtReactionTicks: 7, hurtMoveScale: 0.2, hurtVelocityRetain: 0.15,
    // Launch, invulnerable traversal, landing — three readable phases in one state, and a price.
    // Travel is the escape; landing is the cooldown. i-frames cover the whole travel so the roll
    // you asked for is the roll you got. Landing keeps a steer floor so the feet come back under
    // you instead of gluing to the floor. Seven landing ticks, not eleven: the roll ends on the
    // feet, not in a stumble. Distance is 24 px so a held roll still cannot beat a run.
    dodge: {
      total: 20,            // whole dodge state: travel + landing recovery
      travel: 13,           // ticks the roll's own momentum owns the body
      distance: 24,         // px covered across those travel ticks — landing mobility uses the rest of the budget so a held roll cannot beat a run
      push: 0.55,           // speed scale on the launch tick: the shove off the back foot
      brake: 5,             // closing travel ticks, decelerating to a dead stop
      iStart: 0, iEnd: 12,  // i-frames: the whole travel, including the launch and the brake
      landMoveExp: 1.2,     // steering eases in across the landing
      landMoveMin: 0.28,    // first landing tick still has ~27 px/s — a step, not a plant
      wallSlideMinForwardRatio: 0.25, // a 30°+ glance slides; less forward progress meets the wall and lands
      attackCancelFrom: 9,  // late travel: light contact begins only after authored i-frames end
      reversalWindow: 20,   // a true pass-through leaves a short player-clock opening to answer
      buffer: 12,           // maximum age of a discrete request on the player's unfrozen control clock (200 ms)
    },
    attack: {
      buffer: 12,
      // Before this the heavy can be abandoned; from here the visible plant is a promise. It is also
      // the ONE number the heavy's whole telegraph derives from: presenter.heavyPromiseFrame() turns
      // it into the render frame that carries the glow, the plant dust and the shake. There used to
      // be a second number (heavyChargeTicks) lighting the glow two ticks earlier, which meant the
      // ramp began before the promise and nothing at all marked the promise.
      heavyCommitTick: 4,
      steerRateDeg: 16,     // max deg/tick the swing angle may still be steered, during steerTicks only
                            // note the press tick cannot steer (the state is entered after the steer block),
                            // so a light's usable correction is (steerTicks - 1) * steerRateDeg — 48°,
                            // enough for an 8-way tap to finish a cardinal-to-diagonal redirect
      swings: [
        { startup: 4, active: 4, recovery: 13, damage: 2, radius: 25, arcDeg: 130, lunge: 13, windup: 2, hitstop: 3, knockback: 90, chainFrom: 2, dodgeCancelFrom: 0, whiffPenalty: 7, moveCommit: 0.45, moveRecover: 0.7, steerTicks: 4, sweep: 1, heavy: false },
        { startup: 4, active: 4, recovery: 13, damage: 2, radius: 25, arcDeg: 150, lunge: 15, windup: 2, hitstop: 3, knockback: 95, chainFrom: 2, dodgeCancelFrom: 0, whiffPenalty: 7, moveCommit: 0.45, moveRecover: 0.7, steerTicks: 4, sweep: -1, heavy: false },
        { startup: 12, active: 7, recovery: 24, damage: 4, radius: 31, arcDeg: 215, lunge: 30, windup: 8, hitstop: 8, knockback: 260, chainFrom: 999, dodgeCancelFrom: 4, whiffPenalty: 14, moveCommit: 0, moveRecover: 0.35, steerTicks: 4, sweep: 1, heavy: true },
      ] as SwingDef[],
    },
    aimAssistDeg: 28,
    aimAssistHysteresisDeg: 8,
    aimAssistRangeBlade: 72,
    aimAssistRangeBow: 220,
    aimLockConeDeg: 50,
    aimLockRange: 150,
    aimLockBreakRange: 180,
    deathSlowmoTicks: 30, deathSlowmo: 0.25,
  },

  // One committed draw → loose. Attack is still edge-triggered; no hold-to-charge this piece.
  bow: {
    draw: 10,
    recover: 14,
    dodgeCancelFrom: 6,   // state ticks from the draw start: cancel the string, or roll after the loose
    steerTicks: 8,
    muzzle: 10,
    speed: 260,
    radius: 3,
    life: 72,
    damage: 2,
    knockback: 50,
    hitstop: 2,
    moveDraw: 0.2,
    moveRecover: 0.55,
  },

  hitstop: { killBonus: 2, max: 12, boltCut: 3 },
  knockbackDecayTicks: 8,
  wallSlamMinSpeed: 100, // only committed knockback can author a stone punctuation; no extra damage

  // Combat slow-motion. The player and the input poll stay welded to 60 Hz; only enemies and
  // projectiles run on the stretched clock, so your own swing is full speed while the world crawls.
  // `rate` is per-mille of normal speed and should divide 1000, or the stretched clock is not exact.
  // Short on purpose: at rate 250 the player gets four times the real time to act AND four times the
  // real-time damage, so the window is the lever, not the depth.
  // heavyRate/heavyTicks: a short breath on a committed connect. 500 divides 1000 exactly.
  // graze: a hostile hitbox passed close during the roll without overlapping. Short, half-speed,
  // once per roll. The jackpot (overlap) still owns the long deep window.
  bullet: {
    rate: 250, ticks: 24, maxTicks: 24,
    heavyRate: 500, heavyTicks: 8,
    cutRate: 500, cutTicks: 4,
    grazeRate: 500, grazeTicks: 6, grazePx: 8,
  },
  spawnTelegraphTicks: 40,
  // Stock arenas keep the old half-second hold so pinned hashes stay put. The loop's door
  // flash is the hold (`loopLeadTicks` === `transitionTicks`). `startWaves` does not wait it
  // again — the first tell is already on the floor when the room is visible.
  waveLeadTicks: 30,
  loopLeadTicks: 8,
  // One short breath between curriculum beats. A 1.5 s reset lets the kill release, clears visual
  // residue, and gives the next formation a clean first read. It also keeps the fastest seeded route
  // above the 55-second control-proof floor without padding enemy health or weakening mastery.
  waveGapTicks: 90,
  // Enemies of one family may overlap attacks, but their tells should not begin on the same beat.
  // Eight ticks keeps a charger pack dangerous while making each release individually readable.
  enemyTellStartGap: 8,
  roomClearSlowmo: 0.2, roomClearSlowmoTicks: 12,
  // Minimum reveal beats before a live confirm/restart may leave the death or victory screen.
  // Enforced in the INPUT layer only (src/input): bots, replays and the debug override bypass it,
  // so the sim stays ungated and the pinned replay fixtures cannot drift.
  reveal: {
    deathMinTicks: 50,    // the death card's key cap lands at CT beat 46 (hud.ts): the way out works only once it is shown
    victoryMinTicks: 30,  // the victory card arrives in one beat; half a second so a buffered press cannot skip it unread
  },
  // The pause card's feel. Read by the shell only (src/main.ts) — the sim never touches these; the
  // hold runs on the render clock in seconds because the sim is stopped while the card is up.
  menu: {
    abandonHoldSec: 0.9,  // deliberate, but short enough that it never reads as broken
    volumeStep: 0.1,      // one slider notch per press / repeat
  },
  run: {
    doorHalfW: 22,        // px: the open door is three tiles wide
    doorEnterDepth: 16,   // px past the door row's top edge; overlapping it while open enters (ADR 0001: relative to the door's row, not row 1)
    offeringRadius: 16,   // px: walk into the vessel to take it
    offeringHp: 1,        // extra max life, and a heal of the same
    rackRadius: 18,       // px: generous enough to read as a physical pickup, not pixel hunting
    transitionTicks: 8,   // 133 ms: enough for a threshold blink, never enough to break momentum
    // 400 ms before a modal will take an answer. The offer opens on the tick the last enemy
    // dies, so without this the attack you were already mashing claimed a vow you never saw.
    // Long enough to notice a screen arrived, short enough that a player who knows what they
    // want is never made to wait for a second press. Moving the SELECTION stays live throughout,
    // so the wait costs a practised player nothing.
    modalArmTicks: 24,
  },

  // THE TOLL. The run's one non-combat beat, and the only place a permanent cost is on the table.
  // lifeCost is a whole vessel out of five, which is the same unit the shore's offering gives back —
  // paying is meant to be felt for the rest of the descent, not shrugged off.
  // The refusal is not paid here: it is paid in the Hall of Minos, where the account is read out.
  // Run coins and the home-banked shade-memory. Obols die with the attempt; Remembrances do not.
  // Shop prices assume the landing pack has paid out — heal is the affordable default the bots take.
  economy: {
    obolsPerKill: { brute: 2, caster: 2, charger: 2, dummy: 0, warden: 4, oathbound: 3 },
    obolsPerClear: 3,
    remembrancePerDepth: 1,
    remembranceOnVictory: 3,
    shop: {
      healCost: 6, healAmount: 2,
      vesselCost: 10, vesselAmount: 1,
      vowCost: 12,
    },
    smith: {
      rerollCost: 3,
      vesselCost: 5,
      vesselAmount: 1,
      radius: 18,
    },
    mystery: {
      chance: 0.5,
      coinCost: 8,
      coinHeal: 2,
      memoryCost: 1,
      memoryVessel: 1,
      huntKind: 'brute' as const,
      huntX: 22,
      huntY: 12,
      huntDelay: 150,
    },
  },

  rites: {
    toll: {
      lifeCost: 1,
      debtKind: 'charger' as const,   // the river sends something that swims
      debtX: 4, debtY: 12,            // tiles: the hall's far corner, at the water — never on top of the player
      debtDelay: 150,                 // ticks: its mark is on the floor before Minos, and it wades in a second after him
    },
  },

  // Status effects: the shared vocabulary boons compose through. Burn is deliberately modest -
  // enemies here have 2 to 8 life, so a status that out-damages the sword would replace the sword.
  status: {
    burn: {
      maxStacks: 3,
      ticks: 60 * 3,      // the whole sentence, refreshed by a new ignition
      interval: 24,       // ticks between bites: slow enough to read as fire, not a damage number fountain
      damage: 1,          // per stack, per bite
    },
  },

  boons: {
    cleave: { radiusAdd: 9, arcAdd: 44, damageAdd: 0, smearAdd: 3 },
    brandMax: 3,
    brandTicks: 60 * 12,
    judgmentDamage: 2,
    judgmentRadius: 34,
    judgmentKnockback: 120,
    judgmentHitstop: 4,
    mirrorDamage: 2,
    mirrorLife: 90,
    echoSpeed: 210,
    echoRadius: 9,
    echoLife: 10,
    echoDamage: 1,
    // Phlegethon's Kiss: the heavy already commits; the fire is the reason to keep committing.
    emberKissBurn: 2,
    // Unanswered pays for a read, so it pays properly: a second helping of the heavy's own damage
    // on top of the swing that earned it, plus the knockback of being caught mid-word.
    unansweredDamage: 4,
    unansweredKnockback: 200,
    unansweredHitstop: 7,
    // The debt passes to whoever is close enough to inherit it - about three tiles.
    debtRange: 56,
    // Hecate's torch reaches a little further than her blade does.
    torchRange: 72,
    torchBurn: 2,
    // The duo. Two stacks on everything the burst touches, so a branded crowd goes up at once.
    pyreBurn: 2,
  },

  brute: {
    hp: 8, radius: 7, speed: 48, attackRange: 26,
    windup: 20, lungeDist: 24, lungeTicks: 6, active: 5, hitRadius: 20, hitArcDeg: 120,
    recovery: 34, staggerTicks: 20, lightNudge: 4, damage: 1, knockbackScale: 0.5,
  },
  // The elite: a Fallen Hoplite that still remembers its oath, and its shield. Tougher and slower
  // than the line shade, and its whole design is the guard - the numbers below are deliberately close
  // to the brute's, because the difference is meant to be the RULE, not the statline.
  oathbound: {
    hp: 12, radius: 7, speed: 40, attackRange: 26,
    windup: 24, lungeDist: 22, lungeTicks: 6, active: 5, hitRadius: 20, hitArcDeg: 110,
    recovery: 32, staggerTicks: 26, damage: 1, knockbackScale: 0.35,
    idleTicks: 20,
    // Wide enough that walking around it is a real detour, narrow enough that it is not a full circle:
    // there is always an answer behind them.
    guardArcDeg: 170,
    // A turned blow still lands on something: the shield shoves back and the frame catches, so a
    // block reads as a physical event rather than as damage that failed to register.
    blockKnockback: 26,
    blockHitstop: 4,
  },
  caster: {
    hp: 3, radius: 5, retreatRange: 70, prefMin: 90, prefMax: 130, speed: 40, strafeSpeed: 30,
    // boltSpeed is the WHOLE speed. It used to be 110 here and a private 1.8x scale in caster.ts, so
    // the one number a tuner would reach for was not the number the bolt flew at. MEASURED, and the
    // reason it is 198: at 110 px/s the bolt advances 1.83 px per tick — less than one pixel of the
    // 2x strip the piece is judged on, and the head's centroid moved +0.2 px over six ticks while
    // the sim moved it 11. Travel that small cannot read as travel at any art quality. 198 puts the
    // head at 3.3 px/tick, unmissable frame to frame, and still leaves ~30 ticks of flight from the
    // preferred 90–130 px band: half a second to see it, step aside, or cut it.
    aimTicks: 24, cooldown: 70, boltSpeed: 198, boltRadius: 3, boltLifeTicks: 180, damage: 1, staggerTicks: 10, knockbackScale: 1,
  },
  charger: {
    hp: 2, radius: 4, hoverMin: 50, hoverMax: 70, hoverSpeed: 60, orbitSpeed: 1.6,
    freezeTicks: 16, commitLead: 9, dashSpeed: 160, dashDist: 80, recovery: 30, damage: 1, staggerTicks: 8, knockbackScale: 1.2,
    hoverMinTicks: 40, hoverMaxTicks: 90,
  },
  // MINOS, JUDGE OF THE FIRST GATE. The code name stays `warden` because the enemy kind is an
  // append-only hashed enum. Three deterministic sentences rotate: leave the judgment circle, read the gaps in
  // an outward veil burst, then cross an aimed fan. At half life the veil breaks in its own safe
  // beat, then each sentence brings the next one with it — circle+veil, veil+fan, fan+circle.
  // The tell that named a sentence does not get shorter. Poise: lights bounce; heavies stagger
  // only while he is not committed.
  warden: {
    hp: 80, radius: 10, speed: 28, orbitMin: 52, orbitMax: 76, orbitSpeed: 0.9,
    phaseThreshold: 0.5, phaseTransitionTicks: 45, phaseShards: 12,
    guardDamageScale: 0.5, guardHitstop: 2,
    windup: 36, windup2: 24, commitLead: 8,
    slamRadius: 42, slamTicks: 4, slamDamage: 2,
    recover: 48, recover2: 32, cooldown: 18,
    staggerTicks: 10, knockbackScale: 0.22,
    ringWindup: 32, ringWindup2: 25, ringRecover: 42, ringRecover2: 29,
    ringAttackTicks: 4, boltCount: 8, boltCount2: 10,
    boltSpeed: 96, boltSpeed2: 108, boltRadius: 3, boltLife: 84, boltDamage: 1,
    fanWindup: 30, fanWindup2: 24, fanRecover: 40, fanRecover2: 28,
    fanCount: 3, fanCount2: 5, fanSpreadDeg: 44,
    fanSpeed: 118, fanSpeed2: 128, fanLife: 96,
    // Phase two answers the first spread with a visibly swept return. The sign alternates with the
    // deterministic pattern cycle, so neither side of the arena becomes a permanent safe habit.
    fanAttackTicks: 4, fanVolleyGap: 8, fanVolleys2: 2, fanVolleySweepDeg: 18,
    idleTicks: 20,
  },

  juice: {
    // How a god's offer arrives. The simulation is parked the whole time (step.ts returns on the
    // 'reward' phase), so this costs nothing and is purely what the eye is given: the room stays
    // visible for a beat under a thickening veil, the cards land one after another, and the prompt
    // only lights when the sim will actually take an answer. Everything must finish inside
    // run.modalArmTicks, or the screen invites a press it is still refusing.
    modalReveal: {
      scrimTicks: 8,     // the veil closing over the kill you just made
      cardStagger: 4,    // between one card landing and the next
      cardTicks: 6,      // each card's own fade and 3px settle
      cardRise: 3,       // px it drops from
    },
    shakeMax: 4, shakeRotMaxDeg: 0.5, shakeDecay: 1.6,
    traumaLight: 0.40, traumaHeavy: 0.58, traumaHurt: 0.6, traumaKill: 0.22,
    flashTicks: 4, squashTicks: 6,
    hitFlashSec: 0.034,     // enemy white-flash on real time: two frames. Longer and the target is a
                            // featureless white blob for most of the hit-stop.
    aberrationTicks: 3,
    aberrationStrength: 2,  // TARGET px of red/blue split at the pulse peak, quantised to whole target pixels (§6.8)
    // Screen flash on an ordinary kill. It has to sit UNDER heavy contact (0.20) and under getting
    // hurt (0.25), or the most routine event in the fight is also the loudest and the next telegraph
    // is washed out by the last thing you killed. The shatter and the punch-zoom carry the release.
    killFlash: 0.12,
    // Projectile trails are stamped every N px the bolt travels, not every N frames: per-frame
    // emission put 2.4x the trail on a 144 Hz display, and bunched it up under slow-motion.
    trail: { boltPx: 7, arrowPx: 11 },
    zoom: { roomClear: 1.06, kill: 1.015, heavyHit: 1.035, decay: 6 }, // decay = per-second ease rate back to 1
    // Contact. The light hit is ~90% of all contact, so it gets the whole chain, only smaller: the
    // camera is shoved along the blade, the body is shoved back off it, the screen blinks once.
    hit: {
      lightKick: 2.6, heavyKick: 5.2,       // px the camera travels along the blade at contact
      kickDecay: 5.5,                       // per-second ease rate; ~3 frames to snap back
      lightZoom: 1.018,                     // punch-in on a light hit (the heavy uses zoom.heavyHit)
      lightFlash: 0.11, heavyFlash: 0.20, flashTint: 0xfff0d0,
      recoil: 2.2, recoilDecay: 12,         // px the player's own body jolts back, and its decay rate
      screen: {
        crowdBonus: 0.18, crowdCap: 1.25,  // sqrt bonus: bodies multiply, the screen gesture does not
        kickCap: 6.5, recoilCap: 5, traumaCap: 0.7,
      },
      bodyKick: 3.2,                        // px the struck body is shoved along the blow during the freeze
      bodyLean: 0.22,                       // rad the struck silhouette tips away from the blade
      redFlash: 3,                          // ticks the struck body wears wine
      blessedRedFlash: 8,
      blessedHitFlashSec: 0.08,
      heavySparks: 16,
      guarded: {
        // An intact veil answers at the contact point. Keep only a trace of screen acknowledgement;
        // the full camera sentence belongs to a real opening or a kill.
        screenScale: 0.12, squashTicks: 2, hitFlashSec: 0.017,
        sparks: 3, sparkHot: 0xe8edf0, spark: 0x8798a3,
      },
      // The contact stamp. Two authored shapes, no soft sprites: a crescent of whole pixels UNDER both
      // fighters (so neither silhouette is ever touched) and a chromatic spark cluster ON the wound.
      // Six tones in total — an alpha-blended bloom adds forty and reads as a smear, not a shape.
      contact: {
        stepSec: 0.022,          // real-time step between tiers; the hit-stop holds tier 0
        edgeFrom: 0.72,          // outer blade third gets a sharper contact/reaction class, no damage bonus
        tiers: 3, heavyTiers: 4,
        snapSteps: 16,           // the crescent only ever points one of 16 ways, like an authored sprite
        spanDeg: 74, heavySpanDeg: 104,
        thick: 5, heavyThick: 9, // px across the fat leading end; the tail runs out to a point
        out: 3, heavyOut: 4,     // px the arc sits beyond the contact, so it passes the target
        rim: 0x120d18,           // 1px dark contrast rim: without it pale steel dies on a pale floor
        steel: 0xbfd0ea,
        core: 0xfff8ec,          // hot leading half, tier 0 only
        sparks: 6, heavySparks: 9,
        sparkSpreadDeg: 52, sparkStepPx: 3,
        sparkHot: 0xffeeb0, spark: 0xffa832,
        drops: 5, heavyDrops: 7, blood: 0xb62a26,
        // the wound: a short red cut ON the body plus shards thrown through it. The crescent stays
        // under the fighters; this is the sentence that says meat, not a swipe.
        woundLen: 7, heavyWoundLen: 13,
        woundThick: 2, heavyWoundThick: 4,
        shards: 5, heavyShards: 7, shardLen: 5,
        poolW: 7, poolH: 3,
      },
    },
    // A successful i-frame dodge-through is the hardest input in the game. It is the only cold-coloured
    // feedback in the fight, so it can never be mistaken for a hit or for damage taken.
    // It is drawn the way the contact stamp is and for the same reason: an authored whole-pixel mark
    // on the FLOOR, under both fighters, plus a one-pixel rim on the player's own outline. Nothing is
    // ever painted over a body, there is no screen-wide lift, and the brightest pixel in the frame
    // lands ON the actor — the reward for the read has to show you the thing that made it.
    dodged: {
      tint: 0x9fd8ff, zoom: 1.035, trauma: 0.10,
      stepSec: 0.016,           // one tier per tick, and strictly under 1/60 so no tier is ever held for two: no two frames of the mark are ever the same image
      tiers: 4,
      r0: 7, rStep: 5,          // the open ring's radius per tier. It expands and thins; it never fills.
      ringDark: 0x121a2c,       // the dark stroke that lets a cold ring read on a lit floor
      ringCore: 0xdff2ff, ringMid: 0x8fc4e8, ringFar: 0x486d94,
      smearBack: 6, smearFront: 3, smearThick: 2,    // a short heading tick, not a bar that eats the body
      sparks: 4, sparkR: 10, sparkLen: 3,            // hard cold ticks on the floor, thrown clear of both bodies
      rim: 0xffffff,            // ONE tick of full brightness on the player's silhouette...
      rimTint: 0xa8dcff,        // ...then the cold tone, for the two ticks the mark takes to die
      rimTicks: 3,
    },
    // Spending a perfect-dodge opening turns the cold survival mark back toward the sword's amber.
    // It is intentionally local and short: this is recognition, not another screen-wide reward.
    reversal: {
      stepSec: 0.022, tiers: 4, back: 10, front: 15, spread: 4,
      cold: 0x9fd8ff, seam: 0xf5f0dd, hot: 0xffb34d,
      zoom: 1.018, trauma: 0.045,
    },
    graze: {
      stepSec: 0.028, tiers: 3, len: 7,
      hot: 0xc9f7ff, mid: 0x70d4ea, far: 0x376d82,
    },
    // The roll itself, which is not a reward and must never wear the cold colour: a dim indigo smear
    // while the body is untouchable, the camera drifting with the commitment, weight on the landing.
    roll: {
      // The smear is an authored whole-pixel streak on the floor, like the contact crescent, not a
      // stack of ghost sprites: at 16 px a ghost of the body reads as a second body. Its hot core
      // burns only while the i-frames are live, so the frame you become touchable again is visible.
      streakLen: 12,          // half the 24 px trip: enough to name depth-axis travel without becoming a ghost body
      streakCore: 0x9a8ad8, streakRim: 0x241a38,
      streakAlpha: 0.48, streakFadeTicks: 3,
      lean: 1.8,              // px the camera drifts along the roll while the body is committed
      landTrauma: 0.05, landDust: 7, launchDust: 8,
      // A head-on wall ends travel immediately. It needs a firmer, local answer than the normal
      // foot plant, but stays far below taking damage so collision never impersonates a hit.
      wallTrauma: 0.09, wallKick: 1.15, wallDust: 5, wallSparks: 3,
      // The roll's own animation table. Each row owns dodge-state ticks from `tick` up to the next
      // row: an authored 16 px pose (drawn in src/render/views/player.ts, not a transform of the
      // standing sprite), how far that pose leans into the travel, and how close to the floor it
      // sits. `key: ''` hands the body back to the standing sprite. Ticks are dodge-state ticks, so
      // these move with `player.dodge.travel`/`total` — launch, dive, the two tuck halves that show
      // the body actually turning over, the extend into the brake, the plant, and the rise.
      pose: [
        { tick: 0, key: 'launch', leanDeg: 9, hop: 0 },
        { tick: 1, key: 'dive', leanDeg: 22, hop: 1 },   // hold the flat dive through the beam
        { tick: 6, key: 'tuckA', leanDeg: 6, hop: -1 },  // curl only after the column is cleared
        { tick: 8, key: 'tuckB', leanDeg: -7, hop: -1 },
        { tick: 10, key: 'extend', leanDeg: 10, hop: 0 },
        { tick: 12, key: 'plant', leanDeg: 4, hop: 0 },
        { tick: 14, key: 'absorb', leanDeg: 2, hop: 0 },
        { tick: 16, key: 'rise', leanDeg: 1, hop: 0 },
        { tick: 19, key: '', leanDeg: 0, hop: 0 },
      ] as { tick: number; key: string; leanDeg: number; hop: number }[],
    },
    // Poise break. Only the heavy breaks a brute, so only that one earns the camera.
    stagger: { trauma: 0.10, bruteTrauma: 0.26, bruteZoom: 1.02, bruteFlash: 0.10 },
    // the greatsword's own feedback chain: the wind-up pulls the camera back, contact shoves it through
    swing: {
      heavyWindKick: 2.4,     // px the camera DRIFTS opposite the swing while the blade is up (a lean, eased)
      // ...and one whole-pixel drop on the tick the promise is made. It replaces a 0.16 trauma that
      // was measurably invisible: shake is trauma^2 * shakeMax, so 0.16 moved the camera at most
      // 0.10 px into a Math.round, inside a 2.4 px lean that was already there. Straight down, so it
      // cannot be read as more of the horizontal drift, and well under the 5.2 px contact kick so it
      // cannot be mistaken for the blow itself.
      heavyPlantKick: 1.6,
      heavyEmberRate: 160,                          // embers/s drawn into the blade during the heavy wind-up
      heavyPlantDust: 11,                          // dust puffed at the feet when the heavy plants
      waveParticles: 12,                           // ground wave thrown along a heavy contact
    },
    bow: {
      looseKick: 1.8,
      looseRecoil: 2.6,
      drawLean: 1.4,
    },
    warden: {
      slamTrauma: 0.44, slamKick: 3.4, slamZoom: 1.045, slamFlash: 0.20, slamDust: 12,
      ringTrauma: 0.035,
      fanTrauma: 0.055, fanKick: 0.8, fanDust: 3,
      phaseTrauma: 0.38, phaseZoom: 1.055, phaseFlash: 0.30,
    },
    // the crescent: build on it, do not replace it
    arc: {
      lightThick: 6, heavyThick: 15,
      spanLight: 90, spanHeavy: 105,   // degrees of smear kept behind the leading edge
      lightAlpha: 0.76, heavyAlpha: 1,
      lightFade: 5, heavyFade: 6,
      ghostAlpha: 0.48,      // warm inner glow the greatsword adds under its crescent
      rimColor: 0x150f1e, rimAlpha: 0.62,   // dark rim behind the crescent, so steel reads on any floor
      hole: 13,              // px left clear around the fighter so body and hilt occupy the frame
      // A circular slash is tangent to its aim at north/south and can look lateral in a still. Once
      // the live sweep has crossed its centre ray, this small tapered keel names that tested axis.
      axisMinVertical: 0.62, axisAlpha: 0.88, axisWidth: 1.5,
    },
    damageNumbers: false,
    light: {
      ambientDarkness: 0.28,  // 0 = untouched, 1 = black at the arena edge
      ambientTint: 0x1e1c38, // indigo void; warm floor is graded out, ember stays on the lights
      vignette: 0.32,        // how much brighter the arena centre is than the edge
      brazierRadius: 108, brazierFlicker: 0.30, brazierTint: 0xff7a18,
      playerLightRadius: 32, playerLightAlpha: 0.12,
      flameRate: 16,         // flame particles per second per brazier
      deathFadeSec: 1.6,     // slow red vignette after playerDeath
      doorRadius: 64, doorFlicker: 0.10, doorTint: 0xffe8c0, doorOpenTint: 0xd4b060, doorAlpha: 0.36,
      windowRadius: 88, windowFlicker: 0.10, windowTint: 0xc8d8ff, windowAlpha: 0.70,
    },
    atmosphere: {
      moteCount: 28, moteSpeed: 7, moteAlpha: 0.55, moteTint: 0xffe4b0,
      fogCount: 5, fogAlpha: 0.10, fogTint: 0x5a6080,
      rayCount: 2, rayAlpha: 0.06, rayTint: 0xffd8a0,
      doorGlowRadius: 36, doorGlowAlpha: 0.10, doorGlowTint: 0xffe8b8, doorOpenTint: 0xd4b060,
    },
    grade: {
      strength: 1,
      shadowR: 0.07, shadowG: 0.08, shadowB: 0.20,
      highlightR: 0.98, highlightG: 0.94, highlightB: 0.90,
      contrast: 1.06, sat: 0.82,
    },
  },
}

export type Tuning = typeof tuning
