import { expect, test } from 'vitest'
import { ErrorIntegracion } from '../contratos/reglas'
import { calcularTotales, dosDecimales, problemasSolicitud, validarSolicitud } from './calculo'
import { solicitudDePrueba } from './datos-prueba'

test('dos decimales no pierde centavos por la coma flotante', () => {
  expect(dosDecimales(1.005)).toBe(1.01)
  expect(dosDecimales(46_296.3 * 0.08)).toBe(3_703.7)
})

test('el total calculado suma base, impuesto por línea y propina', () => {
  expect(calcularTotales(solicitudDePrueba())).toEqual({
    base: 46_296.3,
    impuesto: 3_703.7,
    propina: 4_630,
    calculado: 54_630,
    redondeo: 0,
  })
})

test('el redondeo es lo que pagó el cliente menos lo calculado', () => {
  const solicitud = solicitudDePrueba({
    lineas: [{ codigo: 'P-2', descripcion: 'Limonada', cantidad: 3, precioSinImpuesto: 2_777.78 }],
    propina: null,
    total: 9_000,
  })
  // 3 × 2.777,78 = 8.333,34 y el 8 % es 666,67: suman 9.000,01.
  expect(calcularTotales(solicitud).redondeo).toBe(-0.01)
})

test('sin impuesto, el total es la base más la propina', () => {
  const solicitud = solicitudDePrueba({ impuesto: { tipo: 'ninguno', porcentaje: 0 }, total: 50_926.3 })
  expect(calcularTotales(solicitud)).toMatchObject({ impuesto: 0, calculado: 50_926.3, redondeo: 0 })
})

test('una solicitud correcta no tiene problemas', () => {
  expect(problemasSolicitud(solicitudDePrueba())).toEqual([])
})

test('el total no puede diferir más de 500 pesos de lo calculado', () => {
  expect(problemasSolicitud(solicitudDePrueba({ total: 55_130 }))).toEqual([])
  expect(problemasSolicitud(solicitudDePrueba({ total: 55_131 }))).toHaveLength(1)
  expect(problemasSolicitud(solicitudDePrueba({ total: 54_129 }))).toHaveLength(1)
})

test('la referencia, las líneas, las cantidades y los precios se revisan', () => {
  expect(problemasSolicitud(solicitudDePrueba({ referencia: '' }))).toHaveLength(1)
  expect(problemasSolicitud(solicitudDePrueba({ referencia: 'x'.repeat(101) }))).toHaveLength(1)
  expect(problemasSolicitud(solicitudDePrueba({ lineas: [] }))).toEqual(['La factura no tiene líneas'])
  const mala = { codigo: 'P-1', descripcion: 'Bandeja', cantidad: 0, precioSinImpuesto: -1 }
  expect(problemasSolicitud(solicitudDePrueba({ lineas: [mala], total: 4_630 }))).toHaveLength(2)
})

test('validar lanza un error de validación que no se reintenta', () => {
  expect(() => validarSolicitud(solicitudDePrueba())).not.toThrow()
  try {
    validarSolicitud(solicitudDePrueba({ lineas: [] }))
    expect.unreachable()
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorIntegracion)
    expect(error).toMatchObject({ servicio: 'factus', tipo: 'validacion', reintentable: false })
  }
})
