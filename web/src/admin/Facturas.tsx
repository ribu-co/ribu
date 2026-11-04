import { useEffect, useMemo, useState } from 'react'
import { CONSULTA_COBRO_SEGUNDOS } from '../../../contratos/reglas'
import type { Comprador, Factura, Mesa, Nota, Pago } from '../../../contratos/tipos'
import { usarFuente, type Lectura } from '../datos/contexto'
import { usarAvisos } from '../ui/Avisos'
import { Boton, Chip, Pestanas } from '../ui/Controles'
import { Cargando, ErrorVista, Vacio } from '../ui/Estados'
import { pesos } from '../ui/formato'
import { Icono } from '../ui/Icono'
import { QrImagen } from '../ui/Qr'
import { puede, type RolAdmin } from './acceso'
import { BotonCopiar, ChipFactura, Confirmar, descargarArchivo, ETIQUETA_MEDIO, fechaHora, reunir, usarAhora } from './comunes'
import { armarFilas, cobroVencido, porResolver, type FilaFactura } from './facturacion'
import { HojaComprador } from './HojaComprador'
import { ETIQUETA_CONCEPTO, HojaNota } from './HojaNota'

export function nombreComprador(comprador: Comprador) {
  if (comprador.tipo === 'persona') return comprador.nombre
  if (comprador.tipo === 'empresa') return comprador.razonSocial
  return 'Consumidor final'
}

function BotonPdf({ etiqueta, descargar }: { etiqueta: string; descargar: () => Promise<void> }) {
  const avisos = usarAvisos()
  const [cargando, setCargando] = useState(false)
  return (
    <Boton
      variante="fantasma"
      className="boton--chico"
      cargando={cargando}
      onClick={async () => {
        setCargando(true)
        try {
          await descargar()
        } catch (e) {
          avisos.error(e)
        } finally {
          setCargando(false)
        }
      }}
    >
      <Icono nombre="descarga" tamano={15} /> {etiqueta}
    </Boton>
  )
}

/** El cobro de una nota débito con Factus Pay. Mientras está abierto consulta el pago, como respaldo del webhook. */
function CobroNota({ nota }: { nota: Nota }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const ahora = usarAhora(1_000)
  const { cobro } = nota
  const notaId = nota.id

  useEffect(() => {
    const consulta = setInterval(() => {
      // Un fallo aquí no se muestra: el siguiente intento o el botón de abajo lo cubren.
      fuente.verificarNota(notaId).catch(() => {})
    }, CONSULTA_COBRO_SEGUNDOS * 1_000)
    return () => clearInterval(consulta)
  }, [fuente, notaId])

  if (!cobro) return null
  const vencido = cobroVencido(cobro.qrExpiraEn, ahora)

  return (
    <div className="admin-cobro">
      {vencido ? (
        <p className="aviso aviso--ambar">
          <Icono nombre="reloj" tamano={18} /> <span>El QR de este cobro ya venció.</span>
        </p>
      ) : (
        <QrImagen base64={cobro.qrBase64} etiqueta={`QR para pagar ${pesos(cobro.monto)}`} />
      )}
      <div className="admin-cobro__textos">
        <strong>{pesos(cobro.monto)}, monto exacto</strong>
        {cobro.llaveBreB && !vencido && (
          <>
            <span className="cufe">{cobro.llaveBreB}</span>
            <BotonCopiar texto={cobro.llaveBreB} etiqueta="Copiar la llave Bre-B">
              Copiar llave Bre-B
            </BotonCopiar>
          </>
        )}
        <Boton variante="fantasma" className="boton--chico" onClick={() => fuente.verificarNota(notaId).catch(avisos.error)}>
          <Icono nombre="actualizar" tamano={15} /> Verificar pago
        </Boton>
        {fuente.simulador && (
          <Boton variante="fantasma" className="boton--chico" onClick={() => fuente.simulador?.pagarCobro(cobro.referencia)}>
            Simular el pago (demo)
          </Boton>
        )}
      </div>
    </div>
  )
}

export function FilaNota({ nota, rol }: { nota: Nota; rol: RolAdmin }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [viendoCobro, setViendoCobro] = useState(false)
  const [marcando, setMarcando] = useState(false)
  const esperandoCobro = nota.estado === 'sin_emitir' && nota.cobro !== null

  async function marcarDevolucion() {
    setMarcando(true)
    try {
      await fuente.marcarDevolucionHecha(nota.id)
      avisos.exito('Devolución registrada')
    } catch (e) {
      avisos.error(e)
    } finally {
      setMarcando(false)
    }
  }

  return (
    <li className="admin-nota">
      <div className="admin-nota__cabeza">
        <div className="admin-fila__textos">
          <strong>
            Nota {nota.tipo === 'credito' ? 'crédito' : 'débito'} · {pesos(nota.total)}
          </strong>
          <span>
            {ETIQUETA_CONCEPTO[nota.concepto]} · {nota.motivo}
          </span>
        </div>
        <div className="admin-chips">
          <ChipFactura estado={nota.estado} />
          {nota.devolucion === 'pendiente' && nota.estado !== 'rechazada' && <Chip tono="ambar">Devolución pendiente</Chip>}
          {nota.devolucion === 'hecha' && <Chip tono="gris">Devolución hecha</Chip>}
        </div>
      </div>

      {nota.datos && (
        <dl className="datos admin-datos">
          <div>
            <dt>Número</dt>
            <dd>{nota.datos.numero}</dd>
          </div>
          <div>
            <dt>CUDE</dt>
            <dd className="cufe">{nota.datos.cude}</dd>
          </div>
        </dl>
      )}
      {nota.ultimoError && nota.estado !== 'emitida' && <p className="admin-detalle">{nota.ultimoError}</p>}
      {esperandoCobro && <p className="admin-detalle">Se emite cuando entre el pago del cliente.</p>}
      {esperandoCobro && viendoCobro && puede(rol, 'verificarNota') && <CobroNota nota={nota} />}

      <div className="admin-fila__acciones">
        {nota.datos && puede(rol, 'descargarNotaPdf') && (
          <BotonPdf
            etiqueta="PDF"
            descargar={async () => descargarArchivo(await fuente.descargarNotaPdf(nota.id), `nota-${nota.datos?.numero}.pdf`)}
          />
        )}
        {esperandoCobro && puede(rol, 'verificarNota') && (
          <Boton variante="fantasma" className="boton--chico" onClick={() => setViendoCobro(!viendoCobro)}>
            <Icono nombre="qr" tamano={15} /> {viendoCobro ? 'Ocultar cobro' : 'Ver cobro'}
          </Boton>
        )}
        {nota.estado === 'rechazada' && puede(rol, 'reintentarNota') && (
          <Boton variante="secundario" className="boton--chico" onClick={() => setCorrigiendo(true)}>
            <Icono nombre="actualizar" tamano={15} /> Corregir y reintentar
          </Boton>
        )}
        {nota.devolucion === 'pendiente' && nota.estado === 'emitida' && puede(rol, 'marcarDevolucionHecha') && (
          <Confirmar texto="Registrar devolución" pregunta={`¿Ya devolviste ${pesos(nota.total)}?`} cargando={marcando} variante="secundario" alConfirmar={marcarDevolucion} />
        )}
      </div>

      {corrigiendo && (
        <HojaComprador
          titulo="Corregir la nota rechazada"
          comprador={nota.comprador}
          ultimoError={nota.ultimoError}
          alCerrar={() => setCorrigiendo(false)}
          alReintentar={(solicitud) => fuente.reintentarNota(nota.id, solicitud)}
        />
      )}
    </li>
  )
}

function MensajeFactura({ factura }: { factura: Factura }) {
  if (factura.estado === 'en_proceso') return <p className="admin-detalle">Se está emitiendo. Se reintenta sola si Factus no responde.</p>
  if (factura.estado === 'en_validacion') return <p className="admin-detalle">La DIAN no ha respondido. Se reintenta sola con la misma referencia.</p>
  if (factura.estado === 'rechazada') return <p className="admin-detalle">{factura.ultimoError ?? 'La DIAN rechazó esta factura.'}</p>
  return null
}

export function TarjetaPago({ fila, rol }: { fila: FilaFactura; rol: RolAdmin }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [hoja, setHoja] = useState<'nota' | 'corregir' | null>(null)
  const { pago, factura, notas, numeroMesa } = fila
  const datos = factura?.datos ?? null

  return (
    <li className="tarjeta admin-pago">
      <div className="admin-pago__cabeza">
        <div className="admin-fila__textos">
          <strong>
            {numeroMesa === null ? 'Mesa eliminada' : `Mesa ${numeroMesa}`} · Pago {pago.numero}
            {pago.parte === null ? '' : `, parte ${pago.parte}`}
          </strong>
          <span>
            {fechaHora(pago.pagadoEn ?? pago.creadoEn)} · {ETIQUETA_MEDIO[pago.medio]}
            {factura ? ` · ${nombreComprador(factura.comprador)}` : ''}
          </span>
        </div>
        <div className="admin-pago__total">
          <strong>{pesos(pago.total)}</strong>
          {factura ? <ChipFactura estado={factura.estado} /> : <Chip tono="gris">Sin factura</Chip>}
        </div>
      </div>

      {pago.incidencia === 'pago_duplicado' && (
        <p className="aviso aviso--ambar">
          <Icono nombre="alerta" tamano={18} /> <span>Pago duplicado: no genera factura. El dinero se devuelve por fuera.</span>
        </p>
      )}
      {factura && <MensajeFactura factura={factura} />}

      {datos && (
        <dl className="datos admin-datos">
          <div>
            <dt>Número</dt>
            <dd>{datos.numero}</dd>
          </div>
          <div>
            <dt>CUFE</dt>
            <dd className="cufe">{datos.cufe}</dd>
          </div>
        </dl>
      )}

      {factura && (
        <div className="admin-fila__acciones">
          {datos && <BotonCopiar texto={datos.cufe} etiqueta="Copiar el CUFE">Copiar CUFE</BotonCopiar>}
          {datos && puede(rol, 'descargarFacturaPdf') && (
            <BotonPdf etiqueta="PDF" descargar={async () => descargarArchivo(await fuente.descargarFacturaPdf(pago.mesaToken, pago.id), `factura-${datos.numero}.pdf`)} />
          )}
          {factura.estado === 'rechazada' && puede(rol, 'reintentarFactura') && (
            <Boton variante="secundario" className="boton--chico" onClick={() => setHoja('corregir')}>
              <Icono nombre="actualizar" tamano={15} /> Corregir y reintentar
            </Boton>
          )}
          {datos && puede(rol, 'crearNota') && (
            <Boton variante="secundario" className="boton--chico" onClick={() => setHoja('nota')}>
              <Icono nombre="nota" tamano={15} /> Emitir nota
            </Boton>
          )}
        </div>
      )}

      {notas.length > 0 && (
        <ul className="admin-notas">
          {notas.map((nota) => (
            <FilaNota key={nota.id} nota={nota} rol={rol} />
          ))}
        </ul>
      )}

      {hoja === 'nota' && factura && <HojaNota pago={pago} factura={factura} alCerrar={() => setHoja(null)} />}
      {hoja === 'corregir' && factura && (
        <HojaComprador
          titulo="Corregir la factura rechazada"
          comprador={factura.comprador}
          ultimoError={factura.ultimoError}
          alCerrar={() => setHoja(null)}
          alReintentar={async (solicitud) => {
            await fuente.reintentarFactura(pago.mesaToken, pago.id, solicitud)
            avisos.exito('Factura enviada otra vez a la DIAN')
          }}
        />
      )}
    </li>
  )
}

export function Facturas({
  pagos,
  facturas,
  notas,
  mesas,
  rol,
}: {
  pagos: Lectura<Pago[]>
  facturas: Lectura<Factura[]>
  notas: Lectura<Nota[]>
  mesas: Lectura<Mesa[]>
  rol: RolAdmin
}) {
  const [filtro, setFiltro] = useState<'todas' | 'por_resolver'>('todas')
  const datos = reunir({ pagos, facturas, notas, mesas })
  const filas = useMemo(
    () => (datos.estado === 'listo' ? armarFilas(datos.valor.pagos, datos.valor.facturas, datos.valor.notas, datos.valor.mesas) : []),
    [pagos, facturas, notas, mesas],
  )

  if (datos.estado === 'error') return <ErrorVista error={datos.error} />
  if (datos.estado === 'cargando') return <Cargando texto="Cargando las facturas…" />

  const pendientes = filas.filter(porResolver)
  const visibles = filtro === 'todas' ? filas : pendientes

  return (
    <div className="admin-seccion">
      <div className="admin-seccion__cabeza">
        <div className="admin-periodo">
          <Pestanas
            etiqueta="Filtrar"
            valor={filtro}
            alCambiar={setFiltro}
            opciones={[
              { valor: 'todas', texto: 'Todas' },
              { valor: 'por_resolver', texto: 'Por resolver', insignia: pendientes.length },
            ]}
          />
        </div>
      </div>
      {!puede(rol, 'crearNota') && (
        <p className="aviso aviso--info">
          <Icono nombre="alerta" tamano={18} /> <span>Solo el administrador del restaurante descarga PDF, reintenta y emite notas. Desde la plataforma se puede consultar.</span>
        </p>
      )}
      {visibles.length === 0 ? (
        filtro === 'todas' ? (
          <Vacio icono="recibo" titulo="Todavía no hay pagos" texto="Cuando entre el primer pago, aquí aparece con su factura." />
        ) : (
          <Vacio icono="check" titulo="Nada por resolver" texto="Todas las facturas y notas están al día." />
        )
      ) : (
        <ul className="admin-pagos">
          {visibles.map((fila) => (
            <TarjetaPago key={fila.pago.id} fila={fila} rol={rol} />
          ))}
        </ul>
      )}
    </div>
  )
}
