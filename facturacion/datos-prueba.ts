// Datos inventados para las pruebas de facturacion/.

import type { SolicitudFactura, SolicitudNota } from '../contratos/tipos'

// Dos bandejas de 25.000 con INC del 8 %, y 10 % de propina sobre la base.
export function solicitudDePrueba(cambios: Partial<SolicitudFactura> = {}): SolicitudFactura {
  return {
    referencia: 'pago-1',
    comprador: { tipo: 'consumidor_final', correo: null },
    lineas: [{ codigo: 'P-1', descripcion: 'Bandeja paisa', cantidad: 2, precioSinImpuesto: 23_148.15 }],
    impuesto: { tipo: 'INC', porcentaje: 8 },
    propina: { base: 46_296.3, valor: 4_630 },
    medio: 'factus_pay',
    total: 54_630,
    ...cambios,
  }
}

export function notaDePrueba(cambios: Partial<SolicitudNota> = {}): SolicitudNota {
  return {
    ...solicitudDePrueba({ referencia: 'nota-1' }),
    tipo: 'credito',
    concepto: 'anulacion',
    motivo: 'El cliente devolvió el pedido',
    numeroFactura: 'SETP990000001',
    ...cambios,
  }
}
