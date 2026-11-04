import { expect, test } from 'vitest'
import { ErrorIntegracion } from '../contratos/reglas'
import { crearConexionFactus, segundosDeEspera, type ConfigFactus } from './conexion'
import { crearFetchFalso, json, type LlamadaFalsa, type Responder } from './fetch-falso'

const URL_FACTUS = 'https://factus.prueba'

/** Responde el token y deja el resto a `api`. El reloj se adelanta con `reloj.ms`. */
function preparar(api: Responder = () => json({ data: [] }), token: Responder = tokenPorDefecto()) {
  const reloj = { ms: 1_000_000 }
  const falso = crearFetchFalso((llamada) => (llamada.url.pathname === '/oauth/token' ? token(llamada) : api(llamada)))
  const config: ConfigFactus = {
    url: URL_FACTUS,
    clientId: 'id-inventado',
    clientSecret: 'secreto-inventado',
    usuario: 'equipo@ejemplo.com',
    clave: 'clave-inventada',
    userAgent: 'ribu-pruebas',
    fetch: falso.fetch,
    ahora: () => reloj.ms,
  }
  const conexion = crearConexionFactus(config)
  const tokens = () => falso.llamadas.filter((l) => l.url.pathname === '/oauth/token')
  const deApi = () => falso.llamadas.filter((l) => l.url.pathname !== '/oauth/token')
  return { conexion, reloj, llamadas: falso.llamadas, tokens, api: deApi }
}

function tokenPorDefecto(expiraEn = 600) {
  let numero = 0
  return () => {
    numero++
    return json({ token_type: 'Bearer', expires_in: expiraEn, access_token: `acceso-${numero}`, refresh_token: `renovar-${numero}` })
  }
}

const formulario = (llamada: LlamadaFalsa) => Object.fromEntries(new URLSearchParams(llamada.cuerpo ?? ''))

async function errorDe(promesa: Promise<unknown>): Promise<ErrorIntegracion> {
  const error = await promesa.then(
    () => expect.unreachable('debía fallar'),
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(ErrorIntegracion)
  return error as ErrorIntegracion
}

test('pide el token con datos de formulario y User-Agent propio', async () => {
  const { conexion, tokens } = preparar()
  await conexion.pedir('GET', '/v2/algo')
  const [llamada] = tokens()
  expect(llamada.metodo).toBe('POST')
  expect(llamada.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded')
  expect(llamada.headers.get('User-Agent')).toBe('ribu-pruebas')
  expect(formulario(llamada)).toEqual({
    grant_type: 'password',
    client_id: 'id-inventado',
    client_secret: 'secreto-inventado',
    username: 'equipo@ejemplo.com',
    password: 'clave-inventada',
  })
})

test('las llamadas llevan el token, JSON y User-Agent', async () => {
  const { conexion, api } = preparar(() => json({ data: { ok: true } }))
  const respuesta = await conexion.pedir('POST', '/v2/algo', { cuerpo: { a: 1 }, consulta: { 'filter[x]': '1' } })
  expect(respuesta).toEqual({ data: { ok: true } })
  const [llamada] = api()
  expect(llamada.url.href).toBe(`${URL_FACTUS}/v2/algo?filter%5Bx%5D=1`)
  expect(llamada.headers.get('Authorization')).toBe('Bearer acceso-1')
  expect(llamada.headers.get('Content-Type')).toBe('application/json')
  expect(llamada.headers.get('Accept')).toBe('application/json')
  expect(llamada.headers.get('User-Agent')).toBe('ribu-pruebas')
  expect(llamada.cuerpo).toBe('{"a":1}')
})

test('reusa el token mientras no esté por vencer y lo renueva con refresh_token', async () => {
  const { conexion, reloj, tokens, api } = preparar()
  await conexion.pedir('GET', '/v2/algo')
  reloj.ms += 539_000 // a 61 segundos de vencer
  await conexion.pedir('GET', '/v2/algo')
  expect(tokens()).toHaveLength(1)

  reloj.ms += 2_000 // a 59 segundos de vencer
  await conexion.pedir('GET', '/v2/algo')
  expect(tokens()).toHaveLength(2)
  expect(formulario(tokens()[1])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'renovar-1' })
  expect(api().map((l) => l.headers.get('Authorization'))).toEqual(['Bearer acceso-1', 'Bearer acceso-1', 'Bearer acceso-2'])
})

test('toma la duración de expires_in', async () => {
  const { conexion, reloj, tokens } = preparar(undefined, tokenPorDefecto(3600))
  await conexion.pedir('GET', '/v2/algo')
  reloj.ms += 3_500_000
  await conexion.pedir('GET', '/v2/algo')
  expect(tokens()).toHaveLength(1)
})

test('si el refresh_token ya no sirve, entra otra vez con la contraseña', async () => {
  const normal = tokenPorDefecto()
  const { conexion, reloj, tokens } = preparar(undefined, (llamada) =>
    formulario(llamada).grant_type === 'refresh_token' ? json({ error: 'invalid_grant' }, 400) : normal(),
  )
  await conexion.pedir('GET', '/v2/algo')
  reloj.ms += 600_000
  await conexion.pedir('GET', '/v2/algo')
  expect(tokens().map((l) => formulario(l).grant_type)).toEqual(['password', 'refresh_token', 'password'])
})

test('varias llamadas a la vez piden un solo token', async () => {
  const { conexion, tokens } = preparar()
  await Promise.all([conexion.pedir('GET', '/v2/a'), conexion.pedir('GET', '/v2/b'), conexion.pedir('GET', '/v2/c')])
  expect(tokens()).toHaveLength(1)
})

test('si Factus responde 401, entra de nuevo y repite la llamada una vez', async () => {
  const { conexion, tokens, api } = preparar((llamada) =>
    llamada.headers.get('Authorization') === 'Bearer acceso-1' ? json({ message: 'Unauthenticated.' }, 401) : json({}),
  )
  await conexion.pedir('GET', '/v2/algo')
  expect(tokens()).toHaveLength(2)
  expect(api()).toHaveLength(2)
})

test('un 401 que se repite se lanza como no_autorizado', async () => {
  const { conexion, api } = preparar(() => json({ message: 'Unauthenticated.' }, 401))
  const error = await errorDe(conexion.pedir('GET', '/v2/algo'))
  expect(error).toMatchObject({ tipo: 'no_autorizado', status: 401, reintentable: false })
  expect(api()).toHaveLength(2)
})

test('credenciales inválidas son no_autorizado y no repiten el token', async () => {
  const { conexion, tokens } = preparar(undefined, () => json({ error: 'invalid_grant', message: 'Credenciales' }, 400))
  const error = await errorDe(conexion.pedir('GET', '/v2/algo'))
  expect(error).toMatchObject({ tipo: 'no_autorizado', status: 400 })
  expect(tokens()).toHaveLength(1)
})

test('un token sin expires_in no se acepta', async () => {
  const { conexion } = preparar(undefined, () => json({ access_token: 'x' }))
  expect(await errorDe(conexion.pedir('GET', '/v2/algo'))).toMatchObject({ tipo: 'servidor' })
})

test.each([
  [409, 'conflicto'],
  [429, 'limite'],
  [500, 'servidor'],
  [503, 'servidor'],
  [403, 'no_autorizado'],
  [422, 'validacion'],
  [404, 'validacion'],
  [400, 'validacion'],
] as const)('un %i se lanza como %s', async (status, tipo) => {
  const { conexion } = preparar(() => json({ message: 'falló' }, status))
  const error = await errorDe(conexion.pedir('GET', '/v2/algo'))
  expect(error).toMatchObject({ servicio: 'factus', tipo, status })
  expect(error.message).toBe(`Factus respondió ${status}: falló`)
})

test('un 429 trae la espera de Retry-After', async () => {
  const { conexion } = preparar(() => json({ message: 'Too Many Attempts.' }, 429, { 'Retry-After': '17' }))
  expect(await errorDe(conexion.pedir('GET', '/v2/algo'))).toMatchObject({ tipo: 'limite', esperarSegundos: 17 })
})

test('Retry-After también puede venir como fecha', () => {
  const ahora = Date.parse('2026-11-04T15:00:00Z')
  expect(segundosDeEspera('Wed, 04 Nov 2026 15:00:30 GMT', ahora)).toBe(30)
  expect(segundosDeEspera('Wed, 04 Nov 2026 14:00:00 GMT', ahora)).toBe(0)
  expect(segundosDeEspera(null, ahora)).toBeUndefined()
  expect(segundosDeEspera('pronto', ahora)).toBeUndefined()
})

test('un 422 explica qué campos fallaron', async () => {
  const { conexion } = preparar(() =>
    json({ message: 'Datos inválidos', errors: { 'customer.names': ['Es obligatorio'], items: ['Vacío'] } }, 422),
  )
  const error = await errorDe(conexion.pedir('POST', '/v2/bills/validate', { cuerpo: {} }))
  expect(error.message).toBe('Factus respondió 422: Datos inválidos. customer.names: Es obligatorio. items: Vacío')
})

test('una página HTML de Cloudflare se resume sin romper', async () => {
  const { conexion } = preparar(() => new Response('<html>\n  Attention Required!\n</html>', { status: 403 }))
  const error = await errorDe(conexion.pedir('GET', '/v2/algo'))
  expect(error).toMatchObject({ tipo: 'no_autorizado', message: 'Factus respondió 403: <html> Attention Required! </html>' })
})

test('sin conexión se lanza como red, que se reintenta', async () => {
  const { conexion } = preparar(() => {
    throw new TypeError('fetch failed')
  })
  const error = await errorDe(conexion.pedir('GET', '/v2/algo'))
  expect(error).toMatchObject({ tipo: 'red', reintentable: true, message: 'Sin conexión con Factus: fetch failed' })
})

test('los errores no muestran el token ni las credenciales', async () => {
  const { conexion } = preparar(() => json({ message: 'falló' }, 500))
  const error = await errorDe(conexion.pedir('GET', '/v2/algo'))
  for (const secreto of ['acceso-1', 'renovar-1', 'secreto-inventado', 'clave-inventada']) {
    expect(error.message).not.toContain(secreto)
  }
})

const rango = (id: number, cambios: Record<string, unknown> = {}) => ({ id, is_active: 1, is_expired: 0, ...cambios })

test('busca el rango activo del documento y lo guarda en memoria', async () => {
  const { conexion, api } = preparar(() => json({ data: [rango(7, { is_expired: 1 }), rango(8)] }))
  expect(await conexion.rangoActivo('factura')).toBe(8)
  expect(await conexion.rangoActivo('factura')).toBe(8)
  expect(api()).toHaveLength(1)
  expect(Object.fromEntries(api()[0].url.searchParams)).toEqual({ 'filter[document]': '21', 'filter[is_active]': '1' })
})

test('cada tipo de documento tiene su rango', async () => {
  const ids: Record<string, number> = { '21': 1, '22': 2, '23': 3 }
  const { conexion, api } = preparar((llamada) =>
    json({ data: { data: [rango(ids[llamada.url.searchParams.get('filter[document]')!])], pagination: {} } }),
  )
  expect(await conexion.rangoActivo('factura')).toBe(1)
  expect(await conexion.rangoActivo('credito')).toBe(2)
  expect(await conexion.rangoActivo('debito')).toBe(3)
  expect(api()).toHaveLength(3)
})

test('sin rango activo falla y vuelve a consultar en la siguiente llamada', async () => {
  let rangos: unknown[] = []
  const { conexion, api } = preparar(() => json({ data: rangos }))
  const error = await errorDe(conexion.rangoActivo('credito'))
  expect(error).toMatchObject({ tipo: 'validacion', message: 'Factus no tiene un rango activo de documento 22' })
  rangos = [rango(5)]
  expect(await conexion.rangoActivo('credito')).toBe(5)
  expect(api()).toHaveLength(2)
})

test('un rango olvidado se vuelve a consultar', async () => {
  const { conexion, api } = preparar(() => json({ data: [rango(9)] }))
  await conexion.rangoActivo('debito')
  conexion.olvidarRango('debito')
  await conexion.rangoActivo('debito')
  expect(api()).toHaveLength(2)
})
