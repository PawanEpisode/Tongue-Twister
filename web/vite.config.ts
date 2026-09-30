import { fileURLToPath } from 'node:url'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig, loadEnv } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, root, '')
  // Dev server only. `vite build` and `vite preview` stay free of source paths.
  const inspectorEnabled =
    command === 'serve' &&
    mode !== 'production' &&
    mode !== 'test' &&
    env.CODE_INSPECTOR !== 'false'

  return {
    resolve: { tsconfigPaths: true },
    plugins: [
      // Before the React plugin so path attributes land in JSX before it compiles.
      codeInspectorPlugin({
        bundler: 'vite',
        dev: () => inspectorEnabled,
        openIn: 'reuse',
        // 'exec' runs the editor CLI (`cursor`, `code`…) and prints a clear error in the
        // dev-server terminal when it can't. 'open' uses the cursor:// URL scheme instead,
        // which fails silently — set CODE_INSPECTOR_LAUNCH=open only if the CLI isn't installed.
        launchType: env.CODE_INSPECTOR_LAUNCH === 'open' ? 'open' : 'exec',
        // No floating toggle: the inspector only wakes while Option/Alt+Shift is held,
        // so normal clicks (and the IDE's built-in browser) are never intercepted.
        showSwitch: false,
        autoToggle: false,
        hideDomPathAttr: true,
        pathType: 'absolute',
        match: /\.(jsx|tsx)$/,
        exclude: [/\.(test|spec)\.(jsx|tsx)$/],
        // TanStack Start has no index.html; inject the client runtime into the shell.
        injectTo: fileURLToPath(
          new URL('./src/routes/__root.tsx', import.meta.url),
        ),
      }),
      devtools(),
      nitro(),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  }
})
