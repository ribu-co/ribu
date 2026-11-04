import { describe, expect, test } from 'vitest'
import { ErrorIntegracion } from '../contratos/reglas'
import { crearEscenario, quien, R1 } from './apoyo-pruebas'

type Escenario = ReturnType<typeof crearEscenario>
const ANULACION = { tipo: 'credito', concepto: 'anulacion', motivo: 'El cliente devolvió el pedido' }
const devolucion = (precio: number, cantidad = 1) => ({
  tipo: 'credito',
  concepto: 'devolucion_parcial',
  motivo: 'Devolvió parte del pedido',
  lineas: [{ descripcion: 'Plato devuelto', cantidad, precio }],
})
const debito = (medio: string, precio = 21_600) => ({
  tipo: 'debito',
  concepto: 'otros',
  motivo: 'Cobro adicional',
  lineas: [{ descripcion: 'Servicio', cantidad: 1, precio }],
  medio,
})

/** Una factura emitida de $54.000 más 10 % de propina: $59.000. */
async function facturaEmitida(e: Escenario, correo: string | null = null) {
  await e.pedido([['plato', 1]])
  const { datos } = await e.pagar({ tipo: 'saldo' }, { medio: 'efectivo', token: quien.mesero(), propina: 10, comprador: { tipo: 'consumidor_final', correo } })
  await e.emitirFactura(datos.id)
  return datos.id as string
}

const crearNota = (e: Escenario, pagoId: string, cuerpo: unknown) => e.pedir('POST', `/api/pagos/${pagoId}/notas`, quien.admin(), cuerpo)
const leerNota = (e: Escenario, id: string) => e.db.leer<any>(`restaurantes/${R1}/notas/${id}`)

describe('nota crédito', () => {
  test('la anulación copia la factura completa, con la propina, y deja la devolución pendiente', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { status, datos: nota } = await crearNota(e, pagoId, ANULACION)
    expect(status).toBe(201)
    expect(nota).toMatchObject({ tipo: 'credito', estado: 'en_proceso', total: 59_000, devolucion: 'pendiente', propina: { base: 50_000, valor: 5_000 } })
    await e.emitirNota(nota.id)
    const solicitud = e.facturacion.emisiones.at(-1) as any
    expect(solicitud).toMatchObject({ referencia: nota.id, tipo: 'credito', concepto: 'anulacion', total: 59_000, numeroFactura: (await e.leerFactura(pagoId)).datos.numero })
    expect(await leerNota(e, nota.id)).toMatchObject({ estado: 'emitida', devolucion: 'pendiente', datos: { cude: expect.any(String) } })
    expect((await e.leerFactura(pagoId)).notas).toEqual([expect.objectContaining({ id: nota.id, estado: 'emitida', numero: expect.any(String), total: 59_000 })])
  })

  test('no cambia la cuenta de la mesa', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { cuentaId } = await e.leerPago(pagoId)
    const antes = await e.leerCuenta(cuentaId)
    const { datos: nota } = await crearNota(e, pagoId, ANULACION)
    await e.emitirNota(nota.id)
    expect(await e.leerCuenta(cuentaId)).toEqual(antes)
  })

  test('una devolución parcial va sin impuesto por línea y sin propina', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nota } = await crearNota(e, pagoId, devolucion(10_800, 2))
    expect(nota).toMatchObject({ total: 21_600, propina: null, lineas: [{ cantidad: 2, precioSinImpuesto: 10_000 }] })
  })

  test('no supera saldoAcreditable', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    expect((await crearNota(e, pagoId, devolucion(59_001))).datos.codigo).toBe('NOTA_EXCEDE_FACTURA')
    const { datos: primera } = await crearNota(e, pagoId, devolucion(40_000))
    expect((await crearNota(e, pagoId, devolucion(19_001))).datos.codigo).toBe('NOTA_EXCEDE_FACTURA')
    expect((await crearNota(e, pagoId, ANULACION)).datos.codigo).toBe('NOTA_EXCEDE_FACTURA')
    const segunda = await crearNota(e, pagoId, devolucion(19_000))
    expect(segunda.status).toBe(201)
    expect((await crearNota(e, pagoId, devolucion(1))).datos.codigo).toBe('NOTA_EXCEDE_FACTURA')
    expect(primera.id).toBeTruthy()
  })

  test('dos notas a la vez no pasan del saldo', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const resultados = await Promise.all([crearNota(e, pagoId, devolucion(40_000)), crearNota(e, pagoId, devolucion(40_000))])
    expect(resultados.map((r) => r.status).sort()).toEqual([201, 409])
  })

  test('una nota débito emitida sube lo acreditable', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nd } = await crearNota(e, pagoId, debito('efectivo', 10_800))
    expect((await crearNota(e, pagoId, devolucion(69_800))).datos.codigo).toBe('NOTA_EXCEDE_FACTURA')
    await e.emitirNota(nd.id)
    expect((await crearNota(e, pagoId, devolucion(69_800))).status).toBe(201)
  })

  test('la devolución pasa a hecha una sola vez, con la nota emitida', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nota } = await crearNota(e, pagoId, ANULACION)
    const hecha = () => e.pedir('POST', `/api/notas/${nota.id}/devolucion`, quien.admin())
    expect((await hecha()).datos.codigo).toBe('TRANSICION_INVALIDA')
    await e.emitirNota(nota.id)
    expect((await hecha()).datos.devolucion).toBe('hecha')
    expect((await hecha()).datos.codigo).toBe('TRANSICION_INVALIDA')
  })

  test('solo sobre una factura emitida', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar({ tipo: 'saldo' }, { medio: 'efectivo', token: quien.mesero() })
    expect((await crearNota(e, pago.id, ANULACION)).datos.codigo).toBe('FACTURA_NO_DISPONIBLE')
    expect((await crearNota(e, 'no-existe', ANULACION)).datos.codigo).toBe('NO_ENCONTRADO')
  })

  test('validaciones', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    expect((await crearNota(e, pagoId, { ...ANULACION, motivo: ' ' })).datos.codigo).toBe('NOTA_INVALIDA')
    expect((await crearNota(e, pagoId, { tipo: 'credito', concepto: 'intereses', motivo: 'x', lineas: [] })).datos.codigo).toBe('NOTA_INVALIDA')
    expect((await crearNota(e, pagoId, { ...devolucion(1_000), lineas: [] })).datos.codigo).toBe('NOTA_INVALIDA')
    expect((await crearNota(e, pagoId, devolucion(-5))).datos.codigo).toBe('NOTA_INVALIDA')
  })
})

describe('nota débito', () => {
  test('con efectivo se emite de una vez', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { status, datos: nota } = await crearNota(e, pagoId, debito('efectivo'))
    expect(status).toBe(201)
    expect(nota).toMatchObject({ estado: 'en_proceso', cobro: null, devolucion: 'no_aplica', total: 21_600, medio: 'efectivo' })
    await e.emitirNota(nota.id)
    expect((await leerNota(e, nota.id)).estado).toBe('emitida')
  })

  test('con factus_pay primero cobra y luego emite', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const emisionesAntes = e.facturacion.emisiones.length
    const { datos: nota } = await crearNota(e, pagoId, debito('factus_pay'))
    expect(nota).toMatchObject({ estado: 'sin_emitir', cobro: { estado: 'ready', monto: 21_600, referencia: nota.id } })
    expect(await e.leerReferencia(nota.id)).toMatchObject({ restauranteId: R1, tipo: 'nota' })

    // Sin pagar, ni el disparador ni el aviso emiten nada.
    await e.emitirNota(nota.id)
    await e.avisoDePago(nota.id)
    expect((await leerNota(e, nota.id)).estado).toBe('sin_emitir')
    expect(e.facturacion.emisiones).toHaveLength(emisionesAntes)

    e.cobros.marcarPagado(nota.id)
    await e.avisoDePago(nota.id)
    await e.avisoDePago(nota.id)
    expect((await leerNota(e, nota.id)).estado).toBe('en_proceso')
    await e.emitirNota(nota.id)
    await e.emitirNota(nota.id)
    expect((await leerNota(e, nota.id)).estado).toBe('emitida')
    expect(e.facturacion.emisiones).toHaveLength(emisionesAntes + 1)
    expect(e.facturacion.emisiones.at(-1)).toMatchObject({ tipo: 'debito', referencia: nota.id, medio: 'factus_pay' })
  })

  test('un monto distinto al de la nota no la emite', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nota } = await crearNota(e, pagoId, debito('factus_pay'))
    const pagado = e.cobros.marcarPagado(nota.id)
    e.ctx.cobros = { ...e.cobros, consultarCobro: async () => ({ ...pagado, monto: 10_000 }) }
    await e.avisoDePago(nota.id)
    expect((await leerNota(e, nota.id)).estado).toBe('sin_emitir')
  })

  test('el monto de Factus Pay tiene rango. El efectivo no', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    expect((await crearNota(e, pagoId, debito('factus_pay', 5_000))).datos.codigo).toBe('MONTO_FUERA_DE_RANGO')
    expect((await crearNota(e, pagoId, debito('efectivo', 5_000))).status).toBe(201)
  })

  test('si crear el cobro falla, la nota no llega a existir', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    e.ctx.cobros = { ...e.cobros, crearCobro: async () => { throw new ErrorIntegracion('caído', 'factus_pay', 'red') } }
    const { status, datos } = await crearNota(e, pagoId, debito('factus_pay'))
    expect(status).toBe(503)
    expect(datos.codigo).toBe('SERVICIO_NO_DISPONIBLE')
    expect((await e.leerFactura(pagoId)).notas).toEqual([])
  })

  test('verificar sirve de respaldo y renueva el QR vencido con la misma llave', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nota } = await crearNota(e, pagoId, debito('factus_pay'))
    const verificar = () => e.pedir('POST', `/api/notas/${nota.id}/verificar`, quien.admin())
    expect((await verificar()).datos.estado).toBe('sin_emitir')
    e.avanzar(700)
    const { datos: renovada } = await verificar()
    expect(Date.parse(renovada.cobro.qrExpiraEn)).toBeGreaterThan(e.ahora().getTime())
    expect(renovada.cobro.llaveBreB).toBe(nota.cobro.llaveBreB)
    e.cobros.marcarPagado(nota.id)
    e.avanzar(6)
    expect((await verificar()).datos.estado).toBe('en_proceso')
  })
})

describe('las mismas reglas de la factura', () => {
  test('rechazada: se elimina, el administrador corrige y se reemite', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nota } = await crearNota(e, pagoId, ANULACION)
    e.facturacion.escenario = 'rechazada'
    await e.emitirNota(nota.id)
    expect((await leerNota(e, nota.id)).estado).toBe('rechazada')
    expect(e.facturacion.documentos().filter((d) => d.rango === 'credito')).toEqual([])
    expect((await e.leerFactura(pagoId)).notas[0].estado).toBe('rechazada')

    e.facturacion.escenario = 'emitida'
    const comprador = { tipo: 'consumidor_final', correo: 'ana@ribu.test' }
    const { status, datos } = await e.pedir('POST', `/api/notas/${nota.id}/reintentar`, quien.admin(), { comprador })
    expect(status).toBe(200)
    expect(datos).toMatchObject({ estado: 'en_proceso', comprador })
    await e.emitirNota(nota.id)
    expect(await leerNota(e, nota.id)).toMatchObject({ estado: 'emitida', correo: { estado: 'enviado' } })
  })

  test('una rechazada no cuenta para el saldo, pero al reintentar se revisa otra vez', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nota } = await crearNota(e, pagoId, ANULACION)
    e.facturacion.escenario = 'rechazada'
    await e.emitirNota(nota.id)
    e.facturacion.escenario = 'emitida'
    expect((await crearNota(e, pagoId, devolucion(40_000))).status).toBe(201)
    const { datos } = await e.pedir('POST', `/api/notas/${nota.id}/reintentar`, quien.admin(), { comprador: null })
    expect(datos.codigo).toBe('TRANSICION_INVALIDA')
  })

  test('en_validacion reintenta con la misma referencia y nunca se elimina', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nota } = await crearNota(e, pagoId, ANULACION)
    e.facturacion.escenario = 'en_validacion'
    await e.emitirNota(nota.id)
    expect((await leerNota(e, nota.id)).estado).toBe('en_validacion')
    expect(e.facturacion.documentos().filter((d) => d.rango === 'credito')).toHaveLength(1)
    expect((await e.pedir('POST', `/api/notas/${nota.id}/reintentar`, quien.admin(), { comprador: null })).datos.codigo).toBe('TRANSICION_INVALIDA')
  })

  test('el correo sale solo, y un 422 no afecta la nota', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e, 'ana@ribu.test')
    const { datos: nota } = await crearNota(e, pagoId, ANULACION)
    e.ctx.facturacion = {
      ...e.facturacion,
      enviarCorreoNota: async () => { throw new ErrorIntegracion('Factus respondió 422', 'factus', 'validacion', 422) },
    }
    await e.emitirNota(nota.id)
    expect(await leerNota(e, nota.id)).toMatchObject({ estado: 'emitida', correo: { estado: 'fallido' } })
    e.ctx.facturacion = e.facturacion
    const { datos } = await e.pedir('POST', `/api/notas/${nota.id}/correo`, quien.admin(), { correo: 'otra@ribu.test' })
    expect(datos.correo).toMatchObject({ estado: 'enviado', destino: 'otra@ribu.test' })
    expect(e.facturacion.correos.at(-1)).toMatchObject({ rango: 'credito', correo: 'otra@ribu.test' })
  })

  test('el PDF y el correo necesitan la nota emitida', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nota } = await crearNota(e, pagoId, ANULACION)
    expect((await e.pedir('GET', `/api/notas/${nota.id}/pdf`, quien.admin())).datos.codigo).toBe('FACTURA_NO_DISPONIBLE')
    expect((await e.pedir('POST', `/api/notas/${nota.id}/correo`, quien.admin(), { correo: 'a@ribu.test' })).datos.codigo).toBe('FACTURA_NO_DISPONIBLE')
    await e.emitirNota(nota.id)
    const pdf = await e.pedir('GET', `/api/notas/${nota.id}/pdf`, quien.admin())
    expect(pdf.status).toBe(200)
    expect(pdf.cabeceras.get('content-type')).toBe('application/pdf')
  })
})

describe('un restaurante no toca las notas de otro', () => {
  test('el administrador de otro restaurante no encuentra nada', async () => {
    const e = crearEscenario()
    const pagoId = await facturaEmitida(e)
    const { datos: nota } = await crearNota(e, pagoId, ANULACION)
    const otro = quien.admin('rest-2')
    expect((await e.pedir('POST', `/api/pagos/${pagoId}/notas`, otro, ANULACION)).datos.codigo).toBe('NO_ENCONTRADO')
    expect((await e.pedir('POST', `/api/notas/${nota.id}/devolucion`, otro)).datos.codigo).toBe('NO_ENCONTRADO')
    expect((await e.pedir('GET', `/api/notas/${nota.id}/pdf`, otro)).datos.codigo).toBe('NO_ENCONTRADO')
  })
})
