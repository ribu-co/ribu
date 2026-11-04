# Guion del pitch

Máximo 5 minutos, y este guion dura unos 4:30. Lo que va en cita, y la columna "Qué se dice" de la demo, es lo que se dice en voz alta. Los datos de la demo salen de `docs/datos-demo.md`.

**Idea central: la mesa cobra y factura sola.**

**Estado:** se escribió antes de que la app funcione. Cada frase de la demo se ensaya contra la app desplegada. Si algo no funciona ese día, se quita del guion: no se promete lo que la demo no muestre.

## 1. Problema (0:00–0:35)

> Piensen en la última vez que dividieron una cuenta en un restaurante. Alguien pide la cuenta, esperan, cada quien paga distinto y alguien tiene que sacar varias facturas.
>
> Para el dueño, el pedido, el cobro y la factura son tres pasos separados. Y al final hay que cruzar qué plata corresponde a qué factura.

Si `docs/validacion.md` tiene una frase real con permiso, va aquí, con el tipo de negocio. Si no hay, no se dice nada: **no se inventan testimonios**.

## 2. Solución (0:35–1:05)

> Ribu es un sticker en cada mesa, con NFC y QR, que abre un mismo link. Desde ahí se pide, el mesero confirma, la cocina prepara y se paga con Factus Pay.
>
> Y en cuanto entra el pago, se emite la factura electrónica con Factus, sin que nadie la digite. La mesa cobra y factura sola.

## 3. Demo en vivo (1:05–3:05)

Se necesitan tres pantallas: el celular de la mesa, el mesero en el portátil y otro dispositivo con el simulador, que escanea el QR con la cámara.

| Paso | Qué se hace | Qué se dice |
|---|---|---|
| 1 | Abre la mesa 3 con el sticker | Toco el sticker y ya estoy en la mesa 3. Sin instalar nada y sin registrarme. |
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
> Y el costo es fijo: 952 pesos por recaudo, sin importar el valor, más 952 cada vez que pasa el dinero a su cuenta. En esta mesa de 100.000 pesos, el recaudo cuesta 952. Con un datáfono de 3 % más IVA, serían unos 3.600. En cuentas pequeñas el datáfono puede salir más barato, y por eso Ribu también registra efectivo y tarjeta.

## 6. Cierre (4:20–4:30)

> Pedido, cobro y factura, en un solo flujo. Eso es Ribu: la mesa cobra y factura sola. Gracias.

## Preguntas del jurado

### ¿Por qué lo pagaría el dueño?

> Porque le quita el trabajo de relacionar cada pago con su factura y de atender cuentas divididas, y porque cobra con un costo fijo. Todavía no hemos fijado un precio para Ribu ni medido cuánto tiempo ahorra.

Si `docs/validacion.md` ya tiene resultados, se agrega qué dijeron los restaurantes y cuántos fueron. Hay que decir que es una muestra pequeña.

### ¿Cuánto cuesta cobrar?

> Cada recaudo cuesta 800 pesos más IVA: 952. Pasar el dinero a la cuenta del restaurante cuesta otros 952 por solicitud, y una solicitud puede acumular muchos recaudos. Frente a un datáfono del 3 %, conviene desde unos 27.000 a 32.000 pesos por pago. Frente a una tarifa de 1,98 %, desde unos 40.000. Por debajo de eso, el datáfono es más barato.

Tarifas de Factus Pay confirmadas en sus [preguntas frecuentes](https://pay-developers.factus.com.co/preguntas-frecuentes/) el 4 de noviembre de 2026. El IVA del 19 % se aplicó para llegar a $952.

| Comparado con | Conviene desde | Cómo sale |
|---|---:|---|
| 3 %, con el IVA incluido | $31.733 | 952 ÷ 0,03 |
| 3 % + IVA | $26.667 | 952 ÷ 0,0357 |
| 3 % + IVA, con 5 recaudos por dispersión | $32.000 | (952 + 952 ÷ 5) ÷ 0,0357 |
| 3 % + IVA, con 20 recaudos por dispersión | $28.000 | (952 + 952 ÷ 20) ÷ 0,0357 |
| 1,98 % + IVA | $40.404 | 952 ÷ 0,023562 |
| 1 % + IVA, el QR de Wompi | $80.000 | 952 ÷ 0,0119 |

De dónde salen las tarifas de comparación:

- **3 %:** es una cifra de referencia del equipo, no la tarifa de un proveedor. Tarifas publicadas: [ARQ](https://www.arqfinance.com/es-CO/blog/your-money/es-legal-cobrar-comision-pagar-con-tarjeta) cita 2,99 % para Bold y para Redeban. Falta confirmarlas en cada proveedor.
- **1,98 %:** [Bancolombia](https://www.bancolombia.com/pagos/datafono) publica "desde 1,98 % + impuestos" para su datáfono, con suscripción mensual si se hacen menos de 50 transacciones. Se asumió que "impuestos" es IVA del 19 %.
- **1 %:** [Enter.co](https://www.enter.co/fintech/wompi-baja-la-tarifa-del-qr-al-1-y-amplia-los-pagos-desde-el-celular/) reporta que el QR de Wompi bajó a 1 % más IVA. Aclara que aplica a personas naturales y a pagos desde Bancolombia y Nequi, así que no es una tarifa general.

Si preguntan por lo que no cubre esta cuenta:

- No incluye el costo de Factus facturación ni un precio de Ribu, porque no los tenemos.
- Dividir la cuenta cuesta más: 3 partes son 3 recaudos, $2.856. Con partes de $30.600, cada una cuesta $952, frente a $1.092 con un datáfono de 3 % + IVA y $721 con uno de 1,98 % + IVA.
- El dinero queda custodiado por Bancoomeva hasta que se ordena la dispersión. No llega solo a la cuenta del restaurante.

### ¿Qué pasa con el efectivo y la tarjeta? ¿Y si hay que devolver dinero?

> Factus Pay cobra por QR y llave Bre-B. El efectivo y la tarjeta se siguen cobrando como hoy, con el datáfono del restaurante. El personal los registra en Ribu, y también generan factura.
>
> Factus Pay no tiene reversos. Si hay que devolver dinero, el restaurante lo devuelve por fuera, y el administrador registra una nota crédito. La nota queda con la devolución pendiente hasta que la marque como hecha. Ribu no mueve ese dinero: deja constancia de lo que falta devolver.

### ¿Cómo se divide la cuenta?

> De dos formas: en partes iguales, de 2 a 20, o eligiendo productos. Cada pago tiene su propio recaudo y su propia factura. Una misma unidad no puede estar en dos pagos: si alguien ya está pagando ese plato, el sistema no deja cobrarlo otra vez. Y si alguien pide algo después, va en otro pago.

### ¿Y si alguien pega un QR falso?

> Hay dos QR. El del sticker solo abre el link de la mesa: no cobra. El de pago lo genera Ribu para cada pago, con el monto exacto, y nunca se imprime.
>
> El riesgo real es un sticker falso que lleve a otra página. Ribu no puede impedir que alguien lo pegue. Lo que sí pasa es que ese pago nunca entra a la cuenta real: el mesero sigue viendo el saldo y no puede liberar la mesa. Se detecta, pero el cliente ya pudo perder su dinero.
>
> Por eso la protección es física y de operación: revisar los stickers y bloquear la escritura del NFC. Todavía no la hemos probado en un restaurante.

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
- [ ] La nota crédito y la nota débito se emiten.
- [ ] Las tarifas siguen iguales en la documentación de Factus Pay.
- [ ] Eddy puede explicar cada frase sin leerla.
- [ ] El guion completo, con la demo, dura menos de 5 minutos con cronómetro.
