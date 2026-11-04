import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { comoErrorDatos, type AlCambiar, type AlFallar, type Cancelar, type ErrorDatos, type FuenteDatos, type Sesion } from './fuente'

const Contexto = createContext<FuenteDatos | null>(null)

export function ProveedorDatos({ fuente, children }: { fuente: FuenteDatos; children: ReactNode }) {
  return <Contexto.Provider value={fuente}>{children}</Contexto.Provider>
}

export function usarFuente() {
  const fuente = useContext(Contexto)
  if (!fuente) throw new Error('Falta <ProveedorDatos>')
  return fuente
}

export type Lectura<T> =
  | { estado: 'cargando' }
  | { estado: 'listo'; valor: T }
  | { estado: 'error'; error: ErrorDatos }

/**
 * Escucha un documento mientras la pantalla esté abierta. Con `suscribir` en null no escucha nada:
 * sirve para lecturas que dependen de otra, como la cuenta, que sale de la mesa.
 */
export function usarLectura<T>(
  suscribir: ((alCambiar: AlCambiar<T>, alFallar: AlFallar) => Cancelar) | null,
  dependencias: readonly unknown[],
): Lectura<T> {
  const [lectura, setLectura] = useState<Lectura<T>>({ estado: 'cargando' })
  useEffect(() => {
    setLectura({ estado: 'cargando' })
    if (!suscribir) return
    try {
      return suscribir(
        (valor) => setLectura({ estado: 'listo', valor }),
        (error) => setLectura({ estado: 'error', error }),
      )
    } catch (error) {
      setLectura({ estado: 'error', error: comoErrorDatos(error) })
    }
  }, dependencias)
  return lectura
}

/** La sesión actual. undefined mientras se sabe si hay una. */
export function usarSesion(): Sesion | null | undefined {
  const fuente = usarFuente()
  const [sesion, setSesion] = useState<Sesion | null | undefined>(undefined)
  useEffect(() => fuente.escucharSesion(setSesion), [fuente])
  return sesion
}

/** En el link de la mesa: si nadie entró, entra como cliente anónimo. Si es el personal, sigue siéndolo. */
export function usarSesionDeMesa(): Lectura<Sesion> {
  const fuente = usarFuente()
  const sesion = usarSesion()
  const [error, setError] = useState<ErrorDatos | null>(null)
  useEffect(() => {
    if (sesion === null) fuente.entrarComoCliente().catch((e) => setError(comoErrorDatos(e)))
  }, [fuente, sesion])
  if (error) return { estado: 'error', error }
  return sesion ? { estado: 'listo', valor: sesion } : { estado: 'cargando' }
}
