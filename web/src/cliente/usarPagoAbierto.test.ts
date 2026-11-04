import { expect, test } from 'vitest'
import { leerPagoGuardado, pagoVigente } from './usarPagoAbierto'

test('el pago guardado solo vale en la cuenta donde se abrió', () => {
  const guardado = { cuentaId: 'c1', pagoId: 'p1' }
  expect(pagoVigente(guardado, 'c1')).toBe('p1')
  expect(pagoVigente(guardado, null)).toBeNull()
  expect(pagoVigente(guardado, 'c2')).toBeNull()
  expect(pagoVigente(null, 'c1')).toBeNull()
})

test('ignora lo que no entiende, como el formato anterior', () => {
  expect(leerPagoGuardado(JSON.stringify({ cuentaId: 'c1', pagoId: 'p1' }))).toEqual({ cuentaId: 'c1', pagoId: 'p1' })
  expect(leerPagoGuardado('cuenta-1-pago-1')).toBeNull()
  expect(leerPagoGuardado('null')).toBeNull()
  expect(leerPagoGuardado(null)).toBeNull()
})
