import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icono } from './Icono'

const SALIDA_MS = 220

/**
 * Panel que sube desde abajo, al alcance del pulgar. Se cierra tocando el fondo, con Escape o
 * deslizándolo hacia abajo: basta un movimiento rápido, no hace falta arrastrarlo hasta el final.
 */
export function Hoja({
  abierta,
  alCerrar,
  titulo,
  subtitulo,
  children,
  pie,
}: {
  abierta: boolean
  alCerrar: () => void
  titulo: string
  subtitulo?: ReactNode
  children: ReactNode
  pie?: ReactNode
}) {
  const [montada, setMontada] = useState(abierta)
  const panel = useRef<HTMLElement>(null)
  const arrastre = useRef<{ y: number; inicio: number; dy: number } | null>(null)

  // La entrada la anima CSS con @starting-style; aquí solo se espera la salida antes de desmontar.
  useEffect(() => {
    if (abierta) {
      setMontada(true)
      return
    }
    const espera = setTimeout(() => setMontada(false), SALIDA_MS)
    return () => clearTimeout(espera)
  }, [abierta])

  useEffect(() => {
    if (!montada) return
    const alTeclear = (evento: KeyboardEvent) => evento.key === 'Escape' && alCerrar()
    const desborde = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.body.style.overflow = desborde
      window.removeEventListener('keydown', alTeclear)
    }
  }, [montada, alCerrar])

  if (!(montada || abierta) || typeof document === 'undefined') return null

  const alPresionar = (evento: PointerEvent) => {
    if (arrastre.current) return
    arrastre.current = { y: evento.clientY, inicio: performance.now(), dy: 0 }
    ;(evento.currentTarget as HTMLElement).setPointerCapture(evento.pointerId)
    panel.current?.style.setProperty('transition', 'none')
  }
  const alMover = (evento: PointerEvent) => {
    const actual = arrastre.current
    if (!actual || !panel.current) return
    const dy = evento.clientY - actual.y
    // Hacia arriba cede poco: se siente como un límite blando, no como una pared.
    actual.dy = dy > 0 ? dy : dy / 6
    panel.current.style.translate = `0 ${actual.dy}px`
  }
  const alSoltar = () => {
    const actual = arrastre.current
    arrastre.current = null
    if (!actual || !panel.current) return
    panel.current.style.removeProperty('transition')
    panel.current.style.removeProperty('translate')
    const velocidad = actual.dy / (performance.now() - actual.inicio)
    if (actual.dy > 120 || velocidad > 0.5) alCerrar()
  }

  return createPortal(
    <div className="hoja-capa" data-visible={abierta}>
      <div className="hoja-fondo" onClick={alCerrar} />
      <section ref={panel} className="hoja" role="dialog" aria-modal="true" aria-label={titulo}>
        <header className="hoja__cabeza" onPointerDown={alPresionar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar}>
          <span className="hoja__asa" aria-hidden="true" />
          <div className="hoja__titulos">
            <h2>{titulo}</h2>
            {subtitulo && <p>{subtitulo}</p>}
          </div>
          <button
            className="icono-boton"
            aria-label="Cerrar"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={alCerrar}
          >
            <Icono nombre="cerrar" tamano={18} />
          </button>
        </header>
        <div className="hoja__cuerpo">{children}</div>
        {pie && <footer className="hoja__pie">{pie}</footer>}
      </section>
    </div>,
    document.body,
  )
}
