// Reglas que comparten el backend y la web, para que el precio que se muestra sea el que se cobra.

import type {
  CodigoError,
  ConceptoNotaCredito,
  ConceptoNotaDebito,
  Cuenta,
  EstadoCuenta,
  EstadoFactura,
  EstadoLinea,
  EstadoPago,
  Impuesto,
  LineaPedido,
  Pesos,
  ResumenNota,
  ResumenPago,
  TipoNota,
} from './tipos'

// Probado en el sandbox: la documentación dice 1.000 a 12.100.000, pero la API responde 422 fuera de este rango.
export const MONTO_MINIMO_COBRO = 10_000
export const MONTO_MAXIMO_COBRO = 12_000_000
export const COBRO_EXPIRACION_SEGUNDOS = 600
/** Respaldo del webhook: cada cuánto consulta la web mientras muestra un cobro activo. */
export const CONSULTA_COBRO_SEGUNDOS = 5
/** Lo máximo que se puede sugerir, según la SIC. El cliente sí puede elegir otro porcentaje. */
export const PROPINA_SUGERIDA_MAXIMA = 10
export const PARTES_MINIMAS = 2
export const PARTES_MAXIMAS = 20

export const TRANSICIONES_LINEA: Record<EstadoLinea, readonly EstadoLinea[]> = {
  pendiente: ['confirmada', 'rechazada'],
  confirmada: ['en_preparacion', 'lista', 'anulada'],
  en_preparacion: ['lista', 'anulada'],
  lista: ['entregada', 'anulada'],
  entregada: ['anulada'],
  rechazada: [],
  anulada: [],
}

export const TRANSICIONES_CUENTA: Record<EstadoCuenta, readonly EstadoCuenta[]> = {
  abierta: ['pagada', 'cerrada'],
  // Si piden algo más después de pagar, la misma cuenta vuelve a tener saldo.
  pagada: ['abierta', 'cerrada'],
  cerrada: [],
}

// Un pago vencido, cancelado o fallido aún puede terminar pagado: la plata entró y no hay reversos.
export const TRANSICIONES_PAGO: Record<EstadoPago, readonly EstadoPago[]> = {
  esperando_pago: ['pagado', 'vencido', 'cancelado', 'fallido'],
  vencido: ['pagado'],
  cancelado: ['pagado'],
  fallido: ['pagado'],
  pagado: [],
}

// También aplica a las notas crédito y débito.
export const TRANSICIONES_FACTURA: Record<EstadoFactura, readonly EstadoFactura[]> = {
  sin_emitir: ['en_proceso'],
  en_proceso: ['en_validacion', 'emitida', 'rechazada'],
  en_validacion: ['emitida', 'rechazada'],
  rechazada: ['en_proceso'],
  emitida: [],
}

export function puedePasar<E extends string>(mapa: Record<E, readonly E[]>, desde: E, hacia: E) {
  return mapa[desde].includes(hacia)
}

const ESTADOS_QUE_SUMAN: readonly EstadoLinea[] = ['confirmada', 'en_preparacion', 'lista', 'entregada']

/** Solo lo confirmado por el mesero entra a la cuenta y se puede pagar. */
export const lineaSuma = (estado: EstadoLinea) => ESTADOS_QUE_SUMAN.includes(estado)

export const unidadesPorCubrir = (linea: LineaPedido) =>
  lineaSuma(linea.estado) ? linea.cantidad - linea.cantidadCubierta : 0

const dosDecimales = (valor: number) => Math.round(valor * 100) / 100

/** Factus pide el precio sin impuesto y la carta lo muestra con impuesto. */
export function baseSinImpuesto(precioFinal: Pesos, impuesto: Impuesto) {
  return dosDecimales(precioFinal / (1 + impuesto.porcentaje / 100))
}

export const propinaValida = (porcentaje: number) =>
  Number.isInteger(porcentaje) && porcentaje >= 0 && porcentaje <= 100

/** La base excluye impuestos. POR CONFIRMAR con un contador: el texto de la SIC sobre la base. */
export function calcularPropina(subtotal: Pesos, impuesto: Impuesto, porcentaje: number): Pesos {
  return Math.round((baseSinImpuesto(subtotal, impuesto) * porcentaje) / 100)
}

/** Los pesos que sobran van a las primeras partes: las partes suman exactamente el total. */
export function repartirPartesIguales(total: Pesos, partes: number): Pesos[] {
  if (!Number.isInteger(partes) || partes < PARTES_MINIMAS || partes > PARTES_MAXIMAS) {
    throw new RangeError(`La cuenta se divide entre ${PARTES_MINIMAS} y ${PARTES_MAXIMAS} partes`)
  }
  const parte = Math.floor(total / partes)
  const sobrante = total - parte * partes
  return Array.from({ length: partes }, (_, i) => (i < sobrante ? parte + 1 : parte))
}

export function calcularTotales(lineas: readonly LineaPedido[], pagos: readonly ResumenPago[]) {
  const consumo = lineas
    .filter((linea) => lineaSuma(linea.estado))
    .reduce((suma, linea) => suma + linea.precio * linea.cantidad, 0)
  const sumarPagos = (estado: EstadoPago) =>
    pagos
      .filter((pago) => pago.estado === estado && pago.incidencia === null)
      .reduce((suma, pago) => suma + pago.subtotal, 0)
  const pagado = sumarPagos('pagado')
  const enCobro = sumarPagos('esperando_pago')
  return { consumo, pagado, enCobro, porPagar: Math.max(consumo - pagado - enCobro, 0) }
}

/** La mesa solo la libera el mesero, sin pedidos por confirmar, cobros activos ni saldo. */
export function puedeLiberarMesa(cuenta: Pick<Cuenta, 'lineas' | 'enCobro' | 'porPagar'>) {
  return (
    cuenta.enCobro === 0 &&
    cuenta.porPagar === 0 &&
    cuenta.lineas.every((linea) => linea.estado !== 'pendiente')
  )
}

/** Lo que Factus llama `correction_concept_code`. */
export const CODIGO_CORRECCION_NOTA_CREDITO: Record<ConceptoNotaCredito, string> = {
  devolucion_parcial: '1',
  anulacion: '2',
  rebaja: '3',
  ajuste_precio: '4',
}

export const CODIGO_CORRECCION_NOTA_DEBITO: Record<ConceptoNotaDebito, string> = {
  intereses: '1',
  gastos_por_cobrar: '2',
  cambio_valor: '3',
  otros: '4',
}

/** Lo que todavía se puede acreditar de una factura. Una nota débito emitida sube ese valor. */
export function saldoAcreditable(totalFactura: Pesos, notas: readonly ResumenNota[]): Pesos {
  const sumar = (tipo: TipoNota, cuenta: (estado: EstadoFactura) => boolean) =>
    notas
      .filter((nota) => nota.tipo === tipo && cuenta(nota.estado))
      .reduce((suma, nota) => suma + nota.total, 0)
  const creditos = sumar('credito', (estado) => estado !== 'rechazada')
  const debitos = sumar('debito', (estado) => estado === 'emitida')
  return Math.max(totalFactura + debitos - creditos, 0)
}

export const ESTADO_HTTP_POR_ERROR: Record<CodigoError, number> = {
  CUERPO_INVALIDO: 400,
  NO_AUTORIZADO: 401,
  SIN_PERMISO: 403,
  NO_ENCONTRADO: 404,
  PRODUCTO_NO_DISPONIBLE: 409,
  STOCK_INSUFICIENTE: 409,
  TRANSICION_INVALIDA: 409,
  LINEA_CON_PAGO: 409,
  NADA_POR_PAGAR: 409,
  CANTIDAD_NO_DISPONIBLE: 409,
  PARTE_NO_DISPONIBLE: 409,
  DIVISION_ACTIVA: 409,
  PAGO_EN_CURSO: 409,
  MESA_CON_SALDO: 409,
  FACTURA_NO_DISPONIBLE: 409,
  NOTA_EXCEDE_FACTURA: 409,
  MONTO_FUERA_DE_RANGO: 422,
  PROPINA_INVALIDA: 422,
  COMPRADOR_INVALIDO: 422,
  NOTA_INVALIDA: 422,
  SERVICIO_NO_DISPONIBLE: 503,
}

export type TipoErrorIntegracion = 'red' | 'limite' | 'conflicto' | 'servidor' | 'no_autorizado' | 'validacion'

const ERRORES_REINTENTABLES: readonly TipoErrorIntegracion[] = ['red', 'limite', 'conflicto', 'servidor']

/** Lo que lanzan `cobros/` y `facturacion/` cuando falla Factus Pay o Factus. */
export class ErrorIntegracion extends Error {
  constructor(
    mensaje: string,
    readonly servicio: 'factus' | 'factus_pay',
    readonly tipo: TipoErrorIntegracion,
    readonly status?: number,
    /** El `Retry-After` de un 429. */
    readonly esperarSegundos?: number,
  ) {
    super(mensaje)
    this.name = 'ErrorIntegracion'
  }

  get reintentable() {
    return ERRORES_REINTENTABLES.includes(this.tipo)
  }
}

export const rutas = {
  paginaMesa: (token: string) => `/m/${token}`,
  mesas: 'mesas',
  restaurantes: 'restaurantes',
  productos: (restauranteId: string) => `restaurantes/${restauranteId}/productos`,
  cuentas: (restauranteId: string) => `restaurantes/${restauranteId}/cuentas`,
  pagos: (restauranteId: string) => `restaurantes/${restauranteId}/pagos`,
  facturas: (restauranteId: string) => `restaurantes/${restauranteId}/facturas`,
  notas: (restauranteId: string) => `restaurantes/${restauranteId}/notas`,
}
