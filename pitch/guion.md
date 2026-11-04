# Guion del pitch

Máximo 5 minutos. La pauta reserva 4:30; falta cronometrarla con Eddy. Lo que va en cita, y la columna "Qué se dice" de la demo, es lo que se dice en voz alta. Las preguntas del jurado y las notas de preparación quedan fuera de esos 4:30. Los datos de la demo salen de `docs/datos-demo.md`.

**Idea central: la mesa cobra y factura sola.**

**Estado:** se escribió antes de que la app funcione. Cada frase de la demo se ensaya contra la app desplegada. Si algo no funciona ese día, se quita del guion: no se promete lo que la demo no muestre.

## 1. Problema (0:00–0:35)

> Piensen en la última vez que dividieron una cuenta en un restaurante. Alguien pide la cuenta, esperan, cada quien paga distinto y alguien tiene que sacar varias facturas.
>
> Nuestra hipótesis es que, cuando pedido, cobro y factura están separados, el dueño termina cruzando qué plata corresponde a qué factura. Todavía debemos validarla con restaurantes.

Si `docs/validacion.md` tiene una frase real con permiso, va aquí, con el tipo de negocio. Si no hay, no se dice nada: **no se inventan testimonios**.

## 2. Solución (0:35–1:05)

> Ribu es un sticker en cada mesa, con NFC y QR, que abre un mismo link. Desde ahí se pide, el mesero confirma, la cocina prepara y se paga con Factus Pay.
>
> Y en cuanto entra el pago, se emite la factura electrónica con Factus, sin que nadie la digite. La mesa cobra y factura sola.

## 3. Demo en vivo (1:05–3:05)

Se necesitan tres pantallas: el celular de la mesa, el mesero en el portátil y otro dispositivo con el simulador, que escanea el QR con la cámara.

| Paso | Qué se hace | Qué se dice |
|---|---|---|
| 1 | Abre el enlace de la mesa 3; usa el sticker solo si ya pasó la prueba física | Abro el enlace y ya estoy en la mesa 3. Sin instalar nada y sin registrarme. |
| 2 | Pide 2 mojarras, 2 jugos y 1 patacón | Pido. Esto todavía no va a cocina. |
| 3 | El mesero confirma | El mesero confirma, y solo lo confirmado se puede pagar. Quedaban dos mojarras, así que la mojarra aparece agotada. |
| 4 | Avanza el pedido en cocina | La cocina lo ve y lo va marcando. Toda la mesa ve el avance. |
| 5 | Elige toda la cuenta, 10 % de propina y consumidor final | Elijo la propina antes de pagar, porque el cobro es por el monto exacto: 100.300 pesos. |
| 6 | Muestra el QR y la llave Bre-B | Factus Pay crea el recaudo. Este es el sandbox: no se mueve dinero real. |
| 7 | Escanea con el simulador y paga | Confirmo el pago en el simulador de Factus Pay. |
| 8 | Aparece la factura | Sin tocar nada más: número, CUFE, QR de la DIAN y PDF. Esta es la factura de ese pago. |

**Si queda tiempo:** mostrar el mismo id del pago en el panel de Factus Pay y en la factura.

## 4. Arquitectura (3:05–3:45)

> Todo depende de una decisión: el id del pago en Ribu es el `reference_code` en Factus Pay y también en Factus. Así el dinero y la factura quedan asociados desde el principio, no se cruzan después.
>
> El webhook avisa, pero no le creemos sin confirmar: consultamos el estado antes de facturar. Si la DIAN demora, reintentamos con la misma referencia, y no se duplica.
>
> La web nunca envía precios ni estados. Las llaves de las APIs no llegan al navegador: las maneja solo el backend, en Firebase.

## 5. Valor para el dueño (3:45–4:20)

> ¿Qué gana el dueño? Primero, cada pago queda atado a su factura, sin cruzar extractos. Segundo, dividir la cuenta deja de ser un problema: cada persona paga lo suyo y recibe su factura.
>
> Cada recaudo cuesta 952 pesos, más 952 por dispersión. El ahorro depende del importe y de cuántos recaudos se agrupen. Aún falta medir el ahorro de tiempo y fijar el precio de Ribu.

## 6. Cierre (4:20–4:30)

> Pedido, cobro y factura, en un solo flujo. Eso es Ribu: la mesa cobra y factura sola. Gracias.

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
