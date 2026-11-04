# Ribu

Pedidos, pagos y facturación electrónica de un restaurante desde la mesa. Cada mesa tiene un sticker con NFC y QR que abren el mismo link. Desde ahí se pide, el mesero confirma, la cocina prepara, se paga con Factus Pay y la factura electrónica se emite con Factus v2.

Proyecto del Reto Factus, API WARS Montería.

## Integrantes

- Juan Diego Díaz Avendaño: Integración
- Elias David Vidal de la Rosa: Facturación
- Andrés Felipe Ortiz Rodríguez: Interfaz
- Néstor Junior Hernández López: Cobros
- Eddy Lans: Producto y pitch

## Cómo correrlo

```bash
npm install
npm run dev
```

Abre la dirección que muestra Vite. Para usar las APIs reales, copia `.env.example` a `.env` y pon las credenciales del sandbox.

- [AGENTS.md](AGENTS.md): reglas de trabajo y datos de las APIs.
- [contratos/README.md](contratos/README.md): cómo se comunican las piezas y las reglas de negocio.
