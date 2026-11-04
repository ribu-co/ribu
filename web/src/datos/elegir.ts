// Qué fuente de datos usa la web, según VITE_FUENTE en web/.env. Cada una se importa aparte para que
// la build con Firebase no lleve la versión en memoria, sus claves de demo ni el simulador.

import QRCode from 'qrcode'
import { ErrorDatos, type FuenteDatos } from './fuente'

export const FUENTES = ['memoria', 'firebase'] as const
export type NombreFuente = (typeof FUENTES)[number]

export function nombreFuente(valor: string | undefined): NombreFuente {
  if (valor === undefined || valor === '') return 'memoria'
  if ((FUENTES as readonly string[]).includes(valor)) return valor as NombreFuente
  throw new Error(`VITE_FUENTE debe ser ${FUENTES.join(' o ')}, no "${valor}"`)
}

/** La condición usa import.meta.env directo: Vite la reemplaza al compilar y la rama que sobra no se empaca. */
export async function crearFuente(): Promise<FuenteDatos> {
  nombreFuente(import.meta.env.VITE_FUENTE)
  if (import.meta.env.VITE_FUENTE === 'firebase') {
    throw new ErrorDatos('SERVICIO_NO_DISPONIBLE', 'La versión con Firebase todavía no está conectada')
  }
  const [{ crearFuenteMemoria }, { almacenCompartido, almacenSesionDePestana }] = await Promise.all([
    import('./memoria'),
    import('./almacen'),
  ])
  return crearFuenteMemoria({
    almacen: almacenCompartido(),
    almacenSesion: almacenSesionDePestana(),
    dibujarQr: async (texto) => (await QRCode.toDataURL(texto, { margin: 1, width: 480 })).replace(/^data:image\/png;base64,/, ''),
  })
}
