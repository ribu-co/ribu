# Pruebas físicas

**Estado: sin realizar.** Requiere stickers, celulares y la URL de una mesa. Los resultados de abajo están vacíos hasta que alguien haga la prueba.

**Responsable:** Eddy.

**Regla que no se negocia: no completes ningún pago.** El reto prohíbe el dinero real. En la app del banco, detente antes de confirmar.

## Qué se necesita

- La URL de una mesa, con la forma `https://<dominio>/m/<token>`. La entrega Juan Diego. Debe ser definitiva, porque el sticker queda grabado con ella.
- Stickers NFC regrabables, y una app para grabarlos.
- Un iPhone y un Android con NFC.
- Una impresora para el QR.

## 1. Grabar el sticker NFC

1. Graba la URL como un registro de tipo URL.
2. Lee el sticker con otro celular para comprobar que quedó bien.
3. **No lo bloquees todavía.** El bloqueo de escritura no se puede deshacer. Hazlo solo con la URL definitiva. Prueba además en un sticker aparte si, ya bloqueado, otra persona puede sobrescribirlo: es parte de la respuesta sobre stickers falsos.

## 2. Probar el sticker

Hazlo con la pantalla desbloqueada y sin abrir ninguna app antes.

| Comprobar | iPhone | Android |
|---|---|---|
| Modelo y versión del sistema | | |
| ¿Lee el sticker sin abrir una app? | | |
| ¿Qué tiene que tocar el usuario? | | |
| ¿Cuántos segundos hasta ver la mesa? | | |
| ¿Abre la mesa correcta? | | |
| ¿Funciona a través de una funda? | | |
| ¿Funciona sobre una mesa de metal? | | |

## 3. Probar el QR impreso

1. Genera un QR con la misma URL del sticker.
2. Imprímelo al tamaño real que tendría en la mesa.
3. Escanéalo con la cámara, sin instalar ninguna app.

| Comprobar | iPhone | Android |
|---|---|---|
| ¿Abre la misma mesa que el NFC? | | |
| ¿Lee desde la distancia de una persona sentada? | | |
| ¿Lee con poca luz? | | |
| ¿Lee con el papel doblado o plastificado? | | |

## 4. Comprobar la llave Bre-B

Queremos saber si un cliente puede pagar desde el mismo celular, copiando la llave y pegándola en su banco. Factus Pay dice que se puede, con el monto exacto. No documenta qué nombre ve quien paga.

1. Crea un cobro en el sandbox y copia la llave con el botón de la app.
2. Abre la app del banco, en la opción de enviar con llave.
3. Pega la llave. **Ahí termina la prueba.** No confirmes ningún envío.
4. Si aparece un nombre, anota solo si corresponde a un comercio o a un intermediario. Si aparece el nombre de una persona, no lo anotes.

**Una llave del sandbox puede no existir en la red real.** Si el banco responde que no existe, eso no prueba que el flujo falle: solo prueba que se puede pegar. Regístralo así, y no lo presentes como un pago probado.

| Banco o billetera | ¿Deja pegar la llave? | ¿Qué responde? | ¿Muestra un nombre? |
|---|---|---|---|
| | | | |
| | | | |

## Qué cambia con estos resultados

| Resultado | Qué hacer |
|---|---|
| Un celular no lee el NFC sin abrir una app | No digas "solo toque": muestra el QR como alternativa |
| El QR falla al tamaño previsto | Agrándalo antes de imprimir los de la demo |
| No se puede pegar la llave | Avísale a Néstor y a Andrés. No prometas pagar desde el mismo celular |
| No se pudo comprobar el nombre del comercio | No lo uses en la respuesta sobre el QR falso |
| Otra persona puede sobrescribir el sticker | Bloquéalo, y dilo en la respuesta sobre el QR falso |

## Evidencia y límites del MVP

Al 4 de noviembre de 2026 no se ha escrito NFC, impreso QR ni probado un banco. Registrar responsable, fecha, URL y commit desplegado, tipo de tag, tamaño de impresión, modelos y versiones de teléfonos, banco y versión de su app. No registrar autenticación, saldos, cuentas ni notificaciones personales.

Comparar carácter por carácter el texto del NFC, el QR decodificado y la URL HTTPS entregada por Integración. El sticker guarda el enlace `/m/{token}`, nunca el QR temporal de Factus Pay ni una llave Bre-B. La impresión se prueba sobre papel, no solo desde pantalla.

La prueba bancaria termina en el campo de la llave: no avanzar a autorización ni completar ningún pago. Probar que deja pegar no demuestra que el banco acepte un recaudo de sandbox. Si el banco exige avanzar para probarlo, dejar la prueba bloqueada. El flujo de pago se comprueba exclusivamente con el simulador.

Bloquear la escritura del NFC puede impedir regrabar ese tag; no evita clonarlo ni cubrirlo con un sticker falso. Mostrar el dominio oficial legible y revisar físicamente los stickers son medidas operativas por validar. No afirmar que el NFC elimina el fraude.

Registrar pasa, falla o bloqueado solo tras observarlo y adjuntar evidencia sanitizada. Todos los resultados actuales siguen pendientes. Eddy ajusta el pitch a los modelos y bancos realmente probados.
