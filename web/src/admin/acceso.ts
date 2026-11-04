// Quién entra a /admin y qué le ofrece la pantalla. La pantalla solo ofrece lo que el backend va a aceptar;
// quien de verdad protege los datos son el backend y las reglas de Firestore.

import type { Rol } from '../../../contratos/tipos'
import type { Sesion } from '../datos/fuente'

export type RolAdmin = 'admin' | 'plataforma'

export type Acceso =
  | { tipo: 'cargando' }
  | { tipo: 'sin_sesion' }
  /** Mesero, cocina o cliente. */
  | { tipo: 'otro_rol' }
  /** Un administrador mirando otro restaurante. */
  | { tipo: 'otro_restaurante' }
  /** La plataforma no es de ningún restaurante: tiene que decir cuál en la ruta. */
  | { tipo: 'falta_restaurante' }
  | { tipo: 'permitido'; rol: RolAdmin; restauranteId: string; uid: string }

/** `restauranteRuta` es el :restauranteId de /admin/:restauranteId, o null en /admin. */
export function decidirAcceso(sesion: Sesion | null | undefined, restauranteRuta: string | null): Acceso {
  if (sesion === undefined) return { tipo: 'cargando' }
  if (sesion === null) return { tipo: 'sin_sesion' }
  if (sesion.rol === 'plataforma') {
    if (!restauranteRuta) return { tipo: 'falta_restaurante' }
    return { tipo: 'permitido', rol: 'plataforma', restauranteId: restauranteRuta, uid: sesion.uid }
  }
  if (sesion.rol !== 'admin' || !sesion.restauranteId) return { tipo: 'otro_rol' }
  if (restauranteRuta && restauranteRuta !== sesion.restauranteId) return { tipo: 'otro_restaurante' }
  return { tipo: 'permitido', rol: 'admin', restauranteId: sesion.restauranteId, uid: sesion.uid }
}

/** Copia de `x-roles` en openapi.yaml, solo de lo que usa esta pantalla. Una prueba la compara con el archivo. */
export const ROLES_POR_ORDEN = {
  crearProducto: ['admin'],
  actualizarProducto: ['mesero', 'cocina', 'admin'],
  borrarProducto: ['admin'],
  crearPersonal: ['plataforma', 'admin'],
  actualizarPersonal: ['plataforma', 'admin'],
  descargarFacturaPdf: ['cliente', 'mesero', 'admin'],
  reintentarFactura: ['mesero', 'admin'],
  crearNota: ['admin'],
  verificarNota: ['admin'],
  reintentarNota: ['admin'],
  marcarDevolucionHecha: ['admin'],
  descargarNotaPdf: ['admin'],
} as const satisfies Record<string, readonly Rol[]>

export type OrdenAdmin = keyof typeof ROLES_POR_ORDEN

export const puede = (rol: RolAdmin, orden: OrdenAdmin) => (ROLES_POR_ORDEN[orden] as readonly Rol[]).includes(rol)
