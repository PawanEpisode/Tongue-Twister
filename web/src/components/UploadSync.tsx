import { useUploads } from '#/lib/record/useUploads'

/**
 * Renders nothing. After a reload or a fresh visit, picks up recordings that were still uploading (the upload
 * manager, and the resumable-upload library with it, load only when there is something to resume).
 */
export default function UploadSync() {
  useUploads()
  return null
}
