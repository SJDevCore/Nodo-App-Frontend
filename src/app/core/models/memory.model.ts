/** Recuerdo tal como lo devuelve la API. */
export interface Memory {
  id: string;
  title: string;
  /** URL de la imagen en Cloudinary. */
  imageUrl: string;
  lat: number | null;
  lng: number | null;
  /** Fecha ISO. */
  takenAt: string;
  author: { id: string; name: string };
  /** Viaje en el que se tomó, o null. */
  trip: { id: string; name: string } | null;
}

/** Recuerdo listo para mostrar. */
export interface MemoryView extends Memory {
  /** Versión pequeña de la imagen, para la cuadrícula. */
  thumbUrl: string;
  /** ¿La tomé yo? Solo el autor puede borrarla. */
  mine: boolean;
}

/** Foto recién tomada, antes de subirla. */
export interface CapturedPhoto {
  base64: string;
  format: string;
}
