import { expect, test } from 'vitest'
import type { Cuenta, ResumenPago } from '../../../contratos/tipos'
import { compradorValido } from '../datos/comprador'
import { cobrosAjenos, etiquetaPago, leerPorcentaje, miCobroActivo, opcionesPropina, todoPagado, unidadesPorConfirmar } from './cuenta'
import { armarComprador } from './HojaPagar'

const pago = (p: Partial<ResumenPago>): ResumenPago => ({
  id: 'p1',
  numero: 1,
  parte: null,
  subtotal: 10_800,
  total: 10_800,
  medio: 'factus_pay',
  estado: 'esperando_pago',
  estadoFactura: 'sin_emitir',
  incidencia: null,
  creadoPor: 'yo',
  ...p,
})

const cuenta = (c: Partial<Cuenta>): Cuenta => ({
  id: 'c1',
  restauranteId: 'r',
  mesaToken: 'm',
  numeroMesa: 1,
  estado: 'abierta',
  lineas: [],
  division: null,
  pagos: [],
  consumo: 10_800,
  pagado: 0,
  enCobro: 0,
  porPagar: 10_800,
  abiertaEn: '2026-11-04T17:00:00Z',
  cerradaEn: null,
  ...c,
})

test('cada quien ve su propio cobro activo y los demás aparecen como ajenos', () => {
  const c = cuenta({ pagos: [pago({ id: 'a', creadoPor: 'yo' }), pago({ id: 'b', creadoPor: 'otro' }), pago({ id: 'c', creadoPor: 'yo', estado: 'vencido' })] })
  expect(miCobroActivo(c, 'yo')?.id).toBe('a')
  expect(miCobroActivo(c, 'otro')?.id).toBe('b')
  expect(miCobroActivo(c, 'nadie')).toBeNull()
  expect(cobrosAjenos(c, 'yo').map((p) => p.id)).toEqual(['b'])
})

test('la cuenta está pagada solo si hay consumo, no falta nada y nada está en cobro', () => {
  expect(todoPagado(cuenta({ pagado: 10_800, porPagar: 0 }))).toBe(true)
  expect(todoPagado(cuenta({ enCobro: 10_800, porPagar: 0 }))).toBe(false)
  expect(todoPagado(cuenta({ consumo: 0, porPagar: 0 }))).toBe(false)
  expect(todoPagado(cuenta({}))).toBe(false)
})

test('cuenta las unidades que esperan al mesero', () => {
  const linea = { id: 'l', productoId: 'x', nombre: 'X', precio: 1, nota: null, ronda: 1, origen: 'cliente' as const, motivo: null, cantidadCubierta: 0, creadaEn: '' }
  const c = cuenta({ lineas: [{ ...linea, cantidad: 2, estado: 'pendiente' }, { ...linea, cantidad: 3, estado: 'confirmada' }] })
  expect(unidadesPorConfirmar(c)).toBe(2)
})

test('un pago duplicado se nombra así aunque esté pagado', () => {
  expect(etiquetaPago({ estado: 'pagado', incidencia: null })).toBe('Pagado')
  expect(etiquetaPago({ estado: 'pagado', incidencia: 'pago_duplicado' })).toBe('Pago duplicado')
  expect(etiquetaPago({ estado: 'vencido', incidencia: null })).toBe('QR vencido')
})

test('las propinas sugeridas salen ordenadas, sin el cero ni las que pasan del máximo', () => {
  expect(opcionesPropina([10, 0, 5, 8, 5, 15])).toEqual([5, 8, 10])
})

test('"Otro" acepta un entero de 0 a 100', () => {
  expect(leerPorcentaje('12')).toBe(12)
  expect(leerPorcentaje('0')).toBe(0)
  expect(leerPorcentaje('')).toBeNull()
  expect(leerPorcentaje('101')).toBeNull()
  expect(leerPorcentaje('1.5')).toBeNull()
})

const vacio = { correo: '', tipoDocumento: 'CC' as const, documento: '', nombre: '', nit: '', razonSocial: '' }

test('consumidor final no pide datos y el correo es opcional', () => {
  expect(armarComprador('consumidor_final', vacio)).toEqual({ tipo: 'consumidor_final', correo: null })
  expect(compradorValido(armarComprador('consumidor_final', vacio))).toBe(true)
  expect(compradorValido(armarComprador('consumidor_final', { ...vacio, correo: 'no-es-correo' }))).toBe(false)
})

test('persona y empresa piden sus datos, sin espacios de más', () => {
  const persona = armarComprador('persona', { ...vacio, documento: ' 1234567 ', nombre: ' Ana Pérez ', correo: 'ana@ejemplo.co ' })
  expect(persona).toEqual({ tipo: 'persona', tipoDocumento: 'CC', documento: '1234567', nombre: 'Ana Pérez', correo: 'ana@ejemplo.co' })
  expect(compradorValido(persona)).toBe(true)
  expect(compradorValido(armarComprador('persona', { ...vacio, nombre: 'Ana', correo: 'ana@ejemplo.co' }))).toBe(false)

  const empresa = armarComprador('empresa', { ...vacio, nit: '900.123.456', razonSocial: 'Ejemplo SAS', correo: 'pagos@ejemplo.co' })
  expect(empresa).toEqual({ tipo: 'empresa', nit: '900123456', razonSocial: 'Ejemplo SAS', correo: 'pagos@ejemplo.co' })
  expect(compradorValido(empresa)).toBe(true)
})
