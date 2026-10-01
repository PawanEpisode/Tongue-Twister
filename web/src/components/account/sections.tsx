import DataSection from './DataSection'
import DeleteSection from './DeleteSection'
import PrivacySection from './PrivacySection'
import ProfileSection from './ProfileSection'
import RemindersSection from './RemindersSection'
import StreakSection from './StreakSection'
import type { AccountSection } from './types'

/**
 * Everything on `/account`, in order. A later round adds a section by adding one entry here and one
 * component file; the page and the other sections don't change.
 */
export const ACCOUNT_SECTIONS: readonly AccountSection[] = [
  { id: 'profile', title: 'Profile', Component: ProfileSection },
  { id: 'streak', title: 'Streak', Component: StreakSection },
  {
    id: 'reminders',
    title: 'Reminders',
    flag: 'reminders',
    Component: RemindersSection,
  },
  { id: 'privacy', title: 'Privacy', Component: PrivacySection },
  { id: 'data', title: 'Your data', Component: DataSection },
  {
    id: 'delete',
    title: 'Delete account',
    tone: 'danger',
    Component: DeleteSection,
  },
]
