# Casos de prueba

Recorridos para probar Ribu como lo haría un jurado.

**Estado: sin ejecutar.** La app todavía no está desplegada. Lo esperado sale de `contratos/`, no de haber visto la app. Si un resultado real contradice este documento, repórtalo: el error puede estar en la app, en el contrato o aquí.

## Antes de empezar

- **URL de la app:** pendiente.
- **Datos:** los de `docs/datos-demo.md`, con el stock recién cargado.
- **Equipos:** dos celulares como clientes, un portátil para el personal y otro dispositivo con el [simulador](https://pay-api-sandbox.factus.com.co/simulator).
- **Cuentas:** mesero, cocina y admin, que entrega Juan Diego por privado.
- **Reglas:**
  - Nunca dinero real: solo se paga con el simulador.
  - Solo datos inventados, porque el sandbox de Factus es público.
  - Si una factura rechazada queda sin eliminar, bloquea el rango para todos: avisa en seguida a Elias.

## Resultados y a quién reportar

Reporta cada fallo con el caso, el paso, lo que pasó y una captura, sin tokens ni datos personales.

| Si falla... | Reporta a |
|---|---|
| Pantallas y mensajes | Andrés |
| Recaudo, QR, webhook o simulador | Néstor |
| Factura, notas, PDF o correo | Elias |
| Reglas, permisos, stock, mesas o despliegue | Juan Diego |

| Caso | Resultado | Fecha | Fallo y a quién se reportó |
|---|---|---|---|
| 1. Pedido del cliente | Sin ejecutar | | |
| 2. Pedido del mesero | Sin ejecutar | | |
| 3. Producto agotado | Sin ejecutar | | |
| 4. Flujo completo con Factus Pay | Sin ejecutar | | |
| 5. Dos personas pagando a la vez | Sin ejecutar | | |
| 6. Pedido nuevo con un QR activo | Sin ejecutar | | |
| 7. Dividir en partes iguales | Sin ejecutar | | |
| 8. Dividir por productos | Sin ejecutar | | |
| 9. Efectivo y tarjeta | Sin ejecutar | | |
| 10. Factura rechazada | Sin ejecutar | | |
| 11. Nota crédito | Sin ejecutar | | |
| 12. Nota débito | Sin ejecutar | | |
| 13. Liberar la mesa | Sin ejecutar | | |

## 1. Pedido del cliente

1. Abre el link de la mesa 1, sin iniciar sesión.
2. Pide 1 sancocho de gallina y 1 agua.
3. Con el mesero, confirma el sancocho y rechaza el agua, con un motivo.

**Esperado:**

- El cliente entra sin registrarse.
- Antes de confirmar, las líneas están `pendiente`, el stock no baja, no van a cocina y no se pueden pagar.
- Al confirmar, el sancocho baja de 25 a 24, y la cocina lo ve.
- El agua queda `rechazada`, con su motivo, y no suma.
- El consumo es $27.000.
- Otro celular con el mismo link ve el mismo pedido.

## 2. Pedido del mesero

1. Con el mesero, abre la mesa 2 y pide 1 posta negra.
2. Con cocina, pásala a `en_preparacion`, `lista` y `entregada`.
3. Con el mesero, anula otra línea confirmada que nadie haya pagado.

**Esperado:**

- La línea queda `confirmada` sin otro paso y va directo a cocina.
- La posta baja de 15 a 14.
- La línea anulada devuelve su unidad al stock.
- El rol sale del login: el mismo link no le da permisos de mesero a un cliente.

## 3. Producto agotado

1. En la mesa 3, pide 2 mojarras y confirma.
2. Desde otro celular, trata de pedir otra mojarra.

**Esperado:** el stock queda en 0 y `disponible` en `false`. La carta la muestra agotada y un nuevo pedido responde `PRODUCTO_NO_DISPONIBLE`.

**Variante:** con el stock en 2, las mesas 3 y 4 piden 2 mojarras cada una, sin confirmar. Confirma ambas. La segunda debe responder `STOCK_INSUFICIENTE`.

## 4. Flujo completo con Factus Pay

Es el flujo que exige el reto.

1. En la mesa 3, pide 2 mojarras, 2 jugos y 1 patacón. Confirma.
2. Paga toda la cuenta, con 10 % de propina y consumidor final.
3. Copia la llave Bre-B. Comprueba que se copia bien, sin pagar en un banco.
4. Paga con el simulador, escaneando el QR.

**Esperado:**

- El total del cobro es $100.300.
- La página no ofrece pagar lo que no está confirmado.
- Se ve el pago confirmado sin recargar.
- La factura muestra número, CUFE, QR y PDF, y el PDF se abre.
- En el panel de Factus Pay y en Factus aparece la misma referencia, que es el id del pago.
- Con todo pagado, la página ya no ofrece pagar.

## 5. Dos personas pagando a la vez

1. Abre el mismo link en dos celulares, con una cuenta confirmada.
2. Toca pagar toda la cuenta en los dos, al mismo tiempo.
3. Cancela el pago del primero y vuelve a intentar en el segundo.

**Esperado:**

- Solo uno obtiene el cobro. El otro recibe `PAGO_EN_CURSO`, con un mensaje claro.
- Antes de cancelar, hay un solo recaudo activo y todavía ninguna factura sin pago. Después de cancelar y crear el segundo, quedan dos referencias en el historial; solo el pago confirmado genera su factura, salvo la incidencia de pago duplicado que no se factura.
- Al cancelar, lo que cubría queda libre y el segundo puede pagar.

**Si hay tiempo:** después de cancelar y de que el segundo pague, paga también el primer QR en el simulador. Debe quedar `pago_duplicado`, sin factura, y el personal debe verlo para devolver el dinero por fuera.

## 6. Pedido nuevo con un QR activo

1. Con una cuenta de $27.000, genera el QR, sin pagarlo.
2. Pide 1 patacón y confírmalo.
3. Paga el primer QR y luego lo que falta.

**Esperado:**

- El monto del primer QR no cambia. Sigue siendo por $27.000 más la propina que se haya elegido.
- `porPagar` muestra solo los $10.800 nuevos. Sin propina, el consumo total queda en $37.800.
- Lo nuevo va en otro pago, con otra referencia.
- Al final hay 2 recaudos y 2 facturas, y nada queda cobrado dos veces.

## 7. Dividir en partes iguales

1. Con la cuenta de $91.800, divide en 3.
2. Cada celular paga una parte, con propinas distintas.
3. Trata de pagar una parte ya tomada.
4. Trata de cambiar la división con una parte en cobro.

**Esperado:**

- Cada parte es de $30.600 antes de propina. Con 5 % de propina, son $1.417 más.
- Una parte tomada responde `PARTE_NO_DISPONIBLE`.
- Cambiar la división responde `DIVISION_ACTIVA`.
- Hay 3 referencias, 3 recaudos y 3 facturas, y las partes suman $91.800.

**Variantes con una cuenta de $27.000 y propina 0:**

- En 2 partes, cada una es de $13.500 y se puede crear el recaudo.
- En 3 partes, cada una es de $9.000, menos del mínimo real de $10.000. Debe responder `MONTO_FUERA_DE_RANGO` sin crear un recaudo; el personal puede registrar efectivo o tarjeta ficticios.

## 8. Dividir por productos

1. Con 2 limonadas de coco y 1 patacón confirmados, un celular paga 1 limonada y el patacón, sin propina.
2. El otro trata de pagar 2 limonadas. Después paga 1, sin propina.

**Esperado:**

- El primer pago es de $22.800 y el segundo de $12.000. Suman $34.800 y ambos superan el mínimo de Factus Pay.
- Pedir 2 limonadas después de reservar la primera responde `CANTIDAD_NO_DISPONIBLE`.
- Cada factura lleva solo lo que cubrió su pago.

## 9. Efectivo y tarjeta

1. Con un cliente, trata de registrar un pago en efectivo.
2. Con el mesero, registra en efectivo una cuenta ficticia, sin recibir ni mover dinero real.
3. Con el mesero, registra otra cuenta ficticia con tarjeta débito y otra con tarjeta crédito, sin operar un datáfono real.

**Esperado:**

- El cliente recibe `SIN_PERMISO`.
- El pago queda `pagado`, sin QR ni recaudo.
- Se emite la factura, con su medio de pago correcto en Factus.

Las tablas de Factus identifican efectivo `10`, tarjeta débito `49` y tarjeta crédito `48`. Falta probar la emisión con estos medios, no encontrar sus códigos: ver `docs/explicacion-integracion.md`.

## 10. Factura rechazada

**Hay que coordinarlo con Elias y no se hace durante el pitch.** En el sandbox compartido, un rechazo bloquea el rango para todos hasta que se elimine.

**Falta definir cómo provocarlo.** `contratos/README.md` dice que se use un NIT con un `dv` errado, pero `Comprador` no tiene `dv`, porque Factus lo calcula. Elias debe definir un NIT que la DIAN rechace, u otra forma de probarlo.

1. Paga una cuenta con un comprador `empresa` que provoque el rechazo.
2. Con el mesero, abre la factura, corrige el comprador y reintenta.

**Esperado:**

- El pago sigue `pagado`: el dinero no se pierde de vista.
- La factura queda `rechazada` y ya está eliminada en Factus.
- El personal ve el motivo. El cliente ve un mensaje claro, no un error técnico.
- Al corregir, pasa por `en_proceso` y termina `emitida`, con la misma referencia.

## 11. Nota crédito

1. Con el mesero, trata de crear una nota sobre una factura emitida.
2. Con el admin, crea una rebaja parcial.
3. Con el admin, trata de acreditar más de lo que queda.
4. Con el admin, anula lo que quede y registra una devolución ficticia como hecha. No devuelvas dinero real en esta prueba.

**Esperado:**

- El mesero recibe `SIN_PERMISO`.
- La nota muestra número, código único y PDF, y referencia la factura.
- La devolución queda `pendiente`, y luego `hecha`.
- Exceder el saldo responde `NOTA_EXCEDE_FACTURA`.
- La cuenta de la mesa no cambia.
- Ribu no mueve dinero: la devolución ocurre por fuera.

## 12. Nota débito

1. Con el admin, crea una nota débito con `factus_pay`, por $10.800.
2. Paga el cobro con el simulador.
3. Crea otra con efectivo.

**Esperado:**

- Con `factus_pay`, la nota no se emite hasta que entra el pago. El cobro usa el id de la nota como referencia.
- Con efectivo, se emite de una vez.
- Una nota débito por menos de $10.000 con `factus_pay` responde `MONTO_FUERA_DE_RANGO`. Si el valor es menor, se cobra por efectivo o tarjeta ficticios.
- La nota débito emitida aumenta lo que se puede acreditar de esa factura.

## 13. Liberar la mesa

1. Trata de liberar una mesa con saldo, con un cobro activo o con líneas pendientes.
2. Paga todo y libérala.
3. Abre el mismo link.

**Esperado:**

- Con saldo o cobro activo, responde `MESA_CON_SALDO`. Con líneas pendientes, tampoco se libera.
- Al liberarla, el link queda limpio. El siguiente cliente no ve nada del anterior.
- El sticker sigue funcionando con el mismo link.
- Una factura en proceso no bloquea la mesa.

## Si hay tiempo

- **Redondeo:** paga 1 limonada de coco y 3 limonadas por separado. El total en Factus debe dar $12.000 y $36.000. Antes de hacerlo, avisa a Elias.
- **QR vencido:** espera los 600 segundos. Aunque Factus Pay siga en `ready`, Ribu compara `qr_expires_at` convertido desde hora de Colombia a UTC, marca `vencido` y libera lo que cubría.
- **Celular:** repite el caso 4 en iPhone y en Android, con pantalla pequeña.

## Recorridos adicionales del MVP

### 14. Pagos simultáneos de productos distintos

Con la cuenta confirmada de $91.800 y propina 0, A paga una mojarra y un jugo ($40.500); B paga la otra mojarra, el otro jugo y el patacón ($51.300). Generar ambos cobros antes de simular los pagos y pagarlos en orden inverso. Esperado: dos referencias diferentes, dos facturas, suma de $91.800 y saldo 0, sin unidades cubiertas dos veces. Estado: sin ejecutar.

### 15. Webhook, reintentos y demora DIAN

Con Integración y Facturación, reproducir primero en mocks: webhook repetido, llave incorrecta, DIAN demorada, 409 y 429. No publicar la llave. Esperado: consultar referencia, importe y `paid` antes de facturar; procesar una sola vez; rechazar el webhook falso; conservar referencia en cada reintento. Una demora queda `en_validacion` y nunca se elimina; 409 y 429 quedan `en_proceso`, sin cobrar de nuevo. Identificar esta evidencia como mock, no como prueba de las APIs reales. Estado: sin ejecutar.

### 16. Privacidad al cambiar de comensal

Después de liberar la mesa, abrir el mismo enlace con una sesión nueva y tratar de leer una factura de la sesión anterior. Esperado: no ve la cuenta anterior ni la factura privada; solo su creador y el personal autorizado pueden leerla. Estado: sin ejecutar.

## Evidencia y cierre de fallos

Por recorrido registrar fecha, ejecutor, URL, commit desplegado, entorno, importe, referencias de prueba, resultado observado y evidencia sin secretos. Usar pasa, falla o bloqueado solo después de ejecutar; antes, sin ejecutar. Las pruebas unitarias del repo no acreditan estos recorridos.

Reportar un fallo reproducible por issue o en el PR responsable, con pasos exactos, esperado, observado, impacto y evidencia. Anotar su enlace; no decir que se reportó sin enlace. Reensayar sobre el commit que lo corrige. Los casos 14 a 16 también están sin ejecutar: no hay fallos observados todavía que comunicar como hechos.

## Ajustes tras las pruebas de Integración

El [PR #13](https://github.com/ribu-co/ribu/pull/13) confirmó en sandbox el rango de Factus Pay de $10.000 a $12.000.000, que reemplaza el rango publicado de $1.000 a $12.100.000 para estas pruebas. Toda cuenta o parte menor se registra en efectivo o tarjeta, sin dinero real. También confirmó INC, redondeo y notas con `cude`, pero no el recorrido completo de la app ni el pago del simulador.

Los cambios de importes y responsables siguen la [revisión de Juan Diego](https://github.com/ribu-co/ribu/pull/7#issuecomment-6637331388). Integración actualizó los roles: Andrés atiende Interfaz y Néstor Cobros. Los recorridos siguen sin ejecutar hasta contar con el despliegue y las sesiones de prueba.
