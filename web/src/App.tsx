import { lazy, Suspense } from 'react'
import { PaginaMesa } from './cliente/PaginaMesa'
import { Creditos } from './Creditos'
import { Inicio } from './Inicio'
import { PaginaMesaMesero } from './personal/MesaDetalle'
import { PaginaCocina } from './personal/PaginaCocina'
import { PaginaEntrada } from './personal/PaginaEntrada'
import { PaginaMesero } from './personal/PaginaMesero'
import { coincidir, usarRuta } from './ruta'
import { Cargando, Vacio } from './ui/Estados'

// Quien llega por un sticker no descarga los paneles.
const PaginaAdmin = lazy(() => import('./admin/PaginaAdmin').then((m) => ({ default: m.PaginaAdmin })))
const PaginaPlataforma = lazy(() => import('./plataforma/PaginaPlataforma').then((m) => ({ default: m.PaginaPlataforma })))

export function App() {
  const ruta = usarRuta()

  const mesa = coincidir('/m/:token', ruta)
  if (mesa) return <PaginaMesa key={mesa.token} token={mesa.token as string} />
  if (ruta === '/') return <Inicio />
  if (ruta === '/creditos') return <Creditos />
  if (ruta === '/personal') return <PaginaEntrada />
  if (ruta === '/mesero') return <PaginaMesero />
  const mesaDelMesero = coincidir('/mesero/:token', ruta)
  if (mesaDelMesero) return <PaginaMesaMesero key={mesaDelMesero.token} token={mesaDelMesero.token as string} />
  if (ruta === '/cocina') return <PaginaCocina />
  if (coincidir('/plataforma', ruta)) {
    return (
      <Suspense fallback={<main className="pagina"><Cargando /></main>}>
        <PaginaPlataforma />
      </Suspense>
    )
  }

  const admin = coincidir('/admin/:restauranteId', ruta)
  if (admin || coincidir('/admin', ruta)) {
    return (
      <Suspense fallback={<main className="pagina"><Cargando /></main>}>
        <PaginaAdmin key={admin?.restauranteId ?? ''} restauranteId={admin?.restauranteId ?? null} />
      </Suspense>
    )
  }

  return (
    <main className="pagina">
      <Vacio icono="alerta" titulo="Esta página no existe" texto="Revisa el link o vuelve a escanear el sticker de la mesa.">
        <a className="boton boton--secundario" href="/">
          Ir al inicio
        </a>
      </Vacio>
    </main>
  )
}
