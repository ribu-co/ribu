// Guarda la versión en memoria en el navegador. Así el cliente y el mesero, en dos pestañas,
// ven los mismos pedidos, como pasaría con Firestore.

import type { Sesion } from './fuente'
import type { Almacen, AlmacenSesion, EstadoMemoria } from './memoria'

const leerJson = <T,>(almacen: Storage, clave: string): T | null => {
  try {
    const texto = almacen.getItem(clave)
    return texto ? (JSON.parse(texto) as T) : null
  } catch {
    return null
  }
}

export function almacenCompartido(clave = 'ribu:memoria:v1', almacen: Storage = localStorage): Almacen {
  return {
    leer: () => leerJson<EstadoMemoria>(almacen, clave),
    guardar: (estado) => almacen.setItem(clave, JSON.stringify(estado)),
    borrar: () => almacen.removeItem(clave),
    alCambiarFuera(aviso) {
      const alGuardar = (evento: StorageEvent) => {
        if (evento.key === clave) aviso()
      }
      window.addEventListener('storage', alGuardar)
      return () => window.removeEventListener('storage', alGuardar)
    },
  }
}

/**
 * La sesión vive en la pestaña: en un mismo navegador una pestaña puede ser el mesero y otra el
 * cliente. Si el mesero abre el link de la mesa desde su panel, sigue siendo el mesero.
 */
export function almacenSesionDePestana(clave = 'ribu:sesion', almacen: Storage = sessionStorage): AlmacenSesion {
  return {
    leer: () => leerJson<Sesion>(almacen, clave),
    guardar: (sesion) => (sesion ? almacen.setItem(clave, JSON.stringify(sesion)) : almacen.removeItem(clave)),
  }
}
