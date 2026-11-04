# Manual de uso

Cómo se usa Ribu, rol por rol, en https://ribu-co.web.app. Corre con las APIs de sandbox: no se mueve dinero real. El restaurante de la demo, Fogón del Manglar, es inventado.

**Las cuentas de demostración se entregan por privado.** Usa siempre datos inventados, porque el sandbox de Factus es público.

| Rol | Entra por | Llega a |
|---|---|---|
| Cliente | El link de la mesa, sin registrarse | `/m/<token>` |
| Mesero | `/personal` | `/mesero` |
| Cocina | `/personal` | `/cocina` |
| Administrador | `/personal` | `/admin` |
| Plataforma | `/plataforma` o `/personal` | `/plataforma` |

El rol sale de la cuenta, no de lo que se elija en la pantalla. Si alguien entra a una página que no es suya, Ribu se lo dice y le ofrece ir a la suya.

## Cliente en la mesa

### Pedir

1. Escanea el QR o acerca el celular al NFC del sticker. Se abre la página de la mesa, sin registro.
2. En **Carta**, toca un plato. Elige la cantidad y, si quieres, una nota para la cocina. Toca **Agregar**.
3. Toca **Ver productos** en la barra de abajo y luego **Enviar al mesero**.
4. En **Pedido** ves cada ronda y el estado de cada plato. Lo que el mesero rechace aparece con su motivo.

Todos los que abran el mismo link ven el mismo pedido, al instante. Lo agotado aparece como "Agotado por hoy" y no se puede elegir.

### Pagar

Solo se paga lo que el mesero ya confirmó.

1. En **Cuenta** ves consumo, pagado, en cobro y por pagar.
2. Elige qué pagar:
   - **Pagar**: todo lo que falta.
   - **Partes iguales**: de 2 a 20 personas, mientras cada parte alcance $10.000. Cada quien paga su parte desde su celular.
   - **Elegir productos**: solo lo tuyo.
3. Elige la propina. Es voluntaria, y nada viene marcado.
4. Elige a nombre de quién va la factura: **Consumidor final**, **Persona** o **Empresa**. El correo es opcional con consumidor final.
5. Toca **Generar cobro**. Aparecen el monto exacto, la llave Bre-B, el QR y el tiempo que queda: 10 minutos.
6. Paga. En el sandbox se paga con el simulador: ver [Pagar en el sandbox](#pagar-en-el-sandbox).

La pantalla se actualiza sola. Cuando entra el pago dice **Pago recibido**, y luego **Factura en camino**. Al terminar muestra número, CUFE, QR, enlace a la DIAN y **PDF**. Ahí mismo puedes escribir un correo para enviarla.

Solo quien creó el pago ve su factura. Los demás de la mesa ven que quedó pagado.

**Si algo cambia:**

| Mensaje | Qué significa |
|---|---|
| "Alguien de la mesa está pagando" | Otra persona tiene ese valor en cobro. Espera a que termine |
| "El QR venció" o "Cancelaste el cobro" | Lo que cubría quedó libre. Toca **Generar otro cobro** |
| "Recibimos tu pago, pero ya estaba cubierto" | Otra persona pagó lo mismo antes. El restaurante devuelve el dinero por fuera: muéstrale la pantalla al mesero |
| Total por fuera de $10.000 a $12.000.000 | Factus Pay no lo cobra. Se paga en efectivo o con tarjeta, con el mesero |

## Pagar en el sandbox

**Nunca uses una app de banco.** El reto solo permite el sandbox, y el pago se hace únicamente con el simulador.

1. Genera el cobro en la mesa y deja el QR a la vista.
2. En **otro dispositivo con cámara**, abre https://pay-api-sandbox.factus.com.co/simulator.
3. Escanea el QR con la cámara. El simulador solo funciona así, por eso se necesitan dos dispositivos.
4. Elige un resultado exitoso y confírmalo.
5. Vuelve a la mesa. La pantalla cambia sola a **Pago recibido**.

En las pruebas del 4 de noviembre de 2026, la factura se emitió unos 15 segundos después del pago.

## Mesero

Entra por `/personal`. En `/mesero` ve todas las mesas, con su estado: libre, por confirmar, para servir, en cobro, saldo o pagada. Arriba aparece la primera mesa con pedidos por confirmar.

Toca una mesa para abrirla, en `/mesero/<token>`.

**Confirmar lo que pidió el cliente**

- **Confirmar y enviar a cocina** confirma todo lo que está pendiente. También se puede **Confirmar** o **Rechazar** línea por línea. Rechazar pide un motivo.
- Al confirmar baja el stock y el plato llega a cocina. Sin confirmar, no llega.

**Tomar un pedido**

- **Tomar pedido** abre la página de la mesa con la sesión del mesero. **Enviar a cocina** lo manda directo, sin otra confirmación.

**Atender**

- Cuando la cocina marca un plato como listo, la mesa muestra "para servir". Toca **Entregada**.
- **Ya está lista** marca un plato como listo. **Anular** pide un motivo y devuelve el stock. No aparece si la línea ya está en un pago o en una división.

**Cobrar en efectivo o con tarjeta**

En la pestaña **Cuenta**, sin mover dinero real en la demo:

1. Elige **Cobrar todo**, **Por productos** o **Por partes**.
2. Elige el medio: efectivo, tarjeta débito o tarjeta crédito.
3. Elige la propina y el comprador.
4. Toca **Registrar**. El pago queda hecho y la factura se emite sola.

El cobro con QR de Factus Pay se hace desde el link de la mesa, y la pantalla tiene el enlace.

**Revisar un pago**

En **Pagos de la mesa**, toca un pago para ver su detalle. Puedes cancelar un cobro activo. Si la DIAN rechazó la factura, ves el motivo, corriges el comprador y tocas **Volver a emitir la factura**.

**Liberar la mesa**

**Liberar la mesa** se activa cuando no hay pedidos por confirmar, cobros activos ni saldo. Si falta algo, la pantalla dice qué. Al liberarla, la cuenta se cierra y el siguiente cliente no ve nada del anterior. Una factura en proceso no impide liberar.

## Cocina

Entra por `/personal`. En `/cocina` ve lo que falta por preparar, por mesa, con lo más antiguo primero. La cabecera resume cuánto hay por empezar, en preparación y esperando al mesero.

1. **Empezar** pasa el plato a preparación.
2. **Listo** lo deja para que el mesero lo entregue.

También se puede marcar **Listo** sin pasar por **Empezar**. Las notas del cliente aparecen en cada línea. Pagar no quita un plato de la cocina.

## Administrador

Entra por `/personal`. `/admin` tiene cinco pestañas. El administrador solo ve su restaurante. También puede abrir `/mesero` y `/cocina`.

**Resumen.** El dashboard, en vivo:

- Avisos: documentos rechazados, devoluciones pendientes y pagos duplicados. Cada uno lleva a Facturas.
- **Hoy** y **Periodo** (7 días, 30 días o este mes): ventas sin propina, pagos, ticket promedio, propinas e impuestos incluidos. "Hoy" es el día en Colombia.
- **Pagos por medio** y **Productos más vendidos**.
- **Facturación**: emitidas, en validación, rechazadas y notas.
- **Ahora en el salón**: mesas abiertas, por pagar, en cobro y agotados.

Un pago duplicado no cuenta como venta. Sin datos, muestra un mensaje y no un cero inventado.

**Productos.** **Nuevo producto**, editar y borrar. **Marcar agotado** saca un plato de la carta en el momento. El precio se escribe con impuesto incluido. Si lleva conteo, el stock baja solo al confirmar un pedido, y en 0 queda agotado.

**Personal.** **Crear cuenta** con nombre, correo, rol y clave inicial, que se comparte por privado. **Desactivar** le quita el acceso de una vez.

**Facturas.** Cada pago con su factura. El filtro **Por resolver** deja lo que necesita atención.

- En cada factura: copiar el CUFE, descargar el **PDF** y **Corregir y reintentar** si fue rechazada.
- **Emitir nota** crea una nota crédito o débito sobre una factura emitida.

| Nota | Conceptos | Qué pasa después |
|---|---|---|
| Crédito | Devolución parcial, anulación, rebaja, ajuste de precio | Queda con la devolución pendiente. Factus Pay no tiene reversos: el dinero se devuelve por fuera y se registra con **Registrar devolución** |
| Débito con Factus Pay | Intereses, gastos por cobrar, cambio de valor, otros | Muestra QR y llave. La nota se emite cuando entra el pago |
| Débito en efectivo o con tarjeta | Los mismos | Se emite de una vez |

Una factura no se puede acreditar por más de lo que queda. La nota no cambia la cuenta de la mesa.

**Mesas.** El link y el QR de cada mesa, para grabar el sticker. El link no cambia.

## Plataforma

Es quien administra Ribu. Entra por `/plataforma`, sin depender de un restaurante.

1. **Nuevo restaurante**: nombre, impuesto al consumo, propinas sugeridas y número de mesas. Al crearlo aparecen los links para los stickers.
2. **Links de mesas**: copiar los links, ver cada QR y agregar mesas. Los links existentes no cambian.
3. **Administrador**: crea la cuenta de quien lo va a gestionar.
4. **Desactivar**: el restaurante deja de recibir pedidos y pagos. Conserva su historia y se puede **Activar de nuevo**.

Para ver un restaurante por dentro, escribe `/admin/<id del restaurante>` en la dirección: el panel no tiene un enlace directo. Desde ahí ve el dashboard, consulta la carta, las facturas y las mesas, y gestiona el personal. No cambia la carta, no descarga PDF, no reintenta y no emite notas.

Crear un restaurante sin impuesto muestra un aviso, porque esa opción no se ha probado en el sandbox de Factus.

## Otras páginas

- `/`: portada, con el enlace para el personal.
- `/creditos`: autor, licencia y origen de cada foto, todas de Wikimedia Commons.

## Lo que no se puede probar en esta demo

- **Correo:** el sandbox responde 422 a direcciones no autorizadas. La factura queda bien y la pantalla dice que no se pudo enviar. Es una limitación del sandbox.
- **Pago con un banco real:** el reto lo prohíbe.
- **NFC e impresión del QR:** sin realizar, según [Pruebas físicas](pruebas-fisicas.md).
