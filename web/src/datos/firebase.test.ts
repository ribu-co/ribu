import { beforeEach, describe, expect, test, vi } from 'vitest'
import { errorDeFirebase, sesionDesdeClaims } from './firebase'
import { crearFuenteFirebase } from './firebase'

const falso = vi.hoisted(() => ({
  usuario: null as null | Record<string, unknown>,
  alCambiarToken: null as null | ((usuario: unknown) => void),
  anonimos: 0,
  login: vi.fn(),
  salir: vi.fn(async () => {}),
  /** Lo último que se pidió escuchar, con sus callbacks. */
  escuchas: [] as { blanco: { ruta?: string; id?: string; filtros?: unknown[] }; al: (foto: unknown) => void; falla: (e: unknown) => void }[],
}))

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({
    authStateReady: async () => {},
    get currentUser() {
      return falso.usuario
    },
  }),
  onIdTokenChanged: (_: unknown, alCambiar: (u: unknown) => void) => {
    falso.alCambiarToken = alCambiar
    return () => {}
  },
  signInAnonymously: async () => {
    falso.anonimos += 1
    falso.usuario = usuarioFalso('anonimo', {})
    return { user: falso.usuario }
  },
  signInWithEmailAndPassword: falso.login,
  signOut: falso.salir,
}))
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}),
  collection: (_: unknown, ruta: string) => ({ ruta }),
  doc: (_: unknown, ruta: string, id: string) => ({ ruta, id }),
  query: (base: object, ...filtros: unknown[]) => ({ ...base, filtros }),
  where: (...partes: unknown[]) => partes,
  onSnapshot: (blanco: never, al: never, falla: never) => {
    falso.escuchas.push({ blanco, al, falla })
    return () => {}
  },
}))

function usuarioFalso(uid: string, claims: Record<string, unknown>) {
  return {
    uid,
    displayName: null,
    email: claims.rol ? `${uid}@ribu.test` : null,
    getIdTokenResult: async () => ({ claims }),
    getIdToken: async () => `token-${uid}`,
  }
}

const documento = (id: string, datos: object) => ({ id, exists: () => true, data: () => datos })
const ultima = () => falso.escuchas.at(-1)!

beforeEach(() => {
  falso.usuario = null
  falso.anonimos = 0
  falso.escuchas.length = 0
  falso.login.mockReset()
  falso.salir.mockClear()
})

describe('sesionDesdeClaims', () => {
  test('el rol y el restaurante salen de los claims', () => {
    expect(sesionDesdeClaims('u', { rol: 'mesero', restauranteId: 'r1' }, 'Marta')).toEqual({ uid: 'u', rol: 'mesero', restauranteId: 'r1', nombre: 'Marta' })
  })
  test('la plataforma no tiene restaurante, aunque el claim traiga uno', () => {
    expect(sesionDesdeClaims('u', { rol: 'plataforma', restauranteId: 'r1' }, 'Ribu')).toMatchObject({ rol: 'plataforma', restauranteId: null })
  })
  test('sin un rol válido es un cliente', () => {
    expect(sesionDesdeClaims('u', {}, null)).toEqual({ uid: 'u', rol: 'cliente', restauranteId: null, nombre: null })
    expect(sesionDesdeClaims('u', { rol: 'jefe' }, 'x').rol).toBe('cliente')
  })
})

describe('errorDeFirebase', () => {
  test.each([
    ['auth/invalid-credential', 'NO_AUTORIZADO'],
    ['auth/wrong-password', 'NO_AUTORIZADO'],
    ['auth/user-disabled', 'NO_AUTORIZADO'],
    ['permission-denied', 'SIN_PERMISO'],
    ['unauthenticated', 'NO_AUTORIZADO'],
    ['not-found', 'NO_ENCONTRADO'],
    ['unavailable', 'SERVICIO_NO_DISPONIBLE'],
    ['auth/network-request-failed', 'SERVICIO_NO_DISPONIBLE'],
  ])('%s es %s', (code, esperado) => {
    expect(errorDeFirebase({ code }).codigo).toBe(esperado)
  })
})

describe('sesión', () => {
  test('el cliente entra una sola vez aunque lo pidan dos veces', async () => {
    const fuente = crearFuenteFirebase()
    const [a, b] = await Promise.all([fuente.entrarComoCliente(), fuente.entrarComoCliente()])
    expect(falso.anonimos).toBe(1)
    expect(a).toEqual(b)
    expect(a).toMatchObject({ rol: 'cliente', restauranteId: null })
  })

  test('si ya hay sesión, entrar como cliente la conserva', async () => {
    falso.usuario = usuarioFalso('marta', { rol: 'mesero', restauranteId: 'r1' })
    const sesion = await crearFuenteFirebase().entrarComoCliente()
    expect(falso.anonimos).toBe(0)
    expect(sesion).toMatchObject({ rol: 'mesero', restauranteId: 'r1' })
  })

  test('el personal entra con correo y clave', async () => {
    falso.login.mockResolvedValue({ user: usuarioFalso('ana', { rol: 'admin', restauranteId: 'r1' }) })
    const sesion = await crearFuenteFirebase().entrarPersonal(' ana@ribu.test ', 'clave')
    expect(falso.login).toHaveBeenCalledWith(expect.anything(), 'ana@ribu.test', 'clave')
    expect(sesion).toMatchObject({ rol: 'admin', restauranteId: 'r1', nombre: 'ana@ribu.test' })
  })

  test('una cuenta sin rol no se queda adentro', async () => {
    falso.login.mockResolvedValue({ user: usuarioFalso('nadie', {}) })
    await expect(crearFuenteFirebase().entrarPersonal('n@ribu.test', 'clave')).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
    expect(falso.salir).toHaveBeenCalled()
  })

  test('una clave errada llega como NO_AUTORIZADO', async () => {
    falso.login.mockRejectedValue({ code: 'auth/invalid-credential' })
    await expect(crearFuenteFirebase().entrarPersonal('a@ribu.test', 'mal')).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO' })
  })

  test('renovar el token no repite la sesión; salir sí avisa', async () => {
    const fuente = crearFuenteFirebase()
    const vistas: unknown[] = []
    fuente.escucharSesion((s) => vistas.push(s))
    const usuario = usuarioFalso('marta', { rol: 'mesero', restauranteId: 'r1' })
    falso.alCambiarToken!(usuario)
    await vi.waitFor(() => expect(vistas).toHaveLength(1))
    falso.alCambiarToken!(usuario)
    await new Promise((r) => setTimeout(r))
    expect(vistas).toHaveLength(1)
    falso.alCambiarToken!(null)
    await vi.waitFor(() => expect(vistas).toEqual([expect.objectContaining({ uid: 'marta' }), null]))
  })

  test('un aviso viejo no pisa al más reciente', async () => {
    const fuente = crearFuenteFirebase()
    const vistas: unknown[] = []
    fuente.escucharSesion((s) => vistas.push(s))
    let soltar = (_: unknown) => {}
    const lento = { ...usuarioFalso('viejo', {}), getIdTokenResult: () => new Promise((r) => (soltar = r)) }
    falso.alCambiarToken!(lento)
    falso.alCambiarToken!(null)
    await vi.waitFor(() => expect(vistas).toEqual([null]))
    soltar({ claims: {} })
    await new Promise((r) => setTimeout(r))
    expect(vistas).toEqual([null])
  })
})

describe('lecturas en las rutas del contrato', () => {
  test('una mesa pone su token, que es el id del documento', () => {
    const vistas: unknown[] = []
    crearFuenteFirebase().escucharMesa('tok-1', (m) => vistas.push(m), () => {})
    expect(ultima().blanco).toEqual({ ruta: 'mesas', id: 'tok-1' })
    ultima().al(documento('tok-1', { numero: 4 }))
    ultima().al({ id: 'tok-1', exists: () => false, data: () => undefined })
    expect(vistas).toEqual([{ numero: 4, token: 'tok-1' }, null])
  })

  test('las mesas de un restaurante llegan filtradas y ordenadas por número', () => {
    const vistas: { numero: number }[][] = []
    crearFuenteFirebase().escucharMesas('r1', (m) => vistas.push(m), () => {})
    expect(ultima().blanco).toEqual({ ruta: 'mesas', filtros: [['restauranteId', '==', 'r1']] })
    ultima().al({ docs: [documento('b', { numero: 2 }), documento('a', { numero: 1 })] })
    expect(vistas[0]?.map((m) => m.numero)).toEqual([1, 2])
  })

  test.each([
    ['escucharProductos', 'restaurantes/r1/productos'],
    ['escucharPagos', 'restaurantes/r1/pagos'],
    ['escucharFacturas', 'restaurantes/r1/facturas'],
    ['escucharNotas', 'restaurantes/r1/notas'],
    ['escucharPersonal', 'restaurantes/r1/personal'],
  ] as const)('%s lee %s', (funcion, ruta) => {
    crearFuenteFirebase()[funcion]('r1', () => {}, () => {})
    expect(ultima().blanco.ruta).toBe(ruta)
  })

  test('solo escucha las cuentas abiertas', () => {
    crearFuenteFirebase().escucharCuentasAbiertas('r1', () => {}, () => {})
    expect(ultima().blanco).toEqual({ ruta: 'restaurantes/r1/cuentas', filtros: [['estado', 'in', ['abierta', 'pagada']]] })
  })

  test('los documentos sueltos usan su ruta y su id', () => {
    const fuente = crearFuenteFirebase()
    fuente.escucharCuenta('r1', 'c1', () => {}, () => {})
    expect(ultima().blanco).toEqual({ ruta: 'restaurantes/r1/cuentas', id: 'c1' })
    fuente.escucharPago('r1', 'p1', () => {}, () => {})
    expect(ultima().blanco).toEqual({ ruta: 'restaurantes/r1/pagos', id: 'p1' })
    const facturas: unknown[] = []
    fuente.escucharFactura('r1', 'p1', (f) => facturas.push(f), () => {})
    expect(ultima().blanco).toEqual({ ruta: 'restaurantes/r1/facturas', id: 'p1' })
    ultima().al(documento('p1', { estado: 'emitida' }))
    expect(facturas).toEqual([{ estado: 'emitida', pagoId: 'p1' }])
  })

  test('una lectura rechazada por las reglas llega como SIN_PERMISO', () => {
    const errores: { codigo: string }[] = []
    crearFuenteFirebase().escucharRestaurantes(() => {}, (e) => errores.push(e))
    expect(ultima().blanco.ruta).toBe('restaurantes')
    ultima().falla({ code: 'permission-denied' })
    expect(errores[0]?.codigo).toBe('SIN_PERMISO')
  })
})

describe('fuente', () => {
  test('no tiene simulador', () => {
    expect(crearFuenteFirebase().simulador).toBeNull()
  })

  test('las órdenes llevan el ID token del usuario actual', async () => {
    falso.usuario = usuarioFalso('marta', { rol: 'mesero', restauranteId: 'r1' })
    const pedir = vi.fn(async () => Response.json({ token: 'tok-1' }))
    vi.stubGlobal('fetch', pedir)
    await crearFuenteFirebase().liberarMesa('tok-1')
    expect(pedir).toHaveBeenCalledWith('/api/mesas/tok-1/liberar', expect.objectContaining({ headers: { Authorization: 'Bearer token-marta' } }))
    vi.unstubAllGlobals()
  })

  test('sin sesión una orden no sale', async () => {
    const pedir = vi.fn()
    vi.stubGlobal('fetch', pedir)
    await expect(crearFuenteFirebase().liberarMesa('tok-1')).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO' })
    expect(pedir).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
