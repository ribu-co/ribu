import type { Personal } from '../../../contratos/tipos'

/** Primero quien tiene acceso; dentro de cada grupo, por nombre. */
export const ordenarPersonal = (personal: readonly Personal[]) =>
  [...personal].sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, 'es'))
