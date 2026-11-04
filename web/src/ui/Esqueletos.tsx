// Cada esqueleto usa las mismas clases que el componente real, así ocupa exactamente su lugar
// y nada salta cuando llegan los datos. Los textos son texto invisible de muestra: parten la línea
// igual que el real en cualquier ancho, y cada renglón se pinta como una barra.

import type { CSSProperties, ReactNode } from 'react'

/** Un bloque con brillo. Con `children`, el texto invisible le da el alto y el ancho del real. */
export function Hueso({
  ancho,
  className = '',
  style,
  children,
}: {
  ancho?: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <span className={`hueso ${className}`} style={{ width: ancho, ...style }} aria-hidden="true">
      {children}
    </span>
  )
}

/** Texto de muestra con la tipografía de `className`. */
export function Texto({ children, className = '' }: { children: string; className?: string }) {
  return (
    <span className={`hueso-bloque ${className}`} aria-hidden="true">
      <span className="hueso-texto">{children}</span>
    </span>
  )
}

export function EsqueletoProducto() {
  return (
    <div className="producto producto--esqueleto">
      <span className="producto__textos">
        <Texto className="producto__nombre">Patacón con suero</Texto>
        <Texto className="producto__descripcion">Patacón grande con suero costeño</Texto>
        <Texto className="producto__precio">$10.800</Texto>
      </span>
      <Hueso className="producto__foto" />
    </div>
  )
}

export function EsqueletoCarta() {
  return (
    <div className="carta" role="status" aria-label="Cargando la carta">
      <div className="categorias">
        {['Entradas', 'Platos fuertes', 'Bebidas', 'Postres'].map((texto) => (
          <Hueso key={texto} className="categorias__chip">
            {texto}
          </Hueso>
        ))}
      </div>
      <section className="carta__seccion">
        <h2 className="carta__titulo">
          <Texto>Entradas</Texto>
        </h2>
        <ul className="productos">
          {[0, 1, 2, 3].map((i) => (
            <li key={i}>
              <EsqueletoProducto />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function EsqueletoRonda({ lineas = 2 }: { lineas?: number }) {
  return (
    <section className="tarjeta ronda" role="status" aria-label="Cargando el pedido">
      <header className="ronda__cabeza">
        <h3>
          <Texto>Ronda 1</Texto>
        </h3>
        <span>
          <Texto>12:00 p. m.</Texto>
        </span>
      </header>
      <ul className="lineas">
        {Array.from({ length: lineas }, (_, i) => (
          <li key={i} className="linea">
            <Hueso className="linea__cantidad" />
            <div className="linea__cuerpo">
              <div className="linea__fila">
                <Texto className="linea__nombre">Jugo de corozo</Texto>
                <Texto className="linea__precio">$8.100</Texto>
              </div>
              <div className="linea__fila">
                <Hueso className="chip">
                  <span className="chip__punto" />
                  Esperando al mesero
                </Hueso>
                <Hueso className="avance" ancho="86px" style={{ height: 6 }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** La página de la mesa completa mientras llegan la mesa, la carta y la cuenta. */
export function EsqueletoMesa() {
  return (
    <main className="pagina pagina--mesa" aria-busy="true">
      <header className="cabecera">
        <div className="marca">
          <Hueso className="marca__logo" />
          <Texto className="marca__nombre">Fogón del Manglar</Texto>
        </div>
        <Hueso className="pastilla">Mesa 00</Hueso>
      </header>
      <section className="hero hero--esqueleto">
        <Texto className="hero__etiqueta">Mesa 3</Texto>
        <Texto className="hero__titulo">¿Qué se te antoja hoy?</Texto>
        <Texto className="hero__texto">Pide desde aquí. El mesero confirma y la cocina empieza.</Texto>
      </section>
      <div className="barra-pestanas">
        <div className="pestanas" style={{ ['--n' as string]: 2 }}>
          <Hueso className="pestanas__opcion">Carta</Hueso>
          <Hueso className="pestanas__opcion">Pedido</Hueso>
        </div>
      </div>
      <EsqueletoCarta />
    </main>
  )
}
