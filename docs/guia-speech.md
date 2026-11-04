# Cómo construir y defender el speech de Ribu

La estructura acordada con Eddy es **introducción del problema → video funcionando → explicación de cada módulo → cierre breve**. Todo cuenta dentro de cinco minutos. El desarrollo incluye el video y las cinco intervenciones; no se agrega otro discurso de cinco minutos antes o después de la demostración.

Audiencia: el jurado del Reto Factus. Su atención debe terminar en una comprobación concreta: Factus Pay confirma el recaudo y Factus v2 emite la factura de ese pago. Los beneficios se explican desde el cliente y el dueño del restaurante, pero el llamado a la acción se dirige al jurado que evalúa la integración.

## 1. Introducción: crear interés y prometer una comprobación

La introducción responde tres preguntas de la audiencia: qué problema estamos viendo, por qué importa y qué van a demostrar. Eddy dispone de 25 segundos.

### Gancho

Abrir con una situación reconocible: «¿Nos trae la cuenta, por favor?». Hacer una pausa breve y mirar al jurado. El gancho funciona porque lleva al cierre de una mesa, que es el momento que Ribu quiere conectar. Es una frase ilustrativa escrita para este discurso; no se atribuye a un restaurante entrevistado.

Después del gancho, nombrar la fricción concreta: resolver consumo, pago y factura por separado puede repetir trabajo. Hablar de una posibilidad o hipótesis mientras no haya entrevistas; el guion no acredita que todos los restaurantes tengan ese problema.

### Promesa clara de valor

Prometer algo observable: «Veamos cómo un pago queda conectado con su factura». La promesa se cumple en el video y se explica con las APIs después. Evitar promesas que no puedan comprobarse ese día, como un porcentaje de ahorro o la eliminación de todo error.

### Datos, cifras y citas

Usar cifras del propio proyecto: **dos APIs y una referencia compartida**. El video aporta un segundo ejemplo concreto: consumo de $91.800 y cobro de $100.300 con la propina elegida para la demo. Los importes pertenecen al restaurante ficticio de `docs/datos-demo.md`; no son estadísticas de mercado.

Una cita célebre no es obligatoria ni sustituye la evidencia técnica. Si más adelante se incorpora una frase de un restaurante, se registra literal y con permiso. Hoy no hay una cita real autorizada para usar.

### Beneficios y lo que está en juego

- Cliente: comprender qué está pagando y acceder a su factura.
- Dueño: seguir la relación entre consumo confirmado, recaudo y documento.
- Jurado: disponer de evidencia para evaluar las dos APIs trabajando en un mismo caso.

La pérdida que se plantea es el riesgo de esperas y registros repetidos cuando esos pasos están separados. Se formula como hipótesis, no como ahorro ya medido. La ganancia propuesta es claridad y control. Conviene repetir esos beneficios junto con la referencia compartida durante el discurso, sin inventar resultados.

## 2. Desarrollo: demostrar primero y explicar después

El objetivo principal es que el jurado pueda reconstruir **qué enviamos a cada API, qué recibimos y por qué una respuesta habilita el siguiente paso**. Cada integrante explica su responsabilidad y una decisión técnica; no vuelve a contar todo el proyecto.

### El video es la evidencia

La versión para este pitch dura 2:00 y se reproduce después de la introducción. Debe mostrar una corrida real de sandbox, desde el pedido hasta el PDF, con la misma referencia y el mismo importe. El guion está en `pitch/guion-video.md`. Está pendiente de grabación; escribirlo no acredita que las APIs ya funcionen juntas en la app.

Mostrar un QR demuestra que se generó un recaudo. Para demostrar el pago hay que mostrar `paid` confirmado con consulta al proveedor. Para demostrar la emisión hay que mostrar la factura de ese pago con `is_validated: true`, número, CUFE y PDF. Una captura de una solicitud preparada o una factura de otra corrida no prueba el flujo completo.

### La explicación de los módulos debe seguir una lógica

Usar este patrón en cada intervención: **responsabilidad → llamada o decisión → respuesta comprobable → utilidad para el flujo**.

| Integrante | Responsabilidad | Mensaje que debe quedar |
|---|---|---|
| Andrés · Interfaz | Cliente, mesero y cocina; órdenes al backend y lecturas de Firestore | La web muestra el resultado; las credenciales de las APIs y la validación del dinero quedan en el servidor |
| Néstor · Cobros | Factus Pay | Crear un recaudo genera QR y llave; consultar su estado permite comprobar el pago |
| Elias · Facturación | Factus v2 | Se envían datos fiscales y se recibe una factura validada con número, CUFE y PDF |
| Juan Diego · Integración | Estados, reservas y coordinación | El mismo id relaciona recaudo y factura; no se emite por una afirmación del navegador |
| Eddy · Producto y pitch | Problema, datos, recorridos y presentación | Cada beneficio declarado debe corresponder a una demostración o quedar identificado como hipótesis |

Antes de presentar, cada integrante ajusta el texto a lo que realmente implementó y puede defender. Las frases en pasado no convierten un diseño pendiente en una función terminada.

### Raciocinio: explicar el porqué

Ejemplo de una cadena argumental defendible:

1. Factus Pay y Factus v2 resuelven operaciones distintas: recaudar y facturar.
2. Ambas reciben una referencia definida por Ribu.
3. Ribu conserva el id del pago como `reference_code` en las dos.
4. Por eso se puede seguir ese recaudo hasta su factura, incluso si la emisión necesita un reintento.

La asociación técnica respalda la trazabilidad. No prueba por sí sola que el dueño ahorre una cantidad de tiempo o dinero: esa conclusión necesita medición y comparación de costos.

### Lo que cada responsable de API debe poder explicar

| API | Qué se envía | Qué se recibe | Qué comprueba el equipo |
|---|---|---|---|
| Factus Pay · `POST /v1/collections` | `reference_code`, `amount`, `expiration` | Recaudo en `data`, QR y llave Bre-B | Corresponde al importe congelado del pago |
| Factus Pay · `GET /v1/collections/{reference_code}` | Referencia del mismo recaudo | Estado y monto | `paid`, monto esperado y referencia existente antes de facturar |
| Factus v2 · `POST /v2/bills/validate` | Comprador, líneas con precio sin impuesto, impuestos, pago y el mismo `reference_code` | `is_validated`, `number`, `cufe` y enlaces | La factura pertenece a ese pago y está validada |
| Factus v2 · `GET /v2/bills/{number}/download-pdf` | Número de la factura emitida | PDF en base64 | Se puede abrir el documento de la misma corrida |

El webhook es un aviso automático de pago: no reemplaza la consulta. Néstor explica la validación del aviso y Juan Diego cuándo se reconoce el pago y se inicia la emisión. Elias debe poder explicar OAuth, el precio sin INC, `taxes[]`, `payment_details[]` y la diferencia entre factura emitida, demora y rechazo, si el jurado lo pregunta. Las credenciales nunca se muestran.

Las tres claves que la audiencia debe recordar son: **recaudo verificado, factura identificada y referencia compartida**. La explicación técnica funciona mejor si se señala la evidencia del video al pronunciar cada una.

## 3. Cierre: pedir una acción y volver a la idea inicial

El cierre tiene diez segundos y una sola acción: invitar al jurado a comprobar la referencia en ambas APIs. «Los invito a comprobar la misma referencia en ambas APIs» es una petición concreta y verificable. Evitar terminar con una lista de funciones nuevas o una petición genérica de apoyo.

La circularidad consiste en recuperar **dos APIs, una referencia**, que se presentó al inicio. Después de ver el video y escuchar a los responsables, la misma idea ya tiene evidencia y significado. La frase «la mesa cobra y factura sola» reúne el beneficio propuesto: claridad para quien paga y control para el restaurante.

No anunciar «en conclusión». Hacer la invitación, pronunciar la idea central y terminar. La pausa final forma parte del tiempo del equipo.

## 4. Preparación y control del reloj

La pauta principal termina en 4:45 y reserva 15 segundos. El video dura 2:00; los 2:45 restantes incluyen introducción, cinco módulos, cierre y relevos. Con un video de 2:35, el mismo reparto sumaría 5:20: hay que ajustar la pieza antes del ensayo.

Cada módulo tiene un turno asignado en `pitch/guion.md`. Las rutas y nombres de campos pueden quedar visibles mientras se explica su propósito; no hace falta leer cada URL en voz alta. Mantener a todos listos y ensayar el cambio de voz dentro de cada turno. Un moderador lleva el reloj y da una señal discreta al final de cada bloque.

Ensayar con el archivo de video final, el mismo reproductor y el equipo completo. Medir desde el gancho hasta la última palabra, incluyendo reproducción, silencios y relevos. Si se supera 4:45, recortar una explicación repetida y conservar la prueba de ambas APIs. Una estimación de palabras no sustituye ese ensayo.

Estado de esta guía: preparada, pendiente de revisión y ensayo con Eddy y el equipo. Fuentes: `AGENTS.md`, `contratos/README.md`, `docs/datos-demo.md`, `docs/explicacion-integracion.md` y la estructura acordada por el usuario. No contiene resultados de entrevistas o pruebas físicas realizadas por Producto.
