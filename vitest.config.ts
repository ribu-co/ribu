import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['{contratos,flujo,facturacion,cobros,web}/**/*.test.{ts,tsx}'] },
})
