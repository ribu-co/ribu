import { useEffect, useState } from 'react'

const almacen = () => (typeof sessionStorage === 'undefined' ? null : sessionStorage)

interface PagoGuardado {
  cuentaId: string
  pagoId: string
}

export function leerPagoGuardado(texto: string | null | undefined): PagoGuardado | null {
  if (!texto) return null
  try {
    const dato = JSON.parse(texto) as Partial<PagoGuardado> | null
    return typeof dato?.cuentaId === 'string' && typeof dato.pagoId === 'string' ? { cuentaId: dato.cuentaId, pagoId: dato.pagoId } : null
  } catch {
    return null
  }
}

/** Solo vale en la cuenta donde se abrió: al liberar la mesa, el siguiente cliente no ve nada del anterior. */
export const pagoVigente = (guardado: PagoGuardado | null, cuentaId: string | null) =>
  guardado && guardado.cuentaId === cuentaId ? guardado.pagoId : null

/** El pago que la persona está siguiendo. Sobrevive a ir al banco y volver, aunque el navegador recargue. */
export function usarPagoAbierto(token: string, cuentaId: string | null) {
  const clave = `ribu:pago:${token}`
  const [guardado, setGuardado] = useState<PagoGuardado | null>(() => leerPagoGuardado(almacen()?.getItem(clave)))
  const pagoId = pagoVigente(guardado, cuentaId)

  useEffect(() => {
    if (guardado && pagoId === null) {
      almacen()?.removeItem(clave)
      setGuardado(null)
    }
  }, [guardado, pagoId, clave])

  const cambiar = (nuevo: string | null) => {
    const siguiente = nuevo && cuentaId ? { cuentaId, pagoId: nuevo } : null
    if (siguiente) almacen()?.setItem(clave, JSON.stringify(siguiente))
    else almacen()?.removeItem(clave)
    setGuardado(siguiente)
  }
  return [pagoId, cambiar] as const
}
