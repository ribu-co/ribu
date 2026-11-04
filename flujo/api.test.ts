import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ESTADO_HTTP_POR_ERROR } from '../contratos/reglas'
import { ROLES, type Rol } from '../contratos/tipos'
import { clavesIguales, ENCABEZADO_SEMILLA } from './api'
import { CLAVE_SEMILLA, crearEscenario, MESA_1, quien, R1, R2 } from './apoyo-pruebas'
import { aPeticionWeb, enviarRespuesta } from './puente'

const openapi = readFileSync(new URL('../contratos/openapi.yaml', import.meta.url), 'utf8')

interface Operacion {
  id: string
  metodo: string
  ruta: string
  roles: Rol[]
}

/** Lee las rutas y sus `x-roles` de openapi.yaml, que tiene un formato regular. */
function operaciones(): Operacion[] {
  const lista: Operacion[] = []
  let ruta = ''
  let metodo = ''
  let id = ''
  for (const linea of openapi.split('\n')) {
    const deRuta = /^ {2}(\/api\/\S+):$/.exec(linea)
    if (deRuta) ruta = deRuta[1] as string
    if (linea === 'components:') break
    const deMetodo = /^ {4}(get|post|put|patch|delete):$/.exec(linea)
    if (deMetodo) metodo = (deMetodo[1] as string).toUpperCase()
    const deId = /^ {6}operationId: (\w+)$/.exec(linea)
    if (deId) id = deId[1] as string
    const deRoles = /^ {6}x-roles: \[(.*)\]$/.exec(linea)
    if (deRoles) {
      const roles = (deRoles[1] as string).split(',').map((r) => r.trim()).filter(Boolean) as Rol[]
      lista.push({ id, metodo, ruta, roles })
    }
  }
  return lista
}

const conParametros = (ruta: string) =>
  ruta
    .replace('{token}', MESA_1)
    .replace('{restauranteId}', R1)
    .replace('{lineaId}', 'no-existe')
    .replace('{pagoId}', 'no-existe')
    .replace('{notaId}', 'no-existe')
    .replace('{productoId}', 'no-existe')
    .replace('{uid}', 'no-existe')

const tokenDe: Record<Rol, () => string> = {
  cliente: () => quien.cliente(),
  mesero: () => quien.mesero(),
  cocina: () => quien.cocina(),
  admin: () => quien.admin(),
  plataforma: () => quien.plataforma(),
}

const operacionesConSesion = operaciones().filter((op) => op.roles.length > 0)

test('openapi.yaml se leyó completo', () => {
  expect(operaciones().length).toBe(29)
  expect(operaciones().find((op) => op.id === 'recibirWebhookFactusPay')?.roles).toEqual([])
})

test.each(operaciones().map((op) => [op.id, op] as const))('%s está implementada', async (_id, { metodo, ruta }) => {
  const { app } = crearEscenario()
  const esperada = ruta.replace(/\{(\w+)\}/g, ':$1')
  expect(app.routes.some((r) => r.method === metodo && r.path === esperada)).toBe(true)
})

describe('x-roles', () => {
  const casos = operacionesConSesion.flatMap((op) =>
    ROLES.filter((rol) => !op.roles.includes(rol)).map((rol) => [op.id, rol, op] as const),
  )

  test.each(casos)('%s rechaza a %s', async (_id, rol, { metodo, ruta }) => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir(metodo, conParametros(ruta), tokenDe[rol](), {})
    expect(status).toBe(403)
    expect(datos.codigo).toBe('SIN_PERMISO')
  })

  const permitidos = operacionesConSesion.flatMap((op) => op.roles.map((rol) => [op.id, rol, op] as const))

  test.each(permitidos)('%s deja pasar a %s', async (_id, rol, { metodo, ruta }) => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir(metodo, conParametros(ruta), tokenDe[rol](), {})
    // Llega a la lógica: lo que responda ya no es por el rol. Un 2xx trae su contenido.
    if (status >= 400) expect(datos.codigo).toBeTruthy()
    expect(datos.mensaje ?? '').not.toContain('Tu cuenta no puede')
  })

  test.each(operacionesConSesion.map((op) => [op.id, op] as const))('%s exige sesión', async (_id, { metodo, ruta }) => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir(metodo, conParametros(ruta), null, {})
    expect(status).toBe(401)
    expect(datos.codigo).toBe('NO_AUTORIZADO')
  })
})

describe('sesión', () => {
  test('un token que no se verifica responde 401', async () => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, 'token-que-no-sirve', { items: [] })
    expect(status).toBe(401)
    expect(datos.codigo).toBe('NO_AUTORIZADO')
  })

  test('un personal sin restaurante en los claims no es válido', async () => {
    const e = crearEscenario()
    const { status } = await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, 'mesero:sin-restaurante:')
    expect(status).toBe(401)
  })
})

describe('errores', () => {
  test('todo error responde { codigo, mensaje } con el estado de ESTADO_HTTP_POR_ERROR', async () => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir('POST', `/api/mesas/no-existe/liberar`, quien.mesero())
    expect(Object.keys(datos).sort()).toEqual(['codigo', 'mensaje'])
    expect(status).toBe(ESTADO_HTTP_POR_ERROR.NO_ENCONTRADO)
  })

  test('un cuerpo que no es JSON es CUERPO_INVALIDO', async () => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), '{no es json')
    expect(status).toBe(400)
    expect(datos.codigo).toBe('CUERPO_INVALIDO')
  })

  test.each([
    [{ items: [] }],
    [{ items: [{ productoId: 'plato', cantidad: 0, nota: null }] }],
    [{ items: [{ productoId: 'plato', cantidad: 1.5, nota: null }] }],
    [{ items: [{ productoId: '../otro', cantidad: 1, nota: null }] }],
    [{}],
    [[]],
  ])('un pedido mal armado es CUERPO_INVALIDO: %j', async (cuerpo) => {
    const e = crearEscenario()
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), cuerpo)
    expect(datos.codigo).toBe('CUERPO_INVALIDO')
  })

  test('una ruta que no existe responde NO_ENCONTRADO', async () => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir('GET', '/api/nada', quien.cliente())
    expect(status).toBe(404)
    expect(datos.codigo).toBe('NO_ENCONTRADO')
  })

  test('un error interno no filtra detalles', async () => {
    const e = crearEscenario()
    const original = e.db.leer
    e.ctx.db.leer = async () => { throw new Error('clave-secreta en la base de datos') }
    const { status, datos } = await e.pedir('POST', `/api/pagos/x/verificar`, quien.cliente())
    expect([404, 503]).toContain(status)
    expect(JSON.stringify(datos)).not.toContain('secreta')
    e.ctx.db.leer = original
    const fallo = crearEscenario()
    fallo.ctx.db.transaccion = async () => { throw new Error('clave-secreta en la base de datos') }
    const respuesta = await fallo.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())
    expect(respuesta.status).toBe(503)
    expect(respuesta.datos.codigo).toBe('SERVICIO_NO_DISPONIBLE')
    expect(JSON.stringify(respuesta.datos)).not.toContain('secreta')
  })

  test('las respuestas no se guardan en caché', async () => {
    const e = crearEscenario()
    const { cabeceras } = await e.pedir('POST', `/api/mesas/no-existe/liberar`, quien.mesero())
    expect(cabeceras.get('cache-control')).toBe('no-store')
  })
})

describe('restaurantes, mesas y personal', () => {
  const nuevo = { nombre: 'Otro', impuesto: { tipo: 'IVA', porcentaje: 19 }, propinasSugeridas: [0, 5], mesas: 3 }

  test('la plataforma crea un restaurante con sus mesas, y cada mesa tiene un token distinto', async () => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir('POST', '/api/restaurantes', quien.plataforma(), nuevo)
    expect(status).toBe(201)
    expect(datos.restaurante).toMatchObject({ nombre: 'Otro', activo: true })
    expect(datos.mesas.map((m: { numero: number }) => m.numero)).toEqual([1, 2, 3])
    expect(new Set(datos.mesas.map((m: { token: string }) => m.token)).size).toBe(3)
    expect(datos.mesas[0].token).toMatch(/^[0-9a-f]{32}$/)
  })

  test('propinas sugeridas por encima del máximo no se aceptan', async () => {
    const e = crearEscenario()
    const { datos } = await e.pedir('POST', '/api/restaurantes', quien.plataforma(), { ...nuevo, propinasSugeridas: [15] })
    expect(datos.codigo).toBe('CUERPO_INVALIDO')
  })

  test('el administrador solo cambia el suyo, y `activo` solo lo cambia la plataforma', async () => {
    const e = crearEscenario()
    expect((await e.pedir('PATCH', `/api/restaurantes/${R1}`, quien.admin(), { nombre: 'Nuevo' })).datos.nombre).toBe('Nuevo')
    expect((await e.pedir('PATCH', `/api/restaurantes/${R2}`, quien.admin(), { nombre: 'Nuevo' })).datos.codigo).toBe('SIN_PERMISO')
    expect((await e.pedir('PATCH', `/api/restaurantes/${R1}`, quien.admin(), { activo: false })).datos.codigo).toBe('SIN_PERMISO')
    expect((await e.pedir('PATCH', `/api/restaurantes/${R1}`, quien.plataforma(), { activo: false })).datos.activo).toBe(false)
    expect((await e.pedir('PATCH', '/api/restaurantes/no-existe', quien.plataforma(), { activo: false })).datos.codigo).toBe('NO_ENCONTRADO')
  })

  test('agregar mesas sigue la numeración y no toca los tokens existentes', async () => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir('POST', `/api/restaurantes/${R1}/mesas`, quien.admin(), { cantidad: 2 })
    expect(status).toBe(201)
    expect(datos.map((m: { numero: number }) => m.numero)).toEqual([3, 4])
    expect(await e.db.leer(`mesas/${MESA_1}`)).toMatchObject({ numero: 1 })
    expect((await e.pedir('POST', `/api/restaurantes/${R2}/mesas`, quien.admin(), { cantidad: 1 })).datos.codigo).toBe('SIN_PERMISO')
  })

  test('crear personal: las claims salen de la ruta, y la clave no se guarda', async () => {
    const e = crearEscenario()
    const cuerpo = { correo: 'nuevo@ribu.test', nombre: 'Nuevo', rol: 'mesero', clave: 'una-clave-larga' }
    const { status, datos } = await e.pedir('POST', `/api/restaurantes/${R1}/personal`, quien.admin(), { ...cuerpo, restauranteId: R2 })
    expect(status).toBe(201)
    expect(datos).toMatchObject({ correo: 'nuevo@ribu.test', rol: 'mesero', activo: true, restauranteId: R1 })
    expect(JSON.stringify(datos)).not.toContain('una-clave-larga')
    expect(JSON.stringify(e.db.volcado())).not.toContain('una-clave-larga')
    expect(e.authFalsa.claims.get(datos.uid)).toEqual({ rol: 'mesero', restauranteId: R1 })

    const repetido = await e.pedir('POST', `/api/restaurantes/${R1}/personal`, quien.admin(), cuerpo)
    expect(repetido.datos.codigo).toBe('CORREO_EN_USO')
    const corta = await e.pedir('POST', `/api/restaurantes/${R1}/personal`, quien.admin(), { ...cuerpo, correo: 'x@ribu.test', clave: 'corta' })
    expect(corta.datos.codigo).toBe('CUERPO_INVALIDO')
    expect((await e.pedir('POST', `/api/restaurantes/${R2}/personal`, quien.admin(), cuerpo)).datos.codigo).toBe('SIN_PERMISO')
  })

  test('quitarle el acceso a alguien revoca sus tokens', async () => {
    const e = crearEscenario()
    const cuerpo = { correo: 'nuevo@ribu.test', nombre: 'Nuevo', rol: 'mesero', clave: 'una-clave-larga' }
    const { datos: persona } = await e.pedir('POST', `/api/restaurantes/${R1}/personal`, quien.admin(), cuerpo)
    const { datos } = await e.pedir('PATCH', `/api/restaurantes/${R1}/personal/${persona.uid}`, quien.admin(), { activo: false })
    expect(datos.activo).toBe(false)
    expect(e.authFalsa.revocados).toContain(persona.uid)
    const cambio = await e.pedir('PATCH', `/api/restaurantes/${R1}/personal/${persona.uid}`, quien.admin(), { rol: 'cocina' })
    expect(cambio.datos.rol).toBe('cocina')
    expect(e.authFalsa.claims.get(persona.uid)).toEqual({ rol: 'cocina', restauranteId: R1 })
    expect((await e.pedir('PATCH', `/api/restaurantes/${R1}/personal/no-existe`, quien.admin(), { activo: false })).datos.codigo).toBe('NO_ENCONTRADO')
  })
})

describe('carta', () => {
  const nuevo = { nombre: 'Mango', descripcion: null, categoria: 'Postres', precio: 10_000, stock: 5, disponible: true, imagenUrl: null }

  test('el administrador la gestiona, en su restaurante', async () => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir('POST', '/api/productos', quien.admin(), nuevo)
    expect(status).toBe(201)
    expect(datos).toMatchObject({ restauranteId: R1, nombre: 'Mango' })
    const cambio = await e.pedir('PATCH', `/api/productos/${datos.id}`, quien.admin(), { precio: 12_000 })
    expect(cambio.datos.precio).toBe(12_000)
    expect((await e.pedir('DELETE', `/api/productos/${datos.id}`, quien.admin())).status).toBe(204)
    expect((await e.pedir('DELETE', `/api/productos/${datos.id}`, quien.admin())).datos.codigo).toBe('NO_ENCONTRADO')
  })

  test('el mesero y la cocina solo cambian `disponible`', async () => {
    const e = crearEscenario()
    expect((await e.pedir('PATCH', '/api/productos/plato', quien.mesero(), { disponible: false })).datos.disponible).toBe(false)
    expect((await e.pedir('PATCH', '/api/productos/plato', quien.cocina(), { disponible: true })).datos.disponible).toBe(true)
    expect((await e.pedir('PATCH', '/api/productos/plato', quien.mesero(), { precio: 1 })).datos.codigo).toBe('SIN_PERMISO')
    expect((await e.pedir('PATCH', '/api/productos/plato', quien.cocina(), { disponible: true, stock: 1 })).datos.codigo).toBe('SIN_PERMISO')
  })

  test('un stock en 0 deja el producto no disponible', async () => {
    const e = crearEscenario()
    expect((await e.pedir('PATCH', '/api/productos/plato', quien.admin(), { stock: 0 })).datos).toMatchObject({ stock: 0, disponible: false })
  })

  test('cambiar la carta no altera la cuenta', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await e.pedir('PATCH', '/api/productos/plato', quien.admin(), { precio: 1, nombre: 'Otro' })
    await e.pedir('DELETE', '/api/productos/plato', quien.admin())
    expect((await e.leerCuenta(cuenta.id)).lineas[0]).toMatchObject({ nombre: 'Plato', precio: 54_000 })
    expect((await e.pagar({ tipo: 'saldo' })).datos.total).toBe(54_000)
  })

  test('los productos de otro restaurante no se tocan', async () => {
    const e = crearEscenario()
    const { datos } = await e.pedir('POST', '/api/productos', quien.admin(R2), nuevo)
    expect((await e.pedir('PATCH', `/api/productos/${datos.id}`, quien.admin(), { precio: 1 })).datos.codigo).toBe('NO_ENCONTRADO')
  })
})

describe('clave de la semilla', () => {
  test('se compara sin que importe el largo, y una vacía no vale', () => {
    expect(clavesIguales('abc', 'abc')).toBe(true)
    expect(clavesIguales('abc', 'abd')).toBe(false)
    expect(clavesIguales('abc', 'abcdef')).toBe(false)
    expect(clavesIguales('', '')).toBe(false)
  })

  test('la ruta exige el encabezado', async () => {
    const e = crearEscenario()
    const cuerpo = { claves: { plataforma: 'clave-larga-1', admin: 'clave-larga-2', mesero: 'clave-larga-3', cocina: 'clave-larga-4' } }
    expect((await e.pedir('POST', '/api/interno/semilla', null, cuerpo)).status).toBe(401)
    expect((await e.pedir('POST', '/api/interno/semilla', quien.plataforma(), cuerpo)).status).toBe(401)
    expect((await e.pedir('POST', '/api/interno/semilla', null, cuerpo, { [ENCABEZADO_SEMILLA]: 'mala' })).status).toBe(401)
    expect((await e.pedir('POST', '/api/interno/semilla', null, cuerpo, { [ENCABEZADO_SEMILLA]: CLAVE_SEMILLA })).status).toBe(200)
  })

  test('la simulación de pagos no existe si no hay mocks', async () => {
    const e = crearEscenario()
    const { status } = await e.pedir('POST', '/api/interno/mock/cobros/x/pagar', null, undefined, { [ENCABEZADO_SEMILLA]: CLAVE_SEMILLA })
    expect(status).toBe(404)
  })
})

describe('puente con Cloud Functions', () => {
  test('convierte la petición con su cuerpo crudo y sus encabezados', async () => {
    const peticion = aPeticionWeb({
      method: 'POST',
      url: '/api/webhooks/factus-pay/x?key=abc',
      headers: { 'content-type': 'application/json', 'x-varios': ['a', 'b'], ausente: undefined },
      rawBody: Buffer.from('{"a":1}'),
    })
    expect(new URL(peticion.url).pathname).toBe('/api/webhooks/factus-pay/x')
    expect(new URL(peticion.url).searchParams.get('key')).toBe('abc')
    expect(peticion.headers.get('x-varios')).toBe('a, b')
    expect(await peticion.json()).toEqual({ a: 1 })
  })

  test('un GET no lleva cuerpo', () => {
    const peticion = aPeticionWeb({ method: 'GET', url: '/api/x', headers: {}, rawBody: Buffer.from('') })
    expect(peticion.body).toBeNull()
  })

  test('escribe el estado, los encabezados y el cuerpo binario', async () => {
    const llamadas: Record<string, unknown> = {}
    const res = {
      status(codigo: number) { llamadas.status = codigo; return res },
      setHeader(nombre: string, valor: string) { llamadas[nombre] = valor },
      send(cuerpo: Buffer) { llamadas.cuerpo = cuerpo },
    }
    await enviarRespuesta(new Response(new Uint8Array([1, 2, 3]), { status: 201, headers: { 'content-type': 'application/pdf' } }), res)
    expect(llamadas.status).toBe(201)
    expect(llamadas['content-type']).toBe('application/pdf')
    expect([...(llamadas.cuerpo as Buffer)]).toEqual([1, 2, 3])
  })
})
