const TRAZOS = {
  mas: 'M12 5v14M5 12h14',
  menos: 'M5 12h14',
  flecha: 'M7 17 17 7M8 7h9v9',
  derecha: 'm9 6 6 6-6 6',
  izquierda: 'm15 6-6 6 6 6',
  cerrar: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  copiar: 'M9 9h10v10H9zM5 15V5h10',
  reloj: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  bolsa: 'M6 8h12l-1 12H7L6 8ZM9 8V6a3 3 0 0 1 6 0v2',
  carta: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4ZM9 9h6M9 13h6',
  recibo: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6M9 16h3',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2',
  correo: 'M4 6h16v12H4zM4 7l8 6 8-6',
  descarga: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  alerta: 'M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  nota: 'M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4',
  mesa: 'M4 9h16M6 9v10M18 9v10M8 5h8',
  fuego: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1.5 1 2.2 2.4 2.5 4C13 8 13 5 12 3Z',
  persona: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  salir: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  dividir: 'M12 3v18M5 8l-2 4 2 4M19 8l2 4-2 4',
  tienda: 'M4 10h16l-1-5H5l-1 5ZM5 10v10h14V10M9 20v-5h6v5',
  caja: 'M3 7h18v13H3zM3 11h18M8 4h8v3',
  actualizar: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm5 13.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4ZM17.4 6.6h.01',
  ubicacion: 'M12 21s-6.5-6.4-6.5-11a6.5 6.5 0 0 1 13 0c0 4.6-6.5 11-6.5 11Zm0-8.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z',
} as const

export type NombreIcono = keyof typeof TRAZOS

export function Icono({ nombre, tamano = 20, grosor = 2 }: { nombre: NombreIcono; tamano?: number; grosor?: number }) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={grosor}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={TRAZOS[nombre]} />
    </svg>
  )
}
