// Órdenes sobre el pedido de la mesa. Toda orden con dinero o stock corre en una transacción.

import { puedeLiberarMesa, puedePasar, rutas, TRANSICIONES_CUENTA } from '../contratos/reglas'
import type { Mesa, Producto, Restaurante, SolicitudEstadoLinea, SolicitudIdsLineas, SolicitudLineas, SolicitudMotivoLineas } from '../contratos/tipos'
import { esPersonal, exigirRestaurante, type Identidad } from './auth'
import type { Transaccion } from './base-datos'
import {
  agregarLineas as agregarLineasACuenta,
  buscarLineas,
  cambiarEstadoLinea,
  descontarStock,
  devolverStock,
  dividir,
  quitarDivision,
  recalcular,
} from './cuenta'
import { fallar } from './errores'
import { iso, type Contexto, type CuentaDoc } from './modelo'
import { vencerCobrosDeCuenta } from './pagos'

export const rutaMesa = (token: string) => `${rutas.mesas}/${token}`
export const rutaRestaurante = (id: string) => `${rutas.restaurantes}/${id}`
export const rutaCuenta = (restauranteId: string, id: string) => `${rutas.cuentas(restauranteId)}/${id}`
export const rutaProducto = (restauranteId: string, id: string) => `${rutas.productos(restauranteId)}/${id}`

export async function leerMesa(lector: { leer: Transaccion['leer'] }, identidad: Identidad, token: string) {
  const mesa = (await lector.leer<Mesa>(rutaMesa(token))) ?? fallar('NO_ENCONTRADO', 'Esa mesa no existe')
  exigirRestaurante(identidad, mesa.restauranteId)
  return mesa
}

export async function leerCuentaDeMesa(tx: Transaccion, identidad: Identidad, token: string) {
  const mesa = await leerMesa(tx, identidad, token)
  if (!mesa.cuentaId) return fallar('NO_ENCONTRADO', 'La mesa no tiene una cuenta abierta')
  const ruta = rutaCuenta(mesa.restauranteId, mesa.cuentaId)
  const cuenta = (await tx.leer<CuentaDoc>(ruta)) ?? fallar('NO_ENCONTRADO', 'La mesa no tiene una cuenta abierta')
  return { mesa, cuenta, ruta }
}

export async function exigirRestauranteActivo(tx: Transaccion, restauranteId: string) {
  const restaurante = await tx.leer<Restaurante>(rutaRestaurante(restauranteId))
  if (!restaurante) return fallar('NO_ENCONTRADO', 'Ese restaurante no existe')
  if (!restaurante.activo) return fallar('RESTAURANTE_INACTIVO', 'Este restaurante no está recibiendo pedidos')
  return restaurante
}

function guardarProductos(tx: Transaccion, productos: Iterable<Producto>) {
  for (const { restauranteId, id, stock, disponible } of productos) {
    tx.actualizar(rutaProducto(restauranteId, id), { stock, disponible })
  }
}

async function leerProductos(tx: Transaccion, restauranteId: string, ids: readonly string[]) {
  const unicos = [...new Set(ids)]
  const docs = await tx.leerVarios<Producto>(unicos.map((id) => rutaProducto(restauranteId, id)))
  return new Map(unicos.map((id, i) => [id, docs[i] ?? null]))
}

/** Lo que pide el cliente espera al mesero. Lo que pide el personal va directo a cocina. */
export function agregarLineas(ctx: Contexto, identidad: Identidad, token: string, solicitud: SolicitudLineas) {
  return ctx.db.transaccion(async (tx) => {
    const mesa = await leerMesa(tx, identidad, token)
    await exigirRestauranteActivo(tx, mesa.restauranteId)
    const ahora = iso(ctx.ahora())
    const productos = await leerProductos(tx, mesa.restauranteId, solicitud.items.map((item) => item.productoId))

    const cuentaId = mesa.cuentaId ?? ctx.nuevoId()
    const existente = mesa.cuentaId ? await tx.leer<CuentaDoc>(rutaCuenta(mesa.restauranteId, cuentaId)) : null
    const cuenta: CuentaDoc = existente ?? {
      id: cuentaId,
      restauranteId: mesa.restauranteId,
      mesaToken: token,
      numeroMesa: mesa.numero,
      estado: 'abierta',
      lineas: [],
      division: null,
      pagos: [],
      consumo: 0,
      pagado: 0,
      enCobro: 0,
      porPagar: 0,
      abiertaEn: ahora,
      cerradaEn: null,
    }

    const origen = esPersonal(identidad.rol) ? 'personal' : 'cliente'
    agregarLineasACuenta(cuenta, { items: solicitud.items, productos, origen, ahora, nuevoId: ctx.nuevoId })
    if (origen === 'personal') guardarProductos(tx, [...productos.values()].filter((p) => p !== null))
    if (!mesa.cuentaId) tx.actualizar(rutaMesa(token), { estado: 'ocupada', cuentaId })
    tx.guardar(rutaCuenta(mesa.restauranteId, cuentaId), cuenta)
    return cuenta
  })
}

export function confirmarLineas(ctx: Contexto, identidad: Identidad, token: string, { lineaIds }: SolicitudIdsLineas) {
  return ctx.db.transaccion(async (tx) => {
    const { mesa, cuenta, ruta } = await leerCuentaDeMesa(tx, identidad, token)
    const lineas = buscarLineas(cuenta, lineaIds)
    const productos = await leerProductos(tx, mesa.restauranteId, lineas.map((linea) => linea.productoId))
    for (const linea of lineas) {
      cambiarEstadoLinea(linea, 'confirmada')
      const producto = productos.get(linea.productoId)
      if (producto) descontarStock(producto, linea.cantidad)
    }
    guardarProductos(tx, [...productos.values()].filter((p) => p !== null))
    tx.guardar(ruta, recalcular(cuenta))
    return cuenta
  })
}

export function rechazarLineas(ctx: Contexto, identidad: Identidad, token: string, { lineaIds, motivo }: SolicitudMotivoLineas) {
  return ctx.db.transaccion(async (tx) => {
    const { cuenta, ruta } = await leerCuentaDeMesa(tx, identidad, token)
    for (const linea of buscarLineas(cuenta, lineaIds)) {
      cambiarEstadoLinea(linea, 'rechazada')
      linea.motivo = motivo
    }
    tx.guardar(ruta, recalcular(cuenta))
    return cuenta
  })
}

export function anularLineas(ctx: Contexto, identidad: Identidad, token: string, { lineaIds, motivo }: SolicitudMotivoLineas) {
  return ctx.db.transaccion(async (tx) => {
    const { mesa, cuenta, ruta } = await leerCuentaDeMesa(tx, identidad, token)
    await vencerCobrosDeCuenta(tx, cuenta, ctx.ahora())
    const lineas = buscarLineas(cuenta, lineaIds)
    const productos = await leerProductos(tx, mesa.restauranteId, lineas.map((linea) => linea.productoId))
    for (const linea of lineas) {
      if (linea.cantidadCubierta > 0) fallar('LINEA_CON_PAGO', `${linea.nombre} ya está en un pago o en una división`)
      cambiarEstadoLinea(linea, 'anulada')
      linea.motivo = motivo
      const producto = productos.get(linea.productoId)
      if (producto) devolverStock(producto, linea.cantidad)
    }
    guardarProductos(tx, [...productos.values()].filter((p) => p !== null))
    tx.guardar(ruta, recalcular(cuenta))
    return cuenta
  })
}

export function avanzarLinea(ctx: Contexto, identidad: Identidad, token: string, lineaId: string, { estado }: SolicitudEstadoLinea) {
  return ctx.db.transaccion(async (tx) => {
    const { cuenta, ruta } = await leerCuentaDeMesa(tx, identidad, token)
    const [linea] = buscarLineas(cuenta, [lineaId])
    cambiarEstadoLinea(linea as NonNullable<typeof linea>, estado)
    tx.guardar(ruta, cuenta)
    return cuenta
  })
}

export function dividirEnPartesIguales(ctx: Contexto, identidad: Identidad, token: string, partes: number) {
  return ctx.db.transaccion(async (tx) => {
    const { cuenta, ruta } = await leerCuentaDeMesa(tx, identidad, token)
    await vencerCobrosDeCuenta(tx, cuenta, ctx.ahora())
    dividir(cuenta, partes, ctx.nuevoId())
    tx.guardar(ruta, cuenta)
    return cuenta
  })
}

export function quitarLaDivision(ctx: Contexto, identidad: Identidad, token: string) {
  return ctx.db.transaccion(async (tx) => {
    const { cuenta, ruta } = await leerCuentaDeMesa(tx, identidad, token)
    await vencerCobrosDeCuenta(tx, cuenta, ctx.ahora())
    quitarDivision(cuenta)
    tx.guardar(ruta, cuenta)
    return cuenta
  })
}

/** Las facturas en proceso continúan: no bloquean la mesa. Liberar una mesa ya libre no hace nada. */
export function liberarMesa(ctx: Contexto, identidad: Identidad, token: string) {
  return ctx.db.transaccion(async (tx) => {
    const mesa = await leerMesa(tx, identidad, token)
    if (mesa.estado === 'libre' || !mesa.cuentaId) return mesa
    const ruta = rutaCuenta(mesa.restauranteId, mesa.cuentaId)
    const cuenta = await tx.leer<CuentaDoc>(ruta)
    if (cuenta) {
      await vencerCobrosDeCuenta(tx, cuenta, ctx.ahora())
      if (!puedeLiberarMesa(cuenta) || !puedePasar(TRANSICIONES_CUENTA, cuenta.estado, 'cerrada')) {
        fallar('MESA_CON_SALDO', 'La mesa tiene pedidos por confirmar, cobros activos o saldo')
      }
      cuenta.estado = 'cerrada'
      cuenta.cerradaEn = iso(ctx.ahora())
      tx.guardar(ruta, cuenta)
    }
    const libre: Mesa = { ...mesa, estado: 'libre', cuentaId: null }
    tx.guardar(rutaMesa(token), libre)
    return libre
  })
}
