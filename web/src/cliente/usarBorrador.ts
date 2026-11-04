import { useEffect, useState } from 'react'
import type { Borrador } from './borrador'

interface Guardado {
  /** La cuenta en la que se armó. Si la mesa se libera, el borrador ya no es de nadie. */
  cuentaId: string | null
  items: Borrador
}

const almacen = () => (typeof sessionStorage === 'undefined' ? null : sessionStorage)

function leer(clave: string): Guardado | null {
  try {
    const texto = almacen()?.getItem(clave)
    return texto ? (JSON.parse(texto) as Guardado) : null
  } catch {
    return null
  }
}

/** Lo que se va a pedir sobrevive a recargar la página o a ir a otra app y volver. */
export function usarBorrador(token: string, cuentaId: string | null) {
  const clave = `ribu:borrador:${token}`
  const [guardado, setGuardado] = useState<Guardado>(() => leer(clave) ?? { cuentaId, items: [] })

  useEffect(() => {
    setGuardado((actual) => {
      if (actual.cuentaId === cuentaId) return actual
      if (actual.cuentaId === null) return { ...actual, cuentaId }
      return { cuentaId, items: [] }
    })
  }, [cuentaId])

  useEffect(() => {
    almacen()?.setItem(clave, JSON.stringify(guardado))
  }, [clave, guardado])

  const cambiar = (cambio: (items: Borrador) => Borrador) => setGuardado((actual) => ({ ...actual, items: cambio(actual.items) }))
  return [guardado.items, cambiar] as const
}
