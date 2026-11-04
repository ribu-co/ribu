import { PaginaMesa } from './cliente/PaginaMesa'
import { Inicio } from './Inicio'
import { coincidir, usarRuta } from './ruta'
import { Vacio } from './ui/Estados'

export function App() {
  const ruta = usarRuta()

  const mesa = coincidir('/m/:token', ruta)
  if (mesa) return <PaginaMesa key={mesa.token} token={mesa.token as string} />
  if (ruta === '/') return <Inicio />

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
