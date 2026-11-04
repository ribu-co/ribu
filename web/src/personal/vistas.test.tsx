import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'
import type { Cuenta, LineaPedido, Mesa, ResumenPago } from '../../../contratos/tipos'
import { ProveedorDatos } from '../datos/contexto'
import { crearFuenteMemoria } from '../datos/memoria'
import { semillaDemo } from '../datos/semilla'
import { ProveedorAvisos } from '../ui/Avisos'
import type { SesionPersonal } from './logica'
import { VistaMesaMesero } from './MesaDetalle'
import { VistaCocina } from './PaginaCocina'
import { FormularioEntrada } from './PaginaEntrada'
import { VistaTablero } from './PaginaMesero'
import { AccesoNegado } from './Puerta'

const semilla = semillaDemo()
const restaurante = semilla.restaurantes[0]!
const mesero: SesionPersonal = { uid: 'personal-mesero', rol: 'mesero', restauranteId: restaurante.id, nombre: 'Marta (mesera)' }
const cocina: SesionPersonal = { uid: 'personal-cocina', rol: 'cocina', restauranteId: restaurante.id, nombre: 'Cocina' }
const mesa: Mesa = { token: 'demo-mesa-3', restauranteId: restaurante.id, numero: 3, estado: 'ocupada', cuentaId: 'c1' }

const linea = (l: Partial<LineaPedido>): LineaPedido => ({
  id: 'l',
  productoId: 'p',
  nombre: 'Jugo de corozo',
  precio: 8_100,
  cantidad: 1,
  nota: null,
  ronda: 1,
  estado: 'confirmada',
  origen: 'cliente',
  motivo: null,
  cantidadCubierta: 0,
  creadaEn: '2026-11-04T17:00:00Z',
  ...l,
})

const pago = (p: Partial<ResumenPago>): ResumenPago => ({
  id: 'p1',
  numero: 1,
  parte: null,
  subtotal: 10_000,
  total: 10_000,
  medio: 'efectivo',
  estado: 'pagado',
  estadoFactura: 'emitida',
  incidencia: null,
  creadoPor: mesero.uid,
  ...p,
})

const cuenta = (c: Partial<Cuenta>): Cuenta => ({
  id: 'c1',
  restauranteId: restaurante.id,
  mesaToken: mesa.token,
  numeroMesa: 3,
  estado: 'abierta',
  lineas: [],
  division: null,
  pagos: [],
  consumo: 0,
  pagado: 0,
  enCobro: 0,
  porPagar: 0,
  abiertaEn: '2026-11-04T17:00:00Z',
  cerradaEn: null,
  ...c,
})

const pintar = (vista: ReactNode) =>
  renderToStaticMarkup(
    <ProveedorDatos fuente={crearFuenteMemoria()}>
      <ProveedorAvisos>{vista}</ProveedorAvisos>
    </ProveedorDatos>,
  )

test('la entrada pide correo y clave, y en memoria ofrece las cuentas de la demo sin mostrar la clave', () => {
  const html = pintar(<FormularioEntrada />)
  expect(html).toContain('type="email"')
  expect(html).toContain('type="password"')
  expect(html).toContain('Entrar como mesero')
  expect(html).not.toContain('ribu-demo')
})

test('sin sesión u otro rol: mensaje y enlace a /personal', () => {
  const sinSesion = pintar(<AccesoNegado acceso={{ tipo: 'sin_sesion' }} pantalla="cocina" alSalir={() => {}} />)
  expect(sinSesion).toContain('Primero hay que entrar')
  expect(sinSesion).toContain('href="/personal"')

  const otroRol = pintar(<AccesoNegado acceso={{ tipo: 'otro_rol', sesion: mesero }} pantalla="cocina" alSalir={() => {}} />)
  expect(otroRol).toContain('Esta pantalla es de cocina')
  expect(otroRol).toContain('Entraste como mesero')
  expect(otroRol).toContain('href="/personal"')
})

test('el tablero muestra cada mesa con su estado y enlaza a su detalle', () => {
  const libre: Mesa = { ...semilla.mesas[0]!, estado: 'libre', cuentaId: null }
  const html = pintar(
    <VistaTablero
      restaurante={restaurante.nombre}
      sesion={mesero}
      mesas={[libre, mesa]}
      cuentas={[cuenta({ lineas: [linea({ estado: 'pendiente', cantidad: 2 })], porPagar: 16_200, consumo: 16_200 })]}
    />,
  )
  expect(html).toContain('Libre')
  expect(html).toContain('2 por confirmar')
  expect(html).toContain('Saldo $16.200')
  expect(html).toContain('href="/mesero/demo-mesa-3"')
  expect(html).toContain('1 mesa por confirmar')
  expect(html).toContain('Ir a la mesa 3')
})

const cuentaCompleta = cuenta({
  lineas: [
    linea({ id: 'a', ronda: 1, nombre: 'Mojarra frita', nota: 'sin ensalada', estado: 'entregada', cantidadCubierta: 1, precio: 32_400 }),
    linea({ id: 'b', ronda: 2, estado: 'pendiente', cantidad: 2 }),
    linea({ id: 'c', ronda: 2, nombre: 'Agua en botella', estado: 'rechazada', motivo: 'Se acabó', origen: 'personal' }),
  ],
  division: { partes: 2, montos: [16_200, 16_200] },
  pagos: [pago({ parte: 1, subtotal: 16_200, total: 17_000 })],
  consumo: 32_400,
  pagado: 16_200,
  enCobro: 0,
  porPagar: 16_200,
})

test('la pestaña de pedido muestra cada línea: ronda, nota, estado, origen, motivo y acciones', () => {
  const html = pintar(<VistaMesaMesero mesa={mesa} restaurante={restaurante} sesion={mesero} cuenta={cuentaCompleta} />)
  for (const texto of ['Ronda 1', 'Ronda 2', 'Mojarra frita', '“sin ensalada”', 'Por confirmar', 'Rechazado', 'Se acabó', 'Pidió el cliente', 'Pidió el personal', '1 de 1 en un pago']) {
    expect(html).toContain(texto)
  }
  expect(html).toContain('1 línea por confirmar')
  expect(html).toContain('Consumo $32.400 · Por pagar $16.200')
  expect(html).toContain('href="/m/demo-mesa-3"')
  expect(html).toContain('Tomar pedido')
  expect(html).toContain('Confirmar y enviar a cocina')
  expect(html).toContain('aria-label="Rechazar: Jugo de corozo"')
  expect(html).not.toContain('aria-label="Anular: Mojarra frita"')
})

test('la pestaña de cuenta muestra los totales, la división y los pagos', () => {
  const html = pintar(<VistaMesaMesero mesa={mesa} restaurante={restaurante} sesion={mesero} cuenta={cuentaCompleta} pestanaInicial="cuenta" />)
  for (const texto of ['Consumo', 'Pagado', 'En cobro', 'Por pagar', '$32.400', '$16.200']) expect(html).toContain(texto)
  expect(html).toContain('Dividida en 2 partes')
  expect(html).toContain('1 de 2 pagadas')
  expect(html).toContain('Pagos de la mesa')
  expect(html).toContain('Efectivo · Por ti')
  expect(html).toContain('Factura emitida')
})

test('liberar queda deshabilitado y dice qué falta; sin pendientes y pagada se puede', () => {
  const conSaldo = pintar(
    <VistaMesaMesero mesa={mesa} restaurante={restaurante} sesion={mesero} pestanaInicial="cuenta" cuenta={cuenta({ lineas: [linea({ estado: 'pendiente' }), linea({ id: 'x', precio: 8_100 })], consumo: 8_100, porPagar: 8_100 })} />,
  )
  expect(conSaldo).toMatch(/<button[^>]*disabled=""[^>]*><span[^>]*>Liberar la mesa/)
  expect(conSaldo).toContain('Falta resolver: 1 producto por confirmar, $8.100 de saldo.')

  const pagada = pintar(
    <VistaMesaMesero mesa={mesa} restaurante={restaurante} sesion={mesero} pestanaInicial="cuenta" cuenta={cuenta({ estado: 'pagada', lineas: [linea({ cantidadCubierta: 1 })], consumo: 8_100, pagado: 8_100 })} />,
  )
  expect(pagada).not.toMatch(/<button[^>]*disabled=""[^>]*><span[^>]*>Liberar la mesa/)
  expect(pagada).not.toContain('Falta resolver')
})

test('una mesa libre invita a tomar pedido', () => {
  const html = pintar(<VistaMesaMesero mesa={{ ...mesa, estado: 'libre', cuentaId: null }} restaurante={restaurante} sesion={mesero} cuenta={null} />)
  expect(html).toContain('Mesa libre')
  expect(html).toContain('Tomar pedido')
})

test('la cocina no muestra precios y agrupa por mesa', () => {
  const html = pintar(
    <VistaCocina
      restaurante={restaurante.nombre}
      sesion={cocina}
      cuentas={[cuenta({ consumo: 16_200, porPagar: 16_200, lineas: [linea({ cantidad: 2, nota: 'en leche' }), linea({ id: 'p', estado: 'pendiente', nombre: 'Cocada' }), linea({ id: 'e', estado: 'en_preparacion', nombre: 'Enyucado' })] })]}
    />,
  )
  expect(html).toContain('Mesa 3')
  expect(html).toContain('“en leche”')
  expect(html).toContain('Empezar')
  expect(html).toContain('Enyucado')
  expect(html).not.toContain('Cocada')
  expect(html).not.toContain('$')
})

test('sin nada por preparar, la cocina lo dice', () => {
  const html = pintar(<VistaCocina restaurante={restaurante.nombre} sesion={cocina} cuentas={[]} />)
  expect(html).toContain('Nada por preparar')
  expect(html).toContain('Todo al día')
})
