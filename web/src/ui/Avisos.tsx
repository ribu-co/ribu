import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { mensajeDeError } from './errores'
import { Icono } from './Icono'

interface Aviso {
  id: number
  tipo: 'exito' | 'error'
  titulo: string
  texto?: string
  saliendo: boolean
}

interface Avisos {
  exito(titulo: string, texto?: string): void
  error(error: unknown): void
}

const Contexto = createContext<Avisos>({ exito: () => {}, error: () => {} })

export const usarAvisos = () => useContext(Contexto)

/** Mensajes cortos abajo de la pantalla. Entran y salen por el mismo lado, y se van solos. */
export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const siguiente = useRef(0)

  const quitar = useCallback((id: number) => {
    setAvisos((lista) => lista.map((a) => (a.id === id ? { ...a, saliendo: true } : a)))
    setTimeout(() => setAvisos((lista) => lista.filter((a) => a.id !== id)), 200)
  }, [])

  const agregar = useCallback(
    (aviso: Omit<Aviso, 'id' | 'saliendo'>) => {
      const id = ++siguiente.current
      setAvisos((lista) => [...lista.slice(-2), { ...aviso, id, saliendo: false }])
      setTimeout(() => quitar(id), aviso.tipo === 'error' ? 6000 : 3500)
    },
    [quitar],
  )

  const valor = useMemo<Avisos>(
    () => ({
      exito: (titulo, texto) => agregar({ tipo: 'exito', titulo, texto }),
      error: (error) => {
        const { titulo, accion } = mensajeDeError(error)
        agregar({ tipo: 'error', titulo, texto: accion })
      },
    }),
    [agregar],
  )

  return (
    <Contexto.Provider value={valor}>
      {children}
      <div className="avisos" aria-live="polite">
        {avisos.map((aviso) => (
          <div key={aviso.id} className={`toast toast--${aviso.tipo}`} data-saliendo={aviso.saliendo} onClick={() => quitar(aviso.id)}>
            <span className="toast__icono">
              <Icono nombre={aviso.tipo === 'exito' ? 'check' : 'alerta'} tamano={16} />
            </span>
            <div>
              <strong>{aviso.titulo}</strong>
              {aviso.texto && <span>{aviso.texto}</span>}
            </div>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  )
}
