import { useMemo, useState } from 'react'
import type { Cuenta, Factura, Mesa, Nota, Pago, Producto, Restaurante } from '../../../contratos/tipos'
import { usarFuente, usarLectura, usarSesion } from '../datos/contexto'
import { navegar } from '../ruta'
import { Cargando, ErrorVista, Vacio } from '../ui/Estados'
import { Icono, type NombreIcono } from '../ui/Icono'
import { decidirAcceso, type Acceso, type RolAdmin } from './acceso'
import { reunir, usarAhora } from './comunes'
import { Dashboard } from './Dashboard'
import { Facturas } from './Facturas'
import { Mesas } from './Mesas'
import { Productos } from './Productos'
import { SeccionPersonal } from './SeccionPersonal'
import './admin.css'

export const SECCIONES = ['dashboard', 'productos', 'personal', 'facturas', 'mesas'] as const
export type Seccion = (typeof SECCIONES)[number]

const MENU: Record<Seccion, { texto: string; icono: NombreIcono }> = {
  dashboard: { texto: 'Dashboard', icono: 'tienda' },
  productos: { texto: 'Productos', icono: 'carta' },
  personal: { texto: 'Personal', icono: 'persona' },
  facturas: { texto: 'Facturas y notas', icono: 'recibo' },
  mesas: { texto: 'Mesas', icono: 'mesa' },
}

/** La sección vive en el `#` de la dirección: recargar no te saca de donde estabas. */
export const seccionDeHash = (hash: string): Seccion => {
  const nombre = hash.replace(/^#/, '')
  return (SECCIONES as readonly string[]).includes(nombre) ? (nombre as Seccion) : 'dashboard'
}

const MENSAJES_SIN_ACCESO: Record<Exclude<Acceso['tipo'], 'cargando' | 'permitido'>, { titulo: string; texto: string }> = {
  sin_sesion: { titulo: 'Entra para ver esta página', texto: 'La administración del restaurante necesita una cuenta del personal.' },
  otro_rol: { titulo: 'Esta página es de la administración', texto: 'Tu cuenta no tiene acceso. Entra con una cuenta de administrador.' },
  otro_restaurante: { titulo: 'Este restaurante no es el tuyo', texto: 'Tu cuenta solo administra su propio restaurante.' },
  falta_restaurante: { titulo: 'Falta indicar el restaurante', texto: 'Desde la plataforma se entra con el restaurante en la dirección: /admin/ y su identificador.' },
}

export function SinAcceso({ tipo }: { tipo: keyof typeof MENSAJES_SIN_ACCESO }) {
  const { titulo, texto } = MENSAJES_SIN_ACCESO[tipo]
  return (
    <main className="pagina pagina--mesa">
      <Vacio icono="persona" titulo={titulo} texto={texto}>
        <a className="boton boton--secundario" href="/personal">
          Ir a la entrada del personal
        </a>
      </Vacio>
    </main>
  )
}

function Panel({ restauranteId, rol, uid }: { restauranteId: string; rol: RolAdmin; uid: string }) {
  const fuente = usarFuente()
  const ahora = usarAhora()
  const [seccion, setSeccion] = useState<Seccion>(() => seccionDeHash(location.hash))

  const restaurante = usarLectura<Restaurante | null>((a, f) => fuente.escucharRestaurante(restauranteId, a, f), [fuente, restauranteId])
  const pagos = usarLectura<Pago[]>((a, f) => fuente.escucharPagos(restauranteId, a, f), [fuente, restauranteId])
  const facturas = usarLectura<Factura[]>((a, f) => fuente.escucharFacturas(restauranteId, a, f), [fuente, restauranteId])
  const notas = usarLectura<Nota[]>((a, f) => fuente.escucharNotas(restauranteId, a, f), [fuente, restauranteId])
  const cuentas = usarLectura<Cuenta[]>((a, f) => fuente.escucharCuentasAbiertas(restauranteId, a, f), [fuente, restauranteId])
  const productos = usarLectura<Producto[]>((a, f) => fuente.escucharProductos(restauranteId, a, f), [fuente, restauranteId])
  const mesas = usarLectura<Mesa[]>((a, f) => fuente.escucharMesas(restauranteId, a, f), [fuente, restauranteId])
  const datos = useMemo(() => reunir({ pagos, facturas, notas, cuentas, productos }), [pagos, facturas, notas, cuentas, productos])

  function ir(destino: Seccion) {
    setSeccion(destino)
    history.replaceState(null, '', `#${destino}`)
    window.scrollTo({ top: 0 })
  }

  async function salir() {
    await fuente.salir()
    navegar('/personal')
  }

  if (restaurante.estado === 'error') {
    return (
      <main className="pagina pagina--mesa">
        <ErrorVista error={restaurante.error} />
      </main>
    )
  }
  if (restaurante.estado === 'cargando') {
    return (
      <main className="pagina pagina--mesa">
        <Cargando texto="Cargando el restaurante…" />
      </main>
    )
  }
  if (restaurante.valor === null) {
    return (
      <main className="pagina pagina--mesa">
        <Vacio icono="tienda" titulo="No encontramos ese restaurante" texto="Revisa el identificador en la dirección." />
      </main>
    )
  }

  return (
    <div className="admin">
      <header className="admin__cabecera">
        <div className="marca">
          <span className="marca__logo" aria-hidden="true">
            <span />
          </span>
          <span className="marca__nombre">{restaurante.valor.nombre}</span>
        </div>
        <span className="pastilla">{rol === 'plataforma' ? 'Plataforma' : 'Administración'}</span>
        <button className="icono-boton" aria-label="Salir" onClick={salir}>
          <Icono nombre="salir" tamano={18} />
        </button>
      </header>

      <nav className="admin__menu" aria-label="Secciones">
        {SECCIONES.map((nombre) => (
          <button key={nombre} className="admin__opcion" aria-current={seccion === nombre ? 'page' : undefined} onClick={() => ir(nombre)}>
            <Icono nombre={MENU[nombre].icono} tamano={18} />
            <span>{MENU[nombre].texto}</span>
          </button>
        ))}
      </nav>

      <main className="admin__contenido">
        {!restaurante.valor.activo && (
          <p className="aviso aviso--ambar admin__inactivo">
            <Icono nombre="alerta" tamano={18} /> <span>Este restaurante está inactivo: no recibe pedidos ni pagos, pero conserva su historia.</span>
          </p>
        )}
        <div key={seccion} className="admin__vista">
          {seccion === 'dashboard' && <Dashboard datos={datos} ahora={ahora} alIrAFacturas={() => ir('facturas')} />}
          {seccion === 'productos' && <Productos productos={productos} rol={rol} />}
          {seccion === 'personal' && <SeccionPersonal restauranteId={restauranteId} rol={rol} uid={uid} />}
          {seccion === 'facturas' && <Facturas pagos={pagos} facturas={facturas} notas={notas} mesas={mesas} rol={rol} />}
          {seccion === 'mesas' && <Mesas mesas={mesas} origen={location.origin} />}
        </div>
      </main>
    </div>
  )
}

/** /admin y /admin/:restauranteId. */
export function PaginaAdmin({ restauranteId = null }: { restauranteId?: string | null }) {
  const sesion = usarSesion()
  const acceso = decidirAcceso(sesion, restauranteId)
  if (acceso.tipo === 'cargando') {
    return (
      <main className="pagina pagina--mesa">
        <Cargando />
      </main>
    )
  }
  if (acceso.tipo !== 'permitido') return <SinAcceso tipo={acceso.tipo} />
  return <Panel key={acceso.restauranteId} restauranteId={acceso.restauranteId} rol={acceso.rol} uid={acceso.uid} />
}
