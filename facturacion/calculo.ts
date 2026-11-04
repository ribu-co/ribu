// Cálculos que comparten el mock y el cliente de Factus, para que los dos validen lo mismo.

import { ErrorIntegracion } from '../contratos/reglas'
import type { SolicitudFactura } from '../contratos/tipos'

/** Factus acepta un `cash_rounding_amount` de máximo 500 pesos, hacia arriba o hacia abajo. */
export const REDONDEO_MAXIMO = 500
export const REFERENCIA_MAXIMA = 100

/** Redondea a centavos sin el error de coma flotante de 1.005 * 100. */
export const dosDecimales = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100

export interface TotalesFactura {
  /** Suma de precio sin impuesto por cantidad. */
  base: number
  impuesto: number
  propina: number
  /** base + impuesto + propina: lo que Factus calcula. */
  calculado: number
  /** Lo que pagó el cliente menos lo calculado. Va en `cash_rounding_amount`. */
  redondeo: number
}

/** Cada línea calcula su impuesto aparte, con dos decimales. */
export function calcularTotales(solicitud: SolicitudFactura): TotalesFactura {
  let base = 0
  let impuesto = 0
  for (const linea of solicitud.lineas) {
    const valor = dosDecimales(linea.precioSinImpuesto * linea.cantidad)
    base += valor
    impuesto += dosDecimales((valor * solicitud.impuesto.porcentaje) / 100)
  }
  const propina = solicitud.propina?.valor ?? 0
  base = dosDecimales(base)
  impuesto = dosDecimales(impuesto)
  const calculado = dosDecimales(base + impuesto + propina)
  return { base, impuesto, propina, calculado, redondeo: dosDecimales(solicitud.total - calculado) }
}

/** Lo que Factus rechazaría con un 422. Se revisa antes de llamar para no gastar el límite. */
export function problemasSolicitud(solicitud: SolicitudFactura): string[] {
  const problemas: string[] = []
  if (solicitud.referencia.length === 0 || solicitud.referencia.length > REFERENCIA_MAXIMA) {
    problemas.push(`La referencia debe tener entre 1 y ${REFERENCIA_MAXIMA} caracteres`)
  }
  if (solicitud.lineas.length === 0) problemas.push('La factura no tiene líneas')
  for (const linea of solicitud.lineas) {
    if (!(linea.cantidad > 0)) problemas.push(`La cantidad de "${linea.descripcion}" debe ser mayor que 0`)
    if (!(linea.precioSinImpuesto >= 0)) problemas.push(`El precio de "${linea.descripcion}" no puede ser negativo`)
  }
  if (solicitud.lineas.length > 0) {
    const { redondeo } = calcularTotales(solicitud)
    if (Math.abs(redondeo) > REDONDEO_MAXIMO) {
      problemas.push(`El total difiere ${redondeo} pesos de lo calculado; el máximo es ${REDONDEO_MAXIMO}`)
    }
  }
  return problemas
}

export function validarSolicitud(solicitud: SolicitudFactura) {
  const problemas = problemasSolicitud(solicitud)
  if (problemas.length > 0) throw new ErrorIntegracion(problemas.join('. '), 'factus', 'validacion')
}
