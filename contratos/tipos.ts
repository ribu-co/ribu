// Formatos compartidos de Ribu. Solo los cambia Integración; los demás lo piden por PR.
// Las órdenes están en openapi.yaml, las reglas en reglas.ts y el resumen en README.md.

/** Fecha ISO 8601 en UTC. */
export type Fecha = string
/** Pesos colombianos enteros. Incluyen impuesto, salvo que el nombre diga lo contrario. */
export type Pesos = number

export const ROLES = ['cliente', 'mesero', 'cocina', 'admin', 'plataforma'] as const
export type Rol = (typeof ROLES)[number]

/** Lo que puede tener el personal de un restaurante. `plataforma` es de quien administra Ribu. */
export const ROLES_PERSONAL = ['mesero', 'cocina', 'admin'] as const
export type RolPersonal = (typeof ROLES_PERSONAL)[number]

// Restaurante y carta

export const TIPOS_IMPUESTO = ['INC', 'IVA', 'ninguno'] as const
export type TipoImpuesto = (typeof TIPOS_IMPUESTO)[number]

export interface Impuesto {
  tipo: TipoImpuesto
  /** 8 para INC, 19 para IVA y 0 para `ninguno`. */
  porcentaje: number
}

export interface Restaurante {
  id: string
  nombre: string
  /** Aplica a todo el consumo del restaurante. */
  impuesto: Impuesto
  /** Porcentajes que se ofrecen al pagar. Ninguno supera PROPINA_SUGERIDA_MAXIMA. */
  propinasSugeridas: number[]
  /** Un restaurante inactivo no recibe pedidos ni pagos, pero conserva su historia. */
  activo: boolean
}

export interface NuevoRestaurante {
  nombre: string
  impuesto: Impuesto
  propinasSugeridas: number[]
  /** Cuántas mesas crear, numeradas desde 1. */
  mesas: number
}

export type CambiosRestaurante = Partial<Pick<Restaurante, 'nombre' | 'impuesto' | 'propinasSugeridas' | 'activo'>>

export interface RestauranteCreado {
  restaurante: Restaurante
  mesas: Mesa[]
}

/** Una cuenta del personal. La clave y los claims viven en Firebase Authentication. */
export interface Personal {
  uid: string
  restauranteId: string
  correo: string
  nombre: string
  rol: RolPersonal
  /** Sin acceso cuando es false; no se borra para conservar la historia. */
  activo: boolean
  creadoEn: Fecha
}

export interface NuevoPersonal {
  correo: string
  nombre: string
  rol: RolPersonal
  clave: string
}

export interface CambiosPersonal {
  nombre?: string
  rol?: RolPersonal
  activo?: boolean
  clave?: string
}

export interface Producto {
  id: string
  restauranteId: string
  nombre: string
  descripcion: string | null
  categoria: string
  /** Precio de carta, con impuesto incluido. */
  precio: Pesos
  /** Unidades que quedan; null si no se lleva conteo. Baja cuando se confirma el pedido. */
  stock: number | null
  /** Es el botón de "agotado". Pasa a false solo cuando `stock` llega a 0. */
  disponible: boolean
  imagenUrl: string | null
}

export type NuevoProducto = Omit<Producto, 'id' | 'restauranteId'>
export type CambiosProducto = Partial<NuevoProducto>

// Mesa y pedido

export const ESTADOS_MESA = ['libre', 'ocupada'] as const
export type EstadoMesa = (typeof ESTADOS_MESA)[number]

export interface Mesa {
  /** Id del documento y parte fija del link del sticker. No se puede adivinar. */
  token: string
  restauranteId: string
  numero: number
  estado: EstadoMesa
  /** La cuenta que muestra el link. Es null solo cuando la mesa está libre. */
  cuentaId: string | null
}

export const ESTADOS_LINEA = [
  'pendiente',
  'confirmada',
  'en_preparacion',
  'lista',
  'entregada',
  'rechazada',
  'anulada',
] as const
export type EstadoLinea = (typeof ESTADOS_LINEA)[number]

export const ORIGENES_LINEA = ['cliente', 'personal'] as const
export type OrigenLinea = (typeof ORIGENES_LINEA)[number]

export interface LineaPedido {
  id: string
  productoId: string
  /** Copiado del producto al pedir: cambiar la carta no altera la cuenta. */
  nombre: string
  /** Copiado del producto al pedir: cambiar la carta no altera la cuenta. */
  precio: Pesos
  cantidad: number
  nota: string | null
  /** Agrupa lo que se pidió junto, para la cocina. */
  ronda: number
  estado: EstadoLinea
  origen: OrigenLinea
  /** Por qué se rechazó o se anuló. */
  motivo: string | null
  /** Unidades que ya están en un cobro activo, en un pago hecho o en una división. */
  cantidadCubierta: number
  creadaEn: Fecha
}

export const ESTADOS_CUENTA = ['abierta', 'pagada', 'cerrada'] as const
export type EstadoCuenta = (typeof ESTADOS_CUENTA)[number]

/** La cuenta repartida en partes iguales. La división por productos no necesita este dato. */
export interface DivisionPartesIguales {
  partes: number
  /** montos[0] es la parte 1. Suman lo que faltaba por pagar al dividir. */
  montos: Pesos[]
}

export interface Cuenta {
  id: string
  restauranteId: string
  mesaToken: string
  numeroMesa: number
  estado: EstadoCuenta
  lineas: LineaPedido[]
  division: DivisionPartesIguales | null
  pagos: ResumenPago[]
  /** Lo confirmado, sin propina. */
  consumo: Pesos
  /** Lo que cubren los pagos hechos, sin propina. */
  pagado: Pesos
  /** Lo que cubren los cobros activos, sin propina. */
  enCobro: Pesos
  /** consumo - pagado - enCobro. */
  porPagar: Pesos
  abiertaEn: Fecha
  cerradaEn: Fecha | null
}

// Pago

export const MEDIOS_PAGO = ['factus_pay', 'efectivo', 'tarjeta_debito', 'tarjeta_credito'] as const
export type MedioPago = (typeof MEDIOS_PAGO)[number]

export const ESTADOS_PAGO = ['esperando_pago', 'pagado', 'vencido', 'cancelado', 'fallido'] as const
export type EstadoPago = (typeof ESTADOS_PAGO)[number]

export const INCIDENCIAS_PAGO = ['pago_duplicado'] as const
export type IncidenciaPago = (typeof INCIDENCIAS_PAGO)[number]

export const ESTADOS_COBRO = ['started', 'created', 'ready', 'paid', 'failed', 'rejected', 'desconocido'] as const
/** `desconocido` es cualquier otro estado de Factus Pay: no detiene las consultas. */
export type EstadoCobro = (typeof ESTADOS_COBRO)[number]

export interface Cobro {
  referencia: string
  monto: Pesos
  estado: EstadoCobro
  /** PNG en base64, sin el prefijo `data:`. Puede ser null mientras esté en `started`. */
  qrBase64: string | null
  /** Para pagar desde el mismo celular: se copia y se pega en el banco, con el monto exacto. */
  llaveBreB: string | null
  /** Un QR vencido sigue en `ready`: el vencimiento se mira con esta fecha. */
  qrExpiraEn: Fecha | null
  recaudadoEn: Fecha | null
}

export type DestinoPago =
  /** Todo lo confirmado que ningún pago cubre todavía. */
  | { tipo: 'saldo' }
  /** Solo las unidades elegidas: es la división por productos. */
  | { tipo: 'productos'; items: { lineaId: string; cantidad: number }[] }
  /** Una de las partes de `Cuenta.division`; la parte 1 es montos[0]. */
  | { tipo: 'parte_igual'; parte: number }

export interface ItemPago {
  /** null en una parte igual, que se factura como una sola línea de consumo. */
  lineaId: string | null
  nombre: string
  cantidad: number
  precio: Pesos
}

/** Lo que ve toda la mesa en `Cuenta.pagos`. No lleva datos personales. */
export interface ResumenPago {
  /** También es el `reference_code` del recaudo y de la factura. Máximo 100 caracteres. */
  id: string
  numero: number
  /** La parte que paga, si la cuenta se dividió en partes iguales. */
  parte: number | null
  /** Lo que cubre, con impuesto y sin propina. */
  subtotal: Pesos
  /** subtotal + propina. Es el monto exacto del cobro. */
  total: Pesos
  medio: MedioPago
  estado: EstadoPago
  estadoFactura: EstadoFactura
  incidencia: IncidenciaPago | null
  /** Uid de Firebase de quien lo creó. */
  creadoPor: string
}

export interface Pago extends ResumenPago {
  restauranteId: string
  cuentaId: string
  mesaToken: string
  destino: DestinoPago
  items: ItemPago[]
  /** Copiado del restaurante al crear el pago. */
  impuesto: Impuesto
  /** subtotal sin impuesto, con dos decimales. Es la base de la propina. */
  baseSinImpuesto: number
  propinaPorcentaje: number
  propina: Pesos
  /** null si el personal registró el pago en efectivo o con tarjeta. */
  cobro: Cobro | null
  creadoEn: Fecha
  pagadoEn: Fecha | null
}

// Factura

export const TIPOS_DOCUMENTO = ['CC', 'CE', 'NIT', 'PASAPORTE', 'PPT'] as const
/** En Factus son 13, 22, 31, 41 y 48. */
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

/** Quien sale en la factura. Se elige antes de pagar; la web propone `consumidor_final`. */
export type Comprador =
  | { tipo: 'consumidor_final'; correo: string | null }
  | { tipo: 'persona'; tipoDocumento: TipoDocumento; documento: string; nombre: string; correo: string }
  /** El NIT va sin dígito de verificación: Factus lo calcula. */
  | { tipo: 'empresa'; nit: string; razonSocial: string; correo: string }

export const ESTADOS_FACTURA = ['sin_emitir', 'en_proceso', 'en_validacion', 'emitida', 'rechazada'] as const
/**
 * `sin_emitir`: aún no entra el pago.
 * `en_proceso`: pagado sin factura; se reintenta ante fallos de red, 429 o 409.
 * `en_validacion`: la DIAN no ha respondido; se reintenta con la misma referencia y nunca se elimina.
 * `rechazada`: ya se eliminó de Factus, porque bloquea el rango; espera la corrección del personal.
 */
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number]

export const ESTADOS_CORREO = ['sin_correo', 'pendiente', 'enviado', 'fallido'] as const
export type EstadoCorreo = (typeof ESTADOS_CORREO)[number]

export interface EnvioCorreo {
  estado: EstadoCorreo
  destino: string | null
  ultimoError: string | null
  enviadoEn: Fecha | null
}

export interface DatosFactura {
  numero: string
  cufe: string
  /** Enlace al portal de la DIAN. La web dibuja el QR con este texto. */
  qrUrl: string
  urlPublica: string
}

/** Lo que Factus Pay puede traer en el webhook. No reemplaza a `Comprador`. */
export interface PagadorCobro {
  nombre: string
  tipoDocumento: string
  documento: string
}

/** Documento privado: solo lo leen quien creó el pago y el personal. */
export interface Factura {
  pagoId: string
  restauranteId: string
  /** Uid de Firebase de quien creó el pago. */
  pagadorUid: string
  estado: EstadoFactura
  comprador: Comprador
  /** null hasta que la factura quede `emitida`. */
  datos: DatosFactura | null
  intentos: number
  ultimoError: string | null
  correo: EnvioCorreo
  pagador: PagadorCobro | null
  notas: ResumenNota[]
  emitidaEn: Fecha | null
}

// Notas crédito y débito

export const TIPOS_NOTA = ['credito', 'debito'] as const
export type TipoNota = (typeof TIPOS_NOTA)[number]

export const CONCEPTOS_NOTA_CREDITO = ['devolucion_parcial', 'anulacion', 'rebaja', 'ajuste_precio'] as const
export type ConceptoNotaCredito = (typeof CONCEPTOS_NOTA_CREDITO)[number]

export const CONCEPTOS_NOTA_DEBITO = ['intereses', 'gastos_por_cobrar', 'cambio_valor', 'otros'] as const
export type ConceptoNotaDebito = (typeof CONCEPTOS_NOTA_DEBITO)[number]

export const ESTADOS_DEVOLUCION = ['no_aplica', 'pendiente', 'hecha'] as const
/** Factus Pay no tiene reversos: el restaurante devuelve el dinero por fuera y lo registra aquí. */
export type EstadoDevolucion = (typeof ESTADOS_DEVOLUCION)[number]

export interface DatosNota {
  numero: string
  cude: string
  qrUrl: string
  urlPublica: string
}

export interface ResumenNota {
  /** También es su `reference_code` en Factus y, si se cobra, en Factus Pay. */
  id: string
  tipo: TipoNota
  numero: string | null
  /** El valor que corrige, con impuesto y propina. */
  total: Pesos
  estado: EstadoFactura
}

/** Corrige una factura emitida. Documento privado: solo lo lee el personal. */
export interface Nota extends ResumenNota {
  concepto: ConceptoNotaCredito | ConceptoNotaDebito
  motivo: string
  restauranteId: string
  /** El pago cuya factura corrige. */
  pagoId: string
  /** Lo que Factus llama `bill_number`. */
  numeroFactura: string
  comprador: Comprador
  lineas: LineaFactura[]
  impuesto: Impuesto
  propina: PropinaFactura | null
  medio: MedioPago
  /** Solo en una nota débito con `factus_pay`: la nota se emite cuando entra este cobro. */
  cobro: Cobro | null
  devolucion: EstadoDevolucion
  /** null hasta que la nota quede `emitida`. */
  datos: DatosNota | null
  intentos: number
  ultimoError: string | null
  correo: EnvioCorreo
  /** Uid de Firebase de quien la creó. */
  creadoPor: string
  creadaEn: Fecha
  emitidaEn: Fecha | null
}

// Lo que implementan `cobros/` y `facturacion/`, cada uno con un cliente real y un mock.

export interface SolicitudCobro {
  /** El id del pago. */
  referencia: string
  monto: Pesos
  expiraEnSegundos: number
}

export interface NotificacionCobro {
  referencia: string
  monto: Pesos
  recaudadoEn: Fecha | null
  pagador: PagadorCobro | null
}

export interface ServicioCobros {
  crearCobro(solicitud: SolicitudCobro): Promise<Cobro>
  consultarCobro(referencia: string): Promise<Cobro>
  /** Valida la llave en tiempo constante y lee el cuerpo. Si no coincide, lanza `no_autorizado`. */
  leerWebhook(clave: string | null, cuerpo: unknown): NotificacionCobro
}

export interface LineaFactura {
  codigo: string
  descripcion: string
  cantidad: number
  /** Lo que Factus llama `price`: sin impuesto y con dos decimales. */
  precioSinImpuesto: number
}

/** Va como recargo en `allowance_charges`. */
export interface PropinaFactura {
  base: number
  valor: Pesos
}

export interface SolicitudFactura {
  /** El id del pago. Con una factura validada, Factus devuelve la misma en vez de duplicarla. */
  referencia: string
  comprador: Comprador
  lineas: LineaFactura[]
  impuesto: Impuesto
  propina: PropinaFactura | null
  medio: MedioPago
  /** Lo que pagó el cliente, con impuesto y propina. */
  total: Pesos
}

export interface SolicitudNota extends SolicitudFactura {
  /** El id de la nota. */
  referencia: string
  tipo: TipoNota
  concepto: ConceptoNotaCredito | ConceptoNotaDebito
  /** Lo que Factus llama `observation`. */
  motivo: string
  numeroFactura: string
}

export type ResultadoEmision<Datos> =
  | { estado: 'emitida'; datos: Datos }
  | { estado: 'en_validacion'; detalle: string | null }
  | { estado: 'rechazada'; errores: string[] }

export interface PdfFactura {
  nombreArchivo: string
  base64: string
}

export interface ServicioFacturacion {
  emitirFactura(solicitud: SolicitudFactura): Promise<ResultadoEmision<DatosFactura>>
  /** Solo para facturas rechazadas. Una factura en validación nunca se elimina. */
  eliminarFactura(referencia: string): Promise<void>
  descargarPdf(numero: string): Promise<PdfFactura>
  enviarCorreo(numero: string, correo: string): Promise<void>
  emitirNota(solicitud: SolicitudNota): Promise<ResultadoEmision<DatosNota>>
  /** Solo para notas rechazadas. Una nota en validación nunca se elimina. */
  eliminarNota(tipo: TipoNota, referencia: string): Promise<void>
  descargarPdfNota(tipo: TipoNota, numero: string): Promise<PdfFactura>
  enviarCorreoNota(tipo: TipoNota, numero: string, correo: string): Promise<void>
}

// Cuerpos de la API

export interface ItemNuevo {
  productoId: string
  cantidad: number
  nota: string | null
}

export interface SolicitudLineas {
  items: ItemNuevo[]
}

export interface SolicitudIdsLineas {
  lineaIds: string[]
}

export interface SolicitudMotivoLineas extends SolicitudIdsLineas {
  motivo: string
}

export interface SolicitudEstadoLinea {
  estado: 'en_preparacion' | 'lista' | 'entregada'
}

export interface SolicitudDivision {
  partes: number
}

export interface SolicitudMesas {
  /** Cuántas mesas agregar, con los números siguientes. */
  cantidad: number
}

export interface SolicitudPago {
  destino: DestinoPago
  /** Entero de 0 a 100. Es obligatorio: la propina es voluntaria y nunca se asume. */
  propinaPorcentaje: number
  comprador: Comprador
  /** `efectivo` y las tarjetas solo los registra el personal. */
  medio: MedioPago
}

export interface SolicitudCorreo {
  correo: string
}

export interface SolicitudReintentoFactura {
  /** Los datos corregidos, o null si el error no estaba en el comprador. */
  comprador: Comprador | null
}

export interface LineaNota {
  descripcion: string
  cantidad: number
  /** Con impuesto incluido, como en la carta. */
  precio: Pesos
}

export type SolicitudNotaNueva =
  /** Copia la factura completa, con la propina. */
  | { tipo: 'credito'; concepto: 'anulacion'; motivo: string }
  | {
      tipo: 'credito'
      concepto: Exclude<ConceptoNotaCredito, 'anulacion'>
      motivo: string
      lineas: LineaNota[]
    }
  /** Con `factus_pay` crea un cobro y se emite cuando entra el pago. */
  | { tipo: 'debito'; concepto: ConceptoNotaDebito; motivo: string; lineas: LineaNota[]; medio: MedioPago }

export const CODIGOS_ERROR = [
  'CUERPO_INVALIDO',
  'NO_AUTORIZADO',
  'SIN_PERMISO',
  'NO_ENCONTRADO',
  'PRODUCTO_NO_DISPONIBLE',
  'STOCK_INSUFICIENTE',
  'TRANSICION_INVALIDA',
  'LINEA_CON_PAGO',
  'NADA_POR_PAGAR',
  'CANTIDAD_NO_DISPONIBLE',
  'PARTE_NO_DISPONIBLE',
  'DIVISION_ACTIVA',
  'PAGO_EN_CURSO',
  'MONTO_FUERA_DE_RANGO',
  'PROPINA_INVALIDA',
  'COMPRADOR_INVALIDO',
  'MESA_CON_SALDO',
  'FACTURA_NO_DISPONIBLE',
  'NOTA_INVALIDA',
  'NOTA_EXCEDE_FACTURA',
  'CORREO_EN_USO',
  'RESTAURANTE_INACTIVO',
  'SERVICIO_NO_DISPONIBLE',
] as const
export type CodigoError = (typeof CODIGOS_ERROR)[number]

export interface ErrorApi {
  codigo: CodigoError
  mensaje: string
}
