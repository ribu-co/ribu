import { lazy, Suspense } from 'react'
import { Icono } from './ui/Icono'

// Vite reemplaza PROD al compilar: la build de producción no incluye las mesas de la demo.
const MesasDemo = import.meta.env.PROD ? null : lazy(() => import('./MesasDemo').then((m) => ({ default: m.MesasDemo })))

/** En producción cada mesa llega por su sticker. Esta es solo la portada de Ribu. */
export function Inicio() {
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

      <a className="boton boton--secundario inicio__personal" href="/personal">
        <Icono nombre="persona" tamano={18} /> Soy del restaurante
      </a>

      {MesasDemo && (
        <Suspense fallback={null}>
          <MesasDemo />
        </Suspense>
      )}
    </main>
  )
}
