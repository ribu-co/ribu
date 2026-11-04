# Guion del video

Duración prevista: unos 2:35 según la pauta; falta cronometrarla. El reto pide de 2 a 3 minutos. Es una grabación de la pantalla con el flujo completo: **recaudo en Factus Pay y emisión en Factus**.

**Estado: sin grabar.** Se graba cuando el flujo funcione en la web desplegada, nunca contra mocks. Las dos APIs deben seguir en sandbox: está prohibido mover dinero real. Si la demo no muestra las dos APIs de verdad, el equipo queda descalificado.

## Antes de grabar

- [ ] La app está desplegada y el caso 4 de `docs/casos-de-prueba.md` pasó en la web desplegada, con Factus Pay y Factus v2 en sandbox.
- [ ] El stock de la demo está cargado de nuevo y la mesa 3 está libre.
- [ ] No hay datos personales, tokens, `.env` ni consolas con credenciales en la pantalla.
- [ ] Las notificaciones están apagadas.
- [ ] Están abiertos el celular de la mesa (espejado o en modo móvil), el mesero, el simulador, el panel de Factus Pay y la factura.
- [ ] Se grabó un ensayo y se comprobó que el audio se entiende.

El simulador escanea el QR con la cámara. Muestra el QR en una pantalla y graba el simulador en otro dispositivo.

## Guion

| Tiempo | Qué se ve | Qué se dice |
|---|---|---|
| 0:00–0:15 | Título con el nombre del equipo | Ribu conecta el pedido, el cobro y la factura de un restaurante en un solo flujo. La mesa cobra y factura sola. Esta es la web desplegada; Factus Pay y Factus v2 funcionan en sandbox, sin dinero real. |
| 0:15–0:35 | Se abre el link de la mesa 3 y se pide | Cada mesa tiene un sticker con un link. El cliente entra sin registrarse y pide 2 mojarras, 2 jugos y 1 patacón. |
| 0:35–0:55 | El mesero confirma. La mojarra aparece agotada y la cocina recibe el pedido | El mesero confirma, y solo lo confirmado se puede pagar. La mojarra se agotó, y la cocina ya tiene el pedido. |
| 0:55–1:15 | Se elige toda la cuenta, 10 % de propina y consumidor final | Quien paga elige la propina y el comprador antes de generar el cobro, porque el recaudo es por el monto exacto: 100.300 pesos. |
| 1:15–1:35 | QR, llave Bre-B y referencia | Ribu crea el recaudo en Factus Pay. Este es el QR, esta es la llave y esta es la referencia: es el id del pago. |
| 1:35–1:55 | Se escanea y se confirma en el simulador. El celular cambia solo | Confirmo el pago en el simulador de Factus Pay. Ribu verifica el estado con la API antes de seguir. |
| 1:55–2:15 | La factura: número, CUFE, QR y PDF abierto | Sin digitar nada, se emite la factura electrónica en Factus: número, CUFE, QR y PDF. |
| 2:15–2:25 | La misma referencia en el panel de Factus Pay y en la factura | Esta es la asociación: la misma referencia está en el recaudo y en la factura. |
| 2:25–2:35 | Logo y URL de la app | Eso es Ribu: pedido, cobro y factura, en un solo flujo. |

## Reglas de la grabación

- Muestra los valores reales de esa corrida. Si el número o el monto cambian, ajusta la frase.
- No cortes el momento entre el pago y la factura, porque es lo que el jurado quiere ver. Si la factura tarda, muestra el estado `en_proceso` o acelera el tramo y dilo en pantalla.
- Si algo del guion no funciona, quítalo. No lo simules ni lo dibujes.
- Solo si funciona y cabe en los 3 minutos, agrega 15 segundos de una cuenta dividida o de una nota crédito.

## Después de grabar

- [ ] Dura de 2 a 3 minutos.
- [ ] Se ven el recaudo en Factus Pay y la factura en Factus.
- [ ] Se revisó cuadro por cuadro que no aparezca ningún token, llave ni dato personal.
- [ ] Se subió a la plataforma del evento, con el enlace probado desde otra cuenta.
- [ ] Eddy revisó el texto y puede defenderlo.

## Registro de la toma y revisión

Pendientes: URL pública del MVP, commit desplegado, fecha, referencia del recaudo, número de factura, ubicación de la toma original, duración final y enlace del video. No hay grabación terminada ni revisión de Eddy realizada.

Guardar una toma original del flujo completo. Las inserciones del simulador deben corresponder al mismo recaudo, importe y factura; no sustituir un documento de otro pago. En la comparación final se deben ver `Pago.id`, `reference_code` de Factus Pay y `reference_code` de Factus iguales, usando una vista sanitizada sin encabezados de autenticación ni llave del webhook.

Si no se ha probado NFC, abrir el enlace en pantalla y decirlo así. No mostrar correo enviado si sandbox no lo permite. El ahorro de tiempo es una hipótesis; no usar cifras ni testimonios sin evidencia y permiso específico para video. Eddy debe revisar el texto y la toma final antes de darla por entregada.
