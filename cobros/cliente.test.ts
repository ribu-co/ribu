import { expect, test } from 'vitest'
import { ErrorIntegracion } from '../contratos/reglas'
import { aFecha, crearCobrosFactusPay, type OpcionesFactusPay } from './cliente'

const URL_SANDBOX = 'https://pay-api-sandbox.factus.com.co'
const TOKEN = 'token-secreto-de-prueba'

interface Llamada {
  url: string
  metodo: string | undefined
  cabeceras: Record<string, string>
  cuerpo: unknown
}

/** Un `fetch` de mentiras: guarda lo que se le pidió y devuelve lo que le digan. */
function fetchFalso(respuestas: Response | Response[] | (() => never)) {
  const llamadas: Llamada[] = []
  const cola = Array.isArray(respuestas) ? [...respuestas] : respuestas
  const falso: typeof globalThis.fetch = async (entrada, init) => {
    const cabeceras: Record<string, string> = {}
    for (const [nombre, valor] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      cabeceras[nombre] = valor
    }
    llamadas.push({
      url: String(entrada),
      metodo: init?.method,
      cabeceras,
      cuerpo: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    if (typeof cola === 'function') return cola()
    const siguiente = Array.isArray(cola) ? cola.shift() : cola
    if (!siguiente) throw new Error('el fetch falso se quedó sin respuestas')
    return siguiente
  }
  return { fetch: falso, llamadas }
}

const json = (cuerpo: unknown, status = 200, cabeceras: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json', ...cabeceras } })

const RECAUDO = {
  reference_code: 'pago-1',
  amount: 150000,
  status: 'ready',
  breb_key: '@FCWHUYLIV2MWUEUESTONH',
  created_at: '28-10-2026 08:03:04 PM',
  qr_expires_at: '28-10-2026 08:23:04 PM',
  collected_at: null,
  qr: 'data:image/png;base64,iVBORw0KGgoAAAA',
}

const cobros = (fetch: typeof globalThis.fetch, extra: Partial<OpcionesFactusPay> = {}) =>
  crearCobrosFactusPay({
    url: URL_SANDBOX,
    token: TOKEN,
    llaveWebhook: 'llave-del-webhook',
    userAgent: 'ribu',
    fetch,
    ...extra,
  })

const solicitud = { referencia: 'pago-1', monto: 150_000, expiraEnSegundos: 600 }

test('crearCobro manda reference_code, amount y expiration a /v1/collections', async () => {
  const falso = fetchFalso(json({ data: RECAUDO }))
  await cobros(falso.fetch).crearCobro(solicitud)

  expect(falso.llamadas).toHaveLength(1)
  const [llamada] = falso.llamadas
  expect(llamada.url).toBe(`${URL_SANDBOX}/v1/collections`)
  expect(llamada.metodo).toBe('POST')
  expect(llamada.cuerpo).toEqual({ reference_code: 'pago-1', amount: 150_000, expiration: 600 })
})

test('toda llamada lleva el token, el Accept y el User-Agent propio', async () => {
  const falso = fetchFalso([json({ data: RECAUDO }), json({ data: RECAUDO })])
  const servicio = cobros(falso.fetch)
  await servicio.crearCobro(solicitud)
  await servicio.consultarCobro('pago-1')

  for (const { cabeceras } of falso.llamadas) {
    expect(cabeceras.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(cabeceras.Accept).toBe('application/json')
    // Sin User-Agent propio, Cloudflare responde 403.
    expect(cabeceras['User-Agent']).toBe('ribu')
  }
  expect(falso.llamadas[0].cabeceras['Content-Type']).toBe('application/json')
})

test('nunca llama a /auth: eso revocaría el token de todo el equipo', async () => {
  const falso = fetchFalso([json({ data: RECAUDO }), json({ data: RECAUDO })])
  const servicio = cobros(falso.fetch)
  await servicio.crearCobro(solicitud)
  await servicio.consultarCobro('pago-1')
  expect(falso.llamadas.every(({ url }) => !url.includes('/auth'))).toBe(true)
})

test('crearCobro lee el recaudo de data y lo deja en el formato del contrato', async () => {
  const falso = fetchFalso(json({ data: RECAUDO, status: 'success', message: 'Recaudo creado correctamente' }))
  expect(await cobros(falso.fetch).crearCobro(solicitud)).toEqual({
    referencia: 'pago-1',
    monto: 150_000,
    estado: 'ready',
    // El QR va sin el prefijo `data:`.
    qrBase64: 'iVBORw0KGgoAAAA',
    llaveBreB: '@FCWHUYLIV2MWUEUESTONH',
    // 20:23:04 en Colombia es 01:23:04 UTC del día siguiente.
    qrExpiraEn: '2026-10-29T01:23:04.000Z',
    recaudadoEn: null,
  })
})

test.each([200, 201])('acepta %s al crear', async (status) => {
  // Probado en el sandbox: responde 200 si se envía `expiration` y 201 si no. Ribu siempre la envía.
  const falso = fetchFalso(json({ data: RECAUDO }, status))
  expect(await cobros(falso.fetch).crearCobro(solicitud)).toMatchObject({ estado: 'ready' })
})

test('consultarCobro hace GET con la referencia en la ruta', async () => {
  const pagado = { ...RECAUDO, status: 'paid', collected_at: '28-10-2026 08:10:00 PM', qr: null }
  const falso = fetchFalso(json({ data: pagado }))
  const cobro = await cobros(falso.fetch).consultarCobro('pago 1/2')

  expect(falso.llamadas[0].metodo).toBe('GET')
  expect(falso.llamadas[0].url).toBe(`${URL_SANDBOX}/v1/collections/pago%201%2F2`)
  expect(falso.llamadas[0].cuerpo).toBeNull()
  expect(cobro).toMatchObject({ estado: 'paid', qrBase64: null, recaudadoEn: '2026-10-29T01:10:00.000Z' })
})

test('la url con barra al final no duplica la barra', async () => {
  const falso = fetchFalso(json({ data: RECAUDO }))
  await cobros(falso.fetch, { url: `${URL_SANDBOX}/` }).crearCobro(solicitud)
  expect(falso.llamadas[0].url).toBe(`${URL_SANDBOX}/v1/collections`)
})

test('un estado que no conocemos es desconocido y no lanza error', async () => {
  const falso = fetchFalso(json({ data: { ...RECAUDO, status: 'expired' } }))
  expect((await cobros(falso.fetch).consultarCobro('pago-1')).estado).toBe('desconocido')
})

test.each([
  ['sin status', undefined, 'desconocido'],
  ['started', 'started', 'started'],
  ['created', 'created', 'created'],
  ['ready', 'ready', 'ready'],
  ['paid', 'paid', 'paid'],
  ['failed', 'failed', 'failed'],
  ['rejected', 'rejected', 'rejected'],
])('el estado %s se lee como %s', async (_caso, recibido, esperado) => {
  const falso = fetchFalso(json({ data: { ...RECAUDO, status: recibido } }))
  expect((await cobros(falso.fetch).consultarCobro('pago-1')).estado).toBe(esperado)
})

test.each([
  ['número con decimal', 150000.0, 150_000],
  ['texto', '150000', 150_000],
  ['texto con decimales', '150000.00', 150_000],
])('el monto llega como %s y queda en pesos enteros', async (_caso, amount, esperado) => {
  const falso = fetchFalso(json({ data: { ...RECAUDO, amount } }))
  expect((await cobros(falso.fetch).consultarCobro('pago-1')).monto).toBe(esperado)
})

test('un QR vacío o ausente queda en null', async () => {
  for (const qr of [null, '', 'data:image/png;base64,']) {
    const falso = fetchFalso(json({ data: { ...RECAUDO, qr } }))
    expect((await cobros(falso.fetch).consultarCobro('pago-1')).qrBase64).toBeNull()
  }
})

test('un QR que ya viene sin prefijo se deja igual', async () => {
  const falso = fetchFalso(json({ data: { ...RECAUDO, qr: 'iVBORw0KGgo' } }))
  expect((await cobros(falso.fetch).consultarCobro('pago-1')).qrBase64).toBe('iVBORw0KGgo')
})

test.each([
  ['28-10-2026 08:03:04 PM', '2026-10-29T01:03:04.000Z'],
  ['28-10-2026 08:03:04 AM', '2026-10-28T13:03:04.000Z'],
  ['28-10-2026 12:30:00 AM', '2026-10-28T05:30:00.000Z'],
  ['28-10-2026 12:30:00 PM', '2026-10-28T17:30:00.000Z'],
  ['28-10-2026 20:03:04', '2026-10-29T01:03:04.000Z'],
  ['2026-09-04T15:20:00Z', '2026-09-04T15:20:00.000Z'],
  ['2026-09-04T15:20:00.000Z', '2026-09-04T15:20:00.000Z'],
  ['2026-09-04T10:20:00-05:00', '2026-09-04T15:20:00.000Z'],
  // Un ISO sin zona se lee como hora de Colombia, no como la del servidor.
  ['2026-09-04T15:20:00', '2026-09-04T20:20:00.000Z'],
])('la fecha %s queda en ISO UTC %s', (recibida, esperada) => {
  expect(aFecha(recibida)).toBe(esperada)
})

test.each([null, undefined, '', '   ', 'ayer', '99-99-2026 08:03:04 PM', 7, {}])(
  'la fecha %s queda en null',
  (recibida) => {
    expect(aFecha(recibida)).toBeNull()
  },
)

test('las fechas llegan como las devolvió el sandbox, en hora de Colombia', async () => {
  // Probado: crear a las 12:00 p. m. de Colombia devolvió `04-11-2026 12:00:40 PM`.
  const recaudo = { ...RECAUDO, qr_expires_at: '04-11-2026 12:00:40 PM' }
  const falso = fetchFalso(json({ data: recaudo }))
  expect((await cobros(falso.fetch).consultarCobro('pago-1')).qrExpiraEn).toBe('2026-11-04T17:00:40.000Z')
})

test('un QR vencido sigue en ready: el vencimiento se mira con qrExpiraEn', async () => {
  const recaudo = { ...RECAUDO, qr_expires_at: '01-11-2026 08:00:00 AM' }
  const falso = fetchFalso(json({ data: recaudo }))
  const cobro = await cobros(falso.fetch).consultarCobro('pago-1')
  expect(cobro.estado).toBe('ready')
  expect(Date.parse(cobro.qrExpiraEn!)).toBeLessThan(Date.parse('2026-11-04T00:00:00Z'))
})

test('un 422 del sandbox trae { message, errors } y el mensaje incluye el detalle', async () => {
  const cuerpo = { message: 'Error de validación', errors: { amount: ['El monto debe estar entre 10000 y 12000000'] } }
  const falso = fetchFalso(json(cuerpo, 422))
  const error = (await cobros(falso.fetch)
    .crearCobro(solicitud)
    .catch((e: unknown) => e)) as ErrorIntegracion
  expect(error).toMatchObject({ tipo: 'validacion', status: 422 })
  expect(error.message).toBe('Factus Pay respondió 422: Error de validación: El monto debe estar entre 10000 y 12000000')
})

test('otro monto con la misma referencia responde 422 y no se reintenta', async () => {
  const falso = fetchFalso(
    json({ status: 'error', message: 'La referencia ya existe con un monto diferente.', data: null }, 422),
  )
  const error = (await cobros(falso.fetch)
    .crearCobro({ ...solicitud, monto: 20_000 })
    .catch((e: unknown) => e)) as ErrorIntegracion
  expect(error).toMatchObject({ tipo: 'validacion', status: 422 })
  expect(error.reintentable).toBe(false)
})

test('un 429 es limite y trae la espera del Retry-After', async () => {
  const falso = fetchFalso(json({ message: 'Demasiadas peticiones' }, 429, { 'Retry-After': '30' }))
  await expect(cobros(falso.fetch).consultarCobro('pago-1')).rejects.toMatchObject({
    name: 'ErrorIntegracion',
    servicio: 'factus_pay',
    tipo: 'limite',
    status: 429,
    esperarSegundos: 30,
  })
})

test('un 429 sin Retry-After no inventa la espera, pero se reintenta', async () => {
  const falso = fetchFalso(json({}, 429))
  const error = await cobros(falso.fetch).consultarCobro('pago-1').catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ErrorIntegracion)
  expect((error as ErrorIntegracion).esperarSegundos).toBeUndefined()
  expect((error as ErrorIntegracion).reintentable).toBe(true)
})

test('un Retry-After con fecha HTTP se convierte a segundos', async () => {
  const dentroDeDosMinutos = new Date(Date.now() + 120_000).toUTCString()
  const falso = fetchFalso(json({}, 429, { 'Retry-After': dentroDeDosMinutos }))
  const error = (await cobros(falso.fetch)
    .consultarCobro('pago-1')
    .catch((e: unknown) => e)) as ErrorIntegracion
  expect(error.esperarSegundos).toBeGreaterThan(110)
  expect(error.esperarSegundos).toBeLessThanOrEqual(120)
})

test.each([
  [500, 'servidor'],
  [502, 'servidor'],
  [503, 'servidor'],
  [401, 'no_autorizado'],
  [403, 'no_autorizado'],
  [404, 'validacion'],
  [422, 'validacion'],
  [400, 'validacion'],
  [409, 'conflicto'],
])('un %s se lanza como ErrorIntegracion de tipo %s', async (status, tipo) => {
  const falso = fetchFalso(json({ status: 'error', message: 'algo pasó' }, status))
  await expect(cobros(falso.fetch).consultarCobro('pago-1')).rejects.toMatchObject({
    name: 'ErrorIntegracion',
    servicio: 'factus_pay',
    tipo,
    status,
  })
})

test('un 404 no se reintenta y un 500 sí', async () => {
  const comoError = async (status: number) =>
    (await cobros(fetchFalso(json({}, status)).fetch)
      .consultarCobro('pago-1')
      .catch((e: unknown) => e)) as ErrorIntegracion
  expect((await comoError(404)).reintentable).toBe(false)
  expect((await comoError(500)).reintentable).toBe(true)
})

test('el mensaje del error dice el estado y el mensaje de Factus Pay', async () => {
  const falso = fetchFalso(json({ status: 'error', message: 'Recaudo no encontrado', data: null }, 404))
  await expect(cobros(falso.fetch).consultarCobro('pago-1')).rejects.toThrowError(
    'Factus Pay respondió 404: Recaudo no encontrado',
  )
})

test('el token nunca aparece en el mensaje de un error', async () => {
  const falso = fetchFalso(json({ message: `token usado: ${TOKEN}` }, 401))
  const error = (await cobros(falso.fetch)
    .consultarCobro('pago-1')
    .catch((e: unknown) => e)) as ErrorIntegracion
  expect(error.tipo).toBe('no_autorizado')
  expect(error.message).toBe('Factus Pay respondió 401: token usado: [token]')
  expect(error.stack ?? '').not.toContain(TOKEN)
})

test('un 500 con HTML en vez de JSON también se lanza como servidor', async () => {
  const falso = fetchFalso(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
  await expect(cobros(falso.fetch).consultarCobro('pago-1')).rejects.toMatchObject({
    tipo: 'servidor',
    status: 502,
  })
})

test('sin conexión se lanza ErrorIntegracion de tipo red', async () => {
  const falso = fetchFalso(() => {
    throw new TypeError('fetch failed')
  })
  await expect(cobros(falso.fetch).crearCobro(solicitud)).rejects.toMatchObject({
    name: 'ErrorIntegracion',
    servicio: 'factus_pay',
    tipo: 'red',
  })
})

test('si se agota el tiempo también es red, y se puede reintentar', async () => {
  const falso = fetchFalso(() => {
    const error = new Error('tardó demasiado')
    error.name = 'TimeoutError'
    throw error
  })
  const error = (await cobros(falso.fetch, { tiempoLimiteMs: 50 })
    .crearCobro(solicitud)
    .catch((e: unknown) => e)) as ErrorIntegracion
  expect(error.tipo).toBe('red')
  expect(error.reintentable).toBe(true)
  expect(error.message).toContain('se agotó el tiempo')
})

test('una respuesta 200 sin data se reintenta como error de servidor', async () => {
  for (const cuerpo of [{}, { data: null }, { data: 'nada' }]) {
    const falso = fetchFalso(json(cuerpo))
    await expect(cobros(falso.fetch).consultarCobro('pago-1')).rejects.toMatchObject({
      tipo: 'servidor',
      status: 200,
    })
  }
})

test('si el recaudo no trae amount, crearCobro usa el monto que se pidió', async () => {
  const { amount: _, ...sinMonto } = RECAUDO
  const falso = fetchFalso(json({ data: sinMonto }))
  expect((await cobros(falso.fetch).crearCobro(solicitud)).monto).toBe(150_000)
})

test('si el recaudo no trae amount, consultarCobro no se inventa el monto', async () => {
  const { amount: _, ...sinMonto } = RECAUDO
  const falso = fetchFalso(json({ data: sinMonto }))
  await expect(cobros(falso.fetch).consultarCobro('pago-1')).rejects.toMatchObject({ tipo: 'servidor' })
})

test('si el recaudo no trae reference_code, se usa la que se pidió', async () => {
  const { reference_code: _, ...sinReferencia } = RECAUDO
  const falso = fetchFalso(json({ data: sinReferencia }))
  expect((await cobros(falso.fetch).consultarCobro('pago-9')).referencia).toBe('pago-9')
})

// leerWebhook

const LLAVE = 'llave-del-webhook-de-mas-de-32-caracteres'

/** Lo que manda Factus Pay cuando el recaudo queda pagado. */
const CUERPO_WEBHOOK = {
  data: {
    reference_code: 'pago-1',
    amount: 150000.0,
    status: 'paid',
    created_at: '2026-09-04T15:20:00Z',
    qr_expires_at: '2026-09-04T15:40:00Z',
    collected_at: '2026-09-04T15:22:31Z',
    payer: { name: 'Juan Pérez', document_type: 'CC', document_number: '1234567890' },
    qr: null,
  },
}

/** No hace ninguna llamada: `leerWebhook` no toca la red. */
const sinRed = () => cobros(fetchFalso([]).fetch, { llaveWebhook: LLAVE })

test('leerWebhook con la llave buena lee la referencia, el monto, la fecha y el pagador', () => {
  expect(sinRed().leerWebhook(LLAVE, CUERPO_WEBHOOK)).toEqual({
    referencia: 'pago-1',
    monto: 150_000,
    recaudadoEn: '2026-09-04T15:22:31.000Z',
    pagador: { nombre: 'Juan Pérez', tipoDocumento: 'CC', documento: '1234567890' },
  })
})

test.each([
  ['null', null],
  ['vacía', ''],
  ['otra llave del mismo largo', 'x'.repeat(LLAVE.length)],
  ['más corta', LLAVE.slice(0, -1)],
  ['más larga', `${LLAVE}x`],
  ['con un espacio al final', `${LLAVE} `],
  ['en mayúsculas', LLAVE.toUpperCase()],
])('una llave %s lanza no_autorizado', (_caso, clave) => {
  expect(() => sinRed().leerWebhook(clave, CUERPO_WEBHOOK)).toThrowError(
    expect.objectContaining({
      name: 'ErrorIntegracion',
      servicio: 'factus_pay',
      tipo: 'no_autorizado',
      status: 401,
    }),
  )
})

test('un error de llave no se reintenta: hay que responder 401', () => {
  const error = (() => {
    try {
      sinRed().leerWebhook('otra', CUERPO_WEBHOOK)
      return null
    } catch (e: unknown) {
      return e as ErrorIntegracion
    }
  })()
  expect(error?.reintentable).toBe(false)
})

test('si la llave del webhook quedó sin configurar, no autoriza nada', () => {
  const servicio = cobros(fetchFalso([]).fetch, { llaveWebhook: '' })
  for (const clave of [null, '', 'cualquiera']) {
    expect(() => servicio.leerWebhook(clave, CUERPO_WEBHOOK)).toThrowError(
      expect.objectContaining({ tipo: 'no_autorizado' }),
    )
  }
})

test('la llave se valida antes de mirar el cuerpo', () => {
  expect(() => sinRed().leerWebhook('otra', null)).toThrowError(
    expect.objectContaining({ tipo: 'no_autorizado' }),
  )
})

test('payer puede no venir', () => {
  const { payer: _, ...sinPagador } = CUERPO_WEBHOOK.data
  expect(sinRed().leerWebhook(LLAVE, { data: sinPagador }).pagador).toBeNull()
})

test.each([
  ['payer en null', null],
  ['payer vacío', {}],
  ['payer sin nombre ni documento', { document_type: 'CC' }],
])('%s queda en null', (_caso, payer) => {
  expect(sinRed().leerWebhook(LLAVE, { data: { ...CUERPO_WEBHOOK.data, payer } }).pagador).toBeNull()
})

test('un payer a medias se lee con lo que haya', () => {
  const payer = { name: 'Sin Documento' }
  expect(sinRed().leerWebhook(LLAVE, { data: { ...CUERPO_WEBHOOK.data, payer } }).pagador).toEqual({
    nombre: 'Sin Documento',
    tipoDocumento: '',
    documento: '',
  })
})

test('el webhook sin collected_at deja recaudadoEn en null', () => {
  const { collected_at: _, ...sinFecha } = CUERPO_WEBHOOK.data
  expect(sinRed().leerWebhook(LLAVE, { data: sinFecha }).recaudadoEn).toBeNull()
})

test('un collected_at con el formato de Factus también queda en ISO UTC', () => {
  const data = { ...CUERPO_WEBHOOK.data, collected_at: '28-10-2026 08:03:04 PM' }
  expect(sinRed().leerWebhook(LLAVE, { data }).recaudadoEn).toBe('2026-10-29T01:03:04.000Z')
})

test.each([
  ['sin data', {}],
  ['con data en null', { data: null }],
  ['con data que no es objeto', { data: 'pago-1' }],
  ['sin reference_code', { data: { amount: 150000 } }],
  ['con reference_code que no es texto', { data: { reference_code: 7, amount: 150000 } }],
  ['sin amount', { data: { reference_code: 'pago-1' } }],
  ['con amount que no es número', { data: { reference_code: 'pago-1', amount: 'mucho' } }],
  ['en null', null],
])('un cuerpo %s lanza validacion', (_caso, cuerpo) => {
  expect(() => sinRed().leerWebhook(LLAVE, cuerpo)).toThrowError(
    expect.objectContaining({ name: 'ErrorIntegracion', tipo: 'validacion', status: 422 }),
  )
})

test('el monto del webhook llega como texto y queda en pesos enteros', () => {
  const data = { ...CUERPO_WEBHOOK.data, amount: '150000.00' }
  expect(sinRed().leerWebhook(LLAVE, { data }).monto).toBe(150_000)
})

test('leerWebhook no hace ninguna llamada a Factus Pay', () => {
  const falso = fetchFalso([])
  cobros(falso.fetch, { llaveWebhook: LLAVE }).leerWebhook(LLAVE, CUERPO_WEBHOOK)
  expect(falso.llamadas).toHaveLength(0)
})
