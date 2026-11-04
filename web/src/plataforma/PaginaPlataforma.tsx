import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PROPINA_SUGERIDA_MAXIMA } from '../../../contratos/reglas'
import { TIPOS_IMPUESTO, type Mesa, type Personal, type Restaurante, type TipoImpuesto } from '../../../contratos/tipos'
import { usarFuente, usarLectura, usarSesion, type Lectura } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { usarAvisos } from '../ui/Avisos'
import { Boton, Chip } from '../ui/Controles'
import { copiar } from '../ui/copiar'
import { AvisoError, Cargando, ErrorVista, Vacio } from '../ui/Estados'
import { plural } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { Icono } from '../ui/Icono'
import { QrTexto } from '../ui/Qr'
import {
  aImpuesto,
  CLAVE_MINIMA,
  IMPUESTOS,
  leerCantidad,
  leerPropinas,
  linkDeMesa,
  listaDeLinks,
  personalValido,
  PROPINAS_POR_DEFECTO,
} from './formulario'
import './plataforma.css'

/** Solo para quien administra Ribu. Tiene su propia entrada: no depende de las pantallas del personal. */
export function PaginaPlataforma() {
  const sesion = usarSesion()
  if (sesion === undefined) {
    return (
      <main className="pagina pagina--plataforma">
        <Cargando />
      </main>
    )
  }
  // El cliente anónimo que llega aquí tampoco ha entrado: al hacerlo, su sesión se reemplaza.
  if (!sesion || sesion.rol === 'cliente') return <EntradaPlataforma />
  if (sesion.rol !== 'plataforma') return <SinAcceso sesion={sesion} />
  return <PanelPlataforma sesion={sesion} />
}

function Cabecera({ alSalir }: { alSalir?: () => void }) {
  return (
    <header className="cabecera">
      <div className="marca">
        <span className="marca__logo" aria-hidden="true">
          <span />
        </span>
        <span className="marca__nombre">Ribu</span>
      </div>
      <div className="plataforma__sesion">
        <span className="pastilla">Plataforma</span>
        {alSalir && (
          <button className="icono-boton" aria-label="Salir" title="Salir" onClick={alSalir}>
            <Icono nombre="salir" tamano={18} />
          </button>
        )}
      </div>
    </header>
  )
}

function usarSalir() {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  return () => void fuente.salir().catch(avisos.error)
}

export function EntradaPlataforma() {
  const fuente = usarFuente()
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function entrar(evento: FormEvent) {
    evento.preventDefault()
    setEntrando(true)
    setError(null)
    try {
      // Al entrar cambia la sesión y PaginaPlataforma decide qué mostrar.
      await fuente.entrarPersonal(correo, clave)
    } catch (e) {
      setError(e)
      setEntrando(false)
    }
  }

  return (
    <main className="pagina pagina--plataforma-entrada">
      <Cabecera />
      <form className="tarjeta plataforma__entrada entra" onSubmit={entrar}>
        <div>
          <h1 className="tarjeta__titulo">Entra al panel de Ribu</h1>
          <p className="ayuda-campo">Solo para quien administra la plataforma.</p>
        </div>
        <label className="campo">
          <span className="campo__etiqueta">Correo</span>
          <input className="entrada" type="email" inputMode="email" autoComplete="username" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
        </label>
        <label className="campo">
          <span className="campo__etiqueta">Clave</span>
          <input className="entrada" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        <AvisoError error={error} />
        <Boton ancho type="submit" cargando={entrando}>
          Entrar
        </Boton>
      </form>
    </main>
  )
}

const NOMBRE_ROL: Record<string, string> = { mesero: 'mesero', cocina: 'cocina', admin: 'administrador' }

export function SinAcceso({ sesion }: { sesion: Sesion }) {
  const salir = usarSalir()
  return (
    <main className="pagina pagina--plataforma-entrada">
      <Cabecera />
      <Vacio
        icono="alerta"
        titulo="Este panel es solo para quien administra Ribu"
        texto={`Entraste con una cuenta de ${NOMBRE_ROL[sesion.rol] ?? sesion.rol}, que no tiene acceso a los demás restaurantes.`}
      >
        <Boton variante="secundario" onClick={salir}>
          Salir y entrar con otra cuenta
        </Boton>
      </Vacio>
    </main>
  )
}

function PanelPlataforma({ sesion }: { sesion: Sesion }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const salir = usarSalir()
  const restaurantes = usarLectura<Restaurante[]>((a, b) => fuente.escucharRestaurantes(a, b), [fuente, sesion.uid])
  const [creando, setCreando] = useState(false)
  const [conMesas, setConMesas] = useState<Restaurante | null>(null)
  const [conAdministrador, setConAdministrador] = useState<Restaurante | null>(null)
  const [porDesactivar, setPorDesactivar] = useState<Restaurante | null>(null)
  const [cambiando, setCambiando] = useState<string | null>(null)

  async function cambiarActivo(restaurante: Restaurante, activo: boolean) {
    setCambiando(restaurante.id)
    try {
      await fuente.actualizarRestaurante(restaurante.id, { activo })
      avisos.exito(activo ? `${restaurante.nombre} está activo` : `${restaurante.nombre} está inactivo`)
      setPorDesactivar(null)
    } catch (e) {
      avisos.error(e)
    } finally {
      setCambiando(null)
    }
  }

  return (
    <main className="pagina pagina--plataforma">
      <Cabecera alSalir={salir} />
      <section className="hero plataforma__hero">
        <div>
          <p className="hero__etiqueta">Panel de la plataforma</p>
          <h1 className="hero__titulo">Restaurantes</h1>
          {restaurantes.estado === 'listo' && restaurantes.valor.length > 0 && (
            <p className="hero__texto">
              {plural(restaurantes.valor.length, 'restaurante')}, {plural(restaurantes.valor.filter((r) => r.activo).length, 'activo')}
            </p>
          )}
        </div>
        <Boton variante="claro" onClick={() => setCreando(true)}>
          <Icono nombre="mas" tamano={18} /> Nuevo restaurante
        </Boton>
      </section>

      <ListaRestaurantes
        lectura={restaurantes}
        cambiando={cambiando}
        alCrear={() => setCreando(true)}
        alVerMesas={setConMesas}
        alCrearAdministrador={setConAdministrador}
        alDesactivar={setPorDesactivar}
        alActivar={(r) => void cambiarActivo(r, true)}
      />

      <HojaNuevoRestaurante
        abierta={creando}
        alCerrar={() => setCreando(false)}
        alCrear={(restaurante) => {
          setCreando(false)
          setConMesas(restaurante)
          avisos.exito(`${restaurante.nombre} quedó creado`, 'Estos son los links para sus stickers.')
        }}
      />
      <HojaMesas restaurante={conMesas} alCerrar={() => setConMesas(null)} />
      <HojaAdministrador restaurante={conAdministrador} alCerrar={() => setConAdministrador(null)} />
      <Hoja
        abierta={porDesactivar !== null}
        alCerrar={() => setPorDesactivar(null)}
        titulo={`¿Desactivar ${porDesactivar?.nombre ?? 'el restaurante'}?`}
        pie={
          <Boton ancho variante="peligro" cargando={cambiando !== null} onClick={() => porDesactivar && void cambiarActivo(porDesactivar, false)}>
            Desactivar
          </Boton>
        }
      >
        <p className="hoja__texto">Sus mesas dejan de recibir pedidos y pagos. Conserva su historia y se puede volver a activar.</p>
      </Hoja>
    </main>
  )
}

export function ListaRestaurantes({
  lectura,
  cambiando,
  alCrear,
  alVerMesas,
  alCrearAdministrador,
  alDesactivar,
  alActivar,
}: {
  lectura: Lectura<Restaurante[]>
  cambiando: string | null
  alCrear: () => void
  alVerMesas: (restaurante: Restaurante) => void
  alCrearAdministrador: (restaurante: Restaurante) => void
  alDesactivar: (restaurante: Restaurante) => void
  alActivar: (restaurante: Restaurante) => void
}) {
  if (lectura.estado === 'cargando') return <Cargando texto="Cargando los restaurantes…" />
  if (lectura.estado === 'error') return <ErrorVista error={lectura.error} alReintentar={() => location.reload()} />
  if (lectura.valor.length === 0) {
    return (
      <Vacio icono="tienda" titulo="Aún no hay restaurantes" texto="Crea el primero con su impuesto, sus propinas y sus mesas.">
        <Boton variante="secundario" onClick={alCrear}>
          Crear un restaurante
        </Boton>
      </Vacio>
    )
  }
  return (
    <ul className="plataforma__lista">
      {lectura.valor.map((restaurante) => (
        <li key={restaurante.id} className="tarjeta plataforma__restaurante entra" data-activo={restaurante.activo}>
          <div className="plataforma__titulo">
            <h2 className="tarjeta__titulo">{restaurante.nombre}</h2>
            <Chip tono={restaurante.activo ? 'verde-suave' : 'gris'}>{restaurante.activo ? 'Activo' : 'Inactivo'}</Chip>
          </div>
          <p className="ayuda-campo">
            {IMPUESTOS[restaurante.impuesto.tipo].texto} · Propinas sugeridas: {textoPropinas(restaurante.propinasSugeridas)}
          </p>
          <div className="plataforma__acciones">
            <Boton variante="secundario" onClick={() => alVerMesas(restaurante)}>
              <Icono nombre="qr" tamano={18} /> Links de mesas
            </Boton>
            <Boton variante="secundario" onClick={() => alCrearAdministrador(restaurante)}>
              <Icono nombre="persona" tamano={18} /> Administrador
            </Boton>
          </div>
          {restaurante.activo ? (
            <Boton variante="fantasma" onClick={() => alDesactivar(restaurante)}>
              Desactivar
            </Boton>
          ) : (
            <Boton variante="fantasma" cargando={cambiando === restaurante.id} onClick={() => alActivar(restaurante)}>
              Activar de nuevo
            </Boton>
          )}
        </li>
      ))}
    </ul>
  )
}

const textoPropinas = (propinas: readonly number[]) => {
  const positivas = propinas.filter((p) => p > 0)
  return positivas.length ? positivas.map((p) => `${p} %`).join(', ') : 'ninguna'
}

/** Mientras la hoja se cierra sigue mostrando lo último, para que no se vacíe durante la animación. */
function usarUltimo<T>(valor: T | null): T | null {
  const ultimo = useRef(valor)
  if (valor !== null) ultimo.current = valor
  return ultimo.current
}

function HojaNuevoRestaurante({ abierta, alCerrar, alCrear }: { abierta: boolean; alCerrar: () => void; alCrear: (restaurante: Restaurante) => void }) {
  const fuente = usarFuente()
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoImpuesto>('INC')
  const [propinasTexto, setPropinasTexto] = useState(PROPINAS_POR_DEFECTO)
  const [mesasTexto, setMesasTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!abierta) return
    setNombre('')
    setTipo('INC')
    setPropinasTexto(PROPINAS_POR_DEFECTO)
    setMesasTexto('')
    setError(null)
  }, [abierta])

  const propinas = leerPropinas(propinasTexto)
  const mesas = leerCantidad(mesasTexto)
  const valido = nombre.trim().length > 1 && propinas !== null && mesas !== null

  async function crear() {
    if (propinas === null || mesas === null) return
    setEnviando(true)
    setError(null)
    try {
      const { restaurante } = await fuente.crearRestaurante({
        nombre: nombre.trim(),
        impuesto: aImpuesto(IMPUESTOS[tipo]),
        propinasSugeridas: propinas,
        mesas,
      })
      alCrear(restaurante)
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Nuevo restaurante"
      pie={
        <Boton ancho cargando={enviando} disabled={!valido} onClick={crear}>
          Crear restaurante
        </Boton>
      }
    >
      <AvisoError error={error} />
      <label className="campo">
        <span className="campo__etiqueta">Nombre</span>
        <input className="entrada" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>
      <label className="campo">
        <span className="campo__etiqueta">Impuesto al consumo</span>
        <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as TipoImpuesto)}>
          {TIPOS_IMPUESTO.map((t) => (
            <option key={t} value={t}>
              {IMPUESTOS[t].texto}
            </option>
          ))}
        </select>
        {tipo === 'ninguno' && <span className="ayuda-campo ayuda-campo--alerta">Sin impuesto aún no se ha probado en el sandbox de Factus.</span>}
      </label>
      <label className="campo">
        <span className="campo__etiqueta">
          Propinas sugeridas <small>máximo {PROPINA_SUGERIDA_MAXIMA} %, separadas por comas</small>
        </span>
        <input
          className="entrada"
          inputMode="numeric"
          value={propinasTexto}
          onChange={(e) => setPropinasTexto(e.target.value)}
          aria-invalid={propinas === null}
        />
        {propinas === null && (
          <span className="ayuda-campo ayuda-campo--alerta">Usa números enteros de 0 a {PROPINA_SUGERIDA_MAXIMA}. Quien paga sí puede elegir otro porcentaje.</span>
        )}
      </label>
      <label className="campo">
        <span className="campo__etiqueta">Número de mesas</span>
        <input
          className="entrada"
          inputMode="numeric"
          placeholder="Ej.: 12"
          value={mesasTexto}
          onChange={(e) => setMesasTexto(e.target.value.replace(/\D/g, ''))}
          aria-invalid={mesasTexto !== '' && mesas === null}
        />
      </label>
    </Hoja>
  )
}

function HojaMesas({ restaurante, alCerrar }: { restaurante: Restaurante | null; alCerrar: () => void }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const mostrado = usarUltimo(restaurante)
  const id = restaurante?.id ?? null
  const mesas = usarLectura<Mesa[]>(id ? (a, b) => fuente.escucharMesas(id, a, b) : null, [fuente, id])
  const [cantidadTexto, setCantidadTexto] = useState('')
  const [agregando, setAgregando] = useState(false)
  const cantidad = leerCantidad(cantidadTexto)

  async function agregar() {
    if (!id || cantidad === null) return
    setAgregando(true)
    try {
      const nuevas = await fuente.agregarMesas(id, { cantidad })
      setCantidadTexto('')
      avisos.exito(plural(nuevas.length, 'mesa nueva', 'mesas nuevas'))
    } catch (e) {
      avisos.error(e)
    } finally {
      setAgregando(false)
    }
  }

  return (
    <Hoja
      abierta={restaurante !== null}
      alCerrar={alCerrar}
      titulo={`Mesas de ${mostrado?.nombre ?? ''}`}
      subtitulo="Cada link va en el sticker de su mesa, con NFC y QR."
      pie={
        <div className="entrada-boton plataforma__agregar">
          <input
            className="entrada"
            inputMode="numeric"
            placeholder="¿Cuántas mesas más?"
            aria-label="Cuántas mesas agregar"
            value={cantidadTexto}
            onChange={(e) => setCantidadTexto(e.target.value.replace(/\D/g, ''))}
          />
          <Boton variante="secundario" cargando={agregando} disabled={cantidad === null} onClick={agregar}>
            Agregar
          </Boton>
        </div>
      }
    >
      <ListaMesas lectura={mesas} />
    </Hoja>
  )
}

function ListaMesas({ lectura }: { lectura: Lectura<Mesa[]> }) {
  const avisos = usarAvisos()
  if (lectura.estado === 'cargando') return <Cargando texto="Cargando las mesas…" />
  if (lectura.estado === 'error') return <ErrorVista error={lectura.error} />
  if (lectura.valor.length === 0) return <Vacio icono="mesa" titulo="Este restaurante no tiene mesas" texto="Agrega las primeras aquí abajo." />
  return (
    <>
      <Boton
        variante="fantasma"
        onClick={async () => {
          if (await copiar(listaDeLinks(location.origin, lectura.valor))) avisos.exito('Links copiados', plural(lectura.valor.length, 'mesa'))
          else avisos.error({ codigo: 'SERVICIO_NO_DISPONIBLE' })
        }}
      >
        <Icono nombre="copiar" tamano={16} /> Copiar todos los links
      </Boton>
      <ul className="plataforma__mesas">
        {lectura.valor.map((mesa) => (
          <FilaMesa key={mesa.token} mesa={mesa} />
        ))}
      </ul>
    </>
  )
}

function FilaMesa({ mesa }: { mesa: Mesa }) {
  const avisos = usarAvisos()
  const [verQr, setVerQr] = useState(false)
  const link = linkDeMesa(location.origin, mesa.token)
  return (
    <li className="plataforma__mesa">
      <div className="plataforma__titulo">
        <strong>Mesa {mesa.numero}</strong>
        <Chip tono={mesa.estado === 'libre' ? 'gris' : 'verde-suave'}>{mesa.estado === 'libre' ? 'Libre' : 'Ocupada'}</Chip>
      </div>
      <code className="plataforma__link">{link}</code>
      <div className="plataforma__fila-botones">
        <button
          className="icono-boton"
          aria-label={`Copiar el link de la mesa ${mesa.numero}`}
          title="Copiar el link"
          onClick={async () => {
            if (await copiar(link)) avisos.exito('Link copiado', `Mesa ${mesa.numero}`)
            else avisos.error({ codigo: 'SERVICIO_NO_DISPONIBLE' })
          }}
        >
          <Icono nombre="copiar" tamano={18} />
        </button>
        <button
          className="icono-boton"
          aria-label={`${verQr ? 'Ocultar' : 'Ver'} el QR de la mesa ${mesa.numero}`}
          aria-expanded={verQr}
          title="Ver el QR"
          onClick={() => setVerQr(!verQr)}
        >
          <Icono nombre="qr" tamano={18} />
        </button>
      </div>
      {verQr && (
        <div className="plataforma__qr entra">
          <QrTexto texto={link} etiqueta={`QR del sticker de la mesa ${mesa.numero}`} />
        </div>
      )}
    </li>
  )
}

const VACIO = { correo: '', nombre: '', clave: '' }

function HojaAdministrador({ restaurante, alCerrar }: { restaurante: Restaurante | null; alCerrar: () => void }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const mostrado = usarUltimo(restaurante)
  const id = restaurante?.id ?? null
  const personal = usarLectura<Personal[]>(id ? (a, b) => fuente.escucharPersonal(id, a, b) : null, [fuente, id])
  const [datos, setDatos] = useState(VACIO)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    setDatos(VACIO)
    setError(null)
  }, [id])

  const cambiar = (campo: keyof typeof VACIO) => (e: { target: { value: string } }) => setDatos({ ...datos, [campo]: e.target.value })
  const administradores = personal.estado === 'listo' ? personal.valor.filter((p) => p.rol === 'admin') : []

  async function crear() {
    if (!id) return
    setEnviando(true)
    setError(null)
    try {
      const creado = await fuente.crearPersonal(id, { correo: datos.correo.trim(), nombre: datos.nombre.trim(), clave: datos.clave, rol: 'admin' })
      setDatos(VACIO)
      avisos.exito('Administrador creado', creado.correo)
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja
      abierta={restaurante !== null}
      alCerrar={alCerrar}
      titulo={`Administrador de ${mostrado?.nombre ?? ''}`}
      subtitulo="Gestiona la carta, las mesas y el personal de su restaurante."
      pie={
        <Boton ancho cargando={enviando} disabled={!personalValido(datos)} onClick={crear}>
          {administradores.length ? 'Crear otro administrador' : 'Crear administrador'}
        </Boton>
      }
    >
      {personal.estado === 'cargando' && <Cargando texto="Revisando quién lo administra…" />}
      {personal.estado === 'error' && <ErrorVista error={personal.error} />}
      {personal.estado === 'listo' &&
        (administradores.length ? (
          <ul className="detalle">
            {administradores.map((p) => (
              <li key={p.uid}>
                <span>
                  {p.nombre} · {p.correo}
                </span>
                <Chip tono={p.activo ? 'verde-suave' : 'gris'}>{p.activo ? 'Con acceso' : 'Sin acceso'}</Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="aviso aviso--ambar">
            <Icono nombre="alerta" tamano={18} />
            <span>Este restaurante todavía no tiene administrador.</span>
          </p>
        ))}
      <AvisoError error={error} />
      <label className="campo">
        <span className="campo__etiqueta">Nombre</span>
        <input className="entrada" autoComplete="off" value={datos.nombre} onChange={cambiar('nombre')} />
      </label>
      <label className="campo">
        <span className="campo__etiqueta">Correo</span>
        <input className="entrada" type="email" inputMode="email" autoComplete="off" value={datos.correo} onChange={cambiar('correo')} />
      </label>
      <label className="campo">
        <span className="campo__etiqueta">
          Clave inicial <small>mínimo {CLAVE_MINIMA} caracteres</small>
        </span>
        <input className="entrada" type="password" autoComplete="new-password" value={datos.clave} onChange={cambiar('clave')} />
      </label>
      <p className="ayuda-campo">Compártela por un canal privado.</p>
    </Hoja>
  )
}
