import { expect, test } from 'vitest'
import type { TipoNota } from '../contratos/tipos'
import { crearFacturacionFactus, cuerpoFactura, cuerpoNota } from './cliente'
import { notaDePrueba } from './datos-prueba'
import { crearFetchFalso, json, type Responder } from './fetch-falso'

const CUDE = 'b'.repeat(96)
const RANGOS: Record<string, number> = { '21': 1, '22': 22, '23': 33 }

const validada = (cambios: Record<string, unknown> = {}) => ({
  status: 'Created',
  data: {
    number: 'NC5',
    is_validated: true,
    errors: {},
    cude: CUDE,
    links: { qr: `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${CUDE}`, public_url: 'https://factus.pub/nc5' },
    ...cambios,
  },
})

/** Factus de mentira con un rango por tipo de documento. */
function preparar(responder: Responder = () => json(validada(), 201)) {
  const falso = crearFetchFalso((llamada) => {
    if (llamada.url.pathname === '/oauth/token') {
      return json({ token_type: 'Bearer', expires_in: 600, access_token: 'acceso', refresh_token: 'renovar' })
    }
    if (llamada.url.pathname === '/v2/numbering-ranges') {
      const id = RANGOS[llamada.url.searchParams.get('filter[document]')!]
      return json({ data: { data: [{ id, is_active: 1, is_expired: 0 }] } })
    }
    return responder(llamada)
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
  const api = () => falso.llamadas.filter((l) => !['/oauth/token', '/v2/numbering-ranges'].includes(l.url.pathname))
  return { facturacion, llamadas: falso.llamadas, api }
}

test('la nota es la factura más bill_number, correction_concept_code y observation', () => {
  const nota = notaDePrueba()
  expect(cuerpoNota(nota, 22)).toEqual({
    ...cuerpoFactura(nota, 22),
    bill_number: 'SETP990000001',
    correction_concept_code: '2',
    observation: 'El cliente devolvió el pedido',
  })
})

test.each([
  ['credito', 'devolucion_parcial', '1'],
  ['credito', 'anulacion', '2'],
  ['credito', 'rebaja', '3'],
  ['credito', 'ajuste_precio', '4'],
  ['debito', 'intereses', '1'],
  ['debito', 'gastos_por_cobrar', '2'],
  ['debito', 'cambio_valor', '3'],
  ['debito', 'otros', '4'],
] as const)('la nota %s por %s usa el código %s', (tipo, concepto, codigo) => {
  expect(cuerpoNota(notaDePrueba({ tipo, concepto }), 1).correction_concept_code).toBe(codigo)
})

test.each([
  ['credito', '/v2/credit-notes/validate', 22],
  ['debito', '/v2/debit-notes/validate', 33],
] as [TipoNota, string, number][])('la nota %s va a %s con su rango', async (tipo, ruta, rangoId) => {
  const { facturacion, api, llamadas } = preparar()
  const concepto = tipo === 'credito' ? 'anulacion' : 'otros'
  const resultado = await facturacion.emitirNota(notaDePrueba({ tipo, concepto }))
  expect(resultado).toEqual({
    estado: 'emitida',
    datos: {
      numero: 'NC5',
      cude: CUDE,
      qrUrl: `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${CUDE}`,
      urlPublica: 'https://factus.pub/nc5',
    },
  })
  const [llamada] = api()
  expect(llamada.url.pathname).toBe(ruta)
  expect(JSON.parse(llamada.cuerpo!).numbering_range_id).toBe(rangoId)
  const consultado = llamadas.find((l) => l.url.pathname === '/v2/numbering-ranges')!
  expect(consultado.url.searchParams.get('filter[document]')).toBe(tipo === 'credito' ? '22' : '23')
})

test('las notas siguen las mismas reglas de rechazo y demora', async () => {
  const rechazo = preparar(() => json(validada({ is_validated: false, errors: { CAJ01: 'Rechazo: no cuadra' } }), 201))
  expect(await rechazo.facturacion.emitirNota(notaDePrueba())).toEqual({ estado: 'rechazada', errores: ['CAJ01: Rechazo: no cuadra'] })
  const demora = preparar(() => json(validada({ is_validated: false, errors: {} }), 201))
  expect(await demora.facturacion.emitirNota(notaDePrueba())).toEqual({ estado: 'en_validacion', detalle: null })
})

test('una nota con un concepto de otro tipo falla sin llamar a Factus', async () => {
  const { facturacion, llamadas } = preparar()
  const nota = notaDePrueba({ tipo: 'debito', concepto: 'anulacion' })
  await expect(facturacion.emitirNota(nota)).rejects.toMatchObject({ tipo: 'validacion' })
  expect(llamadas).toHaveLength(0)
})

test.each([
  ['credito', '/v2/credit-notes'],
  ['debito', '/v2/debit-notes'],
] as [TipoNota, string][])('la nota %s se elimina, se descarga y se envía en %s', async (tipo, base) => {
  const { facturacion, api } = preparar((llamada) =>
    llamada.url.pathname.endsWith('/download-pdf') ? json({ data: { pdf_base_64_encoded: 'JVBERi0x' } }) : json({}),
  )
  await facturacion.eliminarNota(tipo, 'nota-1')
  expect(await facturacion.descargarPdfNota(tipo, 'N7')).toEqual({ nombreArchivo: 'N7.pdf', base64: 'JVBERi0x' })
  await facturacion.enviarCorreoNota(tipo, 'N7', 'cliente@ejemplo.com')
  expect(api().map((l) => `${l.metodo} ${l.url.pathname}`)).toEqual([
    `DELETE ${base}/reference/nota-1`,
    `GET ${base}/N7/download-pdf`,
    `POST ${base}/N7/send-email`,
  ])
  expect(JSON.parse(api()[2].cuerpo!)).toEqual({ email: 'cliente@ejemplo.com' })
})
