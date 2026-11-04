import { expect, test } from 'vitest'
import { ErrorIntegracion } from '../contratos/reglas'
import { notaDePrueba, solicitudDePrueba } from './datos-prueba'
import { crearFacturacionMock, ERROR_RECHAZO } from './mock'

/** Espera que la promesa falle con un ErrorIntegracion de ese tipo y estado. */
async function fallaCon(promesa: Promise<unknown>, tipo: ErrorIntegracion['tipo'], status?: number) {
  const error = await promesa.then(
    () => expect.unreachable('debía fallar'),
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(ErrorIntegracion)
  expect(error).toMatchObject({ servicio: 'factus', tipo, ...(status ? { status } : {}) })
}

test('por defecto emite la factura con número, CUFE, QR y enlace público', async () => {
  const facturacion = crearFacturacionMock()
  const resultado = await facturacion.emitirFactura(solicitudDePrueba())
  expect(resultado.estado).toBe('emitida')
  if (resultado.estado !== 'emitida') return
  expect(resultado.datos.numero).toBe('SETP990000001')
  expect(resultado.datos.cufe).toMatch(/^[0-9a-f]{96}$/)
  expect(resultado.datos.qrUrl).toContain(resultado.datos.cufe)
  expect(resultado.datos.urlPublica).toMatch(/^https:\/\//)
})

test('cada factura toma el siguiente consecutivo', async () => {
  const facturacion = crearFacturacionMock()
  await facturacion.emitirFactura(solicitudDePrueba({ referencia: 'pago-1' }))
  const segunda = await facturacion.emitirFactura(solicitudDePrueba({ referencia: 'pago-2' }))
  expect(segunda).toMatchObject({ estado: 'emitida', datos: { numero: 'SETP990000002' } })
})

test('la misma referencia validada devuelve la misma factura aunque cambien los datos', async () => {
  const facturacion = crearFacturacionMock()
  const primera = await facturacion.emitirFactura(solicitudDePrueba())
  const repetida = await facturacion.emitirFactura(
    solicitudDePrueba({ comprador: { tipo: 'empresa', nit: '900123456', razonSocial: 'Otra', correo: 'a@b.co' } }),
  )
  expect(repetida).toEqual(primera)
  expect(facturacion.emisiones).toHaveLength(2)
  expect(facturacion.documentos()).toHaveLength(1)
})

test('en validación se reintenta con la misma referencia y conserva el número', async () => {
  const facturacion = crearFacturacionMock({ escenario: 'en_validacion' })
  const primera = await facturacion.emitirFactura(solicitudDePrueba())
  expect(primera).toEqual({ estado: 'en_validacion', detalle: expect.any(String) })

  // Mientras está pendiente, bloquea el rango para otras referencias.
  await fallaCon(facturacion.emitirFactura(solicitudDePrueba({ referencia: 'pago-2' })), 'conflicto', 409)

  facturacion.escenario = 'emitida'
  const reintento = await facturacion.emitirFactura(solicitudDePrueba())
  expect(reintento).toMatchObject({ estado: 'emitida', datos: { numero: 'SETP990000001' } })
  expect(await facturacion.emitirFactura(solicitudDePrueba({ referencia: 'pago-2' }))).toMatchObject({
    estado: 'emitida',
  })
})

test('una factura en validación nunca se elimina', async () => {
  const facturacion = crearFacturacionMock({ escenario: 'en_validacion' })
  await facturacion.emitirFactura(solicitudDePrueba())
  await fallaCon(facturacion.eliminarFactura('pago-1'), 'validacion')
  expect(facturacion.documentos()).toHaveLength(1)
})

test('una rechazada bloquea el rango hasta eliminarla, y luego se reenvía con la misma referencia', async () => {
  const facturacion = crearFacturacionMock({ escenario: 'rechazada' })
  const rechazo = await facturacion.emitirFactura(solicitudDePrueba())
  expect(rechazo).toEqual({ estado: 'rechazada', errores: [ERROR_RECHAZO] })
  expect(ERROR_RECHAZO).toMatch(/rechazo/i)

  await fallaCon(facturacion.emitirFactura(solicitudDePrueba()), 'conflicto', 409)
  await fallaCon(facturacion.emitirFactura(solicitudDePrueba({ referencia: 'pago-2' })), 'conflicto', 409)

  await facturacion.eliminarFactura('pago-1')
  facturacion.escenario = 'emitida'
  expect(await facturacion.emitirFactura(solicitudDePrueba())).toMatchObject({ estado: 'emitida' })
})

test('no se elimina una factura validada ni una que no existe', async () => {
  const facturacion = crearFacturacionMock()
  await facturacion.emitirFactura(solicitudDePrueba())
  await fallaCon(facturacion.eliminarFactura('pago-1'), 'validacion', 422)
  await fallaCon(facturacion.eliminarFactura('no-existe'), 'validacion', 404)
})

test('el escenario se puede decidir por solicitud y puede simular un fallo de Factus', async () => {
  const facturacion = crearFacturacionMock({
    escenario: (solicitud) => {
      if (solicitud.referencia === 'lento') throw new ErrorIntegracion('Límite', 'factus', 'limite', 429, 30)
      return solicitud.comprador.tipo === 'empresa' ? 'rechazada' : 'emitida'
    },
  })
  await fallaCon(facturacion.emitirFactura(solicitudDePrueba({ referencia: 'lento' })), 'limite', 429)
  expect(await facturacion.emitirFactura(solicitudDePrueba())).toMatchObject({ estado: 'emitida' })
  const empresa = solicitudDePrueba({
    referencia: 'pago-2',
    comprador: { tipo: 'empresa', nit: '900123456', razonSocial: 'Empresa Inventada', correo: 'a@b.co' },
  })
  expect(await facturacion.emitirFactura(empresa)).toMatchObject({ estado: 'rechazada' })
})

test('una solicitud que Factus no aceptaría falla sin llegar a Factus', async () => {
  const facturacion = crearFacturacionMock()
  await fallaCon(facturacion.emitirFactura(solicitudDePrueba({ total: 60_000 })), 'validacion')
  expect(facturacion.emisiones).toHaveLength(0)
})

test('el PDF y el correo solo existen para facturas emitidas', async () => {
  const facturacion = crearFacturacionMock()
  await fallaCon(facturacion.descargarPdf('SETP990000001'), 'validacion', 404)
  await facturacion.emitirFactura(solicitudDePrueba())

  const pdf = await facturacion.descargarPdf('SETP990000001')
  expect(pdf.nombreArchivo).toBe('SETP990000001.pdf')
  expect(atob(pdf.base64).startsWith('%PDF')).toBe(true)

  await facturacion.enviarCorreo('SETP990000001', 'cliente@ejemplo.com')
  expect(facturacion.correos).toEqual([
    { rango: 'factura', numero: 'SETP990000001', correo: 'cliente@ejemplo.com' },
  ])
  await fallaCon(facturacion.enviarCorreo('SETP990000099', 'cliente@ejemplo.com'), 'validacion', 404)
})

test('una nota solo corrige una factura emitida', async () => {
  const facturacion = crearFacturacionMock()
  await fallaCon(facturacion.emitirNota(notaDePrueba()), 'validacion', 422)
  await facturacion.emitirFactura(solicitudDePrueba())

  const credito = await facturacion.emitirNota(notaDePrueba())
  expect(credito).toMatchObject({ estado: 'emitida', datos: { numero: 'NC1' } })
  if (credito.estado === 'emitida') expect(credito.datos.cude).toMatch(/^[0-9a-f]{96}$/)

  const debito = await facturacion.emitirNota(notaDePrueba({ referencia: 'nota-2', tipo: 'debito', concepto: 'otros' }))
  expect(debito).toMatchObject({ estado: 'emitida', datos: { numero: 'ND1' } })
})

test('las notas siguen las reglas de rechazo, PDF y correo, cada tipo en su rango', async () => {
  const facturacion = crearFacturacionMock()
  await facturacion.emitirFactura(solicitudDePrueba())
  facturacion.escenario = 'rechazada'
  expect(await facturacion.emitirNota(notaDePrueba())).toMatchObject({ estado: 'rechazada' })

  // La nota crédito rechazada no bloquea las notas débito ni las facturas.
  facturacion.escenario = 'emitida'
  await facturacion.emitirNota(notaDePrueba({ referencia: 'nota-2', tipo: 'debito', concepto: 'otros' }))
  await facturacion.emitirFactura(solicitudDePrueba({ referencia: 'pago-2' }))
  await fallaCon(facturacion.emitirNota(notaDePrueba({ referencia: 'nota-3' })), 'conflicto', 409)

  await facturacion.eliminarNota('credito', 'nota-1')
  expect(await facturacion.emitirNota(notaDePrueba())).toMatchObject({ estado: 'emitida', datos: { numero: 'NC2' } })

  expect((await facturacion.descargarPdfNota('credito', 'NC2')).nombreArchivo).toBe('NC2.pdf')
  await fallaCon(facturacion.descargarPdfNota('debito', 'NC2'), 'validacion', 404)
  await facturacion.enviarCorreoNota('debito', 'ND1', 'cliente@ejemplo.com')
  expect(facturacion.correos).toEqual([{ rango: 'debito', numero: 'ND1', correo: 'cliente@ejemplo.com' }])
})
