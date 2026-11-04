// BaseDatos en memoria para las pruebas de CI. Las transacciones corren una tras otra.

import type { BaseDatos, Fila, FiltroConsulta, Transaccion } from './base-datos'

type Documento = Record<string, unknown>

export interface BaseMemoria extends BaseDatos {
  /** Copia de todos los documentos, para revisar en las pruebas. */
  volcado(): Record<string, Documento>
}

export function crearBaseMemoria(inicial: Record<string, object> = {}): BaseMemoria {
  const docs = new Map<string, Documento>(
    Object.entries(inicial).map(([ruta, datos]) => [ruta, structuredClone(datos) as Documento]),
  )
  let cola: Promise<unknown> = Promise.resolve()

  const leer = async <T>(ruta: string) => {
    const doc = docs.get(ruta)
    return doc === undefined ? null : (structuredClone(doc) as T)
  }

  const consultar = async <T>(coleccion: string, filtro: FiltroConsulta, limite?: number) => {
    const resultado: Fila<T>[] = []
    for (const [ruta, doc] of docs) {
      if (!ruta.startsWith(`${coleccion}/`)) continue
      const id = ruta.slice(coleccion.length + 1)
      if (id.includes('/')) continue
      const valor = doc[filtro.campo]
      // Igual que Firestore: un rango sobre texto no devuelve los null.
      const cumple =
        filtro.op === '==' ? valor === filtro.valor : typeof valor === 'string' && valor <= filtro.valor
      if (cumple) resultado.push({ id, datos: structuredClone(doc) as T })
    }
    return limite === undefined ? resultado : resultado.slice(0, limite)
  }

  async function ejecutar<T>(trabajo: (tx: Transaccion) => Promise<T>) {
    const pendientes: (() => void)[] = []
    const resultado = await trabajo({
      leer,
      consultar,
      leerVarios: (rutas) => Promise.all(rutas.map((ruta) => leer(ruta))) as never,
      guardar: (ruta, datos) => void pendientes.push(() => docs.set(ruta, structuredClone(datos) as Documento)),
      actualizar: (ruta, cambios) =>
        void pendientes.push(() => {
          const doc = docs.get(ruta)
          if (!doc) throw new Error(`No existe ${ruta}`)
          docs.set(ruta, { ...doc, ...(structuredClone(cambios) as Documento) })
        }),
      borrar: (ruta) => void pendientes.push(() => docs.delete(ruta)),
    })
    for (const escribir of pendientes) escribir()
    return resultado
  }

  return {
    leer,
    consultar,
    transaccion<T>(trabajo: (tx: Transaccion) => Promise<T>) {
      const turno = cola.then(() => ejecutar(trabajo))
      cola = turno.catch(() => undefined)
      return turno
    },
    volcado: () => structuredClone(Object.fromEntries(docs)),
  }
}
