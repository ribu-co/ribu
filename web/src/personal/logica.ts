// Lo que deciden las pantallas del personal a partir de los contratos. Los montos y las transiciones
// los valida el backend: aquí solo se elige qué mostrar y qué acciones ofrecer.

import { puedeLiberarMesa, puedePasar, TRANSICIONES_LINEA } from '../../../contratos/reglas'
import type { Cuenta, EstadoFactura, EstadoLinea, LineaPedido, MedioPago, Mesa, OrigenLinea, Rol } from '../../../contratos/tipos'
import type { Sesion } from '../datos/fuente'
import { todoPagado, unidadesPorConfirmar } from '../cliente/cuenta'
import { pesos, plural } from '../ui/formato'

// Roles y acceso

/** Las órdenes de `/mesero` y `/cocina` también aceptan al administrador: ver `x-roles` en openapi.yaml. */
export const ROLES_MESERO: readonly Rol[] = ['mesero', 'admin']
export const ROLES_COCINA: readonly Rol[] = ['cocina', 'admin']

const PANTALLA_POR_ROL: Partial<Record<Rol, string>> = {
  mesero: '/mesero',
  cocina: '/cocina',
  admin: '/admin',
  plataforma: '/plataforma',
}

/** Adónde va cada rol al entrar. null para el cliente, que no tiene pantalla de personal. */
export const pantallaDeRol = (rol: Rol) => PANTALLA_POR_ROL[rol] ?? null

export const NOMBRE_ROL: Record<Rol, string> = {
  cliente: 'cliente',
  mesero: 'mesero',
  cocina: 'cocina',
  admin: 'administración',
  plataforma: 'plataforma',
}

export type SesionPersonal = Sesion & { restauranteId: string }

export type Acceso = { tipo: 'cargando' } | { tipo: 'sin_sesion' } | { tipo: 'otro_rol'; sesion: Sesion } | { tipo: 'permitido'; sesion: SesionPersonal }

/** `undefined` mientras se sabe si hay sesión. El cliente anónimo cuenta como sin sesión. */
export function decidirAcceso(sesion: Sesion | null | undefined, roles: readonly Rol[]): Acceso {
  if (sesion === undefined) return { tipo: 'cargando' }
  if (sesion === null || sesion.rol === 'cliente') return { tipo: 'sin_sesion' }
  if (!roles.includes(sesion.rol) || sesion.restauranteId === null) return { tipo: 'otro_rol', sesion }
  return { tipo: 'permitido', sesion: sesion as SesionPersonal }
}

// El tablero de mesas

export interface EstadoVisibleMesa {
  texto: string
  tono: string
  rayado?: boolean
}

export interface ResumenMesa {
  mesa: Mesa
  cuenta: Cuenta | null
  porConfirmar: number
  paraServir: number
  estados: EstadoVisibleMesa[]
}

const unidades = (lineas: readonly LineaPedido[], estado: EstadoLinea) =>
  lineas.filter((l) => l.estado === estado).reduce((suma, l) => suma + l.cantidad, 0)

/** Cómo se ve una mesa de un vistazo: libre, por confirmar, para servir, en cobro, saldo o pagada. */
export function resumirMesa(mesa: Mesa, cuentas: readonly Cuenta[]): ResumenMesa {
  const cuenta = mesa.cuentaId ? (cuentas.find((c) => c.id === mesa.cuentaId) ?? null) : null
  if (mesa.estado === 'libre') return { mesa, cuenta: null, porConfirmar: 0, paraServir: 0, estados: [{ texto: 'Libre', tono: 'gris' }] }
  if (!cuenta) return { mesa, cuenta: null, porConfirmar: 0, paraServir: 0, estados: [{ texto: 'Ocupada', tono: 'verde-suave' }] }

  const porConfirmar = unidadesPorConfirmar(cuenta)
  const paraServir = unidades(cuenta.lineas, 'lista')
  const estados: EstadoVisibleMesa[] = []
  if (porConfirmar > 0) estados.push({ texto: `${porConfirmar} por confirmar`, tono: 'ambar', rayado: true })
  if (paraServir > 0) estados.push({ texto: `${paraServir} para servir`, tono: 'verde-fuerte' })
  if (cuenta.enCobro > 0) estados.push({ texto: `En cobro ${pesos(cuenta.enCobro)}`, tono: 'verde' })
  if (cuenta.porPagar > 0) estados.push({ texto: `Saldo ${pesos(cuenta.porPagar)}`, tono: 'rojo' })
  if (todoPagado(cuenta)) estados.push({ texto: 'Pagada', tono: 'verde-suave' })
  if (estados.length === 0) estados.push({ texto: 'Sin saldo', tono: 'gris' })
  return { mesa, cuenta, porConfirmar, paraServir, estados }
}

// Las líneas

export type AccionLinea = 'confirmar' | 'rechazar' | 'marcar_lista' | 'entregar' | 'anular'

/**
 * Lo que el mesero puede hacer con una línea, según TRANSICIONES_LINEA. Una línea que ya está en un
 * pago o en una división no se ofrece para anular: el backend respondería LINEA_CON_PAGO.
 */
export function accionesDeLinea(linea: LineaPedido): AccionLinea[] {
  const puede = (hacia: EstadoLinea) => puedePasar(TRANSICIONES_LINEA, linea.estado, hacia)
  const acciones: AccionLinea[] = []
  if (puede('confirmada')) acciones.push('confirmar')
  if (puede('rechazada')) acciones.push('rechazar')
  if (puede('entregada')) acciones.push('entregar')
  if (puede('lista')) acciones.push('marcar_lista')
  if (puede('anulada') && linea.cantidadCubierta === 0) acciones.push('anular')
  return acciones
}

export const idsPorConfirmar = (cuenta: Cuenta | null) => cuenta?.lineas.filter((l) => l.estado === 'pendiente').map((l) => l.id) ?? []

/** El contrato solo dice el origen de la línea: no quién de la mesa o del personal la pidió. */
export const QUIEN_PIDIO: Record<OrigenLinea, string> = {
  cliente: 'Pidió el cliente',
  personal: 'Pidió el personal',
}

/** Por qué todavía no se puede liberar. Vacío si `puedeLiberarMesa` lo permite. */
export function motivosParaNoLiberar(cuenta: Cuenta): string[] {
  if (puedeLiberarMesa(cuenta)) return []
  const motivos: string[] = []
  const pendientes = unidadesPorConfirmar(cuenta)
  if (pendientes > 0) motivos.push(`${plural(pendientes, 'producto')} por confirmar`)
  if (cuenta.enCobro > 0) motivos.push(`${pesos(cuenta.enCobro)} en cobro`)
  if (cuenta.porPagar > 0) motivos.push(`${pesos(cuenta.porPagar)} de saldo`)
  return motivos
}

const ESTADOS_SIN_ENTREGAR: readonly EstadoLinea[] = ['confirmada', 'en_preparacion', 'lista']

/** Liberar no lo impide, pero al cerrar la cuenta esto desaparece también de la cocina. */
export const unidadesSinEntregar = (cuenta: Cuenta) =>
  cuenta.lineas.filter((l) => ESTADOS_SIN_ENTREGAR.includes(l.estado)).reduce((suma, l) => suma + l.cantidad, 0)

// Pagos y factura

export const ETIQUETA_MEDIO: Record<MedioPago, string> = {
  factus_pay: 'Factus Pay',
  efectivo: 'Efectivo',
  tarjeta_debito: 'Tarjeta débito',
  tarjeta_credito: 'Tarjeta crédito',
}

/** Lo que el personal registra a mano. `factus_pay` se cobra desde el link de la mesa, con QR. */
export const MEDIOS_DEL_PERSONAL = ['efectivo', 'tarjeta_debito', 'tarjeta_credito'] as const satisfies readonly MedioPago[]

export const ESTADO_FACTURA: Record<EstadoFactura, EstadoVisibleMesa> = {
  sin_emitir: { texto: 'Sin factura', tono: 'gris' },
  en_proceso: { texto: 'Factura en proceso', tono: 'ambar', rayado: true },
  en_validacion: { texto: 'La DIAN está validando', tono: 'ambar', rayado: true },
  emitida: { texto: 'Factura emitida', tono: 'verde-suave' },
  rechazada: { texto: 'Factura rechazada', tono: 'rojo' },
}

// La cocina

const POR_PREPARAR: readonly EstadoLinea[] = ['confirmada', 'en_preparacion']

export interface MesaEnCocina {
  token: string
  numeroMesa: number
  /** Cuándo se pidió lo más antiguo que falta en esta mesa. */
  desde: string
  lineas: LineaPedido[]
}

/**
 * Lo que falta por preparar, por mesa y con lo más antiguo primero. Incluye las cuentas ya pagadas:
 * pagar no quita un plato de la cocina. El orden usa `creadaEn` porque el contrato no guarda cuándo se confirmó.
 */
export function colaDeCocina(cuentas: readonly Cuenta[]): MesaEnCocina[] {
  return cuentas
    .filter((cuenta) => cuenta.estado !== 'cerrada')
    .map((cuenta) => {
      const lineas = cuenta.lineas
        .filter((l) => POR_PREPARAR.includes(l.estado))
        .sort((a, b) => a.creadaEn.localeCompare(b.creadaEn) || a.ronda - b.ronda)
      return { token: cuenta.mesaToken, numeroMesa: cuenta.numeroMesa, desde: lineas[0]?.creadaEn ?? '', lineas }
    })
    .filter((mesa) => mesa.lineas.length > 0)
    .sort((a, b) => a.desde.localeCompare(b.desde) || a.numeroMesa - b.numeroMesa)
}

/** "2 por empezar · 1 en preparación · 3 esperando al mesero", para la cabecera de la cocina. */
export function resumenCocina(cuentas: readonly Cuenta[]): string[] {
  const contar = (estado: EstadoLinea) =>
    cuentas.filter((c) => c.estado !== 'cerrada').reduce((suma, c) => suma + unidades(c.lineas, estado), 0)
  const partes: [number, string][] = [
    [contar('confirmada'), 'por empezar'],
    [contar('en_preparacion'), 'en preparación'],
    [contar('lista'), 'esperando al mesero'],
  ]
  return partes.filter(([cantidad]) => cantidad > 0).map(([cantidad, texto]) => `${cantidad} ${texto}`)
}

/** A qué estados puede pasar la cocina una línea: solo `en_preparacion` y `lista`, según el contrato. */
export function avancesDeCocina(linea: LineaPedido): ('en_preparacion' | 'lista')[] {
  return (['en_preparacion', 'lista'] as const).filter((hacia) => puedePasar(TRANSICIONES_LINEA, linea.estado, hacia))
}
