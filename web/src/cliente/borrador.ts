// Lo que el cliente va armando antes de enviar. Vive solo en su celular: nadie más lo ve
// hasta que lo envía, y entonces va sin precios, porque el precio lo pone el backend.

import type { Pesos, Producto, SolicitudLineas } from '../../../contratos/tipos'

export interface ItemBorrador {
  clave: string
  productoId: string
  cantidad: number
  nota: string | null
}

export type Borrador = readonly ItemBorrador[]

const limpiarNota = (nota: string | null) => nota?.trim().replace(/\s+/g, ' ') || null
const claveDe = (productoId: string, nota: string | null) => `${productoId}|${nota ?? ''}`

/** El mismo producto con la misma nota se suma; con otra nota va aparte, para que la cocina lo vea. */
export function agregar(borrador: Borrador, productoId: string, cantidad: number, nota: string | null): Borrador {
  const limpia = limpiarNota(nota)
  const clave = claveDe(productoId, limpia)
  if (borrador.some((item) => item.clave === clave)) {
    return borrador.map((item) => (item.clave === clave ? { ...item, cantidad: item.cantidad + cantidad } : item))
  }
  return [...borrador, { clave, productoId, cantidad, nota: limpia }]
}

export function cambiarCantidad(borrador: Borrador, clave: string, cantidad: number): Borrador {
  if (cantidad <= 0) return borrador.filter((item) => item.clave !== clave)
  return borrador.map((item) => (item.clave === clave ? { ...item, cantidad } : item))
}

export const unidades = (borrador: Borrador) => borrador.reduce((suma, item) => suma + item.cantidad, 0)

export const unidadesDe = (borrador: Borrador, productoId: string) =>
  borrador.filter((item) => item.productoId === productoId).reduce((suma, item) => suma + item.cantidad, 0)

/** Solo para mostrar. El total real lo calcula el backend con el precio de la carta. */
export function totalEstimado(borrador: Borrador, productos: readonly Producto[]): Pesos {
  return borrador.reduce((suma, item) => {
    const producto = productos.find((p) => p.id === item.productoId)
    return suma + (producto ? producto.precio * item.cantidad : 0)
  }, 0)
}

/** Saca lo que se agotó o salió de la carta mientras el cliente decidía. */
export function quitarNoDisponibles(borrador: Borrador, productos: readonly Producto[]) {
  const disponibles = new Set(productos.filter((p) => p.disponible).map((p) => p.id))
  const quedan = borrador.filter((item) => disponibles.has(item.productoId))
  const quitados = borrador
    .filter((item) => !disponibles.has(item.productoId))
    .map((item) => productos.find((p) => p.id === item.productoId)?.nombre ?? 'Un producto')
  return { borrador: quedan, quitados }
}

export const aSolicitud = (borrador: Borrador): SolicitudLineas => ({
  items: borrador.map(({ productoId, cantidad, nota }) => ({ productoId, cantidad, nota })),
})
