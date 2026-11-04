import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { Cuenta as TipoCuenta, Factura, Pago } from '../../../contratos/tipos'
import { ProveedorDatos } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { crearFuenteMemoria } from '../datos/memoria'
import { ProveedorAvisos } from '../ui/Avisos'
import { Cuenta } from './Cuenta'
import { FACTURA_EN_CAMINO } from './cuenta'
import { DetallePago, TarjetaFactura } from './SeguimientoPago'

const yo: Sesion = { uid: 'anonimo-yo', rol: 'cliente', restauranteId: null, nombre: null }
const nada = () => {}

const pago = (p: Partial<Pago> = {}): Pago => ({
  id: 'pago-1',
  numero: 1,
  parte: null,
  subtotal: 56_400,
  total: 61_622,
  medio: 'factus_pay',
  estado: 'esperando_pago',
  estadoFactura: 'sin_emitir',
  incidencia: null,
  creadoPor: yo.uid,
  restauranteId: 'fogon-del-manglar',
  cuentaId: 'cuenta-1',
  mesaToken: 'demo-mesa-3',
  destino: { tipo: 'saldo' },
  items: [],
  impuesto: { tipo: 'INC', porcentaje: 8 },
  baseSinImpuesto: 52_222.22,
  propinaPorcentaje: 10,
  propina: 5_222,
  cobro: {
    referencia: 'pago-1',
    monto: 61_622,
    estado: 'ready',
    qrBase64: 'iVBORw0KGgo=',
    llaveBreB: '@ribu12345678',
    qrExpiraEn: '2026-11-04T17:10:00Z',
    recaudadoEn: null,
  },
  creadoEn: '2026-11-04T17:00:00Z',
  pagadoEn: null,
  ...p,
})

const factura = (f: Partial<Factura> = {}): Factura => ({
  pagoId: 'pago-1',
  restauranteId: 'fogon-del-manglar',
  pagadorUid: yo.uid,
  estado: 'emitida',
  comprador: { tipo: 'consumidor_final', correo: null },
  datos: { numero: 'SETP990000123', cufe: 'cufe-de-prueba-abc', qrUrl: 'https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=abc', urlPublica: 'https://ejemplo.co/f' },
  intentos: 1,
  ultimoError: null,
  correo: { estado: 'sin_correo', destino: null, ultimoError: null, enviadoEn: null },
  pagador: null,
  notas: [],
  emitidaEn: '2026-11-04T17:05:00Z',
  ...f,
})

const pintar = (nodo: React.ReactNode) =>
  renderToStaticMarkup(
    <ProveedorDatos fuente={crearFuenteMemoria()}>
      <ProveedorAvisos>{nodo}</ProveedorAvisos>
    </ProveedorDatos>,
  )

const detalle = (p: Pago, sesion: Sesion = yo) =>
  pintar(<DetallePago token="demo-mesa-3" pago={p} restauranteId="fogon-del-manglar" sesion={sesion} alVolver={nada} alReintentar={nada} />)

test('el cobro muestra el monto exacto, la llave para copiar y el QR', () => {
  const html = detalle(pago())
  expect(html).toContain('$61.622')
  expect(html).toContain('$56.400 de consumo + $5.222 de propina (10 %)')
  expect(html).toContain('@ribu12345678')
  expect(html).toContain('Copiar llave')
  expect(html).toContain('aria-label="Copiar el monto"')
  expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
  expect(html).toContain('Esperando la confirmación del banco')
})

test('mientras Factus Pay dibuja el QR, la llave y el QR son huesos del mismo tamaño', () => {
  const html = detalle(pago({ cobro: { ...pago().cobro!, estado: 'started', qrBase64: null, llaveBreB: null } }))
  expect(html).toMatch(/class="[^"]*hueso[^"]*llave/)
  expect(html).toMatch(/class="[^"]*hueso[^"]*qr/)
  expect(html).not.toContain('Copiar llave')
})

test('quien creó el pago ve su factura; los demás de la mesa solo ven "Pagado"', () => {
  const pagado = pago({ estado: 'pagado', estadoFactura: 'emitida' })
  expect(detalle(pagado)).toContain('Pago recibido')

  const otro: Sesion = { ...yo, uid: 'anonimo-otro' }
  const html = detalle(pagado, otro)
  expect(html).toContain('Pagado')
  expect(html).toContain('La factura le llega a quien pagó')
  expect(html).not.toContain('Pago recibido')
})

test('un pago duplicado no se esconde: se explica la devolución', () => {
  const html = detalle(pago({ estado: 'pagado', incidencia: 'pago_duplicado' }))
  expect(html).toContain('ya estaba cubierto')
  expect(html).toContain('te devuelve $61.622')
})

test('un cobro vencido ofrece generar otro', () => {
  const html = detalle(pago({ estado: 'vencido' }))
  expect(html).toContain('El QR venció')
  expect(html).toContain('No se cobró nada')
  expect(html).toContain('Generar otro cobro')
})

test('la factura emitida trae número, CUFE, PDF, enlace a la DIAN y correo', () => {
  const html = pintar(<TarjetaFactura token="demo-mesa-3" pago={pago({ estado: 'pagado' })} factura={factura()} />)
  expect(html).toContain('Factura SETP990000123')
  expect(html).toContain('cufe-de-prueba-abc')
  expect(html).toContain('PDF')
  expect(html).toContain('href="https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=abc"')
  expect(html).toContain('Envíala a tu correo')
})

test.each(['sin_emitir', 'en_proceso', 'en_validacion', 'rechazada'] as const)('con la factura %s queda claro que el pago entró', (estado) => {
  const html = pintar(<TarjetaFactura token="demo-mesa-3" pago={pago({ estado: 'pagado' })} factura={factura({ estado, datos: null })} />)
  expect(html).toContain('Tu pago quedó registrado')
  expect(html).toContain('Factura en camino')
  expect(html).toContain(FACTURA_EN_CAMINO[estado])
  expect(html).not.toContain('error')
})

const cuenta = (c: Partial<TipoCuenta>): TipoCuenta => ({
  id: 'cuenta-1',
  restauranteId: 'fogon-del-manglar',
  mesaToken: 'demo-mesa-3',
  numeroMesa: 3,
  estado: 'abierta',
  lineas: [
    { id: 'l1', productoId: 'mojarra-frita', nombre: 'Mojarra frita', precio: 32_400, cantidad: 1, nota: null, ronda: 1, estado: 'confirmada', origen: 'cliente', motivo: null, cantidadCubierta: 0, creadaEn: '' },
    { id: 'l2', productoId: 'agua', nombre: 'Agua en botella', precio: 4_050, cantidad: 1, nota: null, ronda: 2, estado: 'pendiente', origen: 'cliente', motivo: null, cantidadCubierta: 0, creadaEn: '' },
  ],
  division: null,
  pagos: [],
  consumo: 32_400,
  pagado: 0,
  enCobro: 0,
  porPagar: 32_400,
  abiertaEn: '',
  cerradaEn: null,
  ...c,
})

const pintarCuenta = (c: TipoCuenta) => pintar(<Cuenta cuenta={c} sesion={yo} alPagar={nada} alVerMiCobro={nada} alVerPago={nada} alVerCarta={nada} />)

test('la cuenta cobra solo lo confirmado y avisa lo que espera al mesero', () => {
  const html = pintarCuenta(cuenta({}))
  expect(html).toContain('Pagar $32.400')
  expect(html).toContain('1 producto esperan al mesero')
  expect(html).not.toContain('Agua en botella')
})

test('con todo pagado no se ofrece pagar', () => {
  const html = pintarCuenta(cuenta({ pagado: 32_400, porPagar: 0, pagos: [pago({ estado: 'pagado', total: 32_400 })] }))
  expect(html).toContain('La cuenta está pagada')
  expect(html).not.toContain('Pagar $')
})

test('con un cobro activo propio se muestra ese cobro en vez de otro botón de pagar', () => {
  const html = pintarCuenta(cuenta({ enCobro: 32_400, porPagar: 0, pagos: [pago({ total: 35_640 })] }))
  expect(html).toContain('Tienes un cobro activo de $35.640')
  expect(html).not.toContain('Pagar $')
})

test('el cobro de otra persona se ve, pero sin abrirlo', () => {
  const html = pintarCuenta(cuenta({ enCobro: 32_400, porPagar: 0, pagos: [pago({ creadoPor: 'anonimo-otro' })] }))
  expect(html).toContain('Alguien de la mesa está pagando $56.400')
  expect(html).toMatch(/<button class="pago-fila" disabled=""/)
  expect(html).toContain('Otra persona')
})
