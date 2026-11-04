import { useState } from 'react'
import { puedeLiberarMesa, rutas } from '../../../contratos/reglas'
import type { Cuenta, EstadoLinea, LineaPedido, Mesa, Pago, Restaurante } from '../../../contratos/tipos'
import type { ObjetivoPago } from '../cliente/Dividir'
import { Medidor } from '../cliente/Cuenta'
import { etiquetaPago, todoPagado } from '../cliente/cuenta'
import { usarFuente, usarLectura } from '../datos/contexto'
import { navegar } from '../ruta'
import { usarAvisos } from '../ui/Avisos'
import { Boton, Chip, Pestanas } from '../ui/Controles'
import { AvanceLinea } from '../ui/EstadoLinea'
import { EsqueletoRonda } from '../ui/Esqueletos'
import { ErrorVista, Vacio } from '../ui/Estados'
import { hora, pesos, plural } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { Icono } from '../ui/Icono'
import { agruparPorRonda, resumenLineas } from '../ui/lineas'
import { CobroMesa } from './CobroMesa'
import { HojaCobrar } from './HojaCobrar'
import { HojaMotivo } from './HojaMotivo'
import { HojaPago } from './HojaPago'
import {
  accionesDeLinea,
  ESTADO_FACTURA,
  ETIQUETA_MEDIO,
  idsPorConfirmar,
  motivosParaNoLiberar,
  QUIEN_PIDIO,
  ROLES_MESERO,
  unidadesSinEntregar,
  type AccionLinea,
  type SesionPersonal,
} from './logica'
import { CabeceraPersonal, Enlace, Puerta } from './Puerta'
import { usarAccion } from './usarAccion'

export function PaginaMesaMesero({ token }: { token: string }) {
  return (
    <Puerta roles={ROLES_MESERO} pantalla="mesero">
      {(sesion) => <MesaEnVivo token={token} sesion={sesion} />}
    </Puerta>
  )
}

function MesaEnVivo({ token, sesion }: { token: string; sesion: SesionPersonal }) {
  const fuente = usarFuente()
  const id = sesion.restauranteId
  const mesa = usarLectura<Mesa | null>((a, b) => fuente.escucharMesa(token, a, b), [fuente, token])
  const restaurante = usarLectura<Restaurante | null>((a, b) => fuente.escucharRestaurante(id, a, b), [fuente, id])
  const cuentaId = mesa.estado === 'listo' ? (mesa.valor?.cuentaId ?? null) : null
  const cuenta = usarLectura<Cuenta | null>(cuentaId ? (a, b) => fuente.escucharCuenta(id, cuentaId, a, b) : null, [fuente, id, cuentaId])

  const error = [mesa, restaurante, cuenta].find((l) => l.estado === 'error')
  if (error?.estado === 'error') {
    return (
      <main className="pagina pagina--personal">
        <ErrorVista error={error.error} alReintentar={() => location.reload()} />
      </main>
    )
  }
  if (mesa.estado !== 'listo' || restaurante.estado !== 'listo') return <CargandoMesa />
  // Otra mesa de otro restaurante se trata igual que una que no existe.
  if (!mesa.valor || mesa.valor.restauranteId !== id || !restaurante.valor) {
    return (
      <main className="pagina pagina--personal">
        <Vacio icono="mesa" titulo="Esta mesa no está en tu restaurante">
          <Enlace a="/mesero" className="boton boton--secundario">
            Ver las mesas
          </Enlace>
        </Vacio>
      </main>
    )
  }
  if (cuentaId && cuenta.estado !== 'listo') return <CargandoMesa />
  const valorCuenta = cuentaId && cuenta.estado === 'listo' && cuenta.valor?.estado !== 'cerrada' ? cuenta.valor : null
  return <VistaMesaMesero mesa={mesa.valor} cuenta={valorCuenta} restaurante={restaurante.valor} sesion={sesion} />
}

function CargandoMesa() {
  return (
    <main className="pagina pagina--personal" aria-busy="true">
      <EsqueletoRonda lineas={3} />
    </main>
  )
}

export type PestanaMesero = 'pedido' | 'cuenta'

/** El título de arriba: lo primero que el mesero tiene que resolver en esta mesa. */
function tituloDeMesa(cuenta: Cuenta | null, pendientes: number) {
  if (!cuenta || cuenta.lineas.length === 0) return 'Mesa libre'
  if (pendientes > 0) return `${plural(pendientes, 'línea')} por confirmar`
  if (todoPagado(cuenta)) return 'Cuenta pagada'
  if (cuenta.porPagar > 0) return `Saldo ${pesos(cuenta.porPagar)}`
  if (cuenta.enCobro > 0) return `En cobro ${pesos(cuenta.enCobro)}`
  return 'Sin saldo'
}

export function VistaMesaMesero({
  mesa,
  cuenta,
  restaurante,
  sesion,
  pestanaInicial = 'pedido',
}: {
  mesa: Mesa
  cuenta: Cuenta | null
  restaurante: Restaurante
  sesion: SesionPersonal
  pestanaInicial?: PestanaMesero
}) {
  const fuente = usarFuente()
  const { ocupado, ejecutar } = usarAccion()
  const token = mesa.token
  const pendientes = idsPorConfirmar(cuenta)
  const resumen = resumenLineas(cuenta?.lineas ?? [])
  const [pestana, setPestana] = useState<PestanaMesero>(pestanaInicial)

  // Los objetivos siguen montados mientras la hoja se cierra, para que no se vacíe en la animación.
  const [motivo, setMotivo] = useState<{ accion: 'rechazar' | 'anular'; linea: LineaPedido } | null>(null)
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false)
  const [objetivo, setObjetivo] = useState<ObjetivoPago | null>(null)
  const [cobrando, setCobrando] = useState(false)
  const [pagoVisto, setPagoVisto] = useState<string | null>(null)
  const [viendoPago, setViendoPago] = useState(false)

  const verPago = (pagoId: string) => {
    setPagoVisto(pagoId)
    setViendoPago(true)
  }

  function alAccion(accion: AccionLinea, linea: LineaPedido) {
    if (accion === 'rechazar' || accion === 'anular') {
      setMotivo({ accion, linea })
      setPidiendoMotivo(true)
      return
    }
    const clave = `${accion}:${linea.id}`
    if (accion === 'confirmar') void ejecutar(clave, () => fuente.confirmarLineas(token, { lineaIds: [linea.id] }), `${linea.nombre} va para cocina`)
    if (accion === 'marcar_lista') void ejecutar(clave, () => fuente.avanzarLinea(token, linea.id, { estado: 'lista' }))
    if (accion === 'entregar') void ejecutar(clave, () => fuente.avanzarLinea(token, linea.id, { estado: 'entregada' }))
  }

  return (
    <main className="pagina pagina--mesa">
      <CabeceraPersonal restaurante={restaurante.nombre} pastilla={`Mesa ${mesa.numero}`} volver="/mesero" />

      <section className="hero">
        <p className="hero__etiqueta">Mesa {mesa.numero}</p>
        <h1 className="hero__titulo">{tituloDeMesa(cuenta, pendientes.length)}</h1>
        {cuenta && cuenta.lineas.length > 0 ? (
          <p className="hero__texto">
            {resumen.length > 0 && `${resumen.join(' · ')}. `}
            Consumo {pesos(cuenta.consumo)} · Por pagar {pesos(cuenta.porPagar)}
          </p>
        ) : (
          <p className="hero__texto">Lo que pidas desde el link de la mesa va directo a cocina.</p>
        )}
        <Enlace a={rutas.paginaMesa(token)} className="hero__resumen hero__resumen--enlace">
          <span>Tomar pedido</span>
          <span className="icono-circulo">
            <Icono nombre="mas" tamano={16} />
          </span>
        </Enlace>
      </section>

      {cuenta && cuenta.lineas.length > 0 && (
        <>
          <div className="barra-pestanas">
            <Pestanas
              etiqueta="Secciones de la mesa"
              valor={pestana}
              alCambiar={setPestana}
              opciones={[
                { valor: 'pedido', texto: 'Pedido', insignia: pendientes.length },
                { valor: 'cuenta', texto: 'Cuenta' },
              ]}
            />
          </div>

          <div className="contenido" key={pestana}>
            {pestana === 'pedido' && (
              <div className="rondas">
                {agruparPorRonda(cuenta.lineas).map((ronda) => (
                  <section key={ronda.numero} className="tarjeta ronda entra">
                    <header className="ronda__cabeza">
                      <h3>Ronda {ronda.numero}</h3>
                      <span>{hora(ronda.creadaEn)}</span>
                    </header>
                    <ul className="lineas">
                      {ronda.lineas.map((linea) => (
                        <LineaMesero key={linea.id} linea={linea} ocupado={ocupado} alAccion={alAccion} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {pestana === 'cuenta' && (
              <div className="mesa-detalle__cuenta">
                <section className="tarjeta cuenta__resumen entra" aria-label="Totales de la cuenta">
                  <Medidor consumo={cuenta.consumo} pagado={cuenta.pagado} enCobro={cuenta.enCobro} />
                  <div className="cifras">
                    <Cifra titulo="Consumo" valor={cuenta.consumo} />
                    <Cifra titulo="Pagado" valor={cuenta.pagado} />
                    <Cifra titulo="En cobro" valor={cuenta.enCobro} />
                    <Cifra titulo="Por pagar" valor={cuenta.porPagar} destacada />
                  </div>
                </section>

                <CobroMesa
                  cuenta={cuenta}
                  sesion={sesion}
                  token={token}
                  alCobrar={(nuevo) => {
                    setObjetivo(nuevo)
                    setCobrando(true)
                  }}
                  alVerPago={verPago}
                />

                <ListaPagos cuenta={cuenta} uid={sesion.uid} alVerPago={verPago} />
                <LiberarMesa mesa={mesa} cuenta={cuenta} />
              </div>
            )}
          </div>
        </>
      )}

      <div className="barra-flotante" data-visible={pendientes.length > 0} inert={pendientes.length === 0}>
        <Boton
          ancho
          className="boton--barra"
          cargando={ocupado === 'confirmar-todo'}
          disabled={ocupado !== null}
          onClick={() => void ejecutar('confirmar-todo', () => fuente.confirmarLineas(token, { lineaIds: pendientes }), 'Enviado a cocina')}
        >
          <span className="burbuja">{pendientes.length}</span>
          <span>Confirmar y enviar a cocina</span>
        </Boton>
      </div>

      {motivo && (
        <HojaMotivo
          abierta={pidiendoMotivo}
          alCerrar={() => setPidiendoMotivo(false)}
          accion={motivo.accion}
          linea={motivo.linea}
          token={token}
        />
      )}
      {objetivo && (
        <HojaCobrar
          abierta={cobrando}
          alCerrar={() => setCobrando(false)}
          objetivo={objetivo}
          restaurante={restaurante}
          token={token}
          alCrear={(pago: Pago) => {
            setCobrando(false)
            verPago(pago.id)
          }}
        />
      )}
      <HojaPago
        abierta={viendoPago}
        alCerrar={() => setViendoPago(false)}
        pagoId={pagoVisto}
        token={token}
        restauranteId={mesa.restauranteId}
      />
    </main>
  )
}

function Cifra({ titulo, valor, destacada = false }: { titulo: string; valor: number; destacada?: boolean }) {
  return (
    <div className={`cifra${destacada ? ' cifra--destacada' : ''}`}>
      <span>{titulo}</span>
      <strong>{pesos(valor)}</strong>
    </div>
  )
}

const CHIP_LINEA: Record<EstadoLinea, { texto: string; tono: string }> = {
  pendiente: { texto: 'Por confirmar', tono: 'ambar' },
  confirmada: { texto: 'Confirmado', tono: 'verde-suave' },
  en_preparacion: { texto: 'En preparación', tono: 'verde' },
  lista: { texto: 'Listo para servir', tono: 'verde-fuerte' },
  entregada: { texto: 'Entregado', tono: 'gris' },
  rechazada: { texto: 'Rechazado', tono: 'rojo' },
  anulada: { texto: 'Anulado', tono: 'gris' },
}

const BOTON_ACCION: Record<AccionLinea, { texto: string; variante: 'primario' | 'secundario' | 'fantasma' }> = {
  confirmar: { texto: 'Confirmar', variante: 'primario' },
  rechazar: { texto: 'Rechazar', variante: 'fantasma' },
  entregar: { texto: 'Entregada', variante: 'primario' },
  marcar_lista: { texto: 'Ya está lista', variante: 'secundario' },
  anular: { texto: 'Anular', variante: 'fantasma' },
}

function LineaMesero({
  linea,
  ocupado,
  alAccion,
}: {
  linea: LineaPedido
  ocupado: string | null
  alAccion: (accion: AccionLinea, linea: LineaPedido) => void
}) {
  const chip = CHIP_LINEA[linea.estado]
  const acciones = accionesDeLinea(linea)
  return (
    <li className="linea" data-estado={linea.estado}>
      <span className="linea__cantidad">{linea.cantidad}×</span>
      <div className="linea__cuerpo">
        <div className="linea__fila">
          <strong className="linea__nombre">{linea.nombre}</strong>
          <span className="linea__precio">{pesos(linea.precio * linea.cantidad)}</span>
        </div>
        {linea.nota && <span className="nota-linea">“{linea.nota}”</span>}
        <div className="linea__fila">
          <Chip tono={chip.tono} rayado={linea.estado === 'pendiente'}>
            {chip.texto}
          </Chip>
          <AvanceLinea estado={linea.estado} />
        </div>
        <span className="linea__meta">
          {QUIEN_PIDIO[linea.origen]} · {hora(linea.creadaEn)}
          {linea.cantidadCubierta > 0 && ` · ${linea.cantidadCubierta} de ${linea.cantidad} en un pago`}
        </span>
        {linea.motivo && <p className="linea__motivo">{linea.motivo}</p>}
        {acciones.length > 0 && (
          <div className="acciones-linea">
            {acciones.map((accion) => {
              const clave = `${accion}:${linea.id}`
              const { texto, variante } = BOTON_ACCION[accion]
              return (
                <Boton
                  key={accion}
                  variante={variante}
                  cargando={ocupado === clave}
                  disabled={ocupado !== null}
                  aria-label={`${texto}: ${linea.nombre}`}
                  onClick={() => alAccion(accion, linea)}
                >
                  {texto}
                </Boton>
              )
            })}
          </div>
        )}
      </div>
    </li>
  )
}

function ListaPagos({ cuenta, uid, alVerPago }: { cuenta: Cuenta; uid: string; alVerPago: (pagoId: string) => void }) {
  if (cuenta.pagos.length === 0) return null
  return (
    <section className="tarjeta">
      <h2 className="tarjeta__titulo">Pagos de la mesa</h2>
      <ul className="pagos">
        {cuenta.pagos.map((pago) => {
          const factura = ESTADO_FACTURA[pago.estadoFactura]
          return (
            <li key={pago.id}>
              <button className="pago-fila" onClick={() => alVerPago(pago.id)}>
                <span className="pago-fila__numero">{pago.numero}</span>
                <span className="pago-fila__texto">
                  <strong>{pesos(pago.total)}</strong>
                  <span>
                    {pago.parte ? `Parte ${pago.parte} · ` : ''}
                    {ETIQUETA_MEDIO[pago.medio]} · {pago.creadoPor === uid ? 'Por ti' : 'Otra persona'}
                  </span>
                  {pago.estado === 'pagado' && pago.incidencia === null && <span>{factura.texto}</span>}
                </span>
                <Chip tono={pago.estado === 'pagado' ? (pago.incidencia ? 'ambar' : 'verde-suave') : pago.estado === 'esperando_pago' ? 'verde' : 'gris'}>
                  {etiquetaPago(pago)}
                </Chip>
                <Icono nombre="derecha" tamano={18} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function LiberarMesa({ mesa, cuenta }: { mesa: Mesa; cuenta: Cuenta }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [abierta, setAbierta] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const motivos = motivosParaNoLiberar(cuenta)
  const sinEntregar = unidadesSinEntregar(cuenta)

  async function liberar() {
    setEnviando(true)
    try {
      await fuente.liberarMesa(mesa.token)
      avisos.exito(`Mesa ${mesa.numero} libre`)
      navegar('/mesero', { reemplazar: true })
    } catch (error) {
      avisos.error(error)
      setAbierta(false)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="tarjeta liberar-mesa">
      <Boton ancho variante="secundario" disabled={!puedeLiberarMesa(cuenta)} onClick={() => setAbierta(true)}>
        Liberar la mesa
      </Boton>
      {motivos.length > 0 && <p className="ayuda-campo">Falta resolver: {motivos.join(', ')}.</p>}
      <Hoja
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`¿Liberar la mesa ${mesa.numero}?`}
        pie={
          <Boton ancho cargando={enviando} onClick={() => void liberar()}>
            Sí, liberar la mesa
          </Boton>
        }
      >
        <p className="hoja__texto">La cuenta se cierra y el siguiente cliente no ve nada de este pedido.</p>
        {sinEntregar > 0 && (
          <p className="aviso aviso--ambar">
            <Icono nombre="alerta" tamano={18} />
            <span>{plural(sinEntregar, 'producto')} sin entregar desaparecerán también de la cocina.</span>
          </p>
        )}
      </Hoja>
    </section>
  )
}
