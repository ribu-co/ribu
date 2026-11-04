// Lo que la pantalla de la cuenta decide a partir de `Cuenta`. Los montos ya vienen calculados por
// el backend con calcularTotales; aquí solo se elige qué mostrar.

import { lineaSuma, MONTO_MINIMO_COBRO, PROPINA_SUGERIDA_MAXIMA, propinaValida, repartirPartesIguales, unidadesPorCubrir } from '../../../contratos/reglas'
import type { Cuenta, EnvioCorreo, EstadoFactura, EstadoPago, LineaPedido, ResumenPago } from '../../../contratos/tipos'

export const cobrosActivos = (cuenta: Cuenta) => cuenta.pagos.filter((p) => p.estado === 'esperando_pago')

export const miCobroActivo = (cuenta: Cuenta, uid: string) => cobrosActivos(cuenta).find((p) => p.creadoPor === uid) ?? null

export const cobrosAjenos = (cuenta: Cuenta, uid: string) => cobrosActivos(cuenta).filter((p) => p.creadoPor !== uid)

/**
 * Quien generó un cobro puede irse sin pagar, y su QR sigue reservando la cuenta. Por eso los demás
 * de la mesa también consultan esos cobros: al vencer, lo que cubrían vuelve a quedar por pagar.
 */
export const consultarCobros = (verificar: (pagoId: string) => Promise<unknown>, pagos: readonly Pick<ResumenPago, 'id'>[]) =>
  Promise.allSettled(pagos.map((p) => verificar(p.id)))

/** Todo lo confirmado ya está pagado: la página no ofrece pagar. */
export const todoPagado = (cuenta: Cuenta) => cuenta.consumo > 0 && cuenta.porPagar === 0 && cuenta.enCobro === 0

export const unidadesPorConfirmar = (cuenta: Cuenta) =>
  cuenta.lineas.filter((l) => l.estado === 'pendiente').reduce((suma, l) => suma + l.cantidad, 0)

export function etiquetaPago(pago: Pick<ResumenPago, 'estado' | 'incidencia'>): string {
  if (pago.incidencia === 'pago_duplicado') return 'Pago duplicado'
  const etiquetas: Record<EstadoPago, string> = {
    esperando_pago: 'En cobro',
    pagado: 'Pagado',
    vencido: 'QR vencido',
    cancelado: 'Cancelado',
    fallido: 'Falló',
  }
  return etiquetas[pago.estado]
}

/** Lo que ve quien pagó mientras su factura no está emitida. Nunca suena a error: el pago ya quedó. */
export const FACTURA_EN_CAMINO: Record<Exclude<EstadoFactura, 'emitida'>, string> = {
  sin_emitir: 'Estamos registrando tu pago para emitir la factura.',
  en_proceso: 'Estamos emitiendo tu factura electrónica.',
  en_validacion: 'La DIAN está validando tu factura. Puede tardar unos minutos y se reintenta sola.',
  rechazada: 'La DIAN pidió corregir un dato. El restaurante lo revisa y te llega la factura.',
}

/** Qué decirle a quien pagó sobre el correo de su factura. Un envío fallido nunca se muestra como enviado. */
export function etiquetaCorreo(correo: Pick<EnvioCorreo, 'estado' | 'destino'>): string {
  if (correo.estado === 'enviado') return `Enviada a ${correo.destino}`
  if (correo.estado === 'pendiente') return `Enviándola a ${correo.destino}`
  if (correo.estado === 'fallido') return `No pudimos enviarla a ${correo.destino}. Prueba con otro correo o descarga el PDF.`
  return 'Envíala a tu correo'
}

/** Los porcentajes que se ofrecen como botones. El 0 va aparte, como "Sin propina". */
export const opcionesPropina = (sugeridas: readonly number[]) =>
  [...new Set(sugeridas)].filter((p) => p > 0 && p <= PROPINA_SUGERIDA_MAXIMA).sort((a, b) => a - b)

// Dividir la cuenta

export type EstadoParte = 'libre' | 'en_cobro' | 'pagada'

export interface Parte {
  numero: number
  monto: number
  estado: EstadoParte
  /** El pago que la cubre o la está cobrando. */
  pago: ResumenPago | null
  mia: boolean
}

/**
 * Cómo va cada parte de la división. `Cuenta.pagos` no dice de qué división es cada parte: si se
 * dividió de nuevo, un pago solo cuenta para la parte con su mismo monto.
 */
export function partesDeDivision(cuenta: Cuenta, uid: string): Parte[] {
  const division = cuenta.division
  if (!division) return []
  return division.montos.map((monto, i) => {
    const numero = i + 1
    const deLaParte = cuenta.pagos.filter(
      (p) => p.parte === numero && p.subtotal === monto && p.incidencia === null && (p.estado === 'pagado' || p.estado === 'esperando_pago'),
    )
    const pago = deLaParte.find((p) => p.estado === 'pagado') ?? deLaParte.find((p) => p.estado === 'esperando_pago') ?? null
    return {
      numero,
      monto,
      estado: pago === null ? 'libre' : pago.estado === 'pagado' ? 'pagada' : 'en_cobro',
      pago,
      mia: pago?.creadoPor === uid,
    }
  })
}

/** Con todas sus partes pagadas, la división ya cumplió: lo que se pida después se paga aparte. */
export const divisionTerminada = (partes: readonly Parte[]) => partes.length > 0 && partes.every((p) => p.estado === 'pagada')

/** Lo que la web muestra antes de dividir. Los montos de verdad los calcula el backend. */
export function vistaPreviaPartes(porPagar: number, partes: number) {
  const montos = repartirPartesIguales(porPagar, partes)
  return { montos, alcanza: Math.min(...montos) >= MONTO_MINIMO_COBRO }
}

/** El máximo de partes que deja a cada una en el mínimo de Factus Pay o más. */
export const partesMaximas = (porPagar: number, tope: number) => Math.max(0, Math.min(tope, Math.floor(porPagar / MONTO_MINIMO_COBRO)))

/** Las líneas que todavía se pueden elegir para pagar por productos. */
export const lineasPorElegir = (cuenta: Cuenta) => cuenta.lineas.filter((l) => lineaSuma(l.estado) && unidadesPorCubrir(l) > 0)

/** Unidades que ya cubre otro pago, para mostrarlas en la lista de productos. */
export const unidadesCubiertas = (linea: LineaPedido) => (lineaSuma(linea.estado) ? linea.cantidadCubierta : 0)

export type Eleccion = Record<string, number>

/** Lo que suma la elección, con impuesto. Solo se muestra: el backend lo vuelve a calcular. */
export const subtotalEleccion = (cuenta: Cuenta, eleccion: Eleccion) =>
  cuenta.lineas.reduce((suma, l) => suma + l.precio * Math.min(eleccion[l.id] ?? 0, unidadesPorCubrir(l)), 0)

export const itemsEleccion = (eleccion: Eleccion) =>
  Object.entries(eleccion)
    .filter(([, cantidad]) => cantidad > 0)
    .map(([lineaId, cantidad]) => ({ lineaId, cantidad }))

/** Lo que escribió en "Otro": un entero de 0 a 100, o null si todavía no es válido. */
export function leerPorcentaje(texto: string): number | null {
  if (!/^\d{1,3}$/.test(texto.trim())) return null
  const valor = Number(texto)
  return propinaValida(valor) ? valor : null
}
