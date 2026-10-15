import { describe, expect, it } from 'vitest'
import { deviceKey, measureRoundTrip, roundTripFault, type RoundTrip } from '@/training/latency'

/** Eight clicks 0.75 s apart (80 BPM). */
const clicks = Array.from({ length: 8 }, (_, i) => 1 + i * 0.75)

describe('measureRoundTrip', () => {
  it('takes the median of how late the clicks came back', () => {
    const jitter = [0.004, -0.003, 0.001, 0, -0.002, 0.003, -0.001, 0.002]
    const trip = measureRoundTrip(
      clicks,
      clicks.map((at, i) => at + 0.18 + jitter[i]!),
    )
    expect(trip?.seconds).toBeCloseTo(0.1805, 4)
    expect(trip?.hits).toBe(8)
    expect(trip?.spread).toBeLessThan(0.003)
  })

  it('does not take a late click for the next one', () => {
    // 0.3 s late is still nearer its own click than the next one, 0.75 s away.
    const trip = measureRoundTrip(
      clicks,
      clicks.map((at) => at + 0.3),
    )
    expect(trip?.seconds).toBeCloseTo(0.3)
    expect(trip?.hits).toBe(8)
  })

  it('counts the clicks it found and keeps a stray sound out of the median', () => {
    // 2.2 is a cough between clicks; the third click and the last four were not heard.
    const trip = measureRoundTrip(clicks, [1.1, 1.85, 2.2, 3.35, 4.1])
    expect(trip?.hits).toBe(5)
    expect(trip?.seconds).toBeCloseTo(0.1)
    expect(measureRoundTrip(clicks, [])).toBeNull()
  })
})

describe('roundTripFault', () => {
  const trip = (part: Partial<RoundTrip>): RoundTrip => ({
    seconds: 0.12,
    spread: 0.004,
    hits: 8,
    expected: 8,
    ...part,
  })

  it('trusts a steady run that found most clicks', () => {
    expect(roundTripFault(trip({}))).toBeNull()
    expect(roundTripFault(trip({ hits: 6 }))).toBeNull()
    expect(roundTripFault(trip({ seconds: -0.01 }))).toBeNull()
  })

  it('names what is wrong with the rest', () => {
    expect(roundTripFault(null)).toBe('silent')
    expect(roundTripFault(trip({ hits: 0 }))).toBe('silent')
    expect(roundTripFault(trip({ hits: 5 }))).toBe('few')
    expect(roundTripFault(trip({ spread: 0.03 }))).toBe('unsteady')
    expect(roundTripFault(trip({ seconds: 0.6 }))).toBe('far')
  })
})

describe('deviceKey', () => {
  it('names the input and the output, or the input alone', () => {
    expect(deviceKey('MacBook Pro Microphone', 'AirPods Pro')).toBe(
      'MacBook Pro Microphone → AirPods Pro',
    )
    expect(deviceKey('MacBook Pro Microphone', '  ')).toBe('MacBook Pro Microphone')
  })
})
