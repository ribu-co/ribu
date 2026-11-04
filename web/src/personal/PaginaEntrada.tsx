import { useEffect, useState, type FormEvent } from 'react'
import { usarFuente, usarSesion } from '../datos/contexto'
import type { Simulador } from '../datos/fuente'
import { navegar } from '../ruta'
import { Boton } from '../ui/Controles'
import { AvisoError, Cargando } from '../ui/Estados'
import { NOMBRE_ROL, pantallaDeRol } from './logica'
import './personal.css'

export function PaginaEntrada() {
  const sesion = usarSesion()
  // El rol sale de la sesión, nunca de lo que se elija en la pantalla.
  const destino = sesion ? pantallaDeRol(sesion.rol) : null

  useEffect(() => {
    if (destino) navegar(destino, { reemplazar: true })
  }, [destino])

  if (sesion === undefined || destino) {
    return (
      <main className="pagina pagina--mesa">
        <Cargando />
      </main>
    )
  }
  return <FormularioEntrada />
}

export function FormularioEntrada() {
  const fuente = usarFuente()
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function entrar(correoEntrada: string, claveEntrada: string) {
    setEnviando(true)
    setError(null)
    try {
      await fuente.entrarPersonal(correoEntrada, claveEntrada)
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  const alEnviar = (evento: FormEvent) => {
    evento.preventDefault()
    void entrar(correo, clave)
  }

  return (
    <main className="pagina pagina--mesa">
      <header className="cabecera">
        <div className="marca">
          <span className="marca__logo" aria-hidden="true">
            <span />
          </span>
          <span className="marca__nombre">Ribu</span>
        </div>
        <span className="pastilla">Personal</span>
      </header>

      <section className="hero">
        <p className="hero__etiqueta">Personal del restaurante</p>
        <h1 className="hero__titulo">Entra para atender tus mesas</h1>
      </section>

      <form className="tarjeta entrada-personal" onSubmit={alEnviar}>
        <AvisoError error={error} />
        <label className="campo">
          <span className="campo__etiqueta">Correo</span>
          <input
            className="entrada"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
          />
        </label>
        <label className="campo">
          <span className="campo__etiqueta">Clave</span>
          <input
            className="entrada"
            type="password"
            autoComplete="current-password"
            required
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
        </label>
        <Boton ancho type="submit" cargando={enviando} disabled={correo.trim() === '' || clave === ''}>
          Entrar
        </Boton>
      </form>

      {fuente.simulador && <CuentasDemo simulador={fuente.simulador} ocupado={enviando} alEntrar={entrar} />}
    </main>
  )
}

/** Solo existe con la fuente en memoria: entra sin escribir. Con Firebase no aparece ni se empaca la clave. */
function CuentasDemo({ simulador, ocupado, alEntrar }: { simulador: Simulador; ocupado: boolean; alEntrar: (correo: string, clave: string) => void }) {
  return (
    <section className="entrada-personal__demo" aria-label="Cuentas de la demo">
      <h2 className="seccion-titulo">Modo demo</h2>
      <div className="acciones-linea">
        {simulador.personalDemo().map((cuenta) => (
          <Boton key={cuenta.rol} variante="secundario" disabled={ocupado} onClick={() => alEntrar(cuenta.correo, cuenta.clave)}>
            Entrar como {NOMBRE_ROL[cuenta.rol]}
          </Boton>
        ))}
      </div>
    </section>
  )
}
