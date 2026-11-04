import { expect, test } from 'vitest'
import { CODIGOS_ERROR, type LineaPedido } from '../../../contratos/tipos'
import { coincidir } from '../ruta'
import { MENSAJES_ERROR, mensajeDeError } from './errores'
import { cuentaRegresiva, pesos, plural } from './formato'
import { agruparPorRonda, avanceLinea, resumenLineas } from './lineas'

test('cada CodigoError dice qué pasó y qué hacer', () => {
  for (const codigo of CODIGOS_ERROR) {
    expect(MENSAJES_ERROR[codigo].titulo.length).toBeGreaterThan(10)
    expect(MENSAJES_ERROR[codigo].accion.length).toBeGreaterThan(10)
  }
  expect(mensajeDeError({ codigo: 'PAGO_EN_CURSO' }).titulo).toMatch(/ya está pagando/)
  expect(mensajeDeError(new Error('Failed to fetch'))).toBe(MENSAJES_ERROR.SERVICIO_NO_DISPONIBLE)
  expect(MENSAJES_ERROR.MONTO_FUERA_DE_RANGO.accion).toContain('$12.100.000')
})

test('formatos en pesos colombianos', () => {
  expect(pesos(100_300)).toBe('$100.300')
  expect(pesos(0)).toBe('$0')
  expect(pesos(-8_100)).toBe('-$8.100')
  expect(cuentaRegresiva(245.9)).toBe('4:05')
  expect(cuentaRegresiva(-3)).toBe('0:00')
  expect(plural(1, 'producto')).toBe('1 producto')
  expect(plural(3, 'producto')).toBe('3 productos')
})

test('las rutas sacan el token del link de la mesa', () => {
  expect(coincidir('/m/:token', '/m/abc%20d')).toEqual({ token: 'abc d' })
  expect(coincidir('/m/:token', '/m/abc/otra')).toBeNull()
  expect(coincidir('/personal/mesero', '/personal/mesero/')).toEqual({})
  expect(coincidir('/personal/mesero', '/personal/cocina')).toBeNull()
})

const linea = (parcial: Partial<LineaPedido>): LineaPedido => ({
  id: 'l',
  productoId: 'p',
  nombre: 'Agua',
  precio: 4_050,
  cantidad: 1,
  nota: null,
  ronda: 1,
  estado: 'pendiente',
  origen: 'cliente',
  motivo: null,
  cantidadCubierta: 0,
  creadaEn: '2026-11-04T17:00:00Z',
  ...parcial,
})

test('las líneas se agrupan por ronda, la más reciente primero', () => {
  const rondas = agruparPorRonda([linea({ id: 'a' }), linea({ id: 'b', ronda: 2 }), linea({ id: 'c' })])
  expect(rondas.map((r) => [r.numero, r.lineas.map((l) => l.id)])).toEqual([
    [2, ['b']],
    [1, ['a', 'c']],
  ])
})

test('el resumen cuenta unidades por etapa y el avance ignora lo rechazado', () => {
  const lineas = [
    linea({ cantidad: 2 }),
    linea({ estado: 'en_preparacion', cantidad: 3 }),
    linea({ estado: 'confirmada' }),
    linea({ estado: 'rechazada' }),
  ]
  expect(resumenLineas(lineas)).toEqual(['2 por confirmar', '4 en cocina'])
  expect(avanceLinea('pendiente')).toBe(1)
  expect(avanceLinea('entregada')).toBe(5)
  expect(avanceLinea('rechazada')).toBe(0)
})
