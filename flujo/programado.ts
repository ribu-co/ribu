// Lo que corre cada minuto: vence cobros y reintenta facturas, notas y correos.

import { procesarDocumento } from './documentos'
import { COLECCION_REFERENCIAS, iso, type Contexto, type Referencia } from './modelo'
import { revisarCobroDePago } from './pagos'

/** Factus v2 y Factus Pay permiten 80 llamadas por minuto cada uno, y lo comparte todo el equipo. */
const LIMITE_POR_BARRIDO = 30

export interface ResultadoBarrido {
  cobrosRevisados: number
  documentosRevisados: number
}

export async function barrer(ctx: Contexto): Promise<ResultadoBarrido> {
  const ahora = iso(ctx.ahora())

  const vencidos = await ctx.db.consultar<Referencia>(
    COLECCION_REFERENCIAS,
    { campo: 'venceEn', op: '<=', valor: ahora },
    LIMITE_POR_BARRIDO,
  )
  for (const { id, datos } of vencidos) {
    // Antes de vencerlo se pregunta: puede que ya esté pagado y el aviso se haya perdido.
    await revisarCobroDePago(ctx, datos.restauranteId, id).catch((error: unknown) => {
      console.error('No se pudo revisar un cobro', id, error instanceof Error ? error.message : '')
    })
  }

  const pendientes = await ctx.db.consultar<Referencia>(
    COLECCION_REFERENCIAS,
    { campo: 'reintentarEn', op: '<=', valor: ahora },
    LIMITE_POR_BARRIDO,
  )
  for (const { id, datos } of pendientes) {
    await procesarDocumento(ctx, { tipo: datos.tipo, restauranteId: datos.restauranteId, id }).catch((error: unknown) => {
      console.error('No se pudo procesar un documento', id, error instanceof Error ? error.message : '')
    })
  }

  return { cobrosRevisados: vencidos.length, documentosRevisados: pendientes.length }
}
