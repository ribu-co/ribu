import type { Fecha, Pesos } from '../../../contratos/tipos'

const miles = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

/** $91.800 */
export const pesos = (valor: Pesos) => `${valor < 0 ? '-' : ''}$${miles.format(Math.abs(valor))}`

/** 12:41 p. m. */
export const hora = (fecha: Fecha) =>
  new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' }).format(new Date(fecha))

/** 4:05 */
export function cuentaRegresiva(segundos: number) {
  const s = Math.max(0, Math.floor(segundos))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const plural = (cantidad: number, singular: string, varios = `${singular}s`) =>
  `${cantidad} ${cantidad === 1 ? singular : varios}`
