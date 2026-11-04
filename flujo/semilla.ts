// Datos iniciales de la demo. Correrla otra vez no cambia los tokens de las mesas ni pisa el stock.

import { rutas } from '../contratos/reglas'
import type { Mesa, Personal, Producto, Restaurante, RolPersonal } from '../contratos/tipos'
import { nuevoTokenMesa, rutaPersonal } from './administracion'
import type { ServicioAuth } from './auth'
import { fallar } from './errores'
import { iso, type Contexto, type CuentaDoc } from './modelo'
import { rutaCuenta, rutaMesa, rutaProducto, rutaRestaurante } from './pedidos'

export const RESTAURANTE_DEMO = 'fogon-del-manglar'
const MESAS_DEMO = 5
const CLAVE_MINIMA = 8

const RESTAURANTE: Restaurante = {
  id: RESTAURANTE_DEMO,
  nombre: 'Fogón del Manglar',
  impuesto: { tipo: 'INC', porcentaje: 8 },
  propinasSugeridas: [0, 5, 8, 10],
  activo: true,
}

type FilaCarta = [id: string, nombre: string, categoria: string, precio: number, stock: number, descripcion: string]

// docs/datos-demo.md
const CARTA: readonly FilaCarta[] = [
  ['patacon-suero', 'Patacón con suero', 'Entradas', 10_800, 40, 'Patacón grande con suero costeño'],
  ['carimanolas', 'Carimañolas x 3', 'Entradas', 8_100, 30, 'Rellenas de carne'],
  ['arepa-huevo', 'Arepa de huevo', 'Entradas', 5_400, 30, 'Frita, con huevo entero'],
  ['mojarra-frita', 'Mojarra frita', 'Platos fuertes', 32_400, 2, 'Con patacón, arroz de coco y ensalada'],
  ['posta-negra', 'Posta negra', 'Platos fuertes', 37_800, 15, 'Con arroz de coco y plátano maduro'],
  ['carne-asada', 'Bandeja de carne asada', 'Platos fuertes', 35_100, 20, 'Con yuca, arroz y ensalada'],
  ['sancocho-gallina', 'Sancocho de gallina', 'Platos fuertes', 27_000, 25, 'Con arroz y aguacate'],
  ['jugo-corozo', 'Jugo de corozo', 'Bebidas', 8_100, 40, 'En agua o en leche'],
  ['limonada-coco', 'Limonada de coco', 'Bebidas', 12_000, 30, 'Frappé'],
  ['agua', 'Agua en botella', 'Bebidas', 4_050, 50, '500 ml'],
  ['enyucado', 'Enyucado', 'Postres', 8_100, 20, 'Porción individual'],
  ['cocada', 'Cocada', 'Postres', 6_750, 20, 'Con panela'],
]

const productoDe = ([id, nombre, categoria, precio, stock, descripcion]: FilaCarta): Producto => ({
  id,
  restauranteId: RESTAURANTE_DEMO,
  nombre,
  descripcion,
  categoria,
  precio,
  stock,
  disponible: true,
  imagenUrl: null,
})

export type RolSemilla = RolPersonal | 'plataforma'
const ROLES_SEMILLA: readonly RolSemilla[] = ['plataforma', 'admin', 'mesero', 'cocina']

export const correoDemo = (rol: RolSemilla) => `${rol}@ribu.test`

export interface SolicitudSemilla {
  claves: Record<RolSemilla, string>
  /** Devuelve el stock y libera las mesas. Sirve entre ensayos. Los tokens tampoco cambian. */
  reiniciarDemo: boolean
}

export function leerSolicitudSemilla(cuerpo: unknown): SolicitudSemilla {
  const crudo = (cuerpo ?? {}) as { claves?: Record<string, unknown>; reiniciarDemo?: unknown }
  const claves = crudo.claves ?? {}
  for (const rol of ROLES_SEMILLA) {
    const clave = claves[rol]
    if (typeof clave !== 'string' || clave.length < CLAVE_MINIMA) {
      fallar('CUERPO_INVALIDO', `Falta la clave de ${rol}, con al menos ${CLAVE_MINIMA} caracteres`)
    }
  }
  return { claves: claves as Record<RolSemilla, string>, reiniciarDemo: crudo.reiniciarDemo === true }
}

export interface ResultadoSemilla {
  restauranteId: string
  cuentas: { rol: RolSemilla; correo: string; uid: string }[]
  mesas: { numero: number; token: string; link: string }[]
}

async function asegurarCuenta(auth: ServicioAuth, rol: RolSemilla, clave: string) {
  const correo = correoDemo(rol)
  const nombre = rol === 'plataforma' ? 'Plataforma Ribu' : `Demo ${rol}`
  const existente = await auth.buscarUid(correo)
  const uid = existente ?? (await auth.crearUsuario(correo, clave, nombre))
  if (existente) await auth.actualizarUsuario(uid, { clave, deshabilitado: false })
  await auth.fijarClaims(uid, rol === 'plataforma' ? { rol } : { rol, restauranteId: RESTAURANTE_DEMO })
  return { rol, correo, uid }
}

/** Las claves no se guardan ni se registran: solo pasan a Authentication. */
export async function sembrar(ctx: Contexto, solicitud: SolicitudSemilla, origenWeb: string): Promise<ResultadoSemilla> {
  const cuentas: ResultadoSemilla['cuentas'] = []
  for (const rol of ROLES_SEMILLA) cuentas.push(await asegurarCuenta(ctx.auth, rol, solicitud.claves[rol]))

  const mesas = await ctx.db.transaccion(async (tx) => {
    const ahora = iso(ctx.ahora())
    if (!(await tx.leer<Restaurante>(rutaRestaurante(RESTAURANTE_DEMO)))) {
      tx.guardar(rutaRestaurante(RESTAURANTE_DEMO), RESTAURANTE)
    }

    for (const { uid, rol, correo } of cuentas) {
      if (rol === 'plataforma') continue
      const ruta = rutaPersonal(RESTAURANTE_DEMO, uid)
      const actual = await tx.leer<Personal>(ruta)
      if (actual) {
        if (!actual.activo || actual.rol !== rol) tx.actualizar(ruta, { activo: true, rol })
        continue
      }
      const personal: Personal = { uid, restauranteId: RESTAURANTE_DEMO, correo, nombre: `Demo ${rol}`, rol, activo: true, creadoEn: ahora }
      tx.guardar(ruta, personal)
    }

    for (const fila of CARTA) {
      const producto = productoDe(fila)
      const ruta = rutaProducto(RESTAURANTE_DEMO, producto.id)
      const actual = await tx.leer<Producto>(ruta)
      if (!actual) tx.guardar(ruta, producto)
      else if (solicitud.reiniciarDemo) tx.actualizar(ruta, { stock: producto.stock, disponible: true })
    }

    const existentes = await tx.consultar<Mesa>(rutas.mesas, { campo: 'restauranteId', op: '==', valor: RESTAURANTE_DEMO })
    const lista = existentes.map(({ datos }) => datos)
    for (let numero = 1; numero <= MESAS_DEMO; numero++) {
      if (lista.some((mesa) => mesa.numero === numero)) continue
      const mesa: Mesa = { token: nuevoTokenMesa(), restauranteId: RESTAURANTE_DEMO, numero, estado: 'libre', cuentaId: null }
      tx.guardar(rutaMesa(mesa.token), mesa)
      lista.push(mesa)
    }

    if (solicitud.reiniciarDemo) {
      for (const mesa of lista) {
        if (!mesa.cuentaId) continue
        const ruta = rutaCuenta(RESTAURANTE_DEMO, mesa.cuentaId)
        if (await tx.leer<CuentaDoc>(ruta)) tx.actualizar(ruta, { estado: 'cerrada', cerradaEn: ahora })
        tx.actualizar(rutaMesa(mesa.token), { estado: 'libre', cuentaId: null })
      }
    }
    return lista.sort((a, b) => a.numero - b.numero)
  })

  return {
    restauranteId: RESTAURANTE_DEMO,
    cuentas,
    mesas: mesas.map(({ numero, token }) => ({ numero, token, link: `${origenWeb}${rutas.paginaMesa(token)}` })),
  }
}
