import { describe, expect, test } from 'vitest'
import type { SolicitudFactura } from '../contratos/tipos'
import { crearBaseMemoria } from './base-memoria'
import { crearCobrosCompartidos, crearFacturacionCompartida, LLAVE_WEBHOOK_MOCK } from './mocks-compartidos'

// `api`, los disparadores y la tarea programada corren en procesos distintos en el emulador.
// Cada "proceso" de estas pruebas tiene su propio mock y solo comparte la base de datos.

const factura: SolicitudFactura = {
  referencia: 'pago-1',
  comprador: { tipo: 'consumidor_final', correo: null },
  lineas: [{ codigo: 'x', descripcion: 'Plato', cantidad: 1, precioSinImpuesto: 50_000 }],
  impuesto: { tipo: 'INC', porcentaje: 8 },
  propina: null,
  medio: 'efectivo',
  total: 54_000,
}

const nota = (numeroFactura: string) => ({
  ...factura,
  referencia: 'nota-1',
  tipo: 'credito' as const,
  concepto: 'anulacion' as const,
  motivo: 'Devolución',
  numeroFactura,
})

describe('cobros', () => {
  test('lo que crea un proceso lo ve otro, y el pago también', async () => {
    const db = crearBaseMemoria()
    const api = crearCobrosCompartidos(db)
    const fondo = crearCobrosCompartidos(db)
    const cobro = await api.crearCobro({ referencia: 'r1', monto: 20_000, expiraEnSegundos: 600 })
    expect(await fondo.consultarCobro('r1')).toEqual(cobro)
    const cuerpo = await fondo.marcarPagado('r1')
    expect((await api.consultarCobro('r1')).estado).toBe('paid')
    expect(api.leerWebhook(LLAVE_WEBHOOK_MOCK, cuerpo)).toMatchObject({ referencia: 'r1', monto: 20_000 })
  })

  test('otro monto con la misma referencia responde 422, y repetirla conserva la llave', async () => {
    const db = crearBaseMemoria()
    const api = crearCobrosCompartidos(db)
    const primero = await api.crearCobro({ referencia: 'r1', monto: 20_000, expiraEnSegundos: 600 })
    await expect(api.crearCobro({ referencia: 'r1', monto: 30_000, expiraEnSegundos: 600 })).rejects.toMatchObject({ status: 422 })
    expect((await api.crearCobro({ referencia: 'r1', monto: 20_000, expiraEnSegundos: 600 })).llaveBreB).toBe(primero.llaveBreB)
  })

  test('el monto va dentro del rango de Factus Pay, como en el mock', async () => {
    const api = crearCobrosCompartidos(crearBaseMemoria())
    await expect(api.crearCobro({ referencia: 'r1', monto: 500, expiraEnSegundos: 600 })).rejects.toMatchObject({ status: 422 })
  })

  test('una llave mala no pasa', () => {
    const api = crearCobrosCompartidos(crearBaseMemoria())
    expect(() => api.leerWebhook('mala', {})).toThrow()
  })

  test('un recaudo que no existe responde 404', async () => {
    const api = crearCobrosCompartidos(crearBaseMemoria())
    await expect(api.consultarCobro('nada')).rejects.toMatchObject({ status: 404 })
  })
})

describe('facturación', () => {
  test('la factura de un proceso la conocen los demás: PDF, correo y notas', async () => {
    const db = crearBaseMemoria()
    const disparador = crearFacturacionCompartida(db)
    const api = crearFacturacionCompartida(db)

    const emitida = await disparador.emitirFactura(factura)
    if (emitida.estado !== 'emitida') throw new Error('debía quedar emitida')
    const { numero } = emitida.datos

    expect((await api.descargarPdf(numero)).nombreArchivo).toBe(`${numero}.pdf`)
    await expect(api.enviarCorreo(numero, 'a@ribu.test')).resolves.toBeUndefined()

    const creada = await api.emitirNota(nota(numero))
    if (creada.estado !== 'emitida') throw new Error('debía quedar emitida')
    expect((await disparador.descargarPdfNota('credito', creada.datos.numero)).nombreArchivo).toContain(creada.datos.numero)
  })

  test('la misma referencia devuelve el mismo documento', async () => {
    const db = crearBaseMemoria()
    const uno = await crearFacturacionCompartida(db).emitirFactura(factura)
    const otro = await crearFacturacionCompartida(db).emitirFactura({ ...factura, comprador: { tipo: 'consumidor_final', correo: 'a@ribu.test' } })
    expect(otro).toEqual(uno)
  })

  test('números distintos para referencias distintas', async () => {
    const db = crearBaseMemoria()
    const servicio = crearFacturacionCompartida(db)
    const uno = await servicio.emitirFactura(factura)
    const otro = await servicio.emitirFactura({ ...factura, referencia: 'pago-2' })
    expect(uno.estado === 'emitida' && otro.estado === 'emitida' && uno.datos.numero !== otro.datos.numero).toBe(true)
  })

  test('una nota necesita una factura que exista', async () => {
    const servicio = crearFacturacionCompartida(crearBaseMemoria())
    await expect(servicio.emitirNota(nota('NO-EXISTE'))).rejects.toMatchObject({ status: 422 })
  })

  test('el PDF de un número que no existe responde 404', async () => {
    const servicio = crearFacturacionCompartida(crearBaseMemoria())
    await expect(servicio.descargarPdf('NO-EXISTE')).rejects.toMatchObject({ status: 404 })
  })
})
