import type { MouseEvent, ReactNode } from 'react'
import type { Rol } from '../../../contratos/tipos'
import { usarFuente, usarSesion } from '../datos/contexto'
import { navegar } from '../ruta'
import { usarAvisos } from '../ui/Avisos'
import { Boton } from '../ui/Controles'
import { Cargando, Vacio } from '../ui/Estados'
import { Icono } from '../ui/Icono'
import { decidirAcceso, NOMBRE_ROL, type Acceso, type SesionPersonal } from './logica'
import './personal.css'

/** Un enlace de verdad que cambia de pantalla sin recargar. */
export function Enlace({ a, className, etiqueta, children }: { a: string; className?: string; etiqueta?: string; children: ReactNode }) {
  const alTocar = (evento: MouseEvent) => {
    evento.preventDefault()
    navegar(a)
  }
  return (
    <a href={a} className={className} aria-label={etiqueta} onClick={alTocar}>
      {children}
    </a>
  )
}

export function usarSalir() {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  return async () => {
    try {
      await fuente.salir()
      navegar('/personal', { reemplazar: true })
    } catch (error) {
      avisos.error(error)
    }
  }
}

export function BotonSalir() {
  const salir = usarSalir()
  return (
    <button className="icono-boton" aria-label="Salir" title="Salir" onClick={() => void salir()}>
      <Icono nombre="salir" tamano={18} />
    </button>
  )
}

/** El mensaje cuando alguien llega a una pantalla que no le corresponde. */
export function AccesoNegado({ acceso, pantalla, alSalir }: { acceso: Exclude<Acceso, { tipo: 'permitido' | 'cargando' }>; pantalla: string; alSalir: () => void }) {
  return (
    <main className="pagina pagina--mesa">
      {acceso.tipo === 'sin_sesion' ? (
        <Vacio icono="persona" titulo="Primero hay que entrar" texto={`La pantalla de ${pantalla} es solo para el personal del restaurante.`}>
          <Enlace a="/personal" className="boton boton--primario">
            Entrar como personal
          </Enlace>
        </Vacio>
      ) : (
        <Vacio
          icono="alerta"
          titulo={`Esta pantalla es de ${pantalla}`}
          texto={`Entraste como ${NOMBRE_ROL[acceso.sesion.rol]}. Ve a tu pantalla o sal para entrar con otra cuenta.`}
        >
          <Enlace a="/personal" className="boton boton--primario">
            Ir a mi pantalla
          </Enlace>
          <Boton variante="fantasma" onClick={alSalir}>
            Salir
          </Boton>
        </Vacio>
      )}
    </main>
  )
}

/** Solo deja ver la pantalla a los roles que la usan. El backend igual valida cada orden. */
export function Puerta({ roles, pantalla, children }: { roles: readonly Rol[]; pantalla: string; children: (sesion: SesionPersonal) => ReactNode }) {
  const sesion = usarSesion()
  const salir = usarSalir()
  const acceso = decidirAcceso(sesion, roles)
  if (acceso.tipo === 'cargando') {
    return (
      <main className="pagina pagina--mesa">
        <Cargando />
      </main>
    )
  }
  if (acceso.tipo !== 'permitido') return <AccesoNegado acceso={acceso} pantalla={pantalla} alSalir={() => void salir()} />
  return <>{children(acceso.sesion)}</>
}

/** La cabecera de las pantallas del personal: de dónde es, quién entró y cómo salir. */
export function CabeceraPersonal({ restaurante, sesion, extra }: { restaurante: string; sesion: SesionPersonal; extra?: ReactNode }) {
  return (
    <header className="cabecera">
      <div className="marca">
        <span className="marca__logo" aria-hidden="true">
          <span />
        </span>
        <span className="marca__nombre">{restaurante}</span>
      </div>
      <div className="cabecera-personal__acciones">
        {extra}
        <span className="pastilla cabecera-personal__quien">{sesion.nombre ?? NOMBRE_ROL[sesion.rol]}</span>
        <BotonSalir />
      </div>
    </header>
  )
}
