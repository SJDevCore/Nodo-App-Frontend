/** Última posición conocida de un integrante, tal como la envía el servidor. */
export interface LivePosition {
  userId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  /** Momento en que el servidor la recibió, en milisegundos. */
  at: number;
  /** ¿Está conectado ahora? Si es false, la posición es la última que se le conoció. */
  online: boolean;
}

export interface LatLng {
  lat: number;
  lng: number;
}
