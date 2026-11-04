import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { crearOrdenesApi } from './api'
import type { Ordenes } from './fuente'

const RAIZ = new URL('../../../contratos/openapi.yaml', import.meta.url)

/** Saca del contrato cada `operationId` con su método y su ruta. */
function operacionesDelContrato() {
  const operaciones = new Map<string, { metodo: string; ruta: string }>()
  let ruta = ''
  let metodo = ''
  for (const linea of readFileSync(RAIZ, 'utf8').split('\n')) {
    ruta = /^  (\/api\/\S+):$/.exec(linea)?.[1] ?? ruta
    metodo = /^    (get|post|put|patch|delete):$/.exec(linea)?.[1]?.toUpperCase() ?? metodo
    const id = /^      operationId: (\w+)$/.exec(linea)?.[1]
    if (id) operaciones.set(id, { metodo, ruta })
  }
  return operaciones
}

function apiFalsa(responder: () => Response = () => Response.json({})) {
  const llamadas: { url: string; init: RequestInit }[] = []
  const api = crearOrdenesApi({
    obtenerToken: async () => 'token-de-prueba',
    pedir: async (url, init) => {
      llamadas.push({ url: String(url), init: init as RequestInit })
      return responder()
    },
  })
  return { api, llamadas }
}

/** Con qué argumentos se llama cada orden. Los {parámetros} del contrato toman estos valores. */
const VALORES: Record<string, string> = {
  token: 'mesa-1',
  lineaId: 'linea-1',
  pagoId: 'pago-1',
  notaId: 'nota-1',
  productoId: 'producto-1',
  restauranteId: 'restaurante-1',
  uid: 'uid-1',
}

const ARGUMENTOS: { [K in keyof Ordenes]: unknown[] } = {
  agregarLineas: ['mesa-1', {}],
  confirmarLineas: ['mesa-1', {}],
  rechazarLineas: ['mesa-1', {}],
  anularLineas: ['mesa-1', {}],
  avanzarLinea: ['mesa-1', 'linea-1', {}],
  dividirEnPartesIguales: ['mesa-1', {}],
  quitarDivision: ['mesa-1'],
  crearPago: ['mesa-1', {}],
  verificarPago: ['mesa-1', 'pago-1'],
  cancelarPago: ['mesa-1', 'pago-1'],
  descargarFacturaPdf: ['mesa-1', 'pago-1'],
  enviarFacturaPorCorreo: ['mesa-1', 'pago-1', {}],
  reintentarFactura: ['mesa-1', 'pago-1', {}],
  liberarMesa: ['mesa-1'],
  crearRestaurante: [{}],
  actualizarRestaurante: ['restaurante-1', {}],
  agregarMesas: ['restaurante-1', {}],
  crearPersonal: ['restaurante-1', {}],
  actualizarPersonal: ['restaurante-1', 'uid-1', {}],
  crearProducto: [{}],
  actualizarProducto: ['producto-1', {}],
  borrarProducto: ['producto-1'],
  crearNota: ['pago-1', {}],
  verificarNota: ['nota-1'],
  reintentarNota: ['nota-1', {}],
  marcarDevolucionHecha: ['nota-1'],
  enviarNotaPorCorreo: ['nota-1', {}],
  descargarNotaPdf: ['nota-1'],
}

describe('contra openapi.yaml', () => {
  const contrato = operacionesDelContrato()

  test('hay una función por cada operationId, salvo el webhook', () => {
    expect(contrato.size).toBeGreaterThan(20)
    const esperadas = [...contrato.keys()].filter((id) => id !== 'recibirWebhookFactusPay').sort()
    expect(Object.keys(apiFalsa().api).sort()).toEqual(esperadas)
  })

  test.each(Object.keys(ARGUMENTOS) as (keyof Ordenes)[])('%s usa el método y la ruta del contrato', async (id) => {
    const { api, llamadas } = apiFalsa()
    await (api[id] as (...a: unknown[]) => Promise<unknown>)(...ARGUMENTOS[id])
    const { metodo, ruta } = contrato.get(id)!
    expect(llamadas[0]?.init.method).toBe(metodo)
    expect(llamadas[0]?.url).toBe(ruta.replace(/\{(\w+)\}/g, (_, nombre: string) => VALORES[nombre]!))
  })
})

describe('llamadas', () => {
  test('envía el ID token y el cuerpo en JSON', async () => {
    const { api, llamadas } = apiFalsa()
    await api.crearPago('mesa-1', { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: { tipo: 'consumidor_final', correo: null }, medio: 'factus_pay' })
    const { init } = llamadas[0]!
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-de-prueba', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string).medio).toBe('factus_pay')
  })

  test('sin cuerpo no declara Content-Type', async () => {
    const { api, llamadas } = apiFalsa()
    await api.liberarMesa('mesa-1')
    expect(llamadas[0]?.init.headers).not.toHaveProperty('Content-Type')
    expect(llamadas[0]?.init.body).toBeUndefined()
  })

  test('escapa lo que va en la ruta', async () => {
    const { api, llamadas } = apiFalsa()
    await api.liberarMesa('a/b c')
    expect(llamadas[0]?.url).toBe('/api/mesas/a%2Fb%20c/liberar')
  })

  test('devuelve el PDF como Blob', async () => {
    const { api } = apiFalsa(() => new Response(new Blob(['%PDF'], { type: 'application/pdf' })))
    const pdf = await api.descargarFacturaPdf('mesa-1', 'pago-1')
    expect(pdf.type).toBe('application/pdf')
  })

  test('borrar un producto acepta el 204 sin cuerpo', async () => {
    const { api } = apiFalsa(() => new Response(null, { status: 204 }))
    await expect(api.borrarProducto('producto-1')).resolves.toBeUndefined()
  })
})

describe('errores', () => {
  const con = (respuesta: Response) => apiFalsa(() => respuesta).api

  test('convierte { codigo, mensaje } con comoErrorDatos', async () => {
    const api = con(Response.json({ codigo: 'CORREO_EN_USO', mensaje: 'Ese correo ya existe' }, { status: 409 }))
    await expect(api.crearPersonal('r', {} as never)).rejects.toMatchObject({ name: 'ErrorDatos', codigo: 'CORREO_EN_USO', message: 'Ese correo ya existe' })
  })

  test('una respuesta que no es del backend se traduce por su estado', async () => {
    await expect(con(new Response('<html>', { status: 401 })).liberarMesa('m')).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO' })
    await expect(con(new Response('<html>', { status: 403 })).liberarMesa('m')).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
    await expect(con(new Response('<html>', { status: 404 })).liberarMesa('m')).rejects.toMatchObject({ codigo: 'SERVICIO_NO_DISPONIBLE' })
  })

  test('sin red o sin sesión también llega un ErrorDatos', async () => {
    const sinRed = crearOrdenesApi({ obtenerToken: async () => 't', pedir: async () => { throw new TypeError('Failed to fetch') } })
    await expect(sinRed.liberarMesa('m')).rejects.toMatchObject({ codigo: 'SERVICIO_NO_DISPONIBLE' })
    const sinSesion = crearOrdenesApi({ obtenerToken: async () => { throw { codigo: 'NO_AUTORIZADO' } } })
    await expect(sinSesion.liberarMesa('m')).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO' })
  })

  test('un 200 que no es JSON no revienta sin código', async () => {
    await expect(con(new Response('<html>')).liberarMesa('m')).rejects.toMatchObject({ codigo: 'SERVICIO_NO_DISPONIBLE' })
  })
})
