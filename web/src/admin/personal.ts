// `FuenteDatos` de main todavía no declara las operaciones de personal, aunque openapi.yaml sí las define.
// Mientras llegan, la sección las pide aquí: si la fuente no las trae, muestra que no está conectada
// en vez de fallar. Cuando la fuente las declare, esta función sigue sirviendo sin tocar la pantalla.

import type { CambiosPersonal, NuevoPersonal, Personal } from '../../../contratos/tipos'
import type { AlCambiar, AlFallar, Cancelar, FuenteDatos } from '../datos/fuente'

export interface OperacionesPersonal {
  escucharPersonal(restauranteId: string, alCambiar: AlCambiar<Personal[]>, alFallar: AlFallar): Cancelar
  crearPersonal(restauranteId: string, personal: NuevoPersonal): Promise<Personal>
  actualizarPersonal(restauranteId: string, uid: string, cambios: CambiosPersonal): Promise<Personal>
}

export function operacionesPersonal(fuente: FuenteDatos): OperacionesPersonal | null {
  const conPersonal = fuente as FuenteDatos & Partial<OperacionesPersonal>
  const { escucharPersonal, crearPersonal, actualizarPersonal } = conPersonal
  if (!escucharPersonal || !crearPersonal || !actualizarPersonal) return null
  return {
    escucharPersonal: (...args) => escucharPersonal.apply(conPersonal, args),
    crearPersonal: (...args) => crearPersonal.apply(conPersonal, args),
    actualizarPersonal: (...args) => actualizarPersonal.apply(conPersonal, args),
  }
}

/** Primero quien tiene acceso; dentro de cada grupo, por nombre. */
export const ordenarPersonal = (personal: readonly Personal[]) =>
  [...personal].sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, 'es'))
