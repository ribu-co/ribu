import { useEffect, useMemo, useRef, useState } from 'react'
import type { Producto } from '../../../contratos/tipos'
import { Vacio } from '../ui/Estados'
import { pesos } from '../ui/formato'
import { Icono } from '../ui/Icono'

export function agruparPorCategoria(productos: readonly Producto[]) {
  const categorias = new Map<string, Producto[]>()
  for (const producto of productos) {
    categorias.set(producto.categoria, [...(categorias.get(producto.categoria) ?? []), producto])
  }
  // Lo agotado va al final de su categoría: sigue a la vista, pero no estorba.
  return [...categorias].map(([nombre, lista]) => ({
    nombre,
    productos: [...lista].sort((a, b) => Number(b.disponible) - Number(a.disponible)),
  }))
}

const anclaDe = (categoria: string) =>
  `categoria-${categoria
    .normalize('NFD')
    .replace(/[^\w]+/g, '-')
    .toLowerCase()}`

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter((palabra) => palabra.length > 2)
    .slice(0, 2)
    .map((palabra) => palabra[0]?.toUpperCase())
    .join('')

export function Carta({
  productos,
  enBorrador,
  alElegir,
}: {
  productos: readonly Producto[]
  enBorrador: (productoId: string) => number
  alElegir: (producto: Producto) => void
}) {
  const categorias = useMemo(() => agruparPorCategoria(productos), [productos])
  const [activa, setActiva] = useState(categorias[0]?.nombre ?? '')
  const chips = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observador = new IntersectionObserver(
      (entradas) => {
        const visible = entradas.find((e) => e.isIntersecting)
        if (visible) setActiva((visible.target as HTMLElement).dataset.categoria ?? '')
      },
      { rootMargin: '-140px 0px -65% 0px' },
    )
    for (const { nombre } of categorias) {
      const seccion = document.getElementById(anclaDe(nombre))
      if (seccion) observador.observe(seccion)
    }
    return () => observador.disconnect()
  }, [categorias])

  useEffect(() => {
    const chip = chips.current?.querySelector<HTMLElement>(`[data-categoria="${CSS.escape(activa)}"]`)
    chip?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [activa])

  if (productos.length === 0) {
    return <Vacio titulo="La carta está vacía" texto="El restaurante todavía no ha cargado productos. Pregúntale al mesero." />
  }

  return (
    <div className="carta">
      <div className="categorias" ref={chips} role="navigation" aria-label="Categorías">
        {categorias.map(({ nombre }) => (
          <button
            key={nombre}
            data-categoria={nombre}
            className="categorias__chip"
            aria-current={nombre === activa ? 'true' : undefined}
            onClick={() => {
              setActiva(nombre)
              document.getElementById(anclaDe(nombre))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            {nombre}
          </button>
        ))}
      </div>

      {categorias.map(({ nombre, productos: deCategoria }) => (
        <section key={nombre} id={anclaDe(nombre)} data-categoria={nombre} className="carta__seccion">
          <h2 className="carta__titulo">
            {nombre}
            <span>{deCategoria.length}</span>
          </h2>
          <ul className="productos">
            {deCategoria.map((producto, i) => {
              const cuantos = enBorrador(producto.id)
              return (
                <li key={producto.id} className="entra" style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
                  <button
                    className="producto"
                    disabled={!producto.disponible}
                    onClick={() => alElegir(producto)}
                    aria-label={`${producto.nombre}, ${pesos(producto.precio)}${producto.disponible ? '' : ', agotado'}`}
                  >
                    <span className="producto__textos">
                      <span className="producto__nombre">{producto.nombre}</span>
                      {producto.descripcion && <span className="producto__descripcion">{producto.descripcion}</span>}
                      <span className="producto__precio">{producto.disponible ? pesos(producto.precio) : 'Agotado por hoy'}</span>
                    </span>
                    <span className="producto__foto" data-agotado={!producto.disponible}>
                      {producto.imagenUrl ? <img src={producto.imagenUrl} alt="" loading="lazy" /> : <span>{iniciales(producto.nombre)}</span>}
                      {producto.disponible && (
                        <span className="producto__mas" data-cuantos={cuantos || undefined}>
                          {cuantos > 0 ? cuantos : <Icono nombre="mas" tamano={18} grosor={2.4} />}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
