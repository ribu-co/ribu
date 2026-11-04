import { expect, test } from 'vitest'
import { ErrorIntegracion } from '../contratos/reglas'
import type { MedioPago } from '../contratos/tipos'
import { crearFacturacionFactus, cuerpoFactura, erroresFactus, interpretarEmision } from './cliente'
import { solicitudDePrueba } from './datos-prueba'
import { crearFetchFalso, json, type Responder } from './fetch-falso'

const CUFE = 'a'.repeat(96)

const validada = (cambios: Record<string, unknown> = {}) => ({
  status: 'Created',
  message: 'Documento con el código de referencia pago-1 registrado y validado con éxito',
  data: {
    reference_code: 'pago-1',
    number: 'SETP990000203',
    is_validated: true,
    errors: {},
    cufe: CUFE,
    links: { qr: `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${CUFE}`, public_url: 'https://factus.pub/x' },
    ...cambios,
  },
})

/** Factus de mentira: token, un rango de facturas con id 77 y lo que diga `validar`. */
function preparar(validar: Responder = () => json(validada(), 201)) {
  const falso = crearFetchFalso((llamada) => {
    if (llamada.url.pathname === '/oauth/token') {
      return json({ token_type: 'Bearer', expires_in: 600, access_token: 'acceso', refresh_token: 'renovar' })
    }
    if (llamada.url.pathname === '/v2/numbering-ranges') return json({ data: [{ id: 77, is_active: 1, is_expired: 0 }] })
    return validar(llamada)
  })
  const facturacion = crearFacturacionFactus({
    url: 'https://factus.prueba',
    clientId: 'id',
    clientSecret: 'secreto',
    usuario: 'equipo@ejemplo.com',
    clave: 'clave',
    userAgent: 'ribu-pruebas',
    fetch: falso.fetch,
  })
  const enviados = () =>
    falso.llamadas.filter((l) => l.url.pathname === '/v2/bills/validate').map((l) => JSON.parse(l.cuerpo!))
  return { facturacion, llamadas: falso.llamadas, enviados }
}

test('convierte la solicitud en el cuerpo de bills/validate', () => {
  expect(cuerpoFactura(solicitudDePrueba(), 77)).toEqual({
    reference_code: 'pago-1',
    numbering_range_id: 77,
    send_email: false,
    payment_details: [{ payment_form: '1', payment_method_code: '47', amount: '54630.00' }],
    cash_rounding_amount: '0.00',
    customer: {
      identification_document_code: '13',
      identification: '222222222222',
      names: 'Consumidor Final',
      legal_organization_code: '2',
    },
    items: [
      {
        code_reference: 'P-1',
        name: 'Bandeja paisa',
        quantity: '2.00',
        discount_rate: '0.00',
        price: '23148.15',
        unit_measure_code: '94',
        standard_code: '999',
        taxes: [{ code: '04', rate: '8.00' }],
      },
    ],
    allowance_charges: [
      { concept_type: '03', is_surcharge: true, reason: 'propina', base_amount: '46296.30', amount: '4630.00' },
    ],
  })
})

test.each([
  ['factus_pay', '47'],
  ['efectivo', '10'],
  ['tarjeta_debito', '49'],
  ['tarjeta_credito', '48'],
] as [MedioPago, string][])('el medio %s es el código %s', (medio, codigo) => {
  expect(cuerpoFactura(solicitudDePrueba({ medio }), 1).payment_details[0].payment_method_code).toBe(codigo)
})

test('una persona va con su tipo de documento, nombre y organización 2', () => {
  const tipos = { CC: '13', CE: '22', NIT: '31', PASAPORTE: '41', PPT: '48' } as const
  for (const [tipoDocumento, codigo] of Object.entries(tipos)) {
    const comprador = {
      tipo: 'persona' as const,
      tipoDocumento: tipoDocumento as keyof typeof tipos,
      documento: ' 1234567890 ',
      nombre: 'Ana Inventada',
      correo: 'ana@ejemplo.com',
    }
    expect(cuerpoFactura(solicitudDePrueba({ comprador }), 1).customer).toEqual({
      identification_document_code: codigo,
      identification: '1234567890',
      names: 'Ana Inventada',
      legal_organization_code: '2',
      email: 'ana@ejemplo.com',
    })
  }
})

test('una empresa va con NIT sin dígito de verificación, razón social y organización 1', () => {
  const comprador = { tipo: 'empresa' as const, nit: '900123456', razonSocial: 'Empresa Inventada SAS', correo: 'f@ejemplo.com' }
  expect(cuerpoFactura(solicitudDePrueba({ comprador }), 1).customer).toEqual({
    identification_document_code: '31',
    identification: '900123456',
    company: 'Empresa Inventada SAS',
    legal_organization_code: '1',
    email: 'f@ejemplo.com',
  })
})

test('el consumidor final lleva el correo solo si lo dio', () => {
  const comprador = { tipo: 'consumidor_final' as const, correo: 'c@ejemplo.com' }
  expect(cuerpoFactura(solicitudDePrueba({ comprador }), 1).customer).toMatchObject({ email: 'c@ejemplo.com' })
})

test('el IVA es el código 01 y sin impuesto va excluido', () => {
  const iva = cuerpoFactura(solicitudDePrueba({ impuesto: { tipo: 'IVA', porcentaje: 19 }, total: 59_722.6 }), 1)
  expect(iva.items[0].taxes).toEqual([{ code: '01', rate: '19.00' }])
  const ninguno = cuerpoFactura(solicitudDePrueba({ impuesto: { tipo: 'ninguno', porcentaje: 0 }, total: 50_926.3 }), 1)
  expect(ninguno.items[0].taxes).toEqual([{ code: '01', rate: '0.00', is_excluded: true }])
})

test('sin propina no se envía allowance_charges', () => {
  expect(cuerpoFactura(solicitudDePrueba({ propina: null, total: 50_000 }), 1)).not.toHaveProperty('allowance_charges')
  expect(cuerpoFactura(solicitudDePrueba({ propina: { base: 46_296.3, valor: 0 }, total: 50_000 }), 1)).not.toHaveProperty(
    'allowance_charges',
  )
})

test('cash_rounding_amount cuadra lo pagado con lo calculado', () => {
  const solicitud = solicitudDePrueba({
    lineas: [{ codigo: 'P-2', descripcion: 'Limonada', cantidad: 3, precioSinImpuesto: 2_777.78 }],
    propina: null,
    total: 9_000,
  })
  const cuerpo = cuerpoFactura(solicitud, 1)
  expect(cuerpo.cash_rounding_amount).toBe('-0.01')
  expect(cuerpo.payment_details[0].amount).toBe('9000.00')
})

test('una factura validada se emite con número, CUFE, QR y enlace público', async () => {
  const { facturacion, enviados } = preparar()
  expect(await facturacion.emitirFactura(solicitudDePrueba())).toEqual({
    estado: 'emitida',
    datos: {
      numero: 'SETP990000203',
      cufe: CUFE,
      qrUrl: `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${CUFE}`,
      urlPublica: 'https://factus.pub/x',
    },
  })
  expect(enviados()).toEqual([cuerpoFactura(solicitudDePrueba(), 77)])
})

test('con "rechazo" en errors queda rechazada', async () => {
  const errors = { FAK24: 'Regla: FAK24, Rechazo: No está informado el documento del adquiriente', FAJ44b: 'Notificación' }
  const { facturacion } = preparar(() => json(validada({ is_validated: false, errors }), 201))
  expect(await facturacion.emitirFactura(solicitudDePrueba())).toEqual({
    estado: 'rechazada',
    errores: ['Regla: FAK24, Rechazo: No está informado el documento del adquiriente', 'FAJ44b: Notificación'],
  })
})

test('sin rechazo queda en validación, aunque traiga notificaciones como FAJ44b o RUT01', async () => {
  const errors = { FAJ44b: 'Regla: FAJ44b, Notificación: Nit o Documento de Identificación informado no está registrado', RUT01: 'Notificación' }
  const { facturacion } = preparar(() => json(validada({ is_validated: false, errors }), 201))
  expect(await facturacion.emitirFactura(solicitudDePrueba())).toEqual({
    estado: 'en_validacion',
    detalle: 'Regla: FAJ44b, Notificación: Nit o Documento de Identificación informado no está registrado. RUT01: Notificación',
  })
})

test('validada con notificaciones sigue siendo emitida', () => {
  const resultado = interpretarEmision({ is_validated: 1, errors: { FAJ44b: 'Notificación' } }, () => 'datos')
  expect(resultado).toEqual({ estado: 'emitida', datos: 'datos' })
  expect(interpretarEmision({ is_validated: false, errors: [] }, () => 'datos')).toEqual({ estado: 'en_validacion', detalle: null })
})

test('errors puede llegar como objeto, lista o texto', () => {
  expect(erroresFactus(null)).toEqual([])
  expect(erroresFactus('Rechazo general')).toEqual(['Rechazo general'])
  expect(erroresFactus(['a', ['b']])).toEqual(['a', 'b'])
  expect(erroresFactus({ R1: ['x', 'y'] })).toEqual(['R1: x', 'R1: y'])
})

test('validada sin CUFE es un fallo de Factus que se reintenta', async () => {
  const { facturacion } = preparar(() => json(validada({ cufe: null }), 201))
  const error = await facturacion.emitirFactura(solicitudDePrueba()).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ErrorIntegracion)
  expect(error).toMatchObject({ tipo: 'servidor', reintentable: true })
})

test('una solicitud inválida falla sin llamar a Factus', async () => {
  const { facturacion, llamadas } = preparar()
  const error = await facturacion.emitirFactura(solicitudDePrueba({ total: 70_000 })).catch((e: unknown) => e)
  expect(error).toMatchObject({ tipo: 'validacion' })
  expect(llamadas).toHaveLength(0)
})

test('un 409 de documento pendiente se lanza como conflicto', async () => {
  const { facturacion } = preparar(() => json({ message: 'Se encontró una factura pendiente por enviar a la DIAN' }, 409))
  const error = await facturacion.emitirFactura(solicitudDePrueba()).catch((e: unknown) => e)
  expect(error).toMatchObject({ tipo: 'conflicto', status: 409, reintentable: true })
})

test('si Factus no acepta el rango guardado, la siguiente emisión lo consulta otra vez', async () => {
  let intentos = 0
  const { facturacion, llamadas } = preparar(() =>
    ++intentos === 1
      ? json({ message: 'Datos inválidos', errors: { numbering_range_id: ['El rango no está activo'] } }, 422)
      : json(validada(), 201),
  )
  await expect(facturacion.emitirFactura(solicitudDePrueba())).rejects.toMatchObject({ tipo: 'validacion' })
  await facturacion.emitirFactura(solicitudDePrueba())
  expect(llamadas.filter((l) => l.url.pathname === '/v2/numbering-ranges')).toHaveLength(2)
})

test('elimina una factura rechazada por su referencia', async () => {
  const { facturacion, llamadas } = preparar(() => json({ status: 'OK', message: 'Documento eliminado' }))
  await facturacion.eliminarFactura('pago 1/a')
  const [llamada] = llamadas.filter((l) => l.metodo === 'DELETE')
  expect(llamada.url.pathname).toBe('/v2/bills/destroy/reference/pago%201%2Fa')
  expect(llamada.headers.get('Authorization')).toBe('Bearer acceso')
})

test('si Factus no deja eliminar, el error llega como tal', async () => {
  const { facturacion } = preparar(() => json({ message: 'La factura ya fue validada' }, 422))
  await expect(facturacion.eliminarFactura('pago-1')).rejects.toMatchObject({ tipo: 'validacion', status: 422 })
})

test('descarga el PDF en base64 con su nombre de archivo', async () => {
  const { facturacion, llamadas } = preparar(() =>
    json({ data: { file_name: 'FES-SETP990000203', pdf_base_64_encoded: 'JVBERi0x' } }),
  )
  expect(await facturacion.descargarPdf('SETP990000203')).toEqual({
    nombreArchivo: 'FES-SETP990000203.pdf',
    base64: 'JVBERi0x',
  })
  expect(llamadas.at(-1)).toMatchObject({ metodo: 'GET' })
  expect(llamadas.at(-1)!.url.pathname).toBe('/v2/bills/SETP990000203/download-pdf')
})

test('sin nombre de archivo, el PDF se llama como la factura', async () => {
  const { facturacion } = preparar(() => json({ data: { pdf_base_64_encoded: 'JVBERi0x' } }))
  expect((await facturacion.descargarPdf('SETP1')).nombreArchivo).toBe('SETP1.pdf')
})

test('un PDF vacío es un fallo de Factus que se reintenta', async () => {
  const { facturacion } = preparar(() => json({ data: {} }))
  await expect(facturacion.descargarPdf('SETP1')).rejects.toMatchObject({ tipo: 'servidor', reintentable: true })
})

test('envía la factura al correo que se pida', async () => {
  const { facturacion, llamadas } = preparar(() => json({ status: 'OK', message: 'Correo enviado' }))
  await facturacion.enviarCorreo('SETP990000203', 'cliente@ejemplo.com')
  const llamada = llamadas.at(-1)!
  expect(llamada.metodo).toBe('POST')
  expect(llamada.url.pathname).toBe('/v2/bills/SETP990000203/send-email')
  expect(JSON.parse(llamada.cuerpo!)).toEqual({ email: 'cliente@ejemplo.com' })
})

test('una factura que no existe falla al pedir su PDF o su correo', async () => {
  const { facturacion } = preparar(() => json({ message: 'No encontrado' }, 404))
  await expect(facturacion.descargarPdf('SETP0')).rejects.toMatchObject({ tipo: 'validacion', status: 404 })
  await expect(facturacion.enviarCorreo('SETP0', 'a@ejemplo.com')).rejects.toMatchObject({ status: 404 })
})
