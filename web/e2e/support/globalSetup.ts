import { startApiServer } from './apiServer'

/** Starts the mock API for SSR and returns the teardown. */
export default async function globalSetup() {
  const server = await startApiServer()
  return () => new Promise<void>((resolve) => server.close(() => resolve()))
}
