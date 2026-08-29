import { describe, expect, it } from 'vitest'
import { HARD_LOCK_ACQUIRE_SEC, HARD_LOCK_BREAK_SEC, HardLockFeedback } from '@/render/hardLock'

describe('hard-lock presentation feedback', () => {
  it('distinguishes acquisition, retention, loss, and settled clear', () => {
    const lock = new HardLockFeedback()
    expect(lock.phase).toBe('none')
    expect(lock.targetId).toBeNull()

    lock.setTarget(7)
    expect(lock.phase).toBe('acquired')
    expect(lock.targetId).toBe(7)
    lock.update(HARD_LOCK_ACQUIRE_SEC / 2)
    expect(lock.progress).toBeCloseTo(0.5)
    lock.update(HARD_LOCK_ACQUIRE_SEC / 2)
    expect(lock.phase).toBe('retained')

    lock.setTarget(null)
    expect(lock.phase).toBe('broken')
    expect(lock.targetId).toBeNull()
    lock.update(HARD_LOCK_BREAK_SEC)
    expect(lock.phase).toBe('none')
  })

  it('does not restart a transition when repeated samples report the same target', () => {
    const lock = new HardLockFeedback()
    lock.setTarget(3)
    lock.update(HARD_LOCK_ACQUIRE_SEC * 0.75)
    lock.setTarget(3)
    expect(lock.progress).toBeCloseTo(0.75)
    lock.update(HARD_LOCK_ACQUIRE_SEC * 0.25)
    expect(lock.phase).toBe('retained')

    lock.setTarget(null)
    lock.update(HARD_LOCK_BREAK_SEC * 0.75)
    lock.setTarget(null)
    lock.update(HARD_LOCK_BREAK_SEC * 0.25)
    expect(lock.phase).toBe('none')
  })

  it('treats a direct target switch as a fresh acquisition and reset clears immediately', () => {
    const lock = new HardLockFeedback()
    lock.setTarget(1)
    lock.update(HARD_LOCK_ACQUIRE_SEC)
    lock.setTarget(2)
    expect(lock.phase).toBe('acquired')
    expect(lock.targetId).toBe(2)
    expect(lock.progress).toBe(0)
    lock.reset()
    expect(lock.phase).toBe('none')
    expect(lock.targetId).toBeNull()
  })
})
