// Arma lo que se le pide a Factus a partir del pago y de la nota.

import { baseSinImpuesto } from '../contratos/reglas'
import type { Comprador, Factura, Impuesto, LineaFactura, LineaNota, Nota, Pesos, PropinaFactura, SolicitudFactura, SolicitudNota } from '../contratos/tipos'
import type { PagoDoc } from './modelo'

/** Cada línea va sin impuesto. Una parte igual ya viene como una sola línea "Consumo, parte N de M". */
export const lineasDePago = (pago: PagoDoc): LineaFactura[] =>
  pago.items.map((item) => ({
    codigo: item.lineaId ?? `consumo-${pago.parte}`,
    descripcion: item.nombre,
    cantidad: item.cantidad,
    precioSinImpuesto: baseSinImpuesto(item.precio, pago.impuesto),
  }))

export const propinaDePago = (pago: PagoDoc): PropinaFactura | null =>
  pago.propina > 0 ? { base: pago.baseSinImpuesto, valor: pago.propina } : null

export const solicitudFactura = (pago: PagoDoc, comprador: Factura['comprador']): SolicitudFactura => ({
  referencia: pago.id,
  comprador,
  lineas: lineasDePago(pago),
  impuesto: pago.impuesto,
  propina: propinaDePago(pago),
  medio: pago.medio,
  total: pago.total,
})

export const solicitudNota = (nota: Nota): SolicitudNota => ({
  referencia: nota.id,
  tipo: nota.tipo,
  concepto: nota.concepto,
  motivo: nota.motivo,
  numeroFactura: nota.numeroFactura,
  comprador: nota.comprador,
  lineas: nota.lineas,
  impuesto: nota.impuesto,
  propina: nota.propina,
  medio: nota.medio,
  total: nota.total,
})

export const lineasDeNota = (lineas: readonly LineaNota[], impuesto: Impuesto): LineaFactura[] =>
  lineas.map((linea, i) => ({
    codigo: `nota-${i + 1}`,
    descripcion: linea.descripcion,
    cantidad: linea.cantidad,
    precioSinImpuesto: baseSinImpuesto(linea.precio, impuesto),
  }))

export const totalDeNota = (lineas: readonly LineaNota[]): Pesos =>
  lineas.reduce((suma, linea) => suma + linea.precio * linea.cantidad, 0)

export const correoDe = (comprador: Comprador): string | null => comprador.correo
