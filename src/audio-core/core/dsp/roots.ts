/**
 * Polynomial roots by the Durand–Kerner (Weierstrass) method.
 *
 * Solves the monic polynomial `z^n + c[1] z^{n-1} + … + c[n] = 0` (`c[0]` is ignored and treated
 * as 1). Roots are written into preallocated `re`/`im` buffers. Burg LPC poles sit inside the
 * unit circle, so a few dozen iterations are enough.
 */

const MAX_ITER = 80
const TOL2 = 1e-20

export function durandKerner(coeffs: Float64Array, re: Float64Array, im: Float64Array): void {
  const n = coeffs.length - 1
  if (n < 1) return
  for (let k = 0; k < n; k++) {
    const angle = (2 * Math.PI * k) / n + 0.3
    re[k] = 0.4 * Math.cos(angle)
    im[k] = 0.4 * Math.sin(angle)
  }

  const pr = { r: 0, i: 0 }
  const dr = { r: 0, i: 0 }
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let maxDelta = 0
    for (let k = 0; k < n; k++) {
      horner(coeffs, re[k], im[k], pr)
      denom(re, im, n, k, dr)
      const mag2 = dr.r * dr.r + dr.i * dr.i
      if (mag2 < 1e-30) continue
      const inv = 1 / mag2
      const corrR = (pr.r * dr.r + pr.i * dr.i) * inv
      const corrI = (pr.i * dr.r - pr.r * dr.i) * inv
      re[k] -= corrR
      im[k] -= corrI
      maxDelta = Math.max(maxDelta, corrR * corrR + corrI * corrI)
    }
    if (maxDelta < TOL2) break
  }
}

function horner(coeffs: Float64Array, zr: number, zi: number, out: { r: number; i: number }): void {
  let pr = 1
  let pi = 0
  for (let i = 1; i < coeffs.length; i++) {
    const nr = pr * zr - pi * zi + coeffs[i]
    const ni = pr * zi + pi * zr
    pr = nr
    pi = ni
  }
  out.r = pr
  out.i = pi
}

function denom(
  re: Float64Array,
  im: Float64Array,
  n: number,
  skip: number,
  out: { r: number; i: number },
): void {
  let dr = 1
  let di = 0
  for (let j = 0; j < n; j++) {
    if (j === skip) continue
    const tr = re[skip] - re[j]
    const ti = im[skip] - im[j]
    const ndr = dr * tr - di * ti
    const ndi = dr * ti + di * tr
    dr = ndr
    di = ndi
  }
  out.r = dr
  out.i = di
}
