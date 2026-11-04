# Guion del pitch · presentación del equipo Ribu

**Estructura acordada: introducción del problema → video funcionando → cada integrante explica su módulo → cierre breve.** El límite de **5 minutos incluye todo**: reproducción, voz, pausas y cambios de expositor.

La pauta termina en **4:45 y reserva 15 segundos**. El video debe durar **2:00**, dentro del rango de 2 a 3 minutos del entregable. Conservar la versión anterior de 2:35 llevaría esta misma pauta a 5:20.

**Mensaje que el jurado debe recordar: dos APIs, una referencia. Ribu: la mesa cobra y factura sola.** La explicación prioriza cómo usamos Factus Pay y Factus v2 y cómo asociamos el dinero con la factura.

Estado: guion listo para revisión y ensayo. El video sigue pendiente de grabación. Las frases de funcionamiento se presentan como hechos solo después de comprobar el flujo real en la app desplegada con ambas APIs sandbox. Los módulos se describen en pasado únicamente si cada integrante puede mostrar y defender su implementación. Nunca se completa un pago con dinero real.

## Reparto de los cinco minutos

| Reloj total | Responsable | Bloque | Duración |
|---|---|---|---:|
| 0:00–0:25 | Eddy | Introducción del problema | 25 s |
| 0:25–2:25 | Video | Demostración funcionando | 120 s |
| 2:25–2:50 | Andrés | Interfaz | 25 s |
| 2:50–3:20 | Néstor | Cobros · Factus Pay | 30 s |
| 3:20–3:50 | Elias | Facturación · Factus v2 | 30 s |
| 3:50–4:20 | Juan Diego | Integración | 30 s |
| 4:20–4:35 | Eddy | Producto y pitch | 15 s |
| 4:35–4:45 | Eddy | Cierre e invitación | 10 s |
| 4:45–5:00 | Equipo | Margen para un retraso breve | 15 s |

Las cinco intervenciones de módulo suman 2:10. Se hacen después del video, en el orden Interfaz → Cobros → Facturación → Integración → Producto. Eddy introduce el problema y retoma el cierre. Los turnos ya incluyen el relevo entre personas: todos deben estar preparados.

## Texto para decir y evidencia que acompañarlo

Solo se pronuncia lo que está en cita. Los nombres de endpoints y campos quedan visibles como apoyo; cada responsable explica su propósito sin leer todas las rutas. El video tiene su propio audio y el equipo continúa al terminar, sin volver a narrar todo el recorrido.

### 1. Eddy · Introducción del problema (0:00–0:25)

> «¿Nos trae la cuenta, por favor?»
>
> Resolver el consumo, el pago y la factura por separado puede repetir trabajo. Ribu busca darle claridad al cliente y control al restaurante conectando dos APIs con una referencia. Veamos el flujo en sandbox.

**En pantalla y entrega:** Nombre Ribu y tres conceptos: pedido, pago y factura. Pausa breve después del gancho. Preparar el video para comenzar con una sola acción.

### 2. Video · Demostración funcionando (0:25–2:25)

Reproducir el video completo de 2:00. La pauta de capturas y narración está en `pitch/guion-video.md`.

**En pantalla y entrega:** Reproducir la versión final de 2:00 descrita en pitch/guion-video.md. Conservar audio y rótulo de sandbox. El equipo deja que la evidencia se vea; las explicaciones de módulos empiezan al terminar.

### 3. Andrés · Interfaz (2:25–2:50)

> En Interfaz trabajé las vistas de cliente, mesero y cocina. La web envía órdenes y escucha Firestore. El backend calcula importes y confirma pagos. Así mostramos el estado de la cuenta y la factura sin exponer las credenciales de las APIs.

**En pantalla y entrega:** Una vista real del flujo mostrado en el video. Señalar la separación web/backend. No volver a reproducir el recorrido ni explicar botones uno por uno.

### 4. Néstor · Cobros · Factus Pay (2:50–3:20)

> En Cobros integré Factus Pay: creamos un recaudo con referencia, monto y vencimiento. La API devuelve QR y llave Bre-B. Antes de facturar consultamos ese recaudo y comprobamos monto y estado pagado. El webhook nos avisa; la consulta al proveedor confirma el pago.

**En pantalla y entrega:** Mostrar POST /v1/collections y GET /v1/collections/{reference_code}; debajo, reference_code, amount, expiration y status: paid de la misma corrida. Son solicitudes/respuestas reales sanitizadas; nunca tokens ni la llave secreta del webhook.

### 5. Elias · Facturación · Factus v2 (3:20–3:50)

> En Facturación integré Factus v2. Tras el pago, enviamos comprador, productos, impuestos y medio de pago para validar la factura. Usamos como referencia el id del pago. Recibimos número, CUFE y enlaces, y descargamos el PDF. Las correcciones se gestionan con notas crédito y débito.

**En pantalla y entrega:** Mostrar POST /v2/bills/validate con el mismo reference_code y la respuesta real con is_validated, number y cufe. Señalar el PDF descargado con GET /v2/bills/{number}/download-pdf. Explicar campos, sin leer URLs largas en voz alta.

### 6. Juan Diego · Integración (3:50–4:20)

> En Integración uní ambos servicios. El id del pago es el reference_code del recaudo y de la factura. Reservamos lo que cubre cada cobro para evitar pagos superpuestos. Confirmamos el dinero antes de emitir y conservamos la referencia al reintentar. Esa relación hace trazable el cierre de la mesa.

**En pantalla y entrega:** Dejar juntas las tres referencias iguales: Pago.id de Ribu, reference_code de Factus Pay y reference_code de Factus. Comentar el control de estados como arquitectura; los escenarios de concurrencia y reintento solo se presentan como probados si tienen evidencia.

### 7. Eddy · Producto y pitch (4:20–4:35)

> En Producto definí el escenario del restaurante, los datos de la demo y los recorridos de prueba. Mi responsabilidad es que cada beneficio tenga una demostración verificable.

**En pantalla y entrega:** Mantener visible el caso de la mesa 3 y su factura. No afirmar entrevistas, ahorro medido, pruebas físicas o grabaciones que no se hayan realizado.

### 8. Eddy · Cierre e invitación (4:35–4:45)

> Los invito a comprobar la misma referencia en ambas APIs. Ribu: la mesa cobra y factura sola.

**En pantalla y entrega:** Mirar al jurado y señalar la referencia compartida. Terminar en esa frase. Los 15 segundos siguientes son margen, no otro bloque de contenido.

## Qué demuestra el uso de las APIs

| Responsable | Operación que explica | Evidencia del mismo caso |
|---|---|---|
| Néstor | `POST /v1/collections` con referencia, monto y vencimiento | Recaudo, QR y llave Bre-B de Factus Pay |
| Néstor y Juan Diego | `GET /v1/collections/{reference_code}` antes de facturar | Referencia existente, monto esperado y estado `paid` |
| Elias | `POST /v2/bills/validate` con comprador, líneas, impuestos y pago | Factura validada: `is_validated: true`, número y CUFE |
| Elias | `GET /v2/bills/{number}/download-pdf` | PDF abierto de esa factura |
| Juan Diego | `Pago.id = reference_code` en las dos APIs | La misma referencia en Ribu, Factus Pay y Factus |

El webhook avisa, y el backend confirma con consulta al proveedor. La web no decide que entró dinero. La autenticación, los tokens y la llave del webhook permanecen fuera de la presentación. Explicar un endpoint con una tarjeta de texto no acredita que se llamó: la evidencia debe venir del video o de una captura real sanitizada de esa corrida.

## Ensayo y control del tiempo

El texto hablado en vivo tiene **262 palabras**; el video tiene **126 palabras de narración**. Son recuentos del guion, no una duración medida. El presupuesto de 4:45 incluye el video de dos minutos y todos los relevos. A un ritmo supuesto de 120 palabras por minuto, la voz en vivo ocuparía unos 131.0 segundos dentro de sus 165 segundos asignados. La holgura permite pausas, señalar evidencia y cambiar de expositor.

- Iniciar el reloj antes del gancho. El video empieza a 0:25, Andrés entra a 2:25 y el cierre comienza a 4:35.
- Probar el archivo de video final en el reproductor que se usará. Confirmar audio, legibilidad de importes, referencias y resultado de ambas APIs.
- Ensayar con las cinco personas. Registrar duración de cada turno y duración total en el mismo ensayo; la lectura individual no valida los relevos.
- Objetivo: terminar dentro de 4:45. Si se excede, recortar frases repetidas entre módulos y mantener la comprobación de recaudo, factura y referencia compartida.
- Las preguntas preparadas de abajo se atienden después solo si el formato del evento lo permite. No se agrega una ronda de respuestas dentro del presupuesto de cinco minutos.
- Si el video no reproduce o un paso obligatorio está incompleto, comunicar el estado real y terminar dentro del límite. No sustituirlo por mocks ni por documentos de otro pago. Corregir y volver a grabar antes de la entrega.

## Antes de dar el pitch por listo

- [ ] Video real de 2:00, dentro de la duración exigida de 2 a 3 minutos, reproducido de principio a fin.
- [ ] Se ve el recaudo de Factus Pay confirmado y la factura de Factus v2 del mismo pago.
- [ ] Coinciden las tres referencias, se lee el monto y se abre el PDF.
- [ ] Cada integrante revisó su intervención y explica qué envía, qué recibe y cómo maneja un fallo en su parte.
- [ ] Eddy distingue problema hipotético, datos ficticios y resultados probados por el equipo.
- [ ] Ensayo completo con cinco integrantes dentro de 4:45; quedan 15 segundos de margen.

La guía de introducción, desarrollo y cierre está en `docs/guia-speech.md`. Las fuentes de hechos y cifras siguen siendo `docs/datos-demo.md`, `docs/explicacion-integracion.md`, `contratos/README.md` y las fuentes citadas en las respuestas del jurado. Las entrevistas, el ensayo y las pruebas físicas pendientes no se dan por hechos.

## Preguntas del jurado

### ¿Por qué lo pagaría el dueño?

> Buscamos reducir el trabajo de relacionar cada pago con su factura y de atender cuentas divididas. Esa sería la razón para pagarlo, si el restaurante comprueba ese beneficio. Todavía no hemos fijado un precio para Ribu ni medido cuánto tiempo ahorra.

Si `docs/validacion.md` ya tiene resultados, se agrega qué dijeron los restaurantes y cuántos fueron. Hay que decir que es una muestra pequeña.

### ¿Cuánto cuesta cobrar?

> Cada recaudo cuesta 800 pesos más IVA: 952 con IVA del 19 %. Cada solicitud de dispersión cuesta otros 952. Frente a una comisión total del 3 %, el equilibrio del recaudo solo está cerca de 31.734 pesos; al incluir la dispersión sube. Depende de cuántos recaudos acumule el restaurante antes de dispersar. Hay que comparar su tarifa real y los otros costos antes de prometer ahorro.

Tarifas de Factus Pay confirmadas en sus [preguntas frecuentes](https://pay-developers.factus.com.co/preguntas-frecuentes/) el 4 de noviembre de 2026. El IVA del 19 % se aplicó para llegar a $952.

El 3 % es un **escenario de comparación pedido por el equipo**, no una tarifa verificada de un proveedor. La tabla calcula igualdad de costos, redondeada hacia arriba al peso; el ahorro empieza por encima del equilibrio. No se usa el piso de $22.000 porque no se sostiene con estos supuestos.

| Escenario hipotético | Equilibrio por pago | Cómo sale |
|---|---:|---|
| Comisión total 3 %, sin asignar dispersión | $31.734 | 952 ÷ 0,03 |
| Comisión total 3 %, con 5 recaudos por dispersión | $38.080 | (952 + 952 ÷ 5) ÷ 0,03 |
| Comisión total 3 %, con 20 recaudos por dispersión | $33.320 | (952 + 952 ÷ 20) ÷ 0,03 |
| Comisión total 3 %, con una dispersión por recaudo | $63.467 | (952 + 952) ÷ 0,03 |
| Comisión 3 % + IVA 19 %, sin asignar dispersión | $26.667 | 952 ÷ 0,0357 |
| Comisión 3 % + IVA 19 %, con 5 recaudos por dispersión | $32.000 | (952 + 952 ÷ 5) ÷ 0,0357 |

Los $952 son el cálculo `800 × 1,19`. Para `n` recaudos del mismo importe y una sola dispersión, el costo promedio de Factus Pay por pago es `952 + 952/n`. Frente a una tasa total `t`, el equilibrio es `(952 + 952/n) / t`. Son cálculos del equipo sobre las tarifas citadas, no resultados de clientes.

No usar otras tarifas de competidores hasta verificar su fuente primaria, impuestos, cargos fijos y condiciones del restaurante.

Si preguntan por lo que no cubre esta cuenta:

- No incluye el costo de Factus facturación ni un precio de Ribu, porque no los tenemos; tampoco otros cargos, impuestos o planes del medio comparado.
- Dividir la cuenta cuesta más: 3 partes son 3 recaudos, $2.856, antes de dispersar. Con partes de $30.600, una comisión total hipotética de 3 % sería $918 por parte: menor que $952. No se promete ahorro en ese caso.
- El dinero queda custodiado por Bancoomeva hasta que se ordena la dispersión. No llega solo a la cuenta del restaurante.
- Un pago de menos de $10.000 no se puede cobrar con Factus Pay. El sandbox responde 422, aunque su documentación diga de $1.000 a $12.100.000.

### ¿Qué pasa con el efectivo y la tarjeta? ¿Y si hay que devolver dinero?

> Factus Pay cobra por QR y llave Bre-B. El efectivo y la tarjeta se siguen cobrando como hoy, con el datáfono del restaurante. El personal los registra en Ribu, y también generan factura. Esa es también la salida para lo que Factus Pay no acepta: solo cobra de 10.000 a 12.000.000 de pesos.
>
> Factus Pay no tiene reversos. Si hay que devolver dinero, el restaurante lo devuelve por fuera, y el administrador registra una nota crédito. La nota queda con la devolución pendiente hasta que la marque como hecha. Ribu no mueve ese dinero: deja constancia de lo que falta devolver.

### ¿Cómo se divide la cuenta?

> De dos formas: en partes iguales, de 2 a 20, o eligiendo productos. Cada pago tiene su propio recaudo y su propia factura. Una misma unidad no puede estar en dos pagos: si alguien ya está pagando ese plato, el sistema no deja cobrarlo otra vez. Y si alguien pide algo después, va en otro pago.
>
> Hay un límite: Factus Pay solo cobra desde 10.000 pesos. Si una parte queda por debajo, Ribu no deja dividir así: se divide en menos partes o se paga en efectivo o con tarjeta.

### ¿Y si alguien pega un QR falso?

> Hay dos QR. El del sticker solo abre el link de la mesa: no cobra. El de pago lo genera Ribu para cada pago, con el monto exacto, y nunca se imprime.
>
> El riesgo real es un sticker falso que lleve a otra página. Ribu no puede impedir que alguien lo pegue. Lo que sí pasa es que ese pago nunca entra a la cuenta real: el mesero sigue viendo el saldo y no puede liberar la mesa. Se detecta, pero el cliente ya pudo perder su dinero.
>
> Por eso debemos revisar los stickers, mostrar el dominio oficial y pedir que el cliente lo compruebe. Bloquear la escritura del NFC puede impedir regrabar ese tag, pero no evita clonarlo ni cubrirlo con otro. Todavía no lo hemos probado en un restaurante.

Después de `docs/pruebas-fisicas.md`, agrega qué nombre ve el cliente en su banco antes de pagar. Factus Pay no lo documenta. Si no se ha probado, no lo menciones.

### ¿Ya existe algo así?

> Hay soluciones de pedidos con QR y de pagos con QR. No afirmamos ser los únicos. Nuestro enfoque es unir el pedido, el recaudo y la factura electrónica con una sola referencia.

### ¿Y si falla la demo en vivo?

> Tenemos el video grabado del flujo completo, en el mismo sandbox.

Decirlo solo si el video existe. En el sandbox compartido, la factura de otro equipo puede bloquear el rango con un 409. La app debe seguir reintentando, y mostrar la factura `en_proceso` es una respuesta válida.

## Antes de presentar

Marca cada punto contra la app desplegada. Si no se cumple, quita la frase.

- [ ] El sticker NFC abre la mesa 3 en los celulares que se usarán.
- [ ] La mojarra queda agotada al confirmar 2. El stock está cargado de nuevo.
- [ ] El total de la demo da $100.300.
- [ ] El simulador confirma el pago y aparece la factura sin tocar nada.
- [ ] La factura muestra número, CUFE, QR y PDF.
- [ ] El efectivo y la tarjeta se registran y generan factura.
- [ ] La cuenta se divide de las dos formas.
- [ ] Un cobro de menos de $10.000 muestra un mensaje claro y deja pagar en efectivo o con tarjeta.
- [ ] La nota crédito y la nota débito se emiten.
- [ ] Las tarifas siguen iguales en la documentación de Factus Pay.
- [ ] Eddy puede explicar cada frase sin leerla.
- [ ] El guion completo, con la demo, dura menos de 5 minutos con cronómetro.
