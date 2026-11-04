// Lo que el backend guarda además del contrato. Todo extiende tipos de contratos/tipos.ts, así que
// la web sigue leyendo los mismos formatos.

import type {
  Cuenta,
  DivisionPartesIguales,
  Fecha,
  Pago,
  ResumenPago,
  ServicioCobros,
  ServicioFacturacion,
} from '../contratos/tipos'
import type { ServicioAuth } from './auth'
import type { BaseDatos } from './base-datos'

export interface UnidadesLinea {
  lineaId: string
  cantidad: number
}

/** Una parte igual cubre dinero, no unidades: esto recuerda qué unidades congeló la división. */
export interface DivisionDoc extends DivisionPartesIguales {
  /** Un pago de una división que ya no existe no puede reclamar una parte de otra. */
  id: string
  cubre: UnidadesLinea[]
}

export interface ResumenDoc extends ResumenPago {
  /** La división de la que salió esta parte. null si no es una parte igual. */
  divisionId: string | null
}

export interface CuentaDoc extends Cuenta {
  division: DivisionDoc | null
  pagos: ResumenDoc[]
}

export interface PagoDoc extends Pago {
  divisionId: string | null
}

export type TipoReferencia = 'pago' | 'nota'

/**
 * `referencias/{id}`, solo del backend. Factus Pay tiene una sola URL de webhook para todos los
 * restaurantes, así que la referencia dice de quién es el recaudo. Además guarda la marca de
 * emisión y cuándo hay que volver a intentar, que nadie más debe ver.
 */
export interface Referencia {
  restauranteId: string
  tipo: TipoReferencia
  /** Cuándo vence el cobro. null si no hay un cobro activo. */
  venceEn: Fecha | null
  /** Cuándo volver a intentar la emisión o el correo. null si no falta nada. */
  reintentarEn: Fecha | null
  /** Quién se reservó el documento. Solo ese proceso llama a Factus. */
  reservaDe: string | null
  reservaHasta: Fecha | null
  /** La DIAN lo rechazó, pero falta eliminarlo de Factus: mientras tanto no se reemite. */
  pendienteEliminar: boolean
  intentosCorreo: number
  /** Limita las consultas a una cada CONSULTA_COBRO_SEGUNDOS. */
  consultadoEn: Fecha | null
}

export const COLECCION_REFERENCIAS = 'referencias'
export const rutaReferencia = (id: string) => `${COLECCION_REFERENCIAS}/${id}`

export const referenciaNueva = (restauranteId: string, tipo: TipoReferencia): Referencia => ({
  restauranteId,
  tipo,
  venceEn: null,
  reintentarEn: null,
  reservaDe: null,
  reservaHasta: null,
  pendienteEliminar: false,
  intentosCorreo: 0,
  consultadoEn: null,
})

/** Lo que recibe la lógica desde afuera. Las pruebas ponen mocks; funciones.ts pone lo real. */
export interface Contexto {
  db: BaseDatos
  cobros: ServicioCobros
  facturacion: ServicioFacturacion
  auth: ServicioAuth
  ahora: () => Date
  nuevoId: () => string
}

export const iso = (fecha: Date) => fecha.toISOString()
export const sumarSegundos = (fecha: Date, segundos: number) => new Date(fecha.getTime() + segundos * 1000)
