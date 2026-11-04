// Un restaurante de mentiras y la API entera sobre mocks, para las pruebas que corren en CI.

import { crearCobrosMock, LLAVE_WEBHOOK_DE_EJEMPLO, type CobrosMock } from '../cobros/mock'
import type { Comprador, Mesa, Producto, Restaurante } from '../contratos/tipos'
import { crearFacturacionMock, type FacturacionMock } from '../facturacion/mock'
import { crearApi } from './api'
import { identidadDeClaims, type ServicioAuth } from './auth'
import { crearBaseMemoria } from './base-memoria'
import { procesarDocumento } from './documentos'
import { ErrorRibu } from './errores'
import type { Contexto, CuentaDoc, PagoDoc } from './modelo'
import { rutaReferencia, type Referencia } from './modelo'

export const R1 = 'rest-1'
export const R2 = 'rest-2'
export const MESA_1 = 'mesa-uno'
export const MESA_2 = 'mesa-dos'
export const MESA_R2 = 'mesa-otro'
export const CLAVE_SEMILLA = 'clave-semilla-de-prueba'

export const FINAL: Comprador = { tipo: 'consumidor_final', correo: null }

const producto = (id: string, nombre: string, precio: number, stock: number | null, restauranteId = R1): Producto => ({
  id,
  restauranteId,
  nombre,
  descripcion: null,
  categoria: 'Platos',
  precio,
  stock,
  disponible: true,
  imagenUrl: null,
})

const restaurante = (id: string): Restaurante => ({
  id,
  nombre: id,
  impuesto: { tipo: 'INC', porcentaje: 8 },
  propinasSugeridas: [0, 5, 10],
  activo: true,
})

const mesa = (token: string, restauranteId: string, numero: number): Mesa => ({
  token,
  restauranteId,
  numero,
  estado: 'libre',
  cuentaId: null,
})

/** Quién llama. El token es `rol:uid:restaurante`: la auth falsa lo lee igual que los claims de verdad. */
export const quien = {
  cliente: (uid = 'cliente-1') => `:${uid}:`,
  mesero: (restauranteId = R1) => `mesero:mesero-${restauranteId}:${restauranteId}`,
  cocina: (restauranteId = R1) => `cocina:cocina-${restauranteId}:${restauranteId}`,
  admin: (restauranteId = R1) => `admin:admin-${restauranteId}:${restauranteId}`,
  plataforma: () => 'plataforma:la-plataforma:',
}

function crearAuthFalsa() {
  const usuarios = new Map<string, string>()
  const claims = new Map<string, object>()
  const claves = new Map<string, string>()
  const revocados: string[] = []
  const auth: ServicioAuth = {
    async verificar(token) {
      const [rol, uid, restauranteId] = token.split(':')
      if (!uid) throw new ErrorRibu('NO_AUTORIZADO', 'La sesión no es válida')
      return identidadDeClaims({ uid, ...(rol ? { rol } : {}), ...(restauranteId ? { restauranteId } : {}) })
    },
    async crearUsuario(correo, clave) {
      if (usuarios.has(correo)) throw new ErrorRibu('CORREO_EN_USO', 'Ese correo ya tiene una cuenta')
      const uid = `uid-${usuarios.size + 1}`
      usuarios.set(correo, uid)
      claves.set(uid, clave)
      return uid
    },
    buscarUid: async (correo) => usuarios.get(correo) ?? null,
    async actualizarUsuario(uid, cambios) {
      if (cambios.clave) claves.set(uid, cambios.clave)
    },
    fijarClaims: async (uid, datos) => void claims.set(uid, datos),
    revocar: async (uid) => void revocados.push(uid),
    borrar: async () => undefined,
  }
  return { auth, usuarios, claims, claves, revocados }
}

export interface Respuesta<T = any> {
  status: number
  datos: T
  cabeceras: Headers
}

export function crearEscenario() {
  let reloj = Date.parse('2026-11-04T17:00:00.000Z')
  const ahora = () => new Date(reloj)
  const db = crearBaseMemoria({
    [`restaurantes/${R1}`]: restaurante(R1),
    [`restaurantes/${R2}`]: restaurante(R2),
    [`mesas/${MESA_1}`]: mesa(MESA_1, R1, 1),
    [`mesas/${MESA_2}`]: mesa(MESA_2, R1, 2),
    [`mesas/${MESA_R2}`]: mesa(MESA_R2, R2, 1),
    [`restaurantes/${R1}/productos/plato`]: producto('plato', 'Plato', 54_000, 20),
    [`restaurantes/${R1}/productos/bebida`]: producto('bebida', 'Bebida', 8_100, null),
    [`restaurantes/${R1}/productos/mojarra`]: producto('mojarra', 'Mojarra', 32_400, 2),
    [`restaurantes/${R1}/productos/agua`]: producto('agua', 'Agua', 4_050, 50),
    [`restaurantes/${R2}/productos/plato`]: producto('plato', 'Plato', 54_000, 20, R2),
  })
  const cobros: CobrosMock = crearCobrosMock({ ahora })
  const facturacion: FacturacionMock = crearFacturacionMock()
  const authFalsa = crearAuthFalsa()
  let id = 0
  const ctx: Contexto = {
    db,
    cobros,
    facturacion,
    auth: authFalsa.auth,
    ahora,
    nuevoId: () => `id${++id}`,
  }
  const app = crearApi(ctx, { claveSemilla: () => CLAVE_SEMILLA, origenWeb: () => 'https://ribu.test' })

  async function pedir<T = any>(metodo: string, ruta: string, token?: string | null, cuerpo?: unknown, cabeceras: Record<string, string> = {}): Promise<Respuesta<T>> {
    const respuesta = await app.fetch(
      new Request(`https://ribu.test${ruta}`, {
        method: metodo,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...cabeceras },
        ...(cuerpo === undefined || metodo === 'GET' ? {} : { body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }),
      }),
    )
    const tipo = respuesta.headers.get('content-type') ?? ''
    const datos = tipo.includes('json') ? await respuesta.json() : await respuesta.arrayBuffer()
    return { status: respuesta.status, datos: datos as T, cabeceras: respuesta.headers }
  }

  const leerPago = async (pagoId: string, restauranteId = R1) =>
    (await db.leer<PagoDoc>(`restaurantes/${restauranteId}/pagos/${pagoId}`)) as PagoDoc

  const leerFactura = async (pagoId: string, restauranteId = R1) =>
    (await db.leer<any>(`restaurantes/${restauranteId}/facturas/${pagoId}`)) as any

  const leerCuenta = async (cuentaId: string, restauranteId = R1) =>
    (await db.leer<CuentaDoc>(`restaurantes/${restauranteId}/cuentas/${cuentaId}`)) as CuentaDoc

  const leerProducto = async (id: string) => (await db.leer<Producto>(`restaurantes/${R1}/productos/${id}`)) as Producto

  const leerReferencia = async (id: string) => (await db.leer<Referencia>(rutaReferencia(id))) as Referencia

  /** El cliente pide y el mesero confirma. Devuelve la cuenta. */
  async function pedido(items: [productoId: string, cantidad: number][], mesaToken = MESA_1, cliente = quien.cliente()) {
    const creada = await pedir<CuentaDoc>('POST', `/api/mesas/${mesaToken}/lineas`, cliente, {
      items: items.map(([productoId, cantidad]) => ({ productoId, cantidad, nota: null })),
    })
    if (creada.status !== 201) throw new Error(`No se pudo pedir: ${JSON.stringify(creada.datos)}`)
    const pendientes = creada.datos.lineas.filter((linea) => linea.estado === 'pendiente').map((linea) => linea.id)
    const confirmada = await pedir<CuentaDoc>('POST', `/api/mesas/${mesaToken}/lineas/confirmar`, quien.mesero(), { lineaIds: pendientes })
    if (confirmada.status !== 200) throw new Error(`No se pudo confirmar: ${JSON.stringify(confirmada.datos)}`)
    return confirmada.datos
  }

  const pagar = (destino: unknown, opciones: { medio?: string; propina?: number; token?: string; mesa?: string; comprador?: Comprador } = {}) =>
    pedir('POST', `/api/mesas/${opciones.mesa ?? MESA_1}/pagos`, opciones.token ?? quien.cliente(), {
      destino,
      propinaPorcentaje: opciones.propina ?? 0,
      comprador: opciones.comprador ?? FINAL,
      medio: opciones.medio ?? 'factus_pay',
    })

  /** Lo que el disparador haría al entrar un documento a `en_proceso`. */
  const emitirFactura = (pagoId: string, restauranteId = R1) =>
    procesarDocumento(ctx, { tipo: 'pago', restauranteId, id: pagoId }, { forzar: true })

  const emitirNota = (notaId: string, restauranteId = R1) =>
    procesarDocumento(ctx, { tipo: 'nota', restauranteId, id: notaId }, { forzar: true })

  /** Factus Pay avisa que entró la plata. */
  const avisoDePago = (referencia: string, clave = LLAVE_WEBHOOK_DE_EJEMPLO, restauranteId = R1) =>
    pedir('POST', `/api/webhooks/factus-pay/${restauranteId}?key=${clave}`, null, cobros.cuerpoWebhook(referencia))

  /** Pago completo con Factus Pay: el cliente paga, llega el aviso y se emite. */
  async function pagoCompleto(destino: unknown, opciones: Parameters<typeof pagar>[1] = {}) {
    const creado = await pagar(destino, opciones)
    if (creado.status !== 201) throw new Error(`No se pudo pagar: ${JSON.stringify(creado.datos)}`)
    cobros.marcarPagado(creado.datos.id)
    await avisoDePago(creado.datos.id)
    await emitirFactura(creado.datos.id)
    return creado.datos as PagoDoc
  }

  return {
    ctx,
    db,
    app,
    cobros,
    facturacion,
    authFalsa,
    pedir,
    pedido,
    pagar,
    pagoCompleto,
    avisoDePago,
    emitirFactura,
    emitirNota,
    leerPago,
    leerFactura,
    leerCuenta,
    leerProducto,
    leerReferencia,
    avanzar: (segundos: number) => void (reloj += segundos * 1000),
    ahora,
  }
}

export const lineaIdDe = (cuenta: CuentaDoc, productoId: string) =>
  cuenta.lineas.find((linea) => linea.productoId === productoId)?.id as string
