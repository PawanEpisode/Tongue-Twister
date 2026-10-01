import { useBrowserTimezone } from '#/lib/progress/useBrowserTimezone'

/** Renders nothing. Tells the API the browser's timezone once per device so streak days end at local midnight. */
export default function TimezoneSync() {
  useBrowserTimezone()
  return null
}
