import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import known from '../known-a11y.json' with { type: 'json' }

export type KnownIssue = { rule: string; selector: string; reason: string }
export type Finding = {
  rule: string
  impact: string
  selector: string
  help: string
}

const BLOCKING = new Set(['serious', 'critical'])
const exceptions: KnownIssue[] = known.exceptions

/** True when this exact rule + selector pair is recorded in e2e/known-a11y.json. Never a blanket rule off. */
export const isKnown = (f: Finding) =>
  exceptions.some((k) => k.rule === f.rule && k.selector === f.selector)

/** Serious and critical axe violations on the current page, minus the documented known issues. */
export async function blockingViolations(page: Page): Promise<Finding[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags([
      'wcag2a',
      'wcag2aa',
      'wcag21a',
      'wcag21aa',
      'wcag22aa',
      'best-practice',
    ])
    .analyze()
  return violations
    .filter((v) => v.impact && BLOCKING.has(v.impact))
    .flatMap((v) =>
      v.nodes.map((n) => ({
        rule: v.id,
        impact: v.impact ?? '',
        selector: n.target.join(' '),
        help: v.help,
      })),
    )
    .filter((f) => !isKnown(f))
}
