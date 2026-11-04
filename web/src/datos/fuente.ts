// Lo que la web necesita del backend: escuchar documentos y dar las órdenes de openapi.yaml.
// Las pantallas solo conocen esta interfaz. La cumplen `firebase.ts` y, para desarrollar sin backend, `memoria.ts`.

import { CODIGOS_ERROR } from '../../../contratos/tipos'
import type {
  CambiosPersonal,
  CambiosProducto,
  CambiosRestaurante,
  CodigoError,
  Cuenta,
  Factura,
  Mesa,
  Nota,
  NuevoPersonal,
  NuevoProducto,
  NuevoRestaurante,
  Pago,
  Personal,
  Producto,
  Restaurante,
  RestauranteCreado,
  Rol,
  SolicitudCorreo,
  SolicitudDivision,
  SolicitudEstadoLinea,
  SolicitudIdsLineas,
  SolicitudLineas,
  SolicitudMesas,
  SolicitudMotivoLineas,
  SolicitudNotaNueva,
  SolicitudPago,
  SolicitudReintentoFactura,
} from '../../../contratos/tipos'

export class ErrorDatos extends Error {
  constructor(
    readonly codigo: CodigoError,
    mensaje: string = codigo,
  ) {
    super(mensaje)
    this.name = 'ErrorDatos'
  }
}

/** Convierte cualquier falla en un `ErrorDatos`, para que la pantalla siempre tenga un código. */
export function comoErrorDatos(error: unknown): ErrorDatos {
  if (error instanceof ErrorDatos) return error
  if (typeof error === 'object' && error !== null && 'codigo' in error) {
    const codigo = (error as { codigo: unknown }).codigo
    if (typeof codigo === 'string' && (CODIGOS_ERROR as readonly string[]).includes(codigo)) {
      return new ErrorDatos(codigo as CodigoError, String((error as { mensaje?: unknown }).mensaje ?? codigo))
    }
  }
  return new ErrorDatos('SERVICIO_NO_DISPONIBLE', error instanceof Error ? error.message : String(error))
}

export interface Sesion {
  uid: string
  rol: Rol
  /** null para el cliente: su restaurante sale de la mesa. */
  restauranteId: string | null
  nombre: string | null
}

export type Cancelar = () => void
export type AlCambiar<T> = (valor: T) => void
export type AlFallar = (error: ErrorDatos) => void

/** Documentos que escucha la web. Cada cambio llega a todos los que miran, como en Firestore. */
export interface Lecturas {
  escucharSesion(alCambiar: AlCambiar<Sesion | null>): Cancelar
  /** null si el link no corresponde a ninguna mesa. */
  escucharMesa(token: string, alCambiar: AlCambiar<Mesa | null>, alFallar: AlFallar): Cancelar
  escucharRestaurante(id: string, alCambiar: AlCambiar<Restaurante | null>, alFallar: AlFallar): Cancelar
  escucharProductos(restauranteId: string, alCambiar: AlCambiar<Producto[]>, alFallar: AlFallar): Cancelar
  escucharCuenta(restauranteId: string, cuentaId: string, alCambiar: AlCambiar<Cuenta | null>, alFallar: AlFallar): Cancelar
  escucharPago(restauranteId: string, pagoId: string, alCambiar: AlCambiar<Pago | null>, alFallar: AlFallar): Cancelar
  /** Solo quien creó el pago y el personal. Los demás reciben SIN_PERMISO. */
  escucharFactura(restauranteId: string, pagoId: string, alCambiar: AlCambiar<Factura | null>, alFallar: AlFallar): Cancelar

  // Solo el personal
  escucharMesas(restauranteId: string, alCambiar: AlCambiar<Mesa[]>, alFallar: AlFallar): Cancelar
  escucharCuentasAbiertas(restauranteId: string, alCambiar: AlCambiar<Cuenta[]>, alFallar: AlFallar): Cancelar
  escucharPagos(restauranteId: string, alCambiar: AlCambiar<Pago[]>, alFallar: AlFallar): Cancelar
  escucharFacturas(restauranteId: string, alCambiar: AlCambiar<Factura[]>, alFallar: AlFallar): Cancelar
  escucharNotas(restauranteId: string, alCambiar: AlCambiar<Nota[]>, alFallar: AlFallar): Cancelar
  /** Solo el administrador de ese restaurante y la plataforma. */
  escucharPersonal(restauranteId: string, alCambiar: AlCambiar<Personal[]>, alFallar: AlFallar): Cancelar

  // Solo la plataforma
  escucharRestaurantes(alCambiar: AlCambiar<Restaurante[]>, alFallar: AlFallar): Cancelar
}

export interface Sesiones {
  /** El cliente entra de forma anónima, sin registro. */
  entrarComoCliente(): Promise<Sesion>
  entrarPersonal(correo: string, clave: string): Promise<Sesion>
  salir(): Promise<void>
}

/** Una función por cada `operationId` de openapi.yaml, salvo el webhook. */
export interface Ordenes {
  agregarLineas(token: string, solicitud: SolicitudLineas): Promise<Cuenta>
  confirmarLineas(token: string, solicitud: SolicitudIdsLineas): Promise<Cuenta>
  rechazarLineas(token: string, solicitud: SolicitudMotivoLineas): Promise<Cuenta>
  anularLineas(token: string, solicitud: SolicitudMotivoLineas): Promise<Cuenta>
  avanzarLinea(token: string, lineaId: string, solicitud: SolicitudEstadoLinea): Promise<Cuenta>
  dividirEnPartesIguales(token: string, solicitud: SolicitudDivision): Promise<Cuenta>
  quitarDivision(token: string): Promise<Cuenta>
  crearPago(token: string, solicitud: SolicitudPago): Promise<Pago>
  verificarPago(token: string, pagoId: string): Promise<Pago>
  cancelarPago(token: string, pagoId: string): Promise<Pago>
  descargarFacturaPdf(token: string, pagoId: string): Promise<Blob>
  enviarFacturaPorCorreo(token: string, pagoId: string, solicitud: SolicitudCorreo): Promise<Factura>
  reintentarFactura(token: string, pagoId: string, solicitud: SolicitudReintentoFactura): Promise<Factura>
  liberarMesa(token: string): Promise<Mesa>
  crearRestaurante(restaurante: NuevoRestaurante): Promise<RestauranteCreado>
  actualizarRestaurante(restauranteId: string, cambios: CambiosRestaurante): Promise<Restaurante>
  agregarMesas(restauranteId: string, solicitud: SolicitudMesas): Promise<Mesa[]>
  crearPersonal(restauranteId: string, personal: NuevoPersonal): Promise<Personal>
  actualizarPersonal(restauranteId: string, uid: string, cambios: CambiosPersonal): Promise<Personal>
  crearProducto(producto: NuevoProducto): Promise<Producto>
  actualizarProducto(productoId: string, cambios: CambiosProducto): Promise<Producto>
  borrarProducto(productoId: string): Promise<void>
  crearNota(pagoId: string, solicitud: SolicitudNotaNueva): Promise<Nota>
  verificarNota(notaId: string): Promise<Nota>
  reintentarNota(notaId: string, solicitud: SolicitudReintentoFactura): Promise<Nota>
  marcarDevolucionHecha(notaId: string): Promise<Nota>
  enviarNotaPorCorreo(notaId: string, solicitud: SolicitudCorreo): Promise<Nota>
  descargarNotaPdf(notaId: string): Promise<Blob>
}

/** Solo existe en la versión en memoria: hace lo que en la vida real hacen el banco y la DIAN. */
export interface Simulador {
  pagarCobro(referencia: string): void
  vencerCobro(referencia: string): void
  /** Lo que responderá la DIAN a la siguiente factura o nota que se emita. */
  elegirRespuestaDian(respuesta: 'emitida' | 'en_validacion' | 'rechazada'): void
  respuestaDian(): 'emitida' | 'en_validacion' | 'rechazada'
  /** Las mesas de la demo, para entrar sin sticker. */
  mesasDemo(): { token: string; numero: number }[]
  /** Las cuentas de la demo, para entrar al personal sin crear usuarios. */
  personalDemo(): { rol: Exclude<Rol, 'cliente'>; correo: string; clave: string }[]
  /** Borra los datos guardados en el navegador y vuelve al estado inicial. */
  reiniciar(): void
}

export interface FuenteDatos extends Lecturas, Sesiones, Ordenes {
  simulador: Simulador | null
}
