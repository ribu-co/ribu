import { defineConfig } from 'vitest/config'

// Solo corre dentro de `firebase emulators:exec`: ver test:reglas y test:flujo en package.json.
export default defineConfig({
  test: {
    include: ['flujo/emulador/*.emu.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
