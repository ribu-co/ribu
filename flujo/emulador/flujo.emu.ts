// Recorre el flujo completo contra los emuladores: la función `api` empaquetada, los disparadores reales,
// Firestore y Authentication, con los mocks de Factus y Factus Pay. Corre con `npm run test:flujo`.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, test } from 'vitest'
import type { Cobro, Factura, Mesa, Nota, Producto, SolicitudFactura } from '../../contratos/tipos'
import { crearBaseFirestore } from '../base-firestore'
import { procesarDocumento } from '../documentos'
import { CLAVE_SEMILLA_EMULADOR, crearCobrosCompartidos, crearFacturacionCompartida } from '../mocks-compartidos'
import { referenciaNueva, rutaReferencia, type Contexto, type CuentaDoc, type PagoDoc } from '../modelo'
import { barrer } from '../programado'

const PROYECTO = 'demo-ribu'
const BASE = `http://127.0.0.1:5001/${PROYECTO}/us-central1/api`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const RESTAURANTE = 'fogon-del-manglar'
const CLAVES = {
  plataforma: 'clave-de-prueba-plataforma',
  admin: 'clave-de-prueba-admin',
  mesero: 'clave-de-prueba-mesero',
  cocina: 'clave-de-prueba-cocina',
}

const firestore = getFirestore(initializeApp({ projectId: PROYECTO }))
const db = crearBaseFirestore(firestore)
const leer = <T>(ruta: string) => db.leer<T>(ruta) as Promise<T>
const rutaPago = (id: string) => `restaurantes/${RESTAURANTE}/pagos/${id}`
const rutaFactura = (id: string) => `restaurantes/${RESTAURANTE}/facturas/${id}`
const rutaNota = (id: string) => `restaurantes/${RESTAURANTE}/notas/${id}`
const rutaCuenta = (id: string) => `restaurantes/${RESTAURANTE}/cuentas/${id}`
const rutaProducto = (id: string) => `restaurantes/${RESTAURANTE}/productos/${id}`

interface Resultado<T = any> {
  status: number
  datos: T
  tipo: string | null
}

async function api<T = any>(metodo: string, ruta: string, token: string | null, cuerpo?: unknown, cabeceras: Record<string, string> = {}): Promise<Resultado<T>> {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...cabeceras },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  })
  const tipo = respuesta.headers.get('content-type')
  const datos = tipo?.includes('json') ? await respuesta.json() : await respuesta.arrayBuffer()
  return { status: respuesta.status, datos: datos as T, tipo }
}

const interno = (ruta: string, cuerpo?: unknown) => api('POST', ruta, null, cuerpo, { 'x-semilla-clave': CLAVE_SEMILLA_EMULADOR })

async function entrar(correo: string, clave: string) {
  const respuesta = await fetch(`${AUTH}/accounts:signInWithPassword?key=falsa`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password: clave, returnSecureToken: true }),
  })
  const { idToken } = (await respuesta.json()) as { idToken: string }
  expect(idToken, `no entró ${correo}`).toBeTruthy()
  return idToken
}

async function anonimo() {
  const respuesta = await fetch(`${AUTH}/accounts:signUp?key=falsa`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  })
  return ((await respuesta.json()) as { idToken: string }).idToken
}

/** Los disparadores corren por su cuenta: se espera a que el documento llegue a lo esperado. */
async function esperar<T>(leerDoc: () => Promise<T>, cumple: (doc: T) => boolean, que: string): Promise<T> {
  const limite = Date.now() + 30_000
  for (;;) {
    const doc = await leerDoc()
    if (cumple(doc)) return doc
    if (Date.now() > limite) throw new Error(`No pasó a tiempo: ${que}. Quedó: ${JSON.stringify(doc)}`)
    await new Promise((resolver) => setTimeout(resolver, 200))
  }
}

const facturaEmitida = (id: string) =>
  esperar(() => leer<Factura>(rutaFactura(id)), (f) => f.estado === 'emitida', `factura ${id} emitida`)

const notaEmitida = (id: string) =>
  esperar(() => leer<Nota>(rutaNota(id)), (n) => n.estado === 'emitida', `nota ${id} emitida`)

let mesas: { numero: number; token: string; link: string }[]
let mesero: string
let cocina: string
let admin: string
let plataforma: string

const mesa = (numero: number) => mesas.find((m) => m.numero === numero)!.token

async function pedirYConfirmar(token: string, cliente: string, items: [string, number][]) {
  const pedido = await api<CuentaDoc>('POST', `/api/mesas/${token}/lineas`, cliente, {
    items: items.map(([productoId, cantidad]) => ({ productoId, cantidad, nota: null })),
  })
  expect(pedido.status).toBe(201)
  const lineaIds = pedido.datos.lineas.filter((l) => l.estado === 'pendiente').map((l) => l.id)
  const confirmada = await api<CuentaDoc>('POST', `/api/mesas/${token}/lineas/confirmar`, mesero, { lineaIds })
  expect(confirmada.status).toBe(200)
  return confirmada.datos
}

const pagar = (token: string, quien: string, destino: unknown, medio = 'factus_pay', propinaPorcentaje = 0, comprador: unknown = { tipo: 'consumidor_final', correo: null }) =>
  api('POST', `/api/mesas/${token}/pagos`, quien, { destino, propinaPorcentaje, comprador, medio })

const simularPago = async (referencia: string) => {
  const { status } = await interno(`/api/interno/mock/cobros/${referencia}/pagar`)
  expect(status).toBe(200)
}

beforeAll(async () => {
  const { status, datos } = await interno('/api/interno/semilla', { claves: CLAVES })
  expect(status, JSON.stringify(datos)).toBe(200)
  mesas = datos.mesas
  mesero = await entrar('mesero@ribu.test', CLAVES.mesero)
  cocina = await entrar('cocina@ribu.test', CLAVES.cocina)
  admin = await entrar('admin@ribu.test', CLAVES.admin)
  plataforma = await entrar('plataforma@ribu.test', CLAVES.plataforma)
})

describe('semilla', () => {
  test('sin la clave no entra nadie', async () => {
    const sin = await api('POST', '/api/interno/semilla', null, { claves: CLAVES })
    expect(sin.status).toBe(401)
    const mala = await api('POST', '/api/interno/semilla', null, { claves: CLAVES }, { 'x-semilla-clave': 'mala' })
    expect(mala.status).toBe(401)
    expect(mala.datos.codigo).toBe('NO_AUTORIZADO')
  })

  test('crea los datos de la demo con sus claims', async () => {
    expect(mesas).toHaveLength(5)
    expect(await leer(`restaurantes/${RESTAURANTE}`)).toMatchObject({ nombre: 'Fogón del Manglar', activo: true })
    expect((await firestore.collection(`restaurantes/${RESTAURANTE}/productos`).get()).size).toBe(12)
    for (const { token, numero } of mesas) expect(await leer<Mesa>(`mesas/${token}`)).toMatchObject({ numero, restauranteId: RESTAURANTE })
    const [, carga] = mesero.split('.')
    const claims = JSON.parse(Buffer.from(carga!, 'base64url').toString())
    expect(claims).toMatchObject({ rol: 'mesero', restauranteId: RESTAURANTE })
  })

  test('correrla otra vez no cambia los tokens ni pisa el stock', async () => {
    await firestore.doc(rutaProducto('cocada')).update({ stock: 3 })
    const { datos } = await interno('/api/interno/semilla', { claves: CLAVES })
    expect(datos.mesas).toEqual(mesas)
    expect((await leer<Producto>(rutaProducto('cocada'))).stock).toBe(3)
  })
})

describe('flujo completo', () => {
  test('pedir, confirmar, pagar, webhook, factura y liberar', async () => {
    const token = mesa(3)
    const cliente = await anonimo()

    // El pedido de la demo: docs/datos-demo.md.
    const cuenta = await pedirYConfirmar(token, cliente, [['mojarra-frita', 2], ['jugo-corozo', 2], ['patacon-suero', 1]])
    expect(cuenta.consumo).toBe(91_800)
    expect(await leer<Producto>(rutaProducto('mojarra-frita'))).toMatchObject({ stock: 0, disponible: false })

    const avance = await api('POST', `/api/mesas/${token}/lineas/${cuenta.lineas[0]!.id}/estado`, cocina, { estado: 'en_preparacion' })
    expect(avance.status).toBe(200)

    const { status, datos: pago } = await pagar(token, cliente, { tipo: 'saldo' }, 'factus_pay', 10)
    expect(status).toBe(201)
    expect(pago).toMatchObject({ estado: 'esperando_pago', total: 100_300, propina: 8_500, baseSinImpuesto: 85_000 })
    expect(pago.cobro.qrBase64).toBeTruthy()
    expect(pago.cobro.llaveBreB).toBeTruthy()
    expect(await leer(rutaReferencia(pago.id))).toMatchObject({ restauranteId: RESTAURANTE, tipo: 'pago' })

    expect((await pagar(token, await anonimo(), { tipo: 'saldo' })).datos.codigo).toBe('PAGO_EN_CURSO')
    expect((await api('POST', `/api/mesas/${token}/liberar`, mesero)).datos.codigo).toBe('MESA_CON_SALDO')

    const llave = await api('POST', `/api/webhooks/factus-pay/cualquiera?key=mala`, null, { data: { reference_code: pago.id, amount: 100_300 } })
    expect(llave.status).toBe(401)

    await simularPago(pago.id)
    expect(await leer<PagoDoc>(rutaPago(pago.id))).toMatchObject({ estado: 'pagado', incidencia: null })

    // Nadie llamó a emitir: lo hace el disparador real al quedar `en_proceso`.
    const factura = await facturaEmitida(pago.id)
    expect(factura.datos?.numero).toBeTruthy()
    expect(factura.datos?.cufe).toBeTruthy()
    expect(factura.datos?.qrUrl).toBeTruthy()
    const final = await esperar(() => leer<CuentaDoc>(rutaCuenta(cuenta.id)), (c) => c.pagos[0]?.estadoFactura === 'emitida', 'resumen de la cuenta')
    expect(final).toMatchObject({ estado: 'pagada', pagado: 91_800, enCobro: 0, porPagar: 0 })

    const pdf = await api<ArrayBuffer>('GET', `/api/mesas/${token}/pagos/${pago.id}/factura/pdf`, cliente)
    expect(pdf.status).toBe(200)
    expect(pdf.tipo).toBe('application/pdf')
    expect(new TextDecoder().decode(pdf.datos).startsWith('%PDF-')).toBe(true)
    expect((await api('GET', `/api/mesas/${token}/pagos/${pago.id}/factura/pdf`, await anonimo())).datos.codigo).toBe('SIN_PERMISO')

    // Repetir el aviso no suma ni emite otra vez.
    await simularPago(pago.id)
    const numero = factura.datos?.numero
    expect((await leer<Factura>(rutaFactura(pago.id))).datos?.numero).toBe(numero)
    expect((await leer<CuentaDoc>(rutaCuenta(cuenta.id))).pagado).toBe(91_800)

    const libre = await api<Mesa>('POST', `/api/mesas/${token}/liberar`, mesero)
    expect(libre.datos).toMatchObject({ token, estado: 'libre', cuentaId: null })
    expect((await leer<CuentaDoc>(rutaCuenta(cuenta.id))).estado).toBe('cerrada')

    const siguiente = await api<CuentaDoc>('POST', `/api/mesas/${token}/lineas`, await anonimo(), { items: [{ productoId: 'agua', cantidad: 1, nota: null }] })
    expect(siguiente.datos.id).not.toBe(cuenta.id)
    expect(siguiente.datos.lineas).toHaveLength(1)
    await api('POST', `/api/mesas/${token}/lineas/rechazar`, mesero, { lineaIds: [siguiente.datos.lineas[0]!.id], motivo: 'Fin de la prueba' })
    await api('POST', `/api/mesas/${token}/liberar`, mesero)

    // Entre ensayos, la mojarra recupera su stock sin que cambien los tokens.
    const reinicio = await interno('/api/interno/semilla', { claves: CLAVES, reiniciarDemo: true })
    expect(reinicio.datos.mesas).toEqual(mesas)
    expect(await leer<Producto>(rutaProducto('mojarra-frita'))).toMatchObject({ stock: 2, disponible: true })
  })

  test('dos personas pagan a la vez y solo una entra: es una transacción de verdad', async () => {
    const token = mesa(5)
    const cliente = await anonimo()
    await pedirYConfirmar(token, cliente, [['posta-negra', 1]])
    const [uno, dos] = await Promise.all([pagar(token, cliente, { tipo: 'saldo' }), pagar(token, await anonimo(), { tipo: 'saldo' })])
    expect([uno.status, dos.status].sort()).toEqual([201, 409])
    const pago = uno.status === 201 ? uno.datos : dos.datos
    expect((await api('POST', `/api/mesas/${token}/pagos/${pago.id}/cancelar`, cliente)).status).toBe(200)
    await pagar(token, mesero, { tipo: 'saldo' }, 'efectivo')
    await api('POST', `/api/mesas/${token}/liberar`, mesero)
  })
})

describe('división', () => {
  test('partes iguales, pedir algo más y pagarlo en efectivo, sin que la cuenta quede bloqueada', async () => {
    const token = mesa(1)
    const cliente = await anonimo()
    const cuenta = await pedirYConfirmar(token, cliente, [['posta-negra', 2]])

    const division = await api<CuentaDoc>('PUT', `/api/mesas/${token}/division`, cliente, { partes: 2 })
    expect(division.datos.division?.montos).toEqual([37_800, 37_800])

    const { datos: parte1 } = await pagar(token, cliente, { tipo: 'parte_igual', parte: 1 })
    expect((await pagar(token, await anonimo(), { tipo: 'parte_igual', parte: 1 })).datos.codigo).toBe('PAGO_EN_CURSO')
    expect((await api('DELETE', `/api/mesas/${token}/division`, cliente)).datos.codigo).toBe('DIVISION_ACTIVA')

    await simularPago(parte1.id)
    await facturaEmitida(parte1.id)

    const { status, datos: parte2 } = await pagar(token, mesero, { tipo: 'parte_igual', parte: 2 }, 'efectivo')
    expect(status).toBe(201)
    await facturaEmitida(parte2.id)
    expect(await leer<CuentaDoc>(rutaCuenta(cuenta.id))).toMatchObject({ estado: 'pagada', pagado: 75_600, porPagar: 0, division: null })

    await pedirYConfirmar(token, cliente, [['agua', 1]])
    expect((await api('POST', `/api/mesas/${token}/liberar`, mesero)).datos.codigo).toBe('MESA_CON_SALDO')
    expect((await pagar(token, cliente, { tipo: 'saldo' })).datos.codigo).toBe('MONTO_FUERA_DE_RANGO')

    const { datos: ultimo } = await pagar(token, mesero, { tipo: 'saldo' }, 'efectivo')
    expect(ultimo).toMatchObject({ estado: 'pagado', total: 4_050 })
    await facturaEmitida(ultimo.id)
    expect((await api('POST', `/api/mesas/${token}/liberar`, mesero)).status).toBe(200)
  })

  test('una parte cancelada cuya división se quitó no supera el consumo si paga tarde', async () => {
    const token = mesa(2)
    const cliente = await anonimo()
    const cuenta = await pedirYConfirmar(token, cliente, [['carne-asada', 1]])
    await api('PUT', `/api/mesas/${token}/division`, cliente, { partes: 2 })
    const { datos: vieja } = await pagar(token, cliente, { tipo: 'parte_igual', parte: 1 })
    await api('POST', `/api/mesas/${token}/pagos/${vieja.id}/cancelar`, cliente)
    await api('DELETE', `/api/mesas/${token}/division`, cliente)

    const { datos: completo } = await pagar(token, mesero, { tipo: 'saldo' }, 'efectivo')
    await facturaEmitida(completo.id)

    await simularPago(vieja.id)
    expect(await leer<PagoDoc>(rutaPago(vieja.id))).toMatchObject({ estado: 'pagado', incidencia: 'pago_duplicado', estadoFactura: 'sin_emitir' })
    expect((await leer<Factura>(rutaFactura(vieja.id))).estado).toBe('sin_emitir')
    const actual = await leer<CuentaDoc>(rutaCuenta(cuenta.id))
    expect(actual).toMatchObject({ pagado: 35_100, consumo: 35_100 })
    expect((await api('POST', `/api/mesas/${token}/liberar`, mesero)).status).toBe(200)
  })
})

describe('notas', () => {
  /** Una factura emitida de $27.000 más 10 %: $29.500. */
  async function facturaDeEjemplo() {
    const token = mesa(4)
    await pedirYConfirmar(token, await anonimo(), [['sancocho-gallina', 1]])
    const { datos: pago } = await pagar(token, mesero, { tipo: 'saldo' }, 'tarjeta_debito', 10)
    await facturaEmitida(pago.id)
    await api('POST', `/api/mesas/${token}/liberar`, mesero)
    return pago.id as string
  }

  test('crédito: anula, deja la devolución pendiente y no pasa del saldo', async () => {
    const pagoId = await facturaDeEjemplo()
    expect((await api('POST', `/api/pagos/${pagoId}/notas`, mesero, {})).datos.codigo).toBe('SIN_PERMISO')

    const parcial = { tipo: 'credito', concepto: 'devolucion_parcial', motivo: 'Devolvió parte', lineas: [{ descripcion: 'Parte', cantidad: 1, precio: 10_800 }] }
    const { status, datos: nota } = await api<Nota>('POST', `/api/pagos/${pagoId}/notas`, admin, parcial)
    expect(status).toBe(201)
    expect(nota).toMatchObject({ estado: 'en_proceso', devolucion: 'pendiente', total: 10_800 })

    const emitida = await notaEmitida(nota.id)
    expect(emitida.datos?.cude).toBeTruthy()
    expect(emitida.numero).toBeTruthy()
    const factura = await esperar(() => leer<Factura>(rutaFactura(pagoId)), (f) => f.notas[0]?.estado === 'emitida', 'resumen en la factura')
    expect(factura.notas[0]).toMatchObject({ id: nota.id, tipo: 'credito', total: 10_800 })

    const anulacion = await api('POST', `/api/pagos/${pagoId}/notas`, admin, { tipo: 'credito', concepto: 'anulacion', motivo: 'Anula todo' })
    expect(anulacion.datos.codigo).toBe('NOTA_EXCEDE_FACTURA')

    const pdf = await api('GET', `/api/notas/${nota.id}/pdf`, admin)
    expect(pdf.tipo).toBe('application/pdf')
    const hecha = await api<Nota>('POST', `/api/notas/${nota.id}/devolucion`, admin)
    expect(hecha.datos.devolucion).toBe('hecha')
  })

  test('débito con Factus Pay: primero cobra y luego emite', async () => {
    const pagoId = await facturaDeEjemplo()
    const cuerpo = { tipo: 'debito', concepto: 'otros', motivo: 'Cargo adicional', lineas: [{ descripcion: 'Servicio', cantidad: 1, precio: 21_600 }], medio: 'factus_pay' }
    const { datos: nota } = await api<Nota>('POST', `/api/pagos/${pagoId}/notas`, admin, cuerpo)
    expect(nota).toMatchObject({ estado: 'sin_emitir', devolucion: 'no_aplica' })
    expect(nota.cobro).toMatchObject({ referencia: nota.id, monto: 21_600, estado: 'ready' })
    expect(await leer(rutaReferencia(nota.id))).toMatchObject({ restauranteId: RESTAURANTE, tipo: 'nota' })

    await new Promise((resolver) => setTimeout(resolver, 500))
    expect((await leer<Nota>(rutaNota(nota.id))).estado).toBe('sin_emitir')

    await simularPago(nota.id)
    const emitida = await notaEmitida(nota.id)
    expect(emitida.tipo).toBe('debito')
    expect(emitida.datos?.cude).toBeTruthy()
  })

  test('débito en efectivo: se emite de una vez', async () => {
    const pagoId = await facturaDeEjemplo()
    const { datos: nota } = await api<Nota>('POST', `/api/pagos/${pagoId}/notas`, admin, {
      tipo: 'debito',
      concepto: 'gastos_por_cobrar',
      motivo: 'Domicilio',
      lineas: [{ descripcion: 'Domicilio', cantidad: 1, precio: 5_400 }],
      medio: 'efectivo',
    })
    expect((await notaEmitida(nota.id)).total).toBe(5_400)
  })
})

describe('tarea de cada minuto y Firestore de verdad', () => {
  const contexto = (ahora: () => Date): Contexto => ({
    db,
    cobros: crearCobrosCompartidos(db, ahora),
    facturacion: crearFacturacionCompartida(db),
    auth: {} as Contexto['auth'],
    ahora,
    nuevoId: () => crypto.randomUUID().replaceAll('-', ''),
  })

  test('vence un cobro abandonado aunque Factus Pay siga diciendo ready', async () => {
    const token = mesa(5)
    const cliente = await anonimo()
    const cuenta = await pedirYConfirmar(token, cliente, [['enyucado', 2]])
    const { datos: pago } = await pagar(token, cliente, { tipo: 'saldo' })
    expect((await leer<Cobro>(`_mocks_cobros/${pago.id}`)).estado).toBe('ready')

    await barrer(contexto(() => new Date()))
    expect((await leer<PagoDoc>(rutaPago(pago.id))).estado).toBe('esperando_pago')

    await barrer(contexto(() => new Date(Date.now() + 601_000)))
    expect((await leer<PagoDoc>(rutaPago(pago.id))).estado).toBe('vencido')
    expect((await leer<{ venceEn: string | null }>(rutaReferencia(pago.id))).venceEn).toBeNull()
    expect(await leer<CuentaDoc>(rutaCuenta(cuenta.id))).toMatchObject({ enCobro: 0, porPagar: 16_200 })

    const { datos: efectivo } = await pagar(token, mesero, { tipo: 'saldo' }, 'efectivo')
    await facturaEmitida(efectivo.id)
    await api('POST', `/api/mesas/${token}/liberar`, mesero)
  })

  test('varios procesos compitiendo emiten la factura una sola vez', async () => {
    const id = crypto.randomUUID().replaceAll('-', '')
    const comprador = { tipo: 'consumidor_final', correo: null } as const
    // `en_validacion` no despierta al disparador: aquí solo compiten estos procesos.
    await firestore.doc(rutaFactura(id)).set({ pagoId: id, restauranteId: RESTAURANTE, pagadorUid: 'u', estado: 'en_validacion', comprador, datos: null, intentos: 0, ultimoError: null, correo: { estado: 'sin_correo', destino: null, ultimoError: null, enviadoEn: null }, pagador: null, notas: [], emitidaEn: null })
    await firestore.doc(rutaPago(id)).set({ id, cuentaId: 'no-existe', restauranteId: RESTAURANTE, parte: null, items: [{ lineaId: 'x', nombre: 'Plato', cantidad: 1, precio: 10_800 }], impuesto: { tipo: 'INC', porcentaje: 8 }, propina: 0, baseSinImpuesto: 10_000, medio: 'efectivo', total: 10_800, estadoFactura: 'en_validacion' })
    await firestore.doc(rutaReferencia(id)).set(referenciaNueva(RESTAURANTE, 'pago'))

    let llamadas = 0
    const base = contexto(() => new Date())
    const ctx: Contexto = {
      ...base,
      facturacion: {
        ...base.facturacion,
        emitirFactura: async (solicitud: SolicitudFactura) => {
          llamadas++
          await new Promise((resolver) => setTimeout(resolver, 300))
          return base.facturacion.emitirFactura(solicitud)
        },
      },
    }
    await Promise.all(Array.from({ length: 6 }, () => procesarDocumento(ctx, { tipo: 'pago', restauranteId: RESTAURANTE, id }, { forzar: true })))
    expect(llamadas).toBe(1)
    expect((await leer<Factura>(rutaFactura(id))).estado).toBe('emitida')
  })
})

test('la plataforma crea otro restaurante, y su personal no ve este', async () => {
  const { status, datos } = await api('POST', '/api/restaurantes', plataforma, { nombre: 'Otro', impuesto: { tipo: 'INC', porcentaje: 8 }, propinasSugeridas: [0], mesas: 1 })
  expect(status).toBe(201)
  const nuevo = await api('POST', `/api/restaurantes/${datos.restaurante.id}/personal`, plataforma, { correo: 'otro-mesero@ribu.test', nombre: 'Otro', rol: 'mesero', clave: 'clave-de-prueba-otro' })
  expect(nuevo.status).toBe(201)
  const ajeno = await entrar('otro-mesero@ribu.test', 'clave-de-prueba-otro')
  const intento = await api('POST', `/api/mesas/${mesa(1)}/liberar`, ajeno)
  expect(intento.status).toBe(403)
  expect(intento.datos.codigo).toBe('SIN_PERMISO')
  expect((await api('POST', `/api/mesas/${datos.mesas[0].token}/liberar`, mesero)).datos.codigo).toBe('SIN_PERMISO')
})
