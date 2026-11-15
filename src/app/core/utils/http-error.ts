import { HttpErrorResponse } from '@angular/common/http';

/** Convierte cualquier error en un mensaje que se le puede mostrar al usuario. */
export function toFriendlyError(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) {
    return 'Ocurrió un error inesperado.';
  }

  // status 0: la petición no llegó (sin internet, servidor caído, CORS).
  if (err.status === 0) {
    return 'No hay conexión con el servidor. Revisa tu internet.';
  }

  // NestJS manda `message` como texto, o como arreglo si falla la validación.
  const message: unknown = err.error?.message;
  if (Array.isArray(message)) return message.join('. ');
  if (typeof message === 'string') return message;

  return 'No se pudo completar la acción. Intenta de nuevo.';
}
