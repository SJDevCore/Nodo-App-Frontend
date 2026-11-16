/** Última posición conocida de un integrante, tal como la envía el servidor. */
export interface LivePosition {
  userId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  /** Fecha ISO en que el servidor la recibió. */
  at: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}
