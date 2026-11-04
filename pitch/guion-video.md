# Guion del video · Ribu funcionando en dos minutos

**Duración objetivo: 2:00.** Es la demostración que se inserta entre 0:25 y 2:25 del pitch total de cinco minutos. Cumple el rango del reto de 2 a 3 minutos y deja tiempo para que los cinco integrantes expliquen sus módulos después. El reparto completo está en `pitch/guion.md`.

**Estado: sin grabar.** Solo se graba cuando la app desplegada complete el recorrido con las dos APIs reales de sandbox. Ninguna prueba de este documento mueve dinero real. No se graba contra mocks ni se presenta como terminado por tener un guion.

## Preparación

- Juan Diego entrega URL desplegada, commit y sesiones de prueba por privado. Los recorridos de pedido y pago deben pasar antes de grabar.
- Cargar el restaurante ficticio de `docs/datos-demo.md`: mesa 3, dos mojarras, dos jugos de corozo y un patacón; stock de mojarra en 2.
- El consumo es $91.800, con base $85.000 e INC $6.800. Para este ejemplo se elige voluntariamente 10 % de propina sobre la base según la regla actual del proyecto: $8.500; total del recaudo $100.300. La base de propina sigue pendiente de revisión contable.
- Tener abiertas las vistas del cliente, mesero y cocina, y el simulador en otro dispositivo con cámara. Mostrar el QR del recaudo en una pantalla para escanearlo desde el simulador.
- Preparar vistas reales sanitizadas o el panel para mostrar solicitudes/respuestas de las APIs y las referencias. No mostrar `.env`, tokens, encabezados Authorization, la llave secreta del webhook ni datos de terceros del sandbox compartido.
- Usar un rótulo visible «APIs sandbox · sin dinero real». El enlace de mesa se abre directamente; usar una toma NFC solo si existe y se probó.

## Secuencia de grabación

Los tiempos son del video, no del pitch. Las acciones y esperas ocurren dentro de cada tramo. El equipo retoma la voz al terminar los dos minutos, sin narración en vivo superpuesta.

| Tiempo del video | Evidencia que se ve | Voz grabada |
|---|---|---|
| 0:00–0:10 | Web desplegada y enlace de la mesa 3. Rótulo permanente: APIs sandbox · sin dinero real. | Ribu conecta pedido, pago y factura desde la mesa. Esta corrida usa datos ficticios y las APIs sandbox. |
| 0:10–0:30 | Cliente pide 2 mojarras, 2 jugos y 1 patacón. Mesero confirma en otra sesión. | El cliente pide y el mesero confirma. Solo el consumo confirmado entra al cobro. |
| 0:30–0:40 | Cocina recibe el pedido y mojarra queda agotada por stock 0. | La cocina recibe lo aprobado. Las dos mojarras disponibles se agotan. |
| 0:40–0:55 | Comprador ficticio y propina voluntaria. Mostrar consumo $91.800 y total $100.300. | El consumo incluye impuesto. Elegimos comprador y propina antes de generar el cobro por el monto exacto. |
| 0:55–1:15 | Recaudo de Factus Pay: referencia, amount 100300, QR y llave Bre-B. Mostrar POST /v1/collections en una captura real sanitizada o panel. | Factus Pay recibe referencia, monto y vencimiento. Su respuesta entrega el QR y la llave Bre-B de este recaudo. |
| 1:15–1:35 | Simulador escanea desde otro dispositivo; luego GET del mismo recaudo muestra paid y el monto coincide. | Confirmamos con el simulador. Ribu consulta a Factus Pay y comprueba el pago antes de facturar. |
| 1:35–1:55 | POST /v2/bills/validate de la misma corrida; is_validated true, número, CUFE, QR y PDF abierto. | Factus v2 valida la factura con los productos, impuestos y datos del comprador. Esta es su respuesta y este es el PDF. |
| 1:55–2:00 | Congelar una comparación legible: Pago.id = reference_code de Factus Pay = reference_code de Factus. | La misma referencia conecta el dinero y su factura. |

La última comparación de referencias debe quedar preparada y legible: es la imagen que el jurado recordará mientras Néstor, Elias y Juan Diego explican cómo usaron las APIs. No inventar una referencia ni reemplazarla por un ejemplo que parezca una respuesta real.

## Edición honesta y límite de tiempo

Conservar una toma original del recorrido completo. Las inserciones del segundo dispositivo y del panel deben corresponder al mismo recaudo, importe y factura. Si una espera real impide llegar a dos minutos, puede acelerarse con un rótulo «espera acelerada»; se conserva el original y no se presenta la respuesta como instantánea.

No reemplazar la llamada a una API con una tarjeta dibujada ni con una factura de otro pago. Si hay un fallo, corregir y repetir la corrida antes de grabar. Pago confirmado y emisión validada son las dos evidencias obligatorias; no se recortan para que entre un título o una función adicional.

Los turnos posteriores del equipo explican endpoints, campos, control de estados y reintentos. Por eso el video muestra la operación y evita una introducción comercial larga. Las cuentas divididas, notas y comparaciones de costos quedan para las preguntas, salvo que el jurado pida verlas y el formato permita tiempo adicional.

No mostrar correo enviado si el sandbox no lo permite. No usar testimonios, ahorro medido, ni compatibilidad NFC universal sin evidencia. El video demuestra esta corrida y los dispositivos usados.

## Registro de entrega

| Campo | Estado |
|---|---|
| URL pública y commit desplegado | Pendiente |
| Fecha y referencia del recaudo | Pendiente |
| Número de factura y CUFE de la misma corrida | Pendiente |
| Ubicación de la toma original | Pendiente |
| Duración del archivo final | Pendiente; objetivo 2:00 |
| Enlace del video y acceso comprobado | Pendiente |
| Revisión de Eddy y ensayo con los cinco integrantes | Pendiente |

Antes de marcarlo terminado: abrir el archivo final, comprobar duración de al menos dos minutos y dentro del rango de 2 a 3, verificar que se leen monto y referencias, que se ve `paid`, que la factura está validada y que el PDF pertenece al mismo caso. Medir también su reproducción dentro del pitch completo: objetivo 4:45, límite 5:00.

Fuentes: estructura acordada por el usuario, `AGENTS.md`, `contratos/README.md`, `docs/datos-demo.md`, `docs/explicacion-integracion.md` y [simulador oficial de Factus Pay](https://pay-developers.factus.com.co/sandbox/simulator/).
