// Restaurantes, mesas, personal y carta.

import { randomBytes } from 'node:crypto'
import { rutas } from '../contratos/reglas'
import type {
  CambiosPersonal,
  CambiosProducto,
  CambiosRestaurante,
  Mesa,
  NuevoPersonal,
  NuevoProducto,
  NuevoRestaurante,
  Personal,
  Producto,
  Restaurante,
  RestauranteCreado,
} from '../contratos/tipos'
import type { Identidad } from './auth'
import type { Transaccion } from './base-datos'
import { fallar } from './errores'
import { iso, type Contexto } from './modelo'
import { rutaMesa, rutaProducto, rutaRestaurante } from './pedidos'

export const rutaPersonal = (restauranteId: string, uid: string) => `${rutas.personal(restauranteId)}/${uid}`

/** 128 bits: no se puede adivinar. Es la parte fija del link del sticker. */
export const nuevoTokenMesa = () => randomBytes(16).toString('hex')

/** La plataforma entra a cualquiera; el administrador, solo al suyo. */
function exigirGestion(identidad: Identidad, restauranteId: string) {
  if (identidad.rol !== 'plataforma' && identidad.restauranteId !== restauranteId) {
    fallar('SIN_PERMISO', 'Ese restaurante no es tuyo')
  }
}

const exigirExistente = async (lector: { leer: Transaccion['leer'] }, id: string) =>
  (await lector.leer<Restaurante>(rutaRestaurante(id))) ?? fallar('NO_ENCONTRADO', 'Ese restaurante no existe')

function mesasNuevas(tx: Transaccion, restauranteId: string, desde: number, cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) => {
    const mesa: Mesa = { token: nuevoTokenMesa(), restauranteId, numero: desde + i, estado: 'libre', cuentaId: null }
    tx.guardar(rutaMesa(mesa.token), mesa)
    return mesa
  })
}

export function crearRestaurante(ctx: Contexto, solicitud: NuevoRestaurante): Promise<RestauranteCreado> {
  const { mesas, ...datos } = solicitud
  return ctx.db.transaccion(async (tx) => {
    const restaurante: Restaurante = { id: ctx.nuevoId(), ...datos, activo: true }
    tx.guardar(rutaRestaurante(restaurante.id), restaurante)
    return { restaurante, mesas: mesasNuevas(tx, restaurante.id, 1, mesas) }
  })
}

export function actualizarRestaurante(ctx: Contexto, identidad: Identidad, id: string, cambios: CambiosRestaurante) {
  exigirGestion(identidad, id)
  if (cambios.activo !== undefined && identidad.rol !== 'plataforma') {
    fallar('SIN_PERMISO', 'Solo la plataforma activa o desactiva un restaurante')
  }
  return ctx.db.transaccion(async (tx) => {
    const restaurante = await exigirExistente(tx, id)
    tx.actualizar(rutaRestaurante(id), cambios)
    return { ...restaurante, ...cambios }
  })
}

/** Los tokens existentes no cambian: los stickers ya están impresos. */
export function agregarMesas(ctx: Contexto, identidad: Identidad, id: string, cantidad: number) {
  exigirGestion(identidad, id)
  return ctx.db.transaccion(async (tx) => {
    await exigirExistente(tx, id)
    const actuales = await tx.consultar<Mesa>(rutas.mesas, { campo: 'restauranteId', op: '==', valor: id })
    const ultima = actuales.reduce((mayor, { datos }) => Math.max(mayor, datos.numero), 0)
    return mesasNuevas(tx, id, ultima + 1, cantidad)
  })
}

export async function crearPersonal(ctx: Contexto, identidad: Identidad, restauranteId: string, solicitud: NuevoPersonal) {
  exigirGestion(identidad, restauranteId)
  await exigirExistente(ctx.db, restauranteId)
  const uid = await ctx.auth.crearUsuario(solicitud.correo, solicitud.clave, solicitud.nombre)
  try {
    await ctx.auth.fijarClaims(uid, { rol: solicitud.rol, restauranteId })
    const personal: Personal = {
      uid,
      restauranteId,
      correo: solicitud.correo,
      nombre: solicitud.nombre,
      rol: solicitud.rol,
      activo: true,
      creadoEn: iso(ctx.ahora()),
    }
    await ctx.db.transaccion(async (tx) => tx.guardar(rutaPersonal(restauranteId, uid), personal))
    return personal
  } catch (error) {
    await ctx.auth.borrar(uid).catch(() => undefined)
    throw error
  }
}

export async function actualizarPersonal(ctx: Contexto, identidad: Identidad, restauranteId: string, uid: string, cambios: CambiosPersonal) {
  exigirGestion(identidad, restauranteId)
  const ruta = rutaPersonal(restauranteId, uid)
  const personal = (await ctx.db.leer<Personal>(ruta)) ?? fallar('NO_ENCONTRADO', 'Esa cuenta no existe')
  const { clave, ...datos } = cambios

  await ctx.auth.actualizarUsuario(uid, {
    ...(clave === undefined ? {} : { clave }),
    ...(datos.nombre === undefined ? {} : { nombre: datos.nombre }),
    ...(datos.activo === undefined ? {} : { deshabilitado: !datos.activo }),
  })
  if (datos.rol) await ctx.auth.fijarClaims(uid, { rol: datos.rol, restauranteId })
  // Sus tokens anteriores traen el rol viejo o ya no deben servir.
  if (datos.rol || datos.activo === false || clave !== undefined) await ctx.auth.revocar(uid)

  await ctx.db.transaccion(async (tx) => tx.actualizar(ruta, datos))
  return { ...personal, ...datos }
}

const restauranteDelPersonal = (identidad: Identidad) =>
  identidad.restauranteId ?? fallar('SIN_PERMISO', 'Necesitas una cuenta de un restaurante')

export function crearProducto(ctx: Contexto, identidad: Identidad, solicitud: NuevoProducto) {
  const restauranteId = restauranteDelPersonal(identidad)
  const producto: Producto = { id: ctx.nuevoId(), restauranteId, ...solicitud }
  return ctx.db.transaccion(async (tx) => {
    tx.guardar(rutaProducto(restauranteId, producto.id), producto)
    return producto
  })
}

export function actualizarProducto(ctx: Contexto, identidad: Identidad, productoId: string, cambios: CambiosProducto) {
  const restauranteId = restauranteDelPersonal(identidad)
  if (identidad.rol !== 'admin' && Object.keys(cambios).some((campo) => campo !== 'disponible')) {
    fallar('SIN_PERMISO', 'El mesero y la cocina solo pueden marcar un producto como agotado')
  }
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaProducto(restauranteId, productoId)
    const producto = (await tx.leer<Producto>(ruta)) ?? fallar('NO_ENCONTRADO', 'Ese producto no existe')
    const nuevos = { ...cambios, ...(cambios.stock === 0 ? { disponible: false } : {}) }
    tx.actualizar(ruta, nuevos)
    return { ...producto, ...nuevos }
  })
}

export function borrarProducto(ctx: Contexto, identidad: Identidad, productoId: string) {
  const restauranteId = restauranteDelPersonal(identidad)
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaProducto(restauranteId, productoId)
    if (!(await tx.leer<Producto>(ruta))) fallar('NO_ENCONTRADO', 'Ese producto no existe')
    tx.borrar(ruta)
  })
}
