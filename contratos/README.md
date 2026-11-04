# Contratos de Ribu

Ribu gestiona los pedidos, los pagos y la facturación electrónica de un restaurante desde la mesa. Cada mesa tiene un sticker con NFC y QR que abren el mismo link.

| Archivo | Qué define |
|---|---|
| `tipos.ts` | Formatos, estados y las interfaces de `cobros/` y `facturacion/` |
| `reglas.ts` | Límites, transiciones de estado, cálculos de dinero y rutas de Firestore |
| `openapi.yaml` | Las órdenes que la web le da al backend |

## Cómo se comunican las piezas

- **Órdenes:** la web llama a la API con un ID token de Firebase. El cliente entra de forma anónima, sin registro. El personal entra con login y los claims `restauranteId` y `rol`.
- **Lecturas:** la web escucha Firestore, así toda la mesa ve los cambios al instante.
- **Escrituras:** solo el backend escribe en Firestore. La web nunca envía precios, totales ni estados de pago.
- **Credenciales:** van en Secret Manager, por restaurante, porque cada NIT tiene las suyas. Nunca en Firestore ni en la web.
- **Datos iniciales:** el restaurante, las mesas y el personal se crean con un script.

| Documento | Formato | Quién lo lee |
|---|---|---|
| `mesas/{token}` | `Mesa` | Quien tenga el link. El personal puede listarlas |
| `restaurantes/{id}` | `Restaurante` | Cualquier sesión |
| `restaurantes/{id}/productos/{id}` | `Producto` | Cualquier sesión |
| `restaurantes/{id}/cuentas/{id}` | `Cuenta` | Quien tenga el id, que sale de la mesa. El personal puede listarlas |
| `restaurantes/{id}/pagos/{id}` | `Pago` | Quien tenga el id, que sale de la cuenta. El personal puede listarlos |
| `restaurantes/{id}/facturas/{pagoId}` | `Factura` | Solo quien creó el pago y el personal |
| `restaurantes/{id}/notas/{id}` | `Nota` | Solo el personal |

## Reglas

**Mesa**

- Cada mesa tiene un solo link, y ese link muestra una sola cuenta.
- Mientras el mesero no marque la mesa como libre, el link muestra el mismo pedido.
- Al liberarla, el siguiente cliente no ve nada del anterior.
- No se puede liberar con pedidos por confirmar, cobros activos o saldo.

**Pedido**

- El mismo link sirve para todos. El rol sale del token, no de la pantalla.
- Lo que pide el cliente espera la confirmación del mesero. Lo que pide el personal va directo a cocina.
- El `stock` baja al confirmar y sube al anular. Si llega a 0, el producto queda no disponible.

**Pago**

- Solo se paga lo confirmado.
- Cada pago genera su propio cobro y su propia factura, y cada cobro cuesta $800 + IVA.
- Factus Pay solo cobra de $10.000 a $12.000.000. Una cuenta o una parte por debajo de ese mínimo se paga en efectivo o con tarjeta.
- La cuenta se divide de dos formas: partes iguales (`parte_igual`) o eligiendo productos (`productos`).
- Una misma unidad no puede estar en dos pagos. Si alguien intenta cobrar lo mismo, responde `PAGO_EN_CURSO`.
- Un pago congela lo que cubre y su monto. Lo que se pida después va a otro pago, con otra referencia.
- Si ya está todo pagado, la página no ofrece pagar. Si piden algo más, la misma cuenta vuelve a tener saldo.
- La propina la elige quien paga antes de generar el QR, porque el QR solo acepta el monto exacto. Se sugieren porcentajes de máximo 10 % y se puede elegir otro.
- El cliente paga copiando la llave Bre-B con el monto exacto, o escaneando el QR desde otro celular.
- Efectivo y tarjeta los registra el personal, y también generan factura.

**Confirmación del pago**

- El webhook avisa, pero antes de marcar el pago se confirma con `consultarCobro`.
- Mientras la pantalla de pago esté abierta, la web llama a `verificarPago`, como respaldo.
- Si llega `paid` de un pago vencido o cancelado y sus líneas siguen libres, vale. Si otro pago ya las cubrió, queda como `pago_duplicado`, sin factura, y el personal devuelve el dinero por fuera.

**Factura**

- El comprador se elige antes de pagar. La web propone consumidor final.
- El `reference_code` es el id del pago. Con una factura validada, Factus devuelve la misma aunque los datos cambien.
- Si la DIAN no responde (`en_validacion`), se reintenta con la misma referencia. Nunca se elimina.
- Si la DIAN rechaza (`rechazada`), se elimina en seguida, porque bloquea el rango. Luego el personal corrige y se reemite con la misma referencia.
- Un 409 o un 429 no se muestran como error al cliente: la factura sigue `en_proceso` y se reintenta.
- La factura se envía al correo del comprador si dio uno. También se puede pedir después.
- Toda factura se puede descargar en PDF. No hay impresión en papel.

**Notas crédito y débito**

- Solo el administrador las crea, y solo sobre una factura `emitida`. No cambian la cuenta de la mesa.
- **Nota crédito:** anula la factura o rebaja parte de su valor. Como Factus Pay no tiene reversos, el dinero se devuelve por fuera; la nota queda con la devolución `pendiente` hasta que se registre como `hecha`.
- **Nota débito:** suma un mayor valor. Con `factus_pay` sigue el mismo flujo de la factura: cobro, `paid` y nota. Con efectivo o tarjeta se emite de una vez.
- Una factura no se puede acreditar por más de su valor: ver `saldoAcreditable`.
- Las notas siguen las mismas reglas de rechazo, demora, reintentos, PDF y correo que la factura.

## Probado en el sandbox de Factus v2

Probado el 4 de noviembre de 2026, con datos inventados. La DIAN validó todos estos documentos:

- **Factura:** a consumidor final, a persona y a empresa, con INC `04` y tasa `8.00`, propina en `allowance_charges`, medio de pago `47` y `cash_rounding_amount` de `-0.01`.
- **Consumidor final:** documento `13`, número `222222222222`, `names` "Consumidor Final" y organización `2`.
- **Empresa:** Factus calcula el `dv` si no se envía.
- **Notas:** anulación, devolución parcial y nota débito. `items.note` no es obligatorio. La respuesta trae en `data`: `number`, `cude`, `is_validated`, `errors`, `links.qr`, `links.public_url` y `bill`.

Lo que hay que tener en cuenta al programar:

- **Cloud Functions:** desde `us-central1`, Factus y Factus Pay responden normalmente; Cloudflare no bloquea esa salida. Solo se comprobó la conexión, sin emitir documentos desde allí.
- **Token:** dura 3.600 segundos y trae `refresh_token`.
- **Rangos:** la lista viene en `data.data`, y `document` devuelve el nombre, no el código. En el sandbox están activos el 389 (factura), el 390 y el 1776 (nota crédito) y el 391 (nota débito). Como hay dos de nota crédito, envía siempre `numbering_range_id`.
- **`errors`:** en facturas es un objeto y en notas un arreglo. Con `is_validated: true` trae notificaciones como `FAJ44b` o `CBF02`, que no bloquean nada. Para detectar un rechazo, busca la palabra "Rechazo" en el texto.
- **Cuadre:** si `payment_details` no suma el total después del redondeo, responde 422 con el valor esperado.
- **Referencia repetida:** con los mismos datos devuelve la misma factura. Con un valor distinto puede responder 422, porque primero valida el cuadre.
- **PDF:** en facturas y notas llega en `data.file_name` y `data.pdf_base_64_encoded`.
- **Correo:** en el sandbox, `send-email` responde 422 con "El correo no esta autorizado para recibir correos en el entorno sandbox". Por eso, `correo.estado` puede quedar `fallido` aunque la factura esté bien.

## Probado en el sandbox de Factus Pay

Probado el 4 de noviembre de 2026, sin completar ningún pago:

- **Monto:** de 10.000 a 12.000.000. Por fuera responde 422, aunque la documentación diga 1.000 a 12.100.000. Se puede enviar como número o como texto.
- **Crear:** el recaudo llega en `data`, en `ready`, con `qr` y `breb_key`. Responde 200 si se envía `expiration` y 201 si no.
- **Vencimiento:** `expiration` acepta cualquier cantidad de segundos, y sin ella dura 24 horas. **Un QR vencido sigue en `ready`:** compara `qr_expires_at` con la hora actual.
- **Renovar:** repetir la referencia y el monto con otro `expiration` regenera el QR y conserva la `breb_key`.
- **Referencia repetida:** con el mismo monto devuelve el mismo recaudo. Con otro monto responde 422.
- **Fechas:** llegan como `04-11-2026 12:00:40 PM`, en hora de Colombia. Hay que convertirlas a UTC.
- **Errores:** 404 trae `{ status, message, data: null }`, y una validación trae `{ message, errors }`.
- **Listar:** trae `data`, `links` y `meta`, sin `qr`.

## Por confirmar

- **Correo:** qué direcciones autoriza el sandbox. Sin esto, la demo no puede mostrar el envío con `send-email`.
- **Rechazo real:** no se forzó a propósito, porque bloquearía el rango de todos los equipos. Se fuerza con un NIT y un `dv` errado, y hay que eliminarlo en seguida.
- **Sin impuesto:** cómo se envía `ninguno`. La demo usa INC.
- **Pago:** falta completar uno en el simulador, que solo funciona escaneando el QR con la cámara. Hay que ver qué trae la respuesta en `paid`, y qué estado devuelve cada error: `tx_unknown`, `tx_provider_unavailable`, `tx_timeout` y `tx_risk_control`.
- **Estado `created`:** aparece en el filtro del panel, pero no en la documentación ni en las pruebas.
- **Webhook:** si el simulador lo dispara.
- **Parte igual:** que un contador acepte facturarla como una sola línea de consumo.
