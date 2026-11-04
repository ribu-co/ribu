import { useRef, useState, type ReactNode } from 'react'
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
import { HojaBorrador } from './HojaBorrador'
import { HojaProducto } from './HojaProducto'
import { Pedido } from './Pedido'
import { usarBorrador } from './usarBorrador'

export function PaginaMesa({ token }: { token: string }) {
  const fuente = usarFuente()
  const sesion = usarSesionDeMesa()
  // Firestore solo deja leer con sesión: nada se escucha hasta que exista, aunque sea anónima.
  const uid = sesion.estado === 'listo' ? sesion.valor.uid : null
  const mesa = usarLectura<Mesa | null>(uid ? (a, b) => fuente.escucharMesa(token, a, b) : null, [fuente, token, uid])
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
  if (restaurante.estado === 'listo' && restaurante.valor === null) {
    return (
      <Marco>
        <Vacio icono="mesa" titulo="Este restaurante ya no está en Ribu" texto="El sticker de la mesa quedó viejo. Pídele al mesero la carta y la cuenta." />
      </Marco>
    )
  }
  if (sesion.estado === 'listo' && sesion.valor.rol === 'cocina') {
    return (
      <Marco>
        <Vacio icono="mesa" titulo="Entraste como cocina" texto="La cocina no pide desde la mesa. Para pedir aquí, sal y entra como cliente o como mesero.">
          <Boton variante="secundario" onClick={() => void fuente.salir()}>
            Salir de la cocina
          </Boton>
        </Vacio>
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

export type PestanaMesa = 'carta' | 'pedido'

export function VistaMesa({
  mesa,
  restaurante,
  productos,
  cuenta,
  sesion,
  pestanaInicial = 'carta',
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
  const [pestana, setPestana] = useState<PestanaMesa>(pestanaInicial)
  const [borrador, cambiarBorrador] = usarBorrador(mesa.token, mesa.cuentaId)
  const [elegido, setElegido] = useState<Producto | null>(null)
  const [verBorrador, setVerBorrador] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<unknown>(null)

  const esPersonal = sesion.rol !== 'cliente'
  const lineasActivas = cuenta?.lineas.filter((l) => l.estado !== 'rechazada' && l.estado !== 'anulada') ?? []
  const resumen = resumenLineas(cuenta?.lineas ?? [])
  const cuantos = unidades(borrador)

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
      <header className="cabecera">
        <div className="marca">
          <span className="marca__logo" aria-hidden="true">
            <span />
          </span>
          <span className="marca__nombre">{restaurante.nombre}</span>
        </div>
        <span className="pastilla">Mesa {mesa.numero}</span>
      </header>

      <section className="hero">
        <p className="hero__etiqueta">{esPersonal ? `Pidiendo como ${sesion.nombre ?? 'personal'}` : `Mesa ${mesa.numero}`}</p>
        <h1 className="hero__titulo">
          {esPersonal ? 'Lo que pidas va directo a cocina' : lineasActivas.length ? 'Tu pedido va en camino' : '¿Qué se te antoja hoy?'}
        </h1>
        {resumen.length > 0 ? (
          <button className="hero__resumen" onClick={() => setPestana('pedido')}>
            <span>{resumen.join(' · ')}</span>
            <span className="icono-circulo">
              <Icono nombre="flecha" tamano={16} />
            </span>
          </button>
        ) : (
          <p className="hero__texto">Pide desde aquí. El mesero confirma y la cocina empieza.</p>
        )}
      </section>

      <div className="barra-pestanas">
        <Pestanas
          etiqueta="Secciones de la mesa"
          valor={pestana}
          alCambiar={setPestana}
          opciones={[
            { valor: 'carta', texto: 'Carta' },
            { valor: 'pedido', texto: 'Pedido', insignia: lineasActivas.length },
          ]}
        />
      </div>

      <div className="contenido" key={pestana}>
        {pestana === 'carta' && (
          <Carta productos={productos} enBorrador={(id) => unidadesDe(borrador, id)} alElegir={setElegido} />
        )}
        {pestana === 'pedido' && <Pedido cuenta={cuenta} alVerCarta={() => setPestana('carta')} />}
      </div>

      <div className="barra-flotante" data-visible={cuantos > 0} inert={cuantos === 0}>
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
