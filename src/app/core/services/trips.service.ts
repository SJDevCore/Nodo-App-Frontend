import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import type { Trip, Vehicle } from '../models/trip.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class TripsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly apiUrl = `${environment.apiUrl}/trips`;

  // El viaje activo vive aquí porque lo usan varias pantallas: Viaje, Mapa y Perfil.
  private readonly _active = signal<Trip | null>(null);
  readonly active = this._active.asReadonly();

  private readonly _history = signal<Trip[]>([]);
  /** Viajes terminados, del más reciente al más antiguo. */
  readonly history = this._history.asReadonly();

  /** ¿El usuario actual creó el viaje activo? */
  readonly isOwner = computed(() => {
    const trip = this._active();
    const user = this.auth.user();
    return trip !== null && user !== null && trip.ownerId === user.id;
  });

  /** Consulta si el usuario ya está en un viaje. */
  async loadActive(): Promise<Trip | null> {
    try {
      const trip = await firstValueFrom(this.http.get<Trip>(`${this.apiUrl}/active`));
      this._active.set(trip);
      return trip;
    } catch (err) {
      // 404 no es un fallo: significa "no tienes viaje activo".
      if (err instanceof HttpErrorResponse && err.status === 404) {
        this._active.set(null);
        return null;
      }
      throw err;
    }
  }

  /** Carga los viajes terminados del usuario. */
  async loadHistory(): Promise<void> {
    const trips = await firstValueFrom(this.http.get<Trip[]>(`${this.apiUrl}/history`));
    this._history.set(trips);
  }

  async create(name: string, vehicle: Vehicle, destination?: string): Promise<Trip> {
    // El destino es opcional: si viene vacío no se envía,
    // porque el backend rechazaría una cadena vacía.
    const body = {
      name: name.trim(),
      vehicle,
      ...(destination?.trim() ? { destination: destination.trim() } : {}),
    };
    const trip = await firstValueFrom(this.http.post<Trip>(this.apiUrl, body));
    this._active.set(trip);
    return trip;
  }

  async join(code: string, vehicle: Vehicle): Promise<Trip> {
    const body = { code: code.trim().toUpperCase(), vehicle };
    const trip = await firstValueFrom(this.http.post<Trip>(`${this.apiUrl}/join`, body));
    this._active.set(trip);
    return trip;
  }

  /** Salir del viaje (integrante). El creador no puede: debe terminarlo. */
  async leave(): Promise<void> {
    const trip = this._active();
    if (!trip) return;
    await firstValueFrom(this.http.post<void>(`${this.apiUrl}/${trip.id}/leave`, {}));
    this._active.set(null);
  }

  /** Terminar el viaje para todos (solo el creador). */
  async end(): Promise<void> {
    const trip = this._active();
    if (!trip) return;
    await firstValueFrom(this.http.post(`${this.apiUrl}/${trip.id}/end`, {}));
    this._active.set(null);
  }

  /** Olvida los viajes en memoria. Se llama al cerrar sesión. */
  clear(): void {
    this._active.set(null);
    this._history.set([]);
  }
}
