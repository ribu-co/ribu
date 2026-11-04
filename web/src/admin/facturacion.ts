// Junta cada pago con su factura y sus notas, para la sección de facturas.

import type { Factura, Mesa, Nota, Pago } from '../../../contratos/tipos'

export interface FilaFactura {
  pago: Pago
  factura: Factura | null
  notas: Nota[]
  /** null si la mesa ya no existe. */
  numeroMesa: number | null
}

/** Solo los pagos que entraron: lo que sigue en cobro o venció todavía no tiene nada que facturar. */
export function armarFilas(pagos: readonly Pago[], facturas: readonly Factura[], notas: readonly Nota[], mesas: readonly Mesa[]): FilaFactura[] {
  const facturaDe = new Map(facturas.map((factura) => [factura.pagoId, factura]))
  const numeroDe = new Map(mesas.map((mesa) => [mesa.token, mesa.numero]))
  return pagos
    .filter((pago) => pago.estado === 'pagado')
    .map((pago) => ({
      pago,
      factura: facturaDe.get(pago.id) ?? null,
      notas: notas.filter((nota) => nota.pagoId === pago.id),
      numeroMesa: numeroDe.get(pago.mesaToken) ?? null,
    }))
    .sort((a, b) => (b.pago.pagadoEn ?? b.pago.creadoEn).localeCompare(a.pago.pagadoEn ?? a.pago.creadoEn))
}

/** Algo que todavía le toca a alguien: una factura sin emitir, una nota por resolver o plata por devolver. */
export function porResolver({ pago, factura, notas }: FilaFactura) {
  if (pago.incidencia !== null) return true
  if (factura && factura.estado !== 'emitida') return true
  return notas.some((nota) => nota.estado !== 'emitida' || nota.devolucion === 'pendiente')
}

/** Un QR vencido sigue en `ready`: el vencimiento se mira con la fecha, no con el estado. */
export const cobroVencido = (qrExpiraEn: string | null, ahora: Date) => qrExpiraEn !== null && new Date(qrExpiraEn).getTime() <= ahora.getTime()
