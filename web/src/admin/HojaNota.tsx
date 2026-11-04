import { useState } from 'react'
import { MONTO_MAXIMO_COBRO, MONTO_MINIMO_COBRO } from '../../../contratos/reglas'
import { CONCEPTOS_NOTA_CREDITO, CONCEPTOS_NOTA_DEBITO, MEDIOS_PAGO, type ConceptoNotaCredito, type ConceptoNotaDebito, type Factura, type MedioPago, type Pago, type TipoNota } from '../../../contratos/tipos'
import { usarFuente } from '../datos/contexto'
import { usarAvisos } from '../ui/Avisos'
import { Boton } from '../ui/Controles'
import { AvisoError } from '../ui/Estados'
import { pesos } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { Icono } from '../ui/Icono'
import { Campo, ETIQUETA_MEDIO } from './comunes'
import { leerNota, LINEA_VACIA, lineaDeItem, puedeAnular, saldoDe, type FormularioNota, type LineaFormulario } from './formularios'

export const ETIQUETA_CONCEPTO: Record<ConceptoNotaCredito | ConceptoNotaDebito, string> = {
  devolucion_parcial: 'Devolución parcial',
  anulacion: 'Anulación de la factura',
  rebaja: 'Rebaja o descuento',
  ajuste_precio: 'Ajuste de precio',
  intereses: 'Intereses',
  gastos_por_cobrar: 'Gastos por cobrar',
  cambio_valor: 'Cambio de valor',
  otros: 'Otros',
}

export function HojaNota({ pago, factura, alCerrar }: { pago: Pago; factura: Factura; alCerrar: () => void }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const contexto = { totalPago: pago.total, notas: factura.notas }
  const saldo = saldoDe(contexto)
  const anulable = puedeAnular(contexto)
  const acreditable = saldo > 0

  const [formulario, setFormulario] = useState<FormularioNota>(() => ({
    tipo: acreditable ? 'credito' : 'debito',
    concepto: acreditable ? (anulable ? 'anulacion' : 'devolucion_parcial') : 'cambio_valor',
    motivo: '',
    lineas: [{ ...LINEA_VACIA }],
    medio: pago.medio,
  }))
  const [error, setError] = useState<unknown>(null)
  const [enviando, setEnviando] = useState(false)

  const esAnulacion = formulario.tipo === 'credito' && formulario.concepto === 'anulacion'
  const leida = leerNota(formulario, contexto)
  const items = pago.items.filter((item) => item.lineaId !== null)

  function cambiarTipo(tipo: TipoNota) {
    setFormulario({ ...formulario, tipo, concepto: tipo === 'debito' ? 'cambio_valor' : anulable ? 'anulacion' : 'devolucion_parcial' })
  }

  function cambiarLinea(indice: number, campo: keyof LineaFormulario, valor: string) {
    setFormulario({ ...formulario, lineas: formulario.lineas.map((linea, i) => (i === indice ? { ...linea, [campo]: valor } : linea)) })
  }

  function agregarLinea(linea: LineaFormulario) {
    // Si la única línea sigue en blanco, la reemplaza.
    const enBlanco = formulario.lineas.length === 1 && !formulario.lineas[0]?.descripcion && !formulario.lineas[0]?.precio
    setFormulario({ ...formulario, lineas: enBlanco ? [linea] : [...formulario.lineas, linea] })
  }

  async function emitir() {
    if (!('solicitud' in leida)) return
    setEnviando(true)
    setError(null)
    try {
      const nota = await fuente.crearNota(pago.id, leida.solicitud)
      avisos.exito(nota.cobro ? 'Nota creada: falta el cobro' : 'Nota enviada a la DIAN', nota.cobro ? 'Muestra el QR para que el cliente pague.' : undefined)
      alCerrar()
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja
      abierta
      alCerrar={alCerrar}
      titulo={`Nota sobre la factura ${factura.datos?.numero ?? ''}`}
      subtitulo={`Facturado ${pesos(pago.total)} · Queda por acreditar ${pesos(saldo)}`}
      pie={
        <>
          <div className="fila-total">
            <span>Total de la nota, con impuesto{esAnulacion ? ' y propina' : ''}</span>
            <strong>{leida.total === null ? '—' : pesos(leida.total)}</strong>
          </div>
          {'error' in leida && <p className="ayuda-campo">{leida.error}</p>}
          <Boton ancho cargando={enviando} disabled={!('solicitud' in leida)} onClick={emitir}>
            {formulario.tipo === 'debito' && formulario.medio === 'factus_pay' ? 'Crear nota y cobro' : 'Emitir nota'}
          </Boton>
        </>
      }
    >
      <AvisoError error={error} />

      <Campo etiqueta="Tipo de nota" ayuda={formulario.tipo === 'credito' ? 'Anula o rebaja. Factus Pay no tiene reversos: el dinero se devuelve por fuera.' : 'Suma un mayor valor a la factura.'}>
        <select className="entrada" value={formulario.tipo} onChange={(e) => cambiarTipo(e.target.value as TipoNota)}>
          <option value="credito" disabled={!acreditable}>
            Nota crédito{acreditable ? '' : ' (no queda saldo)'}
          </option>
          <option value="debito">Nota débito</option>
        </select>
      </Campo>

      <Campo etiqueta="Concepto">
        <select className="entrada" value={formulario.concepto} onChange={(e) => setFormulario({ ...formulario, concepto: e.target.value as FormularioNota['concepto'] })}>
          {(formulario.tipo === 'credito' ? CONCEPTOS_NOTA_CREDITO : CONCEPTOS_NOTA_DEBITO).map((concepto) => (
            <option key={concepto} value={concepto} disabled={concepto === 'anulacion' && !anulable}>
              {ETIQUETA_CONCEPTO[concepto]}
              {concepto === 'anulacion' && !anulable ? ' (ya se acreditó una parte)' : ''}
            </option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="Motivo">
        <textarea className="entrada" rows={2} value={formulario.motivo} onChange={(e) => setFormulario({ ...formulario, motivo: e.target.value })} />
      </Campo>

      {formulario.tipo === 'debito' && (
        <Campo
          etiqueta="Medio de pago"
          ayuda={formulario.medio === 'factus_pay' ? `Crea un cobro de ${pesos(MONTO_MINIMO_COBRO)} a ${pesos(MONTO_MAXIMO_COBRO)}. La nota se emite cuando entra el pago.` : 'Se emite de una vez.'}
        >
          <select className="entrada" value={formulario.medio} onChange={(e) => setFormulario({ ...formulario, medio: e.target.value as MedioPago })}>
            {MEDIOS_PAGO.map((medio) => (
              <option key={medio} value={medio}>
                {ETIQUETA_MEDIO[medio]}
              </option>
            ))}
          </select>
        </Campo>
      )}

      {esAnulacion ? (
        <p className="ayuda-campo">Copia la factura completa, con la propina.</p>
      ) : (
        <fieldset className="grupo admin-lineas">
          <legend className="campo__etiqueta">Líneas, con impuesto incluido</legend>
          {formulario.tipo === 'credito' && items.length > 0 && (
            <div className="admin-items" role="group" aria-label="Agregar desde la factura">
              {items.map((item) => (
                <button key={item.lineaId} type="button" className="categorias__chip" onClick={() => agregarLinea(lineaDeItem(item))}>
                  <Icono nombre="mas" tamano={14} /> {item.nombre}
                </button>
              ))}
            </div>
          )}
          {formulario.lineas.map((linea, i) => (
            <div key={i} className="admin-linea">
              <input className="entrada" aria-label={`Descripción de la línea ${i + 1}`} placeholder="Descripción" value={linea.descripcion} onChange={(e) => cambiarLinea(i, 'descripcion', e.target.value)} />
              <input className="entrada" aria-label={`Cantidad de la línea ${i + 1}`} inputMode="numeric" placeholder="Cant." value={linea.cantidad} onChange={(e) => cambiarLinea(i, 'cantidad', e.target.value)} />
              <input className="entrada" aria-label={`Precio de la línea ${i + 1}`} inputMode="numeric" placeholder="Precio" value={linea.precio} onChange={(e) => cambiarLinea(i, 'precio', e.target.value)} />
              <button
                type="button"
                className="icono-boton"
                aria-label={`Quitar la línea ${i + 1}`}
                disabled={formulario.lineas.length === 1}
                onClick={() => setFormulario({ ...formulario, lineas: formulario.lineas.filter((_, j) => j !== i) })}
              >
                <Icono nombre="cerrar" tamano={16} />
              </button>
            </div>
          ))}
          <Boton variante="fantasma" className="boton--chico" onClick={() => agregarLinea({ ...LINEA_VACIA })}>
            <Icono nombre="mas" tamano={15} /> Agregar línea
          </Boton>
        </fieldset>
      )}
    </Hoja>
  )
}
