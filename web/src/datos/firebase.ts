// La fuente real: lecturas con listeners de Firestore, órdenes a /api y sesión con Firebase Authentication.

import { initializeApp } from 'firebase/app'
import { getAuth, onIdTokenChanged, signInAnonymously, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { collection, doc, getFirestore, onSnapshot, query, where, type Query } from 'firebase/firestore'
import { rutas } from '../../../contratos/reglas'
import { ROLES, type Cuenta, type Factura, type Mesa, type Nota, type Pago, type Personal, type Producto, type Restaurante, type Rol } from '../../../contratos/tipos'
import { crearOrdenesApi } from './api'
import { ErrorDatos, type AlCambiar, type AlFallar, type Cancelar, type FuenteDatos, type Sesion } from './fuente'

/** Esta configuración es pública: lo que protege los datos son las reglas de Firestore y el backend. */
export const CONFIGURACION_FIREBASE = {
  projectId: 'ribu-co',
  appId: '1:577553966126:web:15d1b0755a04e87a8b2bbf',
  apiKey: 'AIzaSyCPdu6HL3BvWTMp00R2j2xlqikob_-6u40',
  authDomain: 'ribu-co.firebaseapp.com',
  storageBucket: 'ribu-co.firebasestorage.app',
  messagingSenderId: '577553966126',
}

const CREDENCIALES_INVALIDAS = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email', 'auth/user-disabled']

/** Traduce los errores de Firebase a los códigos que entienden las pantallas. */
export function errorDeFirebase(error: unknown): ErrorDatos {
  const codigo = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  const detalle = error instanceof Error ? error.message : String(error)
  if (typeof codigo === 'string' && CREDENCIALES_INVALIDAS.includes(codigo)) return new ErrorDatos('NO_AUTORIZADO', detalle)
  if (codigo === 'permission-denied') return new ErrorDatos('SIN_PERMISO', detalle)
  if (codigo === 'unauthenticated') return new ErrorDatos('NO_AUTORIZADO', detalle)
  if (codigo === 'not-found') return new ErrorDatos('NO_ENCONTRADO', detalle)
  return new ErrorDatos('SERVICIO_NO_DISPONIBLE', detalle)
}

/** El rol y el restaurante salen de los custom claims. Sin un rol válido es un cliente. */
export function sesionDesdeClaims(uid: string, claims: Record<string, unknown>, nombre: string | null): Sesion {
  const rol: Rol = (ROLES as readonly unknown[]).includes(claims.rol) ? (claims.rol as Rol) : 'cliente'
  if (rol === 'cliente') return { uid, rol, restauranteId: null, nombre: null }
  const restauranteId = rol !== 'plataforma' && typeof claims.restauranteId === 'string' ? claims.restauranteId : null
  return { uid, rol, restauranteId, nombre }
}

export function crearFuenteFirebase(): FuenteDatos {
  const app = initializeApp(CONFIGURACION_FIREBASE)
  const auth = getAuth(app)
  const db = getFirestore(app)

  async function leerSesion(usuario: User, refrescar = false): Promise<Sesion> {
    const { claims } = await usuario.getIdTokenResult(refrescar)
    return sesionDesdeClaims(usuario.uid, claims, usuario.displayName ?? usuario.email)
  }

  /** Los documentos guardan el id aparte del contenido: aquí se vuelve a poner en el campo del contrato. */
  const conId = <T,>(id: string, datos: object, campo: keyof T) => ({ ...datos, [campo]: id }) as T

  function escucharDocumento<T>(coleccion: string, id: string, campo: keyof T, alCambiar: AlCambiar<T | null>, alFallar: AlFallar): Cancelar {
    return onSnapshot(
      doc(db, coleccion, id),
      (foto) => alCambiar(foto.exists() ? conId<T>(foto.id, foto.data(), campo) : null),
      (error) => alFallar(errorDeFirebase(error)),
    )
  }

  function escucharLista<T>(
    consulta: Query,
    campo: keyof T,
    alCambiar: AlCambiar<T[]>,
    alFallar: AlFallar,
    orden?: (a: T, b: T) => number,
  ): Cancelar {
    return onSnapshot(
      consulta,
      (foto) => {
        const lista = foto.docs.map((d) => conId<T>(d.id, d.data(), campo))
        alCambiar(orden ? lista.sort(orden) : lista)
      },
      (error) => alFallar(errorDeFirebase(error)),
    )
  }

  const lista = (ruta: string) => collection(db, ruta)

  let entrando: Promise<Sesion> | null = null

  return {
    simulador: null,

    ...crearOrdenesApi({
      obtenerToken: async () => {
        await auth.authStateReady()
        if (!auth.currentUser) throw new ErrorDatos('NO_AUTORIZADO', 'Primero hay que entrar')
        return auth.currentUser.getIdToken()
      },
    }),

    // Sesión

    escucharSesion(alCambiar) {
      let turno = 0
      let ultima: string | undefined
      const entregar = (sesion: Sesion | null) => {
        // onIdTokenChanged también avisa cada vez que se renueva el token: eso no es un cambio de sesión.
        const firma = JSON.stringify(sesion)
        if (firma === ultima) return
        ultima = firma
        alCambiar(sesion)
      }
      const cancelar = onIdTokenChanged(auth, async (usuario) => {
        const mio = ++turno
        const sesion = usuario ? await leerSesion(usuario).catch(() => null) : null
        if (mio === turno) entregar(sesion)
      })
      return () => {
        turno += 1
        cancelar()
      }
    },

    entrarComoCliente() {
      // Una pantalla puede pedirlo dos veces seguidas; no por eso se crean dos usuarios anónimos.
      entrando ??= (async () => {
        await auth.authStateReady()
        const usuario = auth.currentUser ?? (await signInAnonymously(auth)).user
        return leerSesion(usuario)
      })()
        .catch((error) => {
          throw errorDeFirebase(error)
        })
        .finally(() => {
          entrando = null
        })
      return entrando
    },

    async entrarPersonal(correo, clave) {
      try {
        const { user } = await signInWithEmailAndPassword(auth, correo.trim(), clave)
        const sesion = await leerSesion(user, true)
        if (sesion.rol !== 'cliente') return sesion
      } catch (error) {
        throw errorDeFirebase(error)
      }
      await signOut(auth).catch(() => {})
      throw new ErrorDatos('SIN_PERMISO', 'Esa cuenta no tiene un rol en Ribu')
    },

    async salir() {
      try {
        await signOut(auth)
      } catch (error) {
        throw errorDeFirebase(error)
      }
    },

    // Lecturas

    escucharMesa: (token, a, b) => escucharDocumento<Mesa>(rutas.mesas, token, 'token', a, b),
    escucharRestaurante: (id, a, b) => escucharDocumento<Restaurante>(rutas.restaurantes, id, 'id', a, b),
    escucharProductos: (restauranteId, a, b) => escucharLista<Producto>(lista(rutas.productos(restauranteId)), 'id', a, b),
    escucharCuenta: (restauranteId, cuentaId, a, b) => escucharDocumento<Cuenta>(rutas.cuentas(restauranteId), cuentaId, 'id', a, b),
    escucharPago: (restauranteId, pagoId, a, b) => escucharDocumento<Pago>(rutas.pagos(restauranteId), pagoId, 'id', a, b),
    escucharFactura: (restauranteId, pagoId, a, b) => escucharDocumento<Factura>(rutas.facturas(restauranteId), pagoId, 'pagoId', a, b),
    escucharMesas: (restauranteId, a, b) =>
      escucharLista<Mesa>(query(lista(rutas.mesas), where('restauranteId', '==', restauranteId)), 'token', a, b, (x, y) => x.numero - y.numero),
    escucharCuentasAbiertas: (restauranteId, a, b) =>
      escucharLista<Cuenta>(query(lista(rutas.cuentas(restauranteId)), where('estado', 'in', ['abierta', 'pagada'])), 'id', a, b),
    escucharPagos: (restauranteId, a, b) =>
      escucharLista<Pago>(lista(rutas.pagos(restauranteId)), 'id', a, b, (x, y) => y.creadoEn.localeCompare(x.creadoEn)),
    escucharFacturas: (restauranteId, a, b) => escucharLista<Factura>(lista(rutas.facturas(restauranteId)), 'pagoId', a, b),
    escucharNotas: (restauranteId, a, b) =>
      escucharLista<Nota>(lista(rutas.notas(restauranteId)), 'id', a, b, (x, y) => y.creadaEn.localeCompare(x.creadaEn)),
    escucharPersonal: (restauranteId, a, b) =>
      escucharLista<Personal>(lista(rutas.personal(restauranteId)), 'uid', a, b, (x, y) => x.nombre.localeCompare(y.nombre, 'es')),
    escucharRestaurantes: (a, b) =>
      escucharLista<Restaurante>(lista(rutas.restaurantes), 'id', a, b, (x, y) => x.nombre.localeCompare(y.nombre, 'es')),
  }
}
