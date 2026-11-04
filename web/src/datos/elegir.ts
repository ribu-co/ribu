// Qué fuente de datos usa la web. La build de producción siempre usa Firebase. En desarrollo manda
// VITE_FUENTE, y sin ese valor se usa la versión en memoria.

import type { FuenteDatos } from './fuente'

export const FUENTES = ['memoria', 'firebase'] as const
export type NombreFuente = (typeof FUENTES)[number]

export function nombreFuente(valor: string | undefined, produccion = false): NombreFuente {
  if (produccion) return 'firebase'
  if (valor === undefined || valor === '') return 'memoria'
  if ((FUENTES as readonly string[]).includes(valor)) return valor as NombreFuente
  throw new Error(`VITE_FUENTE debe ser ${FUENTES.join(' o ')}, no "${valor}"`)
}

/** Vite reemplaza PROD al compilar: la build elimina esta rama, con la memoria, sus claves de demo y el simulador. */
export async function crearFuente(): Promise<FuenteDatos> {
  if (!import.meta.env.PROD && nombreFuente(import.meta.env.VITE_FUENTE) === 'memoria') {
    const [{ crearFuenteMemoria }, { almacenCompartido, almacenSesionDePestana }, { default: QRCode }] = await Promise.all([
      import('./memoria'),
      import('./almacen'),
      import('qrcode'),
    ])
    return crearFuenteMemoria({
      almacen: almacenCompartido(),
      almacenSesion: almacenSesionDePestana(),
      dibujarQr: async (texto) => (await QRCode.toDataURL(texto, { margin: 1, width: 480 })).replace(/^data:image\/png;base64,/, ''),
    })
  }
  const { crearFuenteFirebase } = await import('./firebase')
  return crearFuenteFirebase()
}
