// Prueba firestore.rules contra el emulador. Corre con `npm run test:reglas`.

import { initializeApp as iniciarAdmin } from 'firebase-admin/app'
import { getFirestore as firestoreAdmin } from 'firebase-admin/firestore'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  setLogLevel,
  where,
  type Firestore,
} from 'firebase/firestore'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const PROYECTO = 'demo-ribu'
const A = 'rest-a'
const B = 'rest-b'

type Claims = { rol?: string; restauranteId?: string; firebase?: { sign_in_provider: 'anonymous' } }

const apps: FirebaseApp[] = []
let siguiente = 0

function conectar(uid: string | null, claims: Claims = {}): Firestore {
  const app = initializeApp({ projectId: PROYECTO, apiKey: 'falsa' }, `persona-${siguiente++}`)
  apps.push(app)
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080, uid ? { mockUserToken: { sub: uid, ...claims } } : undefined)
  return db
}

const puede = (lectura: Promise<unknown>) => expect(lectura).resolves.toBeDefined()
const noPuede = (lectura: Promise<unknown>) => expect(lectura).rejects.toMatchObject({ code: 'permission-denied' })

let sinSesion: Firestore
let cliente: Firestore
let otroCliente: Firestore
let meseroA: Firestore
let cocinaA: Firestore
let adminA: Firestore
let meseroB: Firestore
let adminB: Firestore
let plataforma: Firestore
let meseroDesactivado: Firestore
let meseroConRolViejo: Firestore

beforeAll(async () => {
  setLogLevel('silent')
  const admin = firestoreAdmin(iniciarAdmin({ projectId: PROYECTO }))
  const poner = (ruta: string, datos: object) => admin.doc(ruta).set(datos)

  for (const [uid, r, rol, activo] of [
    ['mesero-a', A, 'mesero', true],
    ['cocina-a', A, 'cocina', true],
    ['admin-a', A, 'admin', true],
    ['mesero-b', B, 'mesero', true],
    ['admin-b', B, 'admin', true],
    ['mesero-fuera', A, 'mesero', false],
    ['era-admin', A, 'mesero', true],
  ] as const) {
    await poner(`restaurantes/${r}/personal/${uid}`, { uid, restauranteId: r, rol, activo })
  }
  for (const r of [A, B]) {
    await poner(`restaurantes/${r}`, { id: r, nombre: r, activo: true })
    await poner(`mesas/token-${r}`, { token: `token-${r}`, restauranteId: r, numero: 1, estado: 'ocupada', cuentaId: 'c1' })
    await poner(`restaurantes/${r}/productos/p1`, { id: 'p1', restauranteId: r })
    await poner(`restaurantes/${r}/cuentas/c1`, { id: 'c1', restauranteId: r, estado: 'abierta' })
    await poner(`restaurantes/${r}/cuentas/c2`, { id: 'c2', restauranteId: r, estado: 'cerrada' })
    await poner(`restaurantes/${r}/pagos/p1`, { id: 'p1', restauranteId: r })
    await poner(`restaurantes/${r}/facturas/p1`, { pagoId: 'p1', restauranteId: r, pagadorUid: 'cliente-1' })
    await poner(`restaurantes/${r}/notas/n1`, { id: 'n1', restauranteId: r })
  }
  await poner('referencias/p1', { restauranteId: A, tipo: 'pago' })
  await poner('_mocks_cobros/p1', { monto: 1 })

  sinSesion = conectar(null)
  cliente = conectar('cliente-1', { firebase: { sign_in_provider: 'anonymous' } })
  otroCliente = conectar('cliente-2', { firebase: { sign_in_provider: 'anonymous' } })
  meseroA = conectar('mesero-a', { rol: 'mesero', restauranteId: A })
  cocinaA = conectar('cocina-a', { rol: 'cocina', restauranteId: A })
  adminA = conectar('admin-a', { rol: 'admin', restauranteId: A })
  meseroB = conectar('mesero-b', { rol: 'mesero', restauranteId: B })
  adminB = conectar('admin-b', { rol: 'admin', restauranteId: B })
  plataforma = conectar('plataforma', { rol: 'plataforma' })
  meseroDesactivado = conectar('mesero-fuera', { rol: 'mesero', restauranteId: A })
  meseroConRolViejo = conectar('era-admin', { rol: 'admin', restauranteId: A })
})

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)))
})

const leer = (db: Firestore, ruta: string) => getDoc(doc(db, ruta))
const listar = (db: Firestore, ruta: string) => getDocs(collection(db, ruta))
const cuentasAbiertas = (db: Firestore, r: string) =>
  getDocs(query(collection(db, `restaurantes/${r}/cuentas`), where('estado', 'in', ['abierta', 'pagada'])))
const mesasDe = (db: Firestore, r: string) => getDocs(query(collection(db, 'mesas'), where('restauranteId', '==', r)))

describe('solo el backend escribe', () => {
  test.each([
    `mesas/token-${A}`,
    `restaurantes/${A}`,
    `restaurantes/${A}/productos/p1`,
    `restaurantes/${A}/cuentas/c1`,
    `restaurantes/${A}/pagos/p1`,
    `restaurantes/${A}/facturas/p1`,
    `restaurantes/${A}/notas/n1`,
    `restaurantes/${A}/personal/nuevo`,
    'referencias/p1',
  ])('nadie escribe en %s', async (ruta) => {
    for (const db of [sinSesion, cliente, meseroA, adminA, plataforma]) {
      await noPuede(setDoc(doc(db, ruta), { pagado: 999_999 }))
    }
  })
})

describe('sin sesión no se lee nada', () => {
  test.each([
    `mesas/token-${A}`,
    `restaurantes/${A}`,
    `restaurantes/${A}/productos/p1`,
    `restaurantes/${A}/cuentas/c1`,
    `restaurantes/${A}/pagos/p1`,
    `restaurantes/${A}/facturas/p1`,
    `restaurantes/${A}/notas/n1`,
  ])('%s', async (ruta) => {
    await noPuede(leer(sinSesion, ruta))
  })
})

describe('mesas', () => {
  test('quien tiene el link la lee', () => puede(leer(cliente, `mesas/token-${A}`)))
  test('el personal lista las de su restaurante', () => puede(mesasDe(meseroA, A)))
  test('la plataforma lista cualquiera', () => puede(mesasDe(plataforma, B)))
  test('un cliente no las lista', () => noPuede(mesasDe(cliente, A)))
  test('el personal no lista las de otro', () => noPuede(mesasDe(meseroA, B)))
  test('el personal no lee una mesa de otro ni con el link', () => noPuede(leer(meseroA, `mesas/token-${B}`)))
  test('sin filtrar por restaurante no se listan', () => noPuede(listar(adminA, 'mesas')))
  test('un token que no existe no se confunde con un error de permisos', async () => {
    expect((await leer(cliente, 'mesas/no-existe')).exists()).toBe(false)
  })
})

describe('restaurantes y carta', () => {
  test('cualquier sesión los lee', async () => {
    await puede(leer(cliente, `restaurantes/${A}`))
    await puede(leer(cliente, `restaurantes/${A}/productos/p1`))
    await puede(listar(cliente, `restaurantes/${A}/productos`))
  })
  test('solo la plataforma lista restaurantes', async () => {
    await puede(listar(plataforma, 'restaurantes'))
    await noPuede(listar(adminA, 'restaurantes'))
    await noPuede(listar(cliente, 'restaurantes'))
  })
})

describe('personal', () => {
  test('lo leen su administrador y la plataforma', async () => {
    await puede(listar(adminA, `restaurantes/${A}/personal`))
    await puede(leer(adminA, `restaurantes/${A}/personal/mesero-a`))
    await puede(listar(plataforma, `restaurantes/${A}/personal`))
  })
  test('el mesero, la cocina y el cliente no', async () => {
    for (const db of [meseroA, cocinaA, cliente]) {
      await noPuede(leer(db, `restaurantes/${A}/personal/mesero-a`))
      await noPuede(listar(db, `restaurantes/${A}/personal`))
    }
  })
  test('tampoco el administrador de otro restaurante', () => noPuede(listar(adminB, `restaurantes/${A}/personal`)))
})

describe('cuentas', () => {
  test('quien tiene el id la lee', () => puede(leer(cliente, `restaurantes/${A}/cuentas/c1`)))
  test('el mesero y la cocina ven las abiertas de su restaurante', async () => {
    const resultado = await cuentasAbiertas(meseroA, A)
    expect(resultado.docs.map((d) => d.id)).toEqual(['c1'])
    await puede(cuentasAbiertas(cocinaA, A))
  })
  test('el mesero y la cocina no listan las cerradas', async () => {
    await noPuede(listar(meseroA, `restaurantes/${A}/cuentas`))
    await noPuede(listar(cocinaA, `restaurantes/${A}/cuentas`))
  })
  test('el administrador y la plataforma listan todas', async () => {
    await puede(listar(adminA, `restaurantes/${A}/cuentas`))
    await puede(listar(plataforma, `restaurantes/${A}/cuentas`))
  })
  test('un cliente no las lista', () => noPuede(cuentasAbiertas(cliente, A)))
  test('un restaurante nunca ve a otro', async () => {
    await noPuede(cuentasAbiertas(meseroB, A))
    await noPuede(listar(adminB, `restaurantes/${A}/cuentas`))
    await noPuede(leer(meseroB, `restaurantes/${A}/cuentas/c1`))
  })
})

describe('pagos', () => {
  test('quien tiene el id lo lee', () => puede(leer(otroCliente, `restaurantes/${A}/pagos/p1`)))
  test('solo el administrador y la plataforma los listan', async () => {
    await puede(listar(adminA, `restaurantes/${A}/pagos`))
    await puede(listar(plataforma, `restaurantes/${A}/pagos`))
    for (const db of [meseroA, cocinaA, cliente, adminB]) await noPuede(listar(db, `restaurantes/${A}/pagos`))
  })
  test('otro restaurante no lo lee', () => noPuede(leer(adminB, `restaurantes/${A}/pagos/p1`)))
})

describe('facturas', () => {
  const ruta = `restaurantes/${A}/facturas/p1`
  test('la lee quien creó el pago', () => puede(leer(cliente, ruta)))
  test('la lee el personal de ese restaurante', async () => {
    for (const db of [meseroA, cocinaA, adminA, plataforma]) await puede(leer(db, ruta))
  })
  test('otro cliente no la lee, aunque tenga el id', () => noPuede(leer(otroCliente, ruta)))
  test('otro restaurante no la lee', async () => {
    await noPuede(leer(meseroB, ruta))
    await noPuede(leer(adminB, ruta))
  })
  test('solo el administrador y la plataforma las listan', async () => {
    await puede(listar(adminA, `restaurantes/${A}/facturas`))
    await puede(listar(plataforma, `restaurantes/${A}/facturas`))
    for (const db of [meseroA, cocinaA, cliente, adminB]) await noPuede(listar(db, `restaurantes/${A}/facturas`))
  })
})

describe('notas', () => {
  const ruta = `restaurantes/${A}/notas/n1`
  test('solo las leen el administrador y la plataforma', async () => {
    await puede(leer(adminA, ruta))
    await puede(leer(plataforma, ruta))
    await puede(listar(adminA, `restaurantes/${A}/notas`))
  })
  test('nadie más', async () => {
    for (const db of [meseroA, cocinaA, cliente, adminB, meseroB]) {
      await noPuede(leer(db, ruta))
      await noPuede(listar(db, `restaurantes/${A}/notas`))
    }
  })
})

describe('colecciones del backend', () => {
  test.each(['referencias/p1', '_mocks_cobros/p1'])('nadie lee %s', async (ruta) => {
    for (const db of [cliente, meseroA, adminA, plataforma]) await noPuede(leer(db, ruta))
  })
  test('nadie lista las referencias', () => noPuede(listar(plataforma, 'referencias')))
})

describe('quien pierde el acceso lo pierde de una vez, aunque su token siga vivo', () => {
  test('personal desactivado', async () => {
    await noPuede(cuentasAbiertas(meseroDesactivado, A))
    await noPuede(leer(meseroDesactivado, `restaurantes/${A}/facturas/p1`))
  })
  test('un token con un rol anterior no da los permisos de ese rol', async () => {
    await noPuede(listar(meseroConRolViejo, `restaurantes/${A}/pagos`))
    await noPuede(leer(meseroConRolViejo, `restaurantes/${A}/notas/n1`))
  })
})
