import type { ComponentType } from 'react'
import type { Profile } from '#/lib/api'

export type AccountSectionProps = {
  me: Profile
  /** The account is pending deletion: settings are read-only (the API blocks writes). */
  locked: boolean
}

export type AccountSection = {
  /** Stable DOM id and anchor (`/account#data`). */
  id: string
  title: string
  /** The danger zone gets a warning border. */
  tone?: 'danger'
  /** Feature flag that gates the section: it is left out entirely (not shown as "unavailable") while off. */
  flag?: string
  Component: ComponentType<AccountSectionProps>
}

/** The sections to show for these flags, in registry order. */
export const visibleSections = (
  sections: readonly AccountSection[],
  flags: Readonly<Record<string, boolean>>,
): AccountSection[] => sections.filter((s) => !s.flag || flags[s.flag] === true)
