import { lazy, Suspense } from 'react'
import { PaginaMesa } from './cliente/PaginaMesa'
import { Inicio } from './Inicio'
import { coincidir, usarRuta } from './ruta'
import { Cargando, Vacio } from './ui/Estados'

// Quien llega por un sticker no descarga el panel de la plataforma.
const PaginaPlataforma = lazy(() => import('./plataforma/PaginaPlataforma').then((m) => ({ default: m.PaginaPlataforma })))

export function App() {
  const ruta = usarRuta()

  const mesa = coincidir('/m/:token', ruta)
  if (mesa) return <PaginaMesa key={mesa.token} token={mesa.token as string} />
  if (ruta === '/') return <Inicio />
  if (coincidir('/plataforma', ruta)) {
    return (
      <Suspense fallback={<main className="pagina"><Cargando /></main>}>
        <PaginaPlataforma />
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
