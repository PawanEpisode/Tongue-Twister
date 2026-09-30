import path from 'node:path'

const quote = (file) => `'${file.replaceAll("'", `'\\''`)}'`

/** lint-staged passes absolute paths; tools must run in the app that owns the config. */
function relativeTo(dir, filenames) {
  const root = path.resolve(dir)
  return filenames.map((file) => quote(path.relative(root, file))).join(' ')
}

/** @type {import('lint-staged').Configuration} */
export default {
  'web/**/*.{js,ts,tsx,css,json,md}': (filenames) =>
    `cd web && ./node_modules/.bin/prettier --write ${relativeTo('web', filenames)}`,
  'web/**/*.{js,ts,tsx}': (filenames) =>
    `cd web && ./node_modules/.bin/eslint --fix ${relativeTo('web', filenames)}`,
  'api/**/*.py': (filenames) => {
    const files = relativeTo('api', filenames)
    return [
      `cd api && uv run ruff check --fix ${files}`,
      `cd api && uv run ruff format ${files}`,
    ]
  },
}
