import { useMemo, useState } from 'react'
import type { Producto } from '../../../contratos/tipos'
import type { Lectura } from '../datos/contexto'
import { usarFuente } from '../datos/contexto'
import { usarAvisos } from '../ui/Avisos'
import { Boton, Chip } from '../ui/Controles'
import { AvisoError, Cargando, ErrorVista, Vacio } from '../ui/Estados'
import { pesos } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { Icono } from '../ui/Icono'
import { puede, type RolAdmin } from './acceso'
import { Campo, Confirmar } from './comunes'
import { cambiosDeProducto, formularioDeProducto, leerProducto, type CampoProducto, type Errores, type FormularioProducto } from './formularios'

/** Las categorías en el orden en que aparecen y los productos por nombre. */
export function agruparPorCategoria(productos: readonly Producto[]) {
  const grupos = new Map<string, Producto[]>()
  for (const producto of productos) grupos.set(producto.categoria, [...(grupos.get(producto.categoria) ?? []), producto])
  return [...grupos].map(([categoria, lista]) => ({
    categoria,
    productos: [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  }))
}

function HojaProducto({ producto, categorias, alCerrar }: { producto: Producto | null; categorias: string[]; alCerrar: () => void }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [formulario, setFormulario] = useState(() => formularioDeProducto(producto ?? undefined))
  const [errores, setErrores] = useState<Errores<CampoProducto>>({})
  const [error, setError] = useState<unknown>(null)
  const [enviando, setEnviando] = useState(false)
  const cambiar = <K extends keyof FormularioProducto>(campo: K, valor: FormularioProducto[K]) => setFormulario((actual) => ({ ...actual, [campo]: valor }))

  async function guardar() {
    const leido = leerProducto(formulario)
    if ('errores' in leido) {
      setErrores(leido.errores)
      return
    }
    setErrores({})
    setError(null)
    setEnviando(true)
    try {
      if (producto) await fuente.actualizarProducto(producto.id, cambiosDeProducto(producto, leido.valor))
      else await fuente.crearProducto(leido.valor)
      avisos.exito(producto ? 'Producto actualizado' : 'Producto creado', leido.valor.nombre)
      alCerrar()
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  const sinStock = formulario.llevaStock && formulario.stock.trim() === '0'

  return (
    <Hoja
      abierta
      alCerrar={alCerrar}
      titulo={producto ? `Editar ${producto.nombre}` : 'Nuevo producto'}
      pie={
        <Boton ancho cargando={enviando} onClick={guardar}>
          {producto ? 'Guardar cambios' : 'Crear producto'}
        </Boton>
      }
    >
      <AvisoError error={error} />
      <Campo etiqueta="Nombre" error={errores.nombre}>
        <input className="entrada" value={formulario.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />
      </Campo>
      <Campo etiqueta="Categoría" error={errores.categoria}>
        <input className="entrada" list="admin-categorias" value={formulario.categoria} onChange={(e) => cambiar('categoria', e.target.value)} />
        <datalist id="admin-categorias">
          {categorias.map((categoria) => (
            <option key={categoria} value={categoria} />
          ))}
        </datalist>
      </Campo>
      <Campo etiqueta="Precio" ayuda="En pesos, con impuesto incluido, como en la carta." error={errores.precio}>
        <input className="entrada" inputMode="numeric" value={formulario.precio} onChange={(e) => cambiar('precio', e.target.value)} />
      </Campo>
      <Campo etiqueta="Descripción (opcional)">
        <textarea className="entrada" rows={2} value={formulario.descripcion} onChange={(e) => cambiar('descripcion', e.target.value)} />
      </Campo>
      <label className="admin-casilla">
        <input type="checkbox" checked={formulario.llevaStock} onChange={(e) => cambiar('llevaStock', e.target.checked)} />
        <span>Llevar conteo de unidades</span>
      </label>
      {formulario.llevaStock && (
        <Campo etiqueta="Unidades que quedan" ayuda="Baja sola cuando se confirma un pedido." error={errores.stock}>
          <input className="entrada" inputMode="numeric" value={formulario.stock} onChange={(e) => cambiar('stock', e.target.value)} />
        </Campo>
      )}
      <label className="admin-casilla">
        <input type="checkbox" checked={formulario.disponible && !sinStock} disabled={sinStock} onChange={(e) => cambiar('disponible', e.target.checked)} />
        <span>{sinStock ? 'Agotado: no quedan unidades' : 'Disponible en la carta'}</span>
      </label>
      <Campo etiqueta="Enlace de la foto (opcional)">
        <input className="entrada" inputMode="url" value={formulario.imagenUrl} onChange={(e) => cambiar('imagenUrl', e.target.value)} />
      </Campo>
    </Hoja>
  )
}

export function FilaProducto({ producto, rol, alEditar }: { producto: Producto; rol: RolAdmin; alEditar: () => void }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [ocupado, setOcupado] = useState(false)

  async function correr(accion: () => Promise<unknown>, exito: string) {
    setOcupado(true)
    try {
      await accion()
      avisos.exito(exito, producto.nombre)
    } catch (e) {
      avisos.error(e)
    } finally {
      setOcupado(false)
    }
  }

  const agotadoPorStock = producto.stock === 0
  const activo = producto.disponible && !agotadoPorStock

  return (
    <li className="admin-fila">
      <div className="admin-fila__textos">
        <strong>{producto.nombre}</strong>
        <span>
          {pesos(producto.precio)} · {producto.stock === null ? 'Sin conteo' : `${producto.stock} en stock`}
        </span>
      </div>
      <Chip tono={activo ? 'verde-suave' : 'gris'}>{activo ? 'Disponible' : 'Agotado'}</Chip>
      <div className="admin-fila__acciones">
        {puede(rol, 'actualizarProducto') && (
          <>
            <Boton
              variante="fantasma"
              className="boton--chico"
              cargando={ocupado}
              disabled={agotadoPorStock}
              title={agotadoPorStock ? 'Sube el stock para volver a ofrecerlo' : undefined}
              onClick={() => correr(() => fuente.actualizarProducto(producto.id, { disponible: !producto.disponible }), producto.disponible ? 'Marcado como agotado' : 'Marcado como disponible')}
            >
              {producto.disponible ? 'Marcar agotado' : 'Marcar disponible'}
            </Boton>
            <button className="icono-boton" aria-label={`Editar ${producto.nombre}`} onClick={alEditar}>
              <Icono nombre="nota" tamano={16} />
            </button>
          </>
        )}
        {puede(rol, 'borrarProducto') && (
          <Confirmar texto="Borrar" pregunta="¿Borrar de la carta?" cargando={ocupado} alConfirmar={() => correr(() => fuente.borrarProducto(producto.id), 'Producto borrado')} />
        )}
      </div>
    </li>
  )
}

export function Productos({ productos, rol }: { productos: Lectura<Producto[]>; rol: RolAdmin }) {
  const [hoja, setHoja] = useState<{ producto: Producto | null } | null>(null)
  const lista = productos.estado === 'listo' ? productos.valor : null
  const grupos = useMemo(() => agruparPorCategoria(lista ?? []), [lista])

  if (productos.estado === 'error') return <ErrorVista error={productos.error} />
  if (productos.estado === 'cargando') return <Cargando texto="Cargando los productos…" />

  const puedeCrear = puede(rol, 'crearProducto')

  return (
    <div className="admin-seccion">
      <div className="admin-seccion__cabeza">
        <h2 className="tarjeta__titulo">Productos</h2>
        {puedeCrear && (
          <Boton className="boton--chico" onClick={() => setHoja({ producto: null })}>
            <Icono nombre="mas" tamano={16} /> Nuevo producto
          </Boton>
        )}
      </div>
      {!puedeCrear && (
        <p className="aviso aviso--info">
          <Icono nombre="alerta" tamano={18} /> <span>Solo el administrador del restaurante cambia la carta. Desde la plataforma se puede consultar.</span>
        </p>
      )}
      {grupos.length === 0 ? (
        <Vacio icono="carta" titulo="La carta está vacía" texto={puedeCrear ? 'Crea el primer producto para que aparezca en las mesas.' : 'Este restaurante todavía no tiene productos.'} />
      ) : (
        grupos.map((grupo) => (
          <section key={grupo.categoria} className="tarjeta admin-grupo">
            <h3 className="admin-grupo__titulo">{grupo.categoria}</h3>
            <ul className="admin-filas">
              {grupo.productos.map((producto) => (
                <FilaProducto key={producto.id} producto={producto} rol={rol} alEditar={() => setHoja({ producto })} />
              ))}
            </ul>
          </section>
        ))
      )}
      {hoja && <HojaProducto producto={hoja.producto} categorias={grupos.map((g) => g.categoria)} alCerrar={() => setHoja(null)} />}
    </div>
  )
}
