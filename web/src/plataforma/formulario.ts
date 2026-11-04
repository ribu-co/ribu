// Lo que el panel revisa antes de enviar. El backend vuelve a validar todo.

import { PROPINA_SUGERIDA_MAXIMA, propinaValida, rutas } from '../../../contratos/reglas'
import type { Impuesto, Mesa, NuevoPersonal, TipoImpuesto } from '../../../contratos/tipos'
import { correoValido } from '../datos/comprador'

export const IMPUESTOS: Record<TipoImpuesto, Impuesto & { texto: string }> = {
  INC: { tipo: 'INC', porcentaje: 8, texto: 'INC 8 %' },
  IVA: { tipo: 'IVA', porcentaje: 19, texto: 'IVA 19 %' },
  ninguno: { tipo: 'ninguno', porcentaje: 0, texto: 'Sin impuesto' },
}

export const aImpuesto = ({ tipo, porcentaje }: Impuesto): Impuesto => ({ tipo, porcentaje })

export const PROPINAS_POR_DEFECTO = '5, 8, 10'

/** "5, 8, 10" → [5, 8, 10]. null si algo no es un entero entre 0 y el máximo que se puede sugerir. */
export function leerPropinas(texto: string): number[] | null {
  const partes = texto.split(/[\s,;]+/).filter(Boolean)
  const propinas = partes.map(Number)
  if (propinas.some((p) => !propinaValida(p) || p > PROPINA_SUGERIDA_MAXIMA)) return null
  return [...new Set(propinas)].sort((a, b) => a - b)
}

/** La cantidad de mesas: un entero desde 1. */
export function leerCantidad(texto: string): number | null {
  if (!/^\d{1,4}$/.test(texto.trim())) return null
  const cantidad = Number(texto)
  return cantidad >= 1 ? cantidad : null
}

export const CLAVE_MINIMA = 8

export const personalValido = (datos: Pick<NuevoPersonal, 'correo' | 'nombre' | 'clave'>) =>
  correoValido(datos.correo) && datos.nombre.trim().length > 1 && datos.clave.length >= CLAVE_MINIMA

/** El link del sticker. Es el mismo para el QR y para el NFC. */
export const linkDeMesa = (origen: string, token: string) => `${origen}${rutas.paginaMesa(token)}`

export const listaDeLinks = (origen: string, mesas: readonly Mesa[]) =>
  mesas.map((mesa) => `Mesa ${mesa.numero}: ${linkDeMesa(origen, mesa.token)}`).join('\n')
