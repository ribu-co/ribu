// Lo único que la lógica necesita de Firestore. Así casi todo se prueba en CI sin emulador.
// Las escrituras de una transacción se guardan hasta el final: leer después de escribir devuelve lo anterior.

export interface FiltroConsulta {
  campo: string
  op: '==' | '<='
  valor: string
}

export interface Fila<T> {
  id: string
  datos: T
}

export interface Lector {
  leer<T>(ruta: string): Promise<T | null>
  consultar<T>(coleccion: string, filtro: FiltroConsulta, limite?: number): Promise<Fila<T>[]>
}

export interface Transaccion extends Lector {
  leerVarios<T>(rutas: readonly string[]): Promise<(T | null)[]>
  guardar(ruta: string, datos: object): void
  /** Cambia solo esos campos. El documento debe existir. */
  actualizar(ruta: string, cambios: object): void
  borrar(ruta: string): void
}

export interface BaseDatos extends Lector {
  transaccion<T>(trabajo: (tx: Transaccion) => Promise<T>): Promise<T>
}
