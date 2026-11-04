// Lo que la pantalla de la cuenta decide a partir de `Cuenta`. Los montos ya vienen calculados por
// el backend con calcularTotales; aquí solo se elige qué mostrar.

import { PROPINA_SUGERIDA_MAXIMA, propinaValida } from '../../../contratos/reglas'
import type { Cuenta, EstadoFactura, EstadoPago, ResumenPago } from '../../../contratos/tipos'

export const cobrosActivos = (cuenta: Cuenta) => cuenta.pagos.filter((p) => p.estado === 'esperando_pago')

export const miCobroActivo = (cuenta: Cuenta, uid: string) => cobrosActivos(cuenta).find((p) => p.creadoPor === uid) ?? null

export const cobrosAjenos = (cuenta: Cuenta, uid: string) => cobrosActivos(cuenta).filter((p) => p.creadoPor !== uid)

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

/** Los porcentajes que se ofrecen como botones. El 0 va aparte, como "Sin propina". */
export const opcionesPropina = (sugeridas: readonly number[]) =>
  [...new Set(sugeridas)].filter((p) => p > 0 && p <= PROPINA_SUGERIDA_MAXIMA).sort((a, b) => a - b)

/** Lo que escribió en "Otro": un entero de 0 a 100, o null si todavía no es válido. */
export function leerPorcentaje(texto: string): number | null {
  if (!/^\d{1,3}$/.test(texto.trim())) return null
  const valor = Number(texto)
  return propinaValida(valor) ? valor : null
}
