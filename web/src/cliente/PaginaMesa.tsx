import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Cuenta, Mesa, Producto, Restaurante } from '../../../contratos/tipos'
import { usarFuente, usarLectura, usarSesionDeMesa } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { usarAvisos } from '../ui/Avisos'
import { Boton, Pestanas } from '../ui/Controles'
import { ErrorVista, Vacio } from '../ui/Estados'
import { EsqueletoMesa } from '../ui/Esqueletos'
import { pesos, plural } from '../ui/formato'
import { Icono } from '../ui/Icono'
import { resumenLineas } from '../ui/lineas'
import { agregar, aSolicitud, cambiarCantidad, quitarNoDisponibles, totalEstimado, unidades, unidadesDe } from './borrador'
import { Carta } from './Carta'
import { Cuenta as VistaCuenta } from './Cuenta'
import { miCobroActivo } from './cuenta'
import { HojaPagar } from './HojaPagar'
import { SeguimientoPago } from './SeguimientoPago'
import { usarPagoAbierto } from './usarPagoAbierto'
import { HojaBorrador } from './HojaBorrador'
import { HojaProducto } from './HojaProducto'
import { Pedido } from './Pedido'
import { usarBorrador } from './usarBorrador'

export function PaginaMesa({ token }: { token: string }) {
  const fuente = usarFuente()
  const sesion = usarSesionDeMesa()
  const mesa = usarLectura<Mesa | null>((a, b) => fuente.escucharMesa(token, a, b), [fuente, token])
  const valorMesa = mesa.estado === 'listo' ? mesa.valor : null
  const restauranteId = valorMesa?.restauranteId ?? null
  const cuentaId = valorMesa?.cuentaId ?? null

  const restaurante = usarLectura<Restaurante | null>(
    restauranteId ? (a, b) => fuente.escucharRestaurante(restauranteId, a, b) : null,
    [fuente, restauranteId],
  )
  const productos = usarLectura<Producto[]>(
    restauranteId ? (a, b) => fuente.escucharProductos(restauranteId, a, b) : null,
    [fuente, restauranteId],
  )
  const cuenta = usarLectura<Cuenta | null>(
    restauranteId && cuentaId ? (a, b) => fuente.escucharCuenta(restauranteId, cuentaId, a, b) : null,
    [fuente, restauranteId, cuentaId],
  )

  const yaMostrada = useRef(false)
  const error = [sesion, mesa, restaurante, productos, cuenta].find((l) => l.estado === 'error')
  if (error?.estado === 'error') {
    return (
      <Marco>
        <ErrorVista error={error.error} alReintentar={() => location.reload()} />
      </Marco>
    )
  }
  if (mesa.estado === 'listo' && mesa.valor === null) {
    return (
      <Marco>
        <Vacio icono="mesa" titulo="Este link no es de ninguna mesa" texto="Vuelve a escanear el sticker de tu mesa o pídele ayuda al mesero." />
      </Marco>
    )
  }
  // Solo la primera vez se espera la cuenta: después, al abrirse con el primer pedido, la página no parpadea.
  const cuentaLista = cuentaId === null || cuenta.estado === 'listo' || yaMostrada.current
  if (
    sesion.estado !== 'listo' ||
    !valorMesa ||
    restaurante.estado !== 'listo' ||
    !restaurante.valor ||
    productos.estado !== 'listo' ||
    !cuentaLista
  ) {
    return <EsqueletoMesa />
  }

  yaMostrada.current = true
  const valorCuenta = cuentaId && cuenta.estado === 'listo' && cuenta.valor?.estado !== 'cerrada' ? cuenta.valor : null
  return (
    <VistaMesa
      mesa={valorMesa}
      restaurante={restaurante.valor}
      productos={productos.valor}
      cuenta={valorCuenta}
      sesion={sesion.valor}
    />
  )
}

function Marco({ children }: { children: ReactNode }) {
  return <main className="pagina pagina--mesa">{children}</main>
}

/** Vitrina inventada: no vive en el contrato del restaurante. */
const VITRINA: Record<string, { lugar: string; mapa: string; red: string; foto: string }> = {
  'fogon-del-manglar': {
    lugar: 'Montería',
    mapa: 'https://www.google.com/maps/search/?api=1&query=Monter%C3%ADa%2C%20C%C3%B3rdoba',
    red: 'https://instagram.com/fogondelmanglar',
    foto: '/restaurantes/fogon-del-manglar.jpg',
  },
}

export type PestanaMesa = 'carta' | 'pedido' | 'cuenta'

export function VistaMesa({
  mesa,
  restaurante,
  productos,
  cuenta,
  sesion,
  pestanaInicial,
}: {
  mesa: Mesa
  restaurante: Restaurante
  productos: Producto[]
  cuenta: Cuenta | null
  sesion: Sesion
  pestanaInicial?: PestanaMesa
}) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [pagoAbierto, setPagoAbierto] = usarPagoAbierto(mesa.token)
  const miCobro = cuenta ? miCobroActivo(cuenta, sesion.uid) : null
  const [pestana, setPestana] = useState<PestanaMesa>(pestanaInicial ?? (pagoAbierto || miCobro ? 'cuenta' : 'carta'))
  const [pagando, setPagando] = useState(false)

  // Al volver del banco, aunque el navegador haya recargado, la página retoma el cobro activo.
  useEffect(() => {
    if (miCobro && !pagoAbierto) {
      setPagoAbierto(miCobro.id)
      setPestana('cuenta')
    }
  }, [miCobro?.id])
  const [borrador, cambiarBorrador] = usarBorrador(mesa.token, mesa.cuentaId)
  const [elegido, setElegido] = useState<Producto | null>(null)
  const [verBorrador, setVerBorrador] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<unknown>(null)

  const esPersonal = sesion.rol !== 'cliente'
  const lineasActivas = cuenta?.lineas.filter((l) => l.estado !== 'rechazada' && l.estado !== 'anulada') ?? []
  const resumen = resumenLineas(cuenta?.lineas ?? [])
  const cuantos = unidades(borrador)
  const vitrina = VITRINA[restaurante.id]

  async function enviar() {
    const { borrador: limpio, quitados } = quitarNoDisponibles(borrador, productos)
    if (quitados.length > 0) {
      cambiarBorrador(() => limpio)
      setErrorEnvio({ codigo: 'PRODUCTO_NO_DISPONIBLE' })
      return
    }
    setEnviando(true)
    setErrorEnvio(null)
    try {
      await fuente.agregarLineas(mesa.token, aSolicitud(borrador))
      cambiarBorrador(() => [])
      setVerBorrador(false)
      setPestana('pedido')
      avisos.exito(
        esPersonal ? 'Pedido enviado a cocina' : 'Pedido enviado',
        esPersonal ? undefined : 'El mesero lo confirma en un momento.',
      )
    } catch (error) {
      setErrorEnvio(error)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="pagina pagina--mesa">
      <section className="banner">
        <div className="banner__marca">
          <span className="banner__logo">
            {vitrina?.foto ? <img src={vitrina.foto} alt="" /> : <span aria-hidden="true" />}
          </span>
          <h1 className="banner__nombre">{restaurante.nombre}</h1>
        </div>
        <div className="banner__pie">
          {vitrina && (
            <a className="banner__icono" href={vitrina.red} target="_blank" rel="noreferrer" aria-label="Instagram">
              <Icono nombre="instagram" tamano={18} />
            </a>
          )}
          {vitrina && (
            <a className="banner__icono" href={vitrina.mapa} target="_blank" rel="noreferrer" aria-label={`Ubicación en ${vitrina.lugar}`}>
              <Icono nombre="ubicacion" tamano={18} />
            </a>
          )}
          <span className="banner__mesa">Mesa {mesa.numero}</span>
        </div>
      </section>

      {esPersonal && (
        <p className="nota-mesa">
          <span>Pidiendo como {sesion.nombre ?? 'personal'}</span>
          Lo que pidas va directo a cocina
        </p>
      )}
      {resumen.length > 0 && (
        <button className="nota-mesa nota-mesa--boton" onClick={() => setPestana('pedido')}>
          <span>Tu pedido va en camino</span>
          {resumen.join(' · ')}
        </button>
      )}

      <div className="barra-pestanas">
        <Pestanas
          etiqueta="Secciones de la mesa"
          valor={pestana}
          alCambiar={setPestana}
          opciones={[
            { valor: 'carta', texto: 'Carta' },
            { valor: 'pedido', texto: 'Pedido', insignia: lineasActivas.length },
            { valor: 'cuenta', texto: 'Cuenta' },
          ]}
        />
      </div>

      <div className="contenido" key={pestana}>
        {pestana === 'carta' && (
          <Carta productos={productos} enBorrador={(id) => unidadesDe(borrador, id)} alElegir={setElegido} />
        )}
        {pestana === 'pedido' && <Pedido cuenta={cuenta} alVerCarta={() => setPestana('carta')} />}
        {pestana === 'cuenta' &&
          (pagoAbierto ? (
            <SeguimientoPago
              key={pagoAbierto}
              token={mesa.token}
              pagoId={pagoAbierto}
              restauranteId={mesa.restauranteId}
              sesion={sesion}
              alVolver={() => setPagoAbierto(null)}
              alReintentar={() => {
                setPagoAbierto(null)
                setPagando(true)
              }}
            />
          ) : (
            <VistaCuenta
              cuenta={cuenta}
              sesion={sesion}
              alPagar={() => setPagando(true)}
              alVerMiCobro={setPagoAbierto}
              alVerPago={setPagoAbierto}
              alVerCarta={() => setPestana('carta')}
            />
          ))}
      </div>

      <div className="barra-flotante" data-visible={cuantos > 0 && pestana !== 'cuenta'} inert={cuantos === 0 || pestana === 'cuenta'}>
        <Boton ancho className="boton--barra" onClick={() => setVerBorrador(true)}>
          <span className="burbuja">{cuantos}</span>
          <span>Ver {plural(cuantos, 'producto')}</span>
          <strong>{pesos(totalEstimado(borrador, productos))}</strong>
        </Boton>
      </div>

      <HojaProducto
        producto={elegido}
        alCerrar={() => setElegido(null)}
        alAgregar={(producto, cantidad, nota) => {
          cambiarBorrador((actual) => agregar(actual, producto.id, cantidad, nota))
          setElegido(null)
        }}
      />
      {cuenta && (
        <HojaPagar
          abierta={pagando}
          alCerrar={() => setPagando(false)}
          titulo="Pagar la cuenta"
          subtotal={cuenta.porPagar}
          destino={{ tipo: 'saldo' }}
          restaurante={restaurante}
          token={mesa.token}
          alCrear={(pago) => {
            setPagando(false)
            setPagoAbierto(pago.id)
          }}
        />
      )}
      <HojaBorrador
        abierta={verBorrador}
        alCerrar={() => {
          setVerBorrador(false)
          setErrorEnvio(null)
        }}
        borrador={borrador}
        productos={productos}
        esPersonal={esPersonal}
        enviando={enviando}
        error={errorEnvio}
        alCambiarCantidad={(clave, cantidad) => cambiarBorrador((actual) => cambiarCantidad(actual, clave, cantidad))}
        alEnviar={enviar}
      />
    </main>
  )
}
