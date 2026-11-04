import { usarFuente } from './datos/contexto'
import { navegar } from './ruta'
import { Boton } from './ui/Controles'
import { Icono } from './ui/Icono'

/** En producción cada mesa llega por su sticker. Esta página solo sirve para recorrer la demo. */
export function Inicio() {
  const { simulador } = usarFuente()
  const mesas = simulador?.mesasDemo() ?? []

  return (
    <main className="pagina pagina--inicio">
      <header className="cabecera">
        <div className="marca">
          <span className="marca__logo" aria-hidden="true">
            <span />
          </span>
          <span className="marca__nombre">Ribu</span>
        </div>
      </header>

      <section className="hero hero--grande">
        <p className="hero__etiqueta">Pedidos, pagos y factura desde la mesa</p>
        <h1 className="hero__titulo">Escanea, pide, paga. La factura llega sola.</h1>
        <p className="hero__texto">
          Cada mesa tiene un sticker con NFC y QR. Se paga con Factus Pay y la factura electrónica sale con Factus.
        </p>
      </section>

      {simulador && (
        <>
          <h2 className="seccion-titulo">Mesas de la demo</h2>
          <ul className="rejilla-mesas">
            {mesas.map((mesa, i) => (
              <li key={mesa.token} className="entra" style={{ animationDelay: `${i * 40}ms` }}>
                <button className="tarjeta tarjeta--boton mesa-enlace" onClick={() => navegar(`/m/${mesa.token}`)}>
                  <span className="mesa-enlace__numero">{mesa.numero}</span>
                  <span>Mesa</span>
                  <span className="icono-circulo">
                    <Icono nombre="flecha" tamano={16} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="ayuda">
            Los datos viven en este navegador. Abre el personal en otra pestaña para ver los cambios al instante.
          </p>
          <Boton
            variante="fantasma"
            onClick={() => {
              simulador.reiniciar()
              location.reload()
            }}
          >
            <Icono nombre="actualizar" tamano={16} /> Reiniciar la demo
          </Boton>
        </>
      )}
    </main>
  )
}
