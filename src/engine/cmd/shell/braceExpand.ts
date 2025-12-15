// Brace expansion utility
// Supports nested braces, comma-separated lists, and numeric ranges with optional zero-padding.
// Examples:
//  - a{b,c}d -> abd, acd
//  - {1..3} -> 1,2,3
//  - {03..05} -> 03,04,05
//  - x{a,{b,c}}y -> xay, xby, xcy

const splitTopLevelCommas = (s: string): string[] => {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{') {
      depth++
      cur += ch
      continue
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1)
      cur += ch
      continue
    }
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

const expandNumericRange = (s: string): string[] | null => {
  const m = s.match(/^(-?\d+)\.\.(-?\d+)$/)
  if (!m) return null
  const a = Number.parseInt(m[1], 10)
  const b = Number.parseInt(m[2], 10)
  const width = Math.max(m[1].replace('-', '').length, m[2].replace('-', '').length)
  const out: string[] = []
  if (a <= b) {
    for (let v = a; v <= b; v++) out.push(String(v).padStart(width, '0'))
  } else {
    for (let v = a; v >= b; v--) out.push(String(v).padStart(width, '0'))
  }
  return out
}

export default function expandBraces(input: string): string[] {
  // Fast path: no braces
  if (!input.includes('{')) return [input]

  // Find first top-level '{' and its matching '}'
  const firstOpen = input.indexOf('{')
  if (firstOpen === -1) return [input]
  let depth = 0
  let matchClose = -1
  for (let i = firstOpen; i < input.length; i++) {
    const ch = input[i]
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) {
        matchClose = i
        break
      }
    }
  }
  if (matchClose === -1) return [input] // unterminated brace

  const prefix = input.slice(0, firstOpen)
  const inner = input.slice(firstOpen + 1, matchClose)
  const suffix = input.slice(matchClose + 1)

  // If inner is a simple numeric range like 1..5, expand it as the set
  const numRange = expandNumericRange(inner)
  const parts = numRange ?? splitTopLevelCommas(inner)

  const results: string[] = []
  for (const part of parts) {
    // recursively expand the part (it may contain nested braces)
    const leftExpansions = expandBraces(part)
    // recursively expand the suffix as well
    const rightExpansions = expandBraces(suffix)
    for (const l of leftExpansions) {
      for (const r of rightExpansions) {
        results.push(prefix + l + r)
      }
    }
  }

  return results
}
