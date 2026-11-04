import { useState } from 'react'
import { ROLES_PERSONAL, type Personal, type RolPersonal } from '../../../contratos/tipos'
import { usarFuente, usarLectura } from '../datos/contexto'
import { usarAvisos } from '../ui/Avisos'
import { Boton, Chip } from '../ui/Controles'
import { MENSAJES_ERROR } from '../ui/errores'
import { AvisoError, Cargando, ErrorVista, Vacio } from '../ui/Estados'
import { Hoja } from '../ui/Hoja'
import { Icono } from '../ui/Icono'
import { puede, type RolAdmin } from './acceso'
import { Campo, Confirmar, ETIQUETA_ROL } from './comunes'
import { CLAVE_MINIMA, enviarPersonal, FORMULARIO_PERSONAL_VACIO, type CampoPersonal, type Errores } from './formularios'
import { ordenarPersonal } from './personal'

function HojaPersonal({ restauranteId, alCerrar }: { restauranteId: string; alCerrar: () => void }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [formulario, setFormulario] = useState(FORMULARIO_PERSONAL_VACIO)
  const [errores, setErrores] = useState<Errores<CampoPersonal>>({})
  const [correoEnUso, setCorreoEnUso] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [enviando, setEnviando] = useState(false)

  async function crear() {
    setEnviando(true)
    setError(null)
    setErrores({})
    setCorreoEnUso(null)
    const resultado = await enviarPersonal(fuente, restauranteId, formulario)
    setEnviando(false)
    if (resultado.estado === 'creado') {
      avisos.exito('Cuenta creada', formulario.nombre.trim())
      alCerrar()
    } else if (resultado.estado === 'invalido') setErrores(resultado.errores)
    else if (resultado.estado === 'correo_en_uso') setCorreoEnUso(formulario.correo)
    else setError(resultado.error)
  }

  // El aviso se va apenas se cambia el correo: ya no es cierto para el nuevo.
  const enUso = correoEnUso !== null && correoEnUso === formulario.correo
  const { titulo, accion } = MENSAJES_ERROR.CORREO_EN_USO

  return (
    <Hoja
      abierta
      alCerrar={alCerrar}
      titulo="Nueva cuenta del personal"
      pie={
        <Boton ancho cargando={enviando} onClick={crear}>
          Crear cuenta
        </Boton>
      }
    >
      <AvisoError error={error} />
      <Campo etiqueta="Nombre" error={errores.nombre}>
        <input className="entrada" autoComplete="off" value={formulario.nombre} onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })} />
      </Campo>
      <Campo etiqueta="Correo" error={enUso ? `${titulo} ${accion}` : errores.correo}>
        <input
          className="entrada"
          type="email"
          inputMode="email"
          autoComplete="off"
          aria-invalid={enUso || Boolean(errores.correo)}
          value={formulario.correo}
          onChange={(e) => setFormulario({ ...formulario, correo: e.target.value })}
        />
      </Campo>
      <Campo etiqueta="Rol">
        <select className="entrada" value={formulario.rol} onChange={(e) => setFormulario({ ...formulario, rol: e.target.value as RolPersonal })}>
          {ROLES_PERSONAL.map((rol) => (
            <option key={rol} value={rol}>
              {ETIQUETA_ROL[rol]}
            </option>
          ))}
        </select>
      </Campo>
      <Campo etiqueta="Clave inicial" ayuda={`Al menos ${CLAVE_MINIMA} caracteres. Compártela por privado.`} error={errores.clave}>
        <input className="entrada" type="password" autoComplete="new-password" value={formulario.clave} onChange={(e) => setFormulario({ ...formulario, clave: e.target.value })} />
      </Campo>
    </Hoja>
  )
}

export function FilaPersonal({ persona, propia, puedeCambiar, alCambiar, ocupado }: { persona: Personal; propia: boolean; puedeCambiar: boolean; alCambiar: () => void; ocupado: boolean }) {
  return (
    <li className="admin-fila" data-inactivo={!persona.activo}>
      <div className="admin-fila__textos">
        <strong>
          {persona.nombre}
          {propia ? ' (tú)' : ''}
        </strong>
        <span className="admin-texto-largo">{persona.correo}</span>
      </div>
      <Chip tono="gris">{ETIQUETA_ROL[persona.rol]}</Chip>
      <Chip tono={persona.activo ? 'verde-suave' : 'rojo'}>{persona.activo ? 'Con acceso' : 'Sin acceso'}</Chip>
      <div className="admin-fila__acciones">
        {puedeCambiar &&
          !propia &&
          (persona.activo ? (
            <Confirmar texto="Desactivar" pregunta={`¿Quitarle el acceso a ${persona.nombre}?`} cargando={ocupado} alConfirmar={alCambiar} />
          ) : (
            <Boton variante="fantasma" className="boton--chico" cargando={ocupado} onClick={alCambiar}>
              Reactivar
            </Boton>
          ))}
      </div>
    </li>
  )
}

export function SeccionPersonal({ restauranteId, rol, uid }: { restauranteId: string; rol: RolAdmin; uid: string }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const lectura = usarLectura<Personal[]>((alCambiar, alFallar) => fuente.escucharPersonal(restauranteId, alCambiar, alFallar), [fuente, restauranteId])
  const [creando, setCreando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)

  if (lectura.estado === 'error') return <ErrorVista error={lectura.error} />
  if (lectura.estado === 'cargando') return <Cargando texto="Cargando al personal…" />

  const puedeCrear = puede(rol, 'crearPersonal')

  async function cambiarAcceso(persona: Personal) {
    setOcupado(persona.uid)
    try {
      await fuente.actualizarPersonal(restauranteId, persona.uid, { activo: !persona.activo })
      avisos.exito(persona.activo ? 'Acceso retirado' : 'Acceso devuelto', persona.nombre)
    } catch (e) {
      avisos.error(e)
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="admin-seccion">
      <div className="admin-seccion__cabeza">
        <h2 className="tarjeta__titulo">Personal</h2>
        {puedeCrear && (
          <Boton className="boton--chico" onClick={() => setCreando(true)}>
            <Icono nombre="mas" tamano={16} /> Nueva cuenta
          </Boton>
        )}
      </div>
      {lectura.valor.length === 0 ? (
        <Vacio icono="persona" titulo="Todavía no hay cuentas" texto="Crea las cuentas de meseros, cocina y administración." />
      ) : (
        <section className="tarjeta admin-grupo">
          <ul className="admin-filas">
            {ordenarPersonal(lectura.valor).map((persona) => (
              <FilaPersonal
                key={persona.uid}
                persona={persona}
                propia={persona.uid === uid}
                puedeCambiar={puede(rol, 'actualizarPersonal')}
                ocupado={ocupado === persona.uid}
                alCambiar={() => cambiarAcceso(persona)}
              />
            ))}
          </ul>
        </section>
      )}
      {creando && <HojaPersonal restauranteId={restauranteId} alCerrar={() => setCreando(false)} />}
    </div>
  )
}
