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

## Por confirmar en el sandbox

- **Consumidor final:** el documento es `222222222222` en las preguntas frecuentes y `22222222222` en el ejemplo oficial.
- **INC:** que Factus acepte el código `04` con tasa `8.00`, y cómo se envía `ninguno`.
- **Redondeo:** que `cash_rounding_amount` cuadre el total con precios sin impuesto de dos decimales.
- **Correo:** `send_email` solo funciona en producción. La página de `send-email` de facturas solo pide `email`, y las preguntas frecuentes hablan de enviar el PDF en base64.
- **Notas:** la forma de la respuesta y el nombre del código único, que la documentación no muestra. Si `items.note` es obligatorio. Si el sandbox ya tiene rangos activos de documento 22 y 23; si no, se crean con `POST /v2/numbering-ranges`.
- **Factus Pay:** el sobre `data`, el mínimo de `expiration`, si `amount` va como número o texto, y el formato real de las fechas.
- **Estados:** qué estado devuelve Factus Pay con un QR vencido o un error del simulador.
- **Webhook:** si el simulador lo dispara.
- **Medio de pago:** Factus no tiene código para Bre-B; se usa transferencia (`47`).
- **Parte igual:** que un contador acepte facturarla como una sola línea de consumo.

Para probar un rechazo se usa un NIT con un `dv` errado. En el sandbox compartido, ese rechazo bloquea el rango para todos: hay que eliminarlo en seguida.
