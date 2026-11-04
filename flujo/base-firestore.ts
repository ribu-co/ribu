// BaseDatos sobre Firestore, con el SDK de administración.

import type { Firestore, Query, Transaction } from 'firebase-admin/firestore'
import type { BaseDatos, Fila, FiltroConsulta, Transaccion } from './base-datos'

const consulta = (db: Firestore, coleccion: string, filtro: FiltroConsulta, limite?: number): Query => {
  const base = db.collection(coleccion).where(filtro.campo, filtro.op, filtro.valor)
  return limite === undefined ? base : base.limit(limite)
}

const filas = <T>(docs: FirebaseFirestore.QueryDocumentSnapshot[]): Fila<T>[] =>
  docs.map((doc) => ({ id: doc.id, datos: doc.data() as T }))

export function crearBaseFirestore(db: Firestore): BaseDatos {
  return {
    async leer<T>(ruta: string) {
      const doc = await db.doc(ruta).get()
      return doc.exists ? (doc.data() as T) : null
    },

    async consultar<T>(coleccion: string, filtro: FiltroConsulta, limite?: number) {
      const resultado = await consulta(db, coleccion, filtro, limite).get()
      return filas<T>(resultado.docs)
    },

    transaccion<T>(trabajo: (tx: Transaccion) => Promise<T>) {
      return db.runTransaction(async (tx: Transaction) => {
        const pendientes: (() => void)[] = []
        const resultado = await trabajo({
          async leer<D>(ruta: string) {
            const doc = await tx.get(db.doc(ruta))
            return doc.exists ? (doc.data() as D) : null
          },
          async leerVarios<D>(rutas: readonly string[]) {
            if (rutas.length === 0) return []
            const docs = await tx.getAll(...rutas.map((ruta) => db.doc(ruta)))
            return docs.map((doc) => (doc.exists ? (doc.data() as D) : null))
          },
          async consultar<D>(coleccion: string, filtro: FiltroConsulta, limite?: number) {
            const resultado = await tx.get(consulta(db, coleccion, filtro, limite))
            return filas<D>(resultado.docs)
          },
          guardar: (ruta, datos) => void pendientes.push(() => tx.set(db.doc(ruta), datos)),
          actualizar: (ruta, cambios) =>
            void pendientes.push(() => tx.update(db.doc(ruta), cambios as Record<string, unknown>)),
          borrar: (ruta) => void pendientes.push(() => tx.delete(db.doc(ruta))),
        })
        // Firestore exige leer antes de escribir: las escrituras salen todas al final.
        for (const escribir of pendientes) escribir()
        return resultado
      })
    },
  }
}
