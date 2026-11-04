import { useState } from 'react'
import { usarAvisos } from '../ui/Avisos'

/**
 * Una orden a la vez por pantalla: evita el doble toque y muestra el error sin sacar a nadie de donde está.
 * La pantalla no cambia nada por su cuenta: el resultado llega por la lectura en vivo.
 */
export function usarAccion() {
  const avisos = usarAvisos()
  const [ocupado, setOcupado] = useState<string | null>(null)

  async function ejecutar(clave: string, orden: () => Promise<unknown>, exito?: string) {
    setOcupado(clave)
    try {
      await orden()
      if (exito) avisos.exito(exito)
      return true
    } catch (error) {
      avisos.error(error)
      return false
    } finally {
      setOcupado(null)
    }
  }

  return { ocupado, ejecutar }
}
