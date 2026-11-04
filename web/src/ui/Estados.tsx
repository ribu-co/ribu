import type { ReactNode } from 'react'
import { mensajeDeError } from './errores'
import { Icono, type NombreIcono } from './Icono'

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="estado-vista" role="status" aria-live="polite">
      <span className="girando" aria-hidden="true" />
      <p className="estado-vista__texto">{texto}</p>
    </div>
  )
}

export function Vacio({
  icono = 'carta',
  titulo,
  texto,
  children,
}: {
  icono?: NombreIcono
  titulo: string
  texto?: string
  children?: ReactNode
}) {
  return (
    <div className="estado-vista estado-vista--vacio">
      <span className="estado-vista__icono">
        <Icono nombre={icono} tamano={26} />
      </span>
      <h3 className="estado-vista__titulo">{titulo}</h3>
      {texto && <p className="estado-vista__texto">{texto}</p>}
      {children}
    </div>
  )
}

export function ErrorVista({ error, alReintentar }: { error: unknown; alReintentar?: () => void }) {
  const { titulo, accion } = mensajeDeError(error)
  return (
    <div className="estado-vista estado-vista--error" role="alert">
      <span className="estado-vista__icono">
        <Icono nombre="alerta" tamano={26} />
      </span>
      <h3 className="estado-vista__titulo">{titulo}</h3>
      <p className="estado-vista__texto">{accion}</p>
      {alReintentar && (
        <button className="boton boton--secundario" onClick={alReintentar}>
          Reintentar
        </button>
      )}
    </div>
  )
}

/** Un error dentro de un formulario: dice qué pasó y qué hacer, sin sacar a la persona de donde está. */
export function AvisoError({ error }: { error: unknown }) {
  if (!error) return null
  const { titulo, accion } = mensajeDeError(error)
  return (
    <div className="aviso aviso--error" role="alert">
      <Icono nombre="alerta" tamano={18} />
      <div>
        <strong>{titulo}</strong>
        <span>{accion}</span>
      </div>
    </div>
  )
}
