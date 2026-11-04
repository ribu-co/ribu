import { useState } from 'react'

const almacen = () => (typeof sessionStorage === 'undefined' ? null : sessionStorage)

/** El pago que la persona está siguiendo. Sobrevive a ir al banco y volver, aunque el navegador recargue. */
export function usarPagoAbierto(token: string) {
  const clave = `ribu:pago:${token}`
  const [pagoId, setPagoId] = useState<string | null>(() => almacen()?.getItem(clave) ?? null)
  const cambiar = (nuevo: string | null) => {
    if (nuevo) almacen()?.setItem(clave, nuevo)
    else almacen()?.removeItem(clave)
    setPagoId(nuevo)
  }
  return [pagoId, cambiar] as const
}
