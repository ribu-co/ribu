// Un enrutador mínimo: la web solo tiene cinco rutas y no vale la pena otra dependencia.

import { useSyncExternalStore } from 'react'

const EVENTO = 'ribu:navegar'

export function navegar(ruta: string, { reemplazar = false } = {}) {
  if (reemplazar) history.replaceState(null, '', ruta)
  else history.pushState(null, '', ruta)
  window.dispatchEvent(new Event(EVENTO))
  window.scrollTo({ top: 0 })
}

function suscribir(aviso: () => void) {
  window.addEventListener('popstate', aviso)
  window.addEventListener(EVENTO, aviso)
  return () => {
    window.removeEventListener('popstate', aviso)
    window.removeEventListener(EVENTO, aviso)
  }
}

export const usarRuta = () =>
  useSyncExternalStore(
    suscribir,
    // `/mesero/` y `/mesero` son la misma página.
    () => location.pathname.replace(/\/+$/, '') || '/',
    () => '/',
  )

/** coincidir('/m/:token', '/m/abc') → { token: 'abc' } */
export function coincidir(patron: string, ruta: string): Record<string, string> | null {
  const partes = patron.split('/').filter(Boolean)
  const valores = ruta.split('/').filter(Boolean)
  if (partes.length !== valores.length) return null
  const parametros: Record<string, string> = {}
  for (const [i, parte] of partes.entries()) {
    const valor = valores[i] as string
    if (parte.startsWith(':')) parametros[parte.slice(1)] = decodeURIComponent(valor)
    else if (parte !== valor) return null
  }
  return parametros
}
