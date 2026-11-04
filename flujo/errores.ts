// El error que la API le devuelve a la web: un código del contrato y un mensaje sin detalles internos.

import type { CodigoError } from '../contratos/tipos'

export class ErrorRibu extends Error {
  constructor(
    readonly codigo: CodigoError,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorRibu'
  }
}

export function fallar(codigo: CodigoError, mensaje: string): never {
  throw new ErrorRibu(codigo, mensaje)
}
