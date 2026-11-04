import { expect, test } from 'vitest'
import { nombreFuente } from './elegir'

test('sin VITE_FUENTE la web usa la versión en memoria', () => {
  expect(nombreFuente(undefined)).toBe('memoria')
  expect(nombreFuente('')).toBe('memoria')
})

test('VITE_FUENTE elige Firebase y rechaza un nombre que no existe', () => {
  expect(nombreFuente('firebase')).toBe('firebase')
  expect(() => nombreFuente('Firebase')).toThrow(/VITE_FUENTE/)
})

test('en producción siempre es Firebase, aunque VITE_FUENTE falte o diga memoria', () => {
  expect(nombreFuente(undefined, true)).toBe('firebase')
  expect(nombreFuente('memoria', true)).toBe('firebase')
})
