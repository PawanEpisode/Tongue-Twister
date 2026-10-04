import { describe, expect, it } from 'vitest'
import slugs from './demo-slugs.json'
import { DEMO_TWISTERS } from './demo'
import { FAQ, FOOTER, LINKEDIN_URL, MODES, PRIVACY } from './landing'

describe('landing content', () => {
  it('keeps the demo slug list (read by check_public_site in CI) in step with the demo twisters', () => {
    expect(DEMO_TWISTERS.map((t) => t.slug)).toEqual(slugs)
  })
  it('has a scripted example for every demo twister', () => {
    for (const t of DEMO_TWISTERS)
      expect(t.example.split(' ').length).toBeGreaterThan(2)
  })
  it('links to the one decided social profile and nothing legal in the footer', () => {
    expect(LINKEDIN_URL).toBe('https://www.linkedin.com/in/pawankumar1201')
    expect(JSON.stringify(FOOTER)).not.toMatch(/privacy|terms|contact/i)
  })
  it('does not claim things that are not true', () => {
    const all = JSON.stringify({ FAQ, MODES, PRIVACY }).toLowerCase()
    expect(all).not.toMatch(
      /never leaves your device|soc 2|testimonial|cloud recording/,
    )
  })
})
