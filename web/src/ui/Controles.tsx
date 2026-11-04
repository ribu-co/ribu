import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icono } from './Icono'

export function Contador({
  valor,
  alCambiar,
  minimo = 0,
  maximo = 99,
  etiqueta,
}: {
  valor: number
  alCambiar: (valor: number) => void
  minimo?: number
  maximo?: number
  etiqueta: string
}) {
  return (
    <div className="contador" role="group" aria-label={etiqueta}>
      <button type="button" className="contador__boton" aria-label="Quitar uno" disabled={valor <= minimo} onClick={() => alCambiar(valor - 1)}>
        <Icono nombre="menos" tamano={16} />
      </button>
      <span className="contador__valor" aria-live="polite">
        {valor}
      </span>
      <button type="button" className="contador__boton" aria-label="Agregar uno" disabled={valor >= maximo} onClick={() => alCambiar(valor + 1)}>
        <Icono nombre="mas" tamano={16} />
      </button>
    </div>
  )
}

/** Pestañas con un fondo que se desliza a la opción activa. */
export function Pestanas<T extends string>({
  opciones,
  valor,
  alCambiar,
  etiqueta,
}: {
  opciones: readonly { valor: T; texto: string; insignia?: number }[]
  valor: T
  alCambiar: (valor: T) => void
  etiqueta: string
}) {
  const indice = Math.max(
    0,
    opciones.findIndex((o) => o.valor === valor),
  )
  return (
    <div className="pestanas" role="tablist" aria-label={etiqueta} style={{ ['--n' as string]: opciones.length }}>
      <span className="pestanas__fondo" style={{ transform: `translateX(${indice * 100}%)` }} aria-hidden="true" />
      {opciones.map((opcion) => (
        <button
          key={opcion.valor}
          role="tab"
          aria-selected={opcion.valor === valor}
          className="pestanas__opcion"
          onClick={() => alCambiar(opcion.valor)}
        >
          {opcion.texto}
          {opcion.insignia ? <span className="insignia" key={opcion.insignia}>{opcion.insignia}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Boton({
  children,
  variante = 'primario',
  cargando = false,
  ancho = false,
  ...resto
}: {
  children: ReactNode
  variante?: 'primario' | 'secundario' | 'fantasma' | 'peligro' | 'claro'
  cargando?: boolean
  ancho?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...resto}
      className={`boton boton--${variante}${ancho ? ' boton--ancho' : ''} ${resto.className ?? ''}`}
      disabled={resto.disabled || cargando}
      aria-busy={cargando}
    >
      <span className="boton__contenido" data-cargando={cargando}>
        {children}
      </span>
      {cargando && <span className="girando girando--boton" aria-hidden="true" />}
    </button>
  )
}

export function Chip({ tono, children, rayado = false }: { tono: string; children: ReactNode; rayado?: boolean }) {
  return (
    <span className={`chip chip--${tono}${rayado ? ' chip--rayado' : ''}`}>
      <span className="chip__punto" aria-hidden="true" />
      {children}
    </span>
  )
}
