import { useEffect, useRef, useState } from 'react'
import { CONSULTA_COBRO_SEGUNDOS } from '../../../contratos/reglas'
import type { Fecha } from '../../../contratos/tipos'

/**
 * Respaldo del webhook: mientras se muestra un cobro activo, consulta cada CONSULTA_COBRO_SEGUNDOS.
 * Al volver del banco (la pestaña vuelve a estar visible) consulta en el acto, sin esperar el turno.
 */
export function usarConsultaCobro(activo: boolean, consultar: () => Promise<unknown>) {
  const ultima = useRef(consultar)
  ultima.current = consultar

  useEffect(() => {
    if (!activo) return
    const revisar = () => {
      if (document.visibilityState === 'visible') void ultima.current().catch(() => {})
    }
    revisar()
    const intervalo = setInterval(revisar, CONSULTA_COBRO_SEGUNDOS * 1000)
    document.addEventListener('visibilitychange', revisar)
    window.addEventListener('focus', revisar)
    return () => {
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', revisar)
      window.removeEventListener('focus', revisar)
    }
  }, [activo])
}

/** Segundos que le quedan al QR. Se actualiza cada segundo. */
export function usarSegundosRestantes(hasta: Fecha | null): number | null {
  const calcular = () => (hasta ? Math.max(0, (new Date(hasta).getTime() - Date.now()) / 1000) : null)
  const [segundos, setSegundos] = useState(calcular)
  useEffect(() => {
    setSegundos(calcular())
    if (!hasta) return
    const reloj = setInterval(() => setSegundos(calcular()), 1000)
    return () => clearInterval(reloj)
  }, [hasta])
  return segundos
}
