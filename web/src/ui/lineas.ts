import type { EstadoLinea, LineaPedido } from '../../../contratos/tipos'

export const ETIQUETA_LINEA: Record<EstadoLinea, string> = {
  pendiente: 'Esperando al mesero',
  confirmada: 'Confirmado',
  en_preparacion: 'En preparación',
  lista: 'Listo para servir',
  entregada: 'Entregado',
  rechazada: 'No se pudo',
  anulada: 'Anulado',
}

/** El camino feliz de una línea. Rechazada y anulada se salen de él. */
export const PASOS_LINEA: readonly EstadoLinea[] = ['pendiente', 'confirmada', 'en_preparacion', 'lista', 'entregada']

/** Cuántos pasos del camino lleva la línea: 1 recién pedida, 5 entregada, 0 si se cayó. */
export const avanceLinea = (estado: EstadoLinea) => PASOS_LINEA.indexOf(estado) + 1

export interface Ronda {
  numero: number
  lineas: LineaPedido[]
  creadaEn: string
}

/** La ronda más reciente primero: es la que el cliente está esperando. */
export function agruparPorRonda(lineas: readonly LineaPedido[]): Ronda[] {
  const rondas = new Map<number, LineaPedido[]>()
  for (const linea of lineas) rondas.set(linea.ronda, [...(rondas.get(linea.ronda) ?? []), linea])
  return [...rondas]
    .map(([numero, deRonda]) => ({ numero, lineas: deRonda, creadaEn: deRonda[0]?.creadaEn ?? '' }))
    .sort((a, b) => b.numero - a.numero)
}

/** "2 por confirmar · 3 en cocina · 1 listo", para el resumen de arriba. */
export function resumenLineas(lineas: readonly LineaPedido[]): string[] {
  const contar = (estados: EstadoLinea[]) =>
    lineas.filter((l) => estados.includes(l.estado)).reduce((suma, l) => suma + l.cantidad, 0)
  const partes: [number, string][] = [
    [contar(['pendiente']), 'por confirmar'],
    [contar(['confirmada', 'en_preparacion']), 'en cocina'],
    [contar(['lista']), 'para servir'],
    [contar(['entregada']), 'en la mesa'],
  ]
  return partes.filter(([cantidad]) => cantidad > 0).map(([cantidad, texto]) => `${cantidad} ${texto}`)
}
