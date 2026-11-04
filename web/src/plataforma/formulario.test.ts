import { expect, test } from 'vitest'
import { PROPINA_SUGERIDA_MAXIMA } from '../../../contratos/reglas'
import type { Mesa } from '../../../contratos/tipos'
import { aImpuesto, IMPUESTOS, leerCantidad, leerPropinas, linkDeMesa, listaDeLinks, personalValido, PROPINAS_POR_DEFECTO } from './formulario'

test('el INC del 8 % es lo que va al backend, sin el texto de la pantalla', () => {
  expect(aImpuesto(IMPUESTOS.INC)).toEqual({ tipo: 'INC', porcentaje: 8 })
  expect(aImpuesto(IMPUESTOS.IVA)).toEqual({ tipo: 'IVA', porcentaje: 19 })
  expect(aImpuesto(IMPUESTOS.ninguno)).toEqual({ tipo: 'ninguno', porcentaje: 0 })
})

test('lee las propinas sugeridas sin duplicados y en orden', () => {
  expect(leerPropinas(PROPINAS_POR_DEFECTO)).toEqual([5, 8, 10])
  expect(leerPropinas('10 5,5;8')).toEqual([5, 8, 10])
  expect(leerPropinas('')).toEqual([])
})

test('ninguna propina sugerida supera el máximo de la SIC', () => {
  expect(leerPropinas(String(PROPINA_SUGERIDA_MAXIMA))).toEqual([PROPINA_SUGERIDA_MAXIMA])
  expect(leerPropinas(String(PROPINA_SUGERIDA_MAXIMA + 1))).toBeNull()
  expect(leerPropinas('5, 7.5')).toBeNull()
  expect(leerPropinas('cinco')).toBeNull()
  expect(leerPropinas('-5')).toBeNull()
})

test('la cantidad de mesas es un entero desde 1', () => {
  expect(leerCantidad('12')).toBe(12)
  expect(leerCantidad(' 3 ')).toBe(3)
  expect(leerCantidad('0')).toBeNull()
  expect(leerCantidad('')).toBeNull()
  expect(leerCantidad('2.5')).toBeNull()
})

test('una cuenta necesita correo, nombre y clave de 8 caracteres', () => {
  const datos = { correo: 'ana@ribu.co', nombre: 'Ana', clave: 'clave-segura' }
  expect(personalValido(datos)).toBe(true)
  expect(personalValido({ ...datos, correo: 'ana' })).toBe(false)
  expect(personalValido({ ...datos, nombre: ' ' })).toBe(false)
  expect(personalValido({ ...datos, clave: '1234567' })).toBe(false)
})

test('el link del sticker sale de rutas.paginaMesa', () => {
  expect(linkDeMesa('https://ribu-co.web.app', 'abc')).toBe('https://ribu-co.web.app/m/abc')
  const mesas = [{ numero: 1, token: 'a' }, { numero: 2, token: 'b' }] as Mesa[]
  expect(listaDeLinks('https://r.co', mesas)).toBe('Mesa 1: https://r.co/m/a\nMesa 2: https://r.co/m/b')
})
