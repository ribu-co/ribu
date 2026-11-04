// Webhook de Factus Pay: avisa, pero no se le cree. El estado y el monto se confirman con `consultarCobro`.

import { ErrorIntegracion } from '../contratos/reglas'
import type { Cobro } from '../contratos/tipos'
import { fallar } from './errores'
import { rutaReferencia, type Contexto, type Referencia } from './modelo'
import { confirmarCobroNota } from './notas'
import { aplicarCobro } from './pagos'
import { idSeguro } from './validacion'

function leerAviso(ctx: Contexto, clave: string | null, cuerpo: unknown) {
  try {
    return ctx.cobros.leerWebhook(clave, cuerpo)
  } catch (error) {
    if (error instanceof ErrorIntegracion && error.tipo === 'no_autorizado') {
      return fallar('NO_AUTORIZADO', 'La llave del webhook no coincide')
    }
    if (error instanceof ErrorIntegracion) return fallar('CUERPO_INVALIDO', 'El aviso no se entiende')
    throw error
  }
}

/**
 * La llave ya viene validada por `leerWebhook`. Si Factus Pay no contesta la consulta se responde 503, para
 * que repita el aviso. Una referencia desconocida o un cobro sin pagar se responden 200: no hay nada que reintentar.
 */
export async function recibirWebhook(ctx: Contexto, clave: string | null, cuerpo: unknown) {
  const { referencia: id, pagador } = leerAviso(ctx, clave, cuerpo)
  const referencia = idSeguro(id) ? await ctx.db.leer<Referencia>(rutaReferencia(id)) : null
  if (!referencia) {
    console.warn('Webhook con una referencia desconocida')
    return
  }

  let cobro: Cobro
  try {
    cobro = await ctx.cobros.consultarCobro(id)
  } catch (error) {
    if (!(error instanceof ErrorIntegracion)) throw error
    return fallar('SERVICIO_NO_DISPONIBLE', 'No se pudo confirmar el cobro')
  }

  if (referencia.tipo === 'nota') {
    await confirmarCobroNota(ctx, referencia.restauranteId, id, cobro)
    return
  }
  await aplicarCobro(ctx, referencia.restauranteId, id, cobro, pagador)
}
