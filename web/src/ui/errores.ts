import { MONTO_MAXIMO_COBRO, MONTO_MINIMO_COBRO } from '../../../contratos/reglas'
import type { CodigoError } from '../../../contratos/tipos'
import { comoErrorDatos } from '../datos/fuente'
import { pesos } from './formato'

export interface MensajeError {
  /** Qué pasó. */
  titulo: string
  /** Qué hacer. */
  accion: string
}

export const MENSAJES_ERROR: Record<CodigoError, MensajeError> = {
  CUERPO_INVALIDO: {
    titulo: 'Algo no cuadró en lo que enviaste.',
    accion: 'Revisa los datos e inténtalo otra vez.',
  },
  NO_AUTORIZADO: {
    titulo: 'Tu sesión se cerró o los datos de entrada no coinciden.',
    accion: 'Recarga la página o vuelve a entrar.',
  },
  SIN_PERMISO: {
    titulo: 'Esto no está disponible desde tu sesión.',
    accion: 'Pídeselo al mesero o a quien administra el restaurante.',
  },
  NO_ENCONTRADO: {
    titulo: 'No encontramos lo que buscabas.',
    accion: 'Puede que ya no exista. Recarga la página.',
  },
  PRODUCTO_NO_DISPONIBLE: {
    titulo: 'Uno de los productos se acaba de agotar.',
    accion: 'Quítalo de tu pedido y elige otro.',
  },
  STOCK_INSUFICIENTE: {
    titulo: 'No quedan suficientes unidades de un producto.',
    accion: 'Pide una cantidad menor o elige otro producto.',
  },
  TRANSICION_INVALIDA: {
    titulo: 'Ese pedido ya había cambiado de estado.',
    accion: 'La pantalla ya se actualizó: revisa y vuelve a intentar.',
  },
  LINEA_CON_PAGO: {
    titulo: 'Ese producto ya está en un pago.',
    accion: 'Cancela primero ese cobro o deja el producto en la cuenta.',
  },
  NADA_POR_PAGAR: {
    titulo: 'No hay nada por pagar.',
    accion: 'Todo lo confirmado ya está pagado o en cobro.',
  },
  CANTIDAD_NO_DISPONIBLE: {
    titulo: 'Alguien de la mesa ya está pagando parte de esos productos.',
    accion: 'Vuelve a elegir lo que vas a pagar.',
  },
  PARTE_NO_DISPONIBLE: {
    titulo: 'Esa parte ya está pagada o ya no existe.',
    accion: 'Elige otra parte de la cuenta.',
  },
  DIVISION_ACTIVA: {
    titulo: 'La cuenta está dividida y ya hay partes en cobro o pagadas.',
    accion: 'Paga una de las partes o espera a que terminen.',
  },
  PAGO_EN_CURSO: {
    titulo: 'Alguien de la mesa ya está pagando esto.',
    accion: 'Espera a que termine o pídele que cancele su cobro.',
  },
  MONTO_FUERA_DE_RANGO: {
    titulo: 'Ese monto no se puede cobrar con Factus Pay.',
    accion: `Debe estar entre ${pesos(MONTO_MINIMO_COBRO)} y ${pesos(MONTO_MAXIMO_COBRO)}. Divide en menos partes o paga con el mesero.`,
  },
  PROPINA_INVALIDA: {
    titulo: 'La propina no es válida.',
    accion: 'Elige un porcentaje entero entre 0 y 100.',
  },
  COMPRADOR_INVALIDO: {
    titulo: 'Faltan datos para la factura.',
    accion: 'Revisa el documento, el nombre y el correo, o elige consumidor final.',
  },
  MESA_CON_SALDO: {
    titulo: 'La mesa todavía no se puede liberar.',
    accion: 'Confirma o rechaza los pedidos pendientes y cobra lo que falta.',
  },
  FACTURA_NO_DISPONIBLE: {
    titulo: 'La factura todavía no está lista.',
    accion: 'Espera unos segundos: la DIAN la está validando.',
  },
  NOTA_INVALIDA: {
    titulo: 'La nota tiene datos incompletos.',
    accion: 'Revisa el motivo, las cantidades y los precios.',
  },
  NOTA_EXCEDE_FACTURA: {
    titulo: 'La nota supera lo que queda de la factura.',
    accion: 'Baja el valor: no se puede acreditar más de lo facturado.',
  },
  CORREO_EN_USO: {
    titulo: 'Ya hay una cuenta con ese correo.',
    accion: 'Usa otro correo o entra con esa cuenta.',
  },
  RESTAURANTE_INACTIVO: {
    titulo: 'Este restaurante no está recibiendo pedidos en este momento.',
    accion: 'Pídele ayuda al personal.',
  },
  SERVICIO_NO_DISPONIBLE: {
    titulo: 'No pudimos conectarnos.',
    accion: 'Revisa tu internet e inténtalo de nuevo en unos segundos.',
  },
}

export const mensajeDeError = (error: unknown): MensajeError => MENSAJES_ERROR[comoErrorDatos(error).codigo]
