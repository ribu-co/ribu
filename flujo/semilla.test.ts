import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { baseSinImpuesto } from '../contratos/reglas'
import type { Mesa, Producto, Restaurante } from '../contratos/tipos'
import { crearEscenario, quien } from './apoyo-pruebas'
import { correoDemo, leerSolicitudSemilla, RESTAURANTE_DEMO, sembrar } from './semilla'

const CLAVES = { plataforma: 'clave-plataforma', admin: 'clave-admin-1', mesero: 'clave-mesero-1', cocina: 'clave-cocina-1' }
const solicitud = (reiniciarDemo = false) => ({ claves: CLAVES, reiniciarDemo, actualizarClaves: false })
const ORIGEN = 'https://ribu.test'

const productoDemo = (e: ReturnType<typeof crearEscenario>, id: string) =>
  e.db.leer<Producto>(`restaurantes/${RESTAURANTE_DEMO}/productos/${id}`) as Promise<Producto>

function cartaDelDocumento() {
  const documento = readFileSync(new URL('../docs/datos-demo.md', import.meta.url), 'utf8')
  const pesos = (texto: string) => Number(texto.replaceAll('.', '').replace(',', '.'))
  return [...documento.matchAll(/^\| `([\w-]+)` \| (.+?) \| (.+?) \| ([\d.]+) \| ([\d.,]+) \| \*{0,2}(\d+)\*{0,2} \| (.+?) \|$/gm)].map((fila) => ({
    id: fila[1] as string,
    nombre: fila[2] as string,
    categoria: fila[3] as string,
    precio: pesos(fila[4] as string),
    base: pesos(fila[5] as string),
    stock: Number(fila[6]),
    descripcion: fila[7] as string,
  }))
}

describe('sembrar', () => {
  test('crea el restaurante, las 5 mesas y las cuentas, con sus claims', async () => {
    const e = crearEscenario()
    const resultado = await sembrar(e.ctx, solicitud(), ORIGEN)
    expect(resultado.restauranteId).toBe('fogon-del-manglar')
    expect(await e.db.leer<Restaurante>('restaurantes/fogon-del-manglar')).toEqual({
      id: 'fogon-del-manglar',
      nombre: 'Fogón del Manglar',
      impuesto: { tipo: 'INC', porcentaje: 8 },
      propinasSugeridas: [0, 5, 8, 10],
      activo: true,
    })
    expect(resultado.mesas.map((m) => m.numero)).toEqual([1, 2, 3, 4, 5])
    for (const { token, link } of resultado.mesas) {
      expect(link).toBe(`${ORIGEN}/m/${token}`)
      expect(await e.db.leer<Mesa>(`mesas/${token}`)).toMatchObject({ restauranteId: RESTAURANTE_DEMO, estado: 'libre', cuentaId: null })
    }
    expect(new Set(resultado.mesas.map((m) => m.token)).size).toBe(5)

    for (const rol of ['plataforma', 'admin', 'mesero', 'cocina'] as const) {
      expect(correoDemo(rol)).toBe(`${rol}@ribu.test`)
      const uid = e.authFalsa.usuarios.get(`${rol}@ribu.test`) as string
      expect(uid).toBeTruthy()
      expect(e.authFalsa.claves.get(uid)).toBe(CLAVES[rol])
      expect(e.authFalsa.claims.get(uid)).toEqual(rol === 'plataforma' ? { rol } : { rol, restauranteId: RESTAURANTE_DEMO })
      const personal = await e.db.leer(`restaurantes/${RESTAURANTE_DEMO}/personal/${uid}`)
      if (rol === 'plataforma') expect(personal).toBeNull()
      else expect(personal).toMatchObject({ uid, rol, activo: true, correo: `${rol}@ribu.test` })
    }
  })

  test('la carta es la de docs/datos-demo.md, con sus 12 productos', async () => {
    const e = crearEscenario()
    await sembrar(e.ctx, solicitud(), ORIGEN)
    const documento = cartaDelDocumento()
    expect(documento).toHaveLength(12)
    for (const { id, nombre, categoria, precio, base, stock, descripcion } of documento) {
      expect(await productoDemo(e, id)).toEqual({
        id,
        restauranteId: RESTAURANTE_DEMO,
        nombre,
        categoria,
        precio,
        stock,
        descripcion,
        disponible: true,
        imagenUrl: `/platos/${id}.jpg`,
      })
      expect(baseSinImpuesto(precio, { tipo: 'INC', porcentaje: 8 })).toBe(base)
    }
  })

  test('correrla otra vez no cambia los tokens de las mesas: los stickers ya están grabados', async () => {
    const e = crearEscenario()
    const primera = await sembrar(e.ctx, solicitud(), ORIGEN)
    const segunda = await sembrar(e.ctx, solicitud(), ORIGEN)
    const tercera = await sembrar(e.ctx, solicitud(true), ORIGEN)
    expect(segunda.mesas).toEqual(primera.mesas)
    expect(tercera.mesas).toEqual(primera.mesas)
    expect(segunda.cuentas).toEqual(primera.cuentas)
  })

  test('crea solo la mesa que falte', async () => {
    const e = crearEscenario()
    const primera = await sembrar(e.ctx, solicitud(), ORIGEN)
    const borrada = primera.mesas[2]!.token
    await e.db.transaccion(async (tx) => tx.borrar(`mesas/${borrada}`))
    const segunda = await sembrar(e.ctx, solicitud(), ORIGEN)
    expect(segunda.mesas.filter((m) => m.numero !== 3)).toEqual(primera.mesas.filter((m) => m.numero !== 3))
    expect(segunda.mesas.find((m) => m.numero === 3)?.token).not.toBe(borrada)
  })

  test('sin reiniciar no pisa el stock ni lo que el administrador cambió en la carta', async () => {
    const e = crearEscenario()
    await sembrar(e.ctx, solicitud(), ORIGEN)
    await e.db.transaccion(async (tx) => {
      tx.actualizar(`restaurantes/${RESTAURANTE_DEMO}/productos/mojarra-frita`, { stock: 0, disponible: false, precio: 40_000 })
    })
    await sembrar(e.ctx, solicitud(), ORIGEN)
    expect(await productoDemo(e, 'mojarra-frita')).toMatchObject({ stock: 0, disponible: false, precio: 40_000 })
  })

  test('completa la foto de lo ya sembrado, sin tocar la que puso el administrador ni el stock', async () => {
    const e = crearEscenario()
    await sembrar(e.ctx, solicitud(), ORIGEN)
    await e.db.transaccion(async (tx) => {
      tx.actualizar(`restaurantes/${RESTAURANTE_DEMO}/productos/agua`, { imagenUrl: null, stock: 7 })
      tx.actualizar(`restaurantes/${RESTAURANTE_DEMO}/productos/cocada`, { imagenUrl: '/mi-foto.jpg' })
    })
    await sembrar(e.ctx, solicitud(), ORIGEN)
    expect(await productoDemo(e, 'agua')).toMatchObject({ imagenUrl: '/platos/agua.jpg', stock: 7 })
    expect((await productoDemo(e, 'cocada')).imagenUrl).toBe('/mi-foto.jpg')
  })

  test('reiniciar la demo le devuelve el stock a la mojarra entre ensayos', async () => {
    const e = crearEscenario()
    const { mesas } = await sembrar(e.ctx, solicitud(), ORIGEN)
    const token = mesas[2]!.token
    const { uid } = (await sembrar(e.ctx, solicitud(), ORIGEN)).cuentas.find((c) => c.rol === 'mesero')!
    const mesero = `mesero:${uid}:${RESTAURANTE_DEMO}`

    const { datos: cuenta } = await e.pedir('POST', `/api/mesas/${token}/lineas`, mesero, { items: [{ productoId: 'mojarra-frita', cantidad: 2, nota: null }] })
    expect(await productoDemo(e, 'mojarra-frita')).toMatchObject({ stock: 0, disponible: false })

    const reinicio = await sembrar(e.ctx, solicitud(true), ORIGEN)
    expect(await productoDemo(e, 'mojarra-frita')).toMatchObject({ stock: 2, disponible: true })
    expect(await e.db.leer(`mesas/${token}`)).toMatchObject({ estado: 'libre', cuentaId: null })
    expect(await e.db.leer(`restaurantes/${RESTAURANTE_DEMO}/cuentas/${cuenta.id}`)).toMatchObject({ estado: 'cerrada' })
    expect(reinicio.mesas.find((m) => m.numero === 3)?.token).toBe(token)
  })

  test('volver a correrla reactiva una cuenta del personal', async () => {
    const e = crearEscenario()
    const { cuentas } = await sembrar(e.ctx, solicitud(), ORIGEN)
    const { uid } = cuentas.find((c) => c.rol === 'mesero')!
    await e.db.transaccion(async (tx) => tx.actualizar(`restaurantes/${RESTAURANTE_DEMO}/personal/${uid}`, { activo: false }))
    await sembrar(e.ctx, solicitud(), ORIGEN)
    expect(await e.db.leer(`restaurantes/${RESTAURANTE_DEMO}/personal/${uid}`)).toMatchObject({ activo: true })
  })

  test('volver a correrla no cambia las claves, porque eso cerraría las sesiones abiertas, salvo que se pida', async () => {
    const e = crearEscenario()
    const { cuentas } = await sembrar(e.ctx, solicitud(), ORIGEN)
    const { uid } = cuentas.find((c) => c.rol === 'mesero')!
    const otras = { ...CLAVES, mesero: 'otra-clave-larga' }
    await sembrar(e.ctx, { ...solicitud(), claves: otras }, ORIGEN)
    expect(e.authFalsa.claves.get(uid)).toBe(CLAVES.mesero)
    await sembrar(e.ctx, { claves: otras, reiniciarDemo: false, actualizarClaves: true }, ORIGEN)
    expect(e.authFalsa.claves.get(uid)).toBe('otra-clave-larga')
  })

  test('las claves nunca se guardan', async () => {
    const e = crearEscenario()
    const resultado = await sembrar(e.ctx, solicitud(), ORIGEN)
    const todo = JSON.stringify(e.db.volcado()) + JSON.stringify(resultado)
    for (const clave of Object.values(CLAVES)) expect(todo).not.toContain(clave)
  })

  test('lo sembrado sirve de verdad: la mesa recibe un pedido', async () => {
    const e = crearEscenario()
    const { mesas } = await sembrar(e.ctx, solicitud(), ORIGEN)
    const { status } = await e.pedir('POST', `/api/mesas/${mesas[0]!.token}/lineas`, quien.cliente(), { items: [{ productoId: 'agua', cantidad: 1, nota: null }] })
    expect(status).toBe(201)
  })
})

describe('leerSolicitudSemilla', () => {
  test('exige las cuatro claves, con largo mínimo', () => {
    expect(() => leerSolicitudSemilla({})).toThrow()
    expect(() => leerSolicitudSemilla({ claves: { ...CLAVES, cocina: 'corta' } })).toThrow()
    expect(() => leerSolicitudSemilla({ claves: { ...CLAVES, admin: 123 } })).toThrow()
    expect(leerSolicitudSemilla({ claves: CLAVES })).toEqual({ claves: CLAVES, reiniciarDemo: false, actualizarClaves: false })
  })

  test('reiniciar solo con true explícito', () => {
    expect(leerSolicitudSemilla({ claves: CLAVES, reiniciarDemo: 'true' }).reiniciarDemo).toBe(false)
    expect(leerSolicitudSemilla({ claves: CLAVES, reiniciarDemo: true }).reiniciarDemo).toBe(true)
  })

  test('un mensaje de error no repite las claves', () => {
    try {
      leerSolicitudSemilla({ claves: { ...CLAVES, cocina: 'corta' } })
    } catch (error) {
      expect((error as Error).message).not.toContain('corta')
    }
  })
})
