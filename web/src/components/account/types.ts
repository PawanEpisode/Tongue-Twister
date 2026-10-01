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
  Component: ComponentType<AccountSectionProps>
}
