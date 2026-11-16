import { Injectable, inject, signal } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { io, type Socket } from 'socket.io-client';

import { environment } from '../../../environments/environment';
import type { LatLng, LivePosition } from '../models/tracking.model';
import { AuthService } from './auth.service';

interface JoinAck {
  ok: boolean;
  positions?: LivePosition[];
  message?: string;
}

type OutgoingPosition = Pick<LivePosition, 'lat' | 'lng' | 'heading' | 'speed'>;

const HEARTBEAT_MS = 15_000; // reenvío aunque no te muevas
const MIN_SEND_MS = 2_000; // no enviar más de una posición cada 2 s

@Injectable({ providedIn: 'root' })
export class TrackingService {
  private readonly auth = inject(AuthService);

  private socket: Socket | null = null;
  private tripId: string | null = null;
  private watchId: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  // El servidor descarta posiciones de quien aún no entró a la sala.
  // Por eso no se envía nada hasta recibir el ack de trip:join.
  private joined = false;
  private lastPosition: OutgoingPosition | null = null;
  private lastSent = 0;

  private readonly _positions = signal<ReadonlyMap<string, LivePosition>>(new Map());
  private readonly _myPosition = signal<LatLng | null>(null);
  private readonly _connected = signal(false);
  private readonly _error = signal<string | null>(null);

  /** Posiciones de los integrantes, por userId. */
  readonly positions = this._positions.asReadonly();
  /** Mi propia posición, directa del GPS (no espera al servidor). */
  readonly myPosition = this._myPosition.asReadonly();
  readonly connected = this._connected.asReadonly();
  readonly error = this._error.asReadonly();

  // ---------- GPS: funciona con o sin viaje ----------

  /** Empieza a leer el GPS. Si hay un viaje conectado, además comparte la posición. */
  async startSharing(): Promise<void> {
    if (this.watchId) return;

    try {
      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
        (position, err) => {
          if (err || !position) {
            this._error.set('No se pudo obtener tu ubicación. Revisa los permisos.');
            return;
          }
          const { latitude, longitude, heading, speed } = position.coords;
          this.lastPosition = { lat: latitude, lng: longitude, heading, speed };
          this._myPosition.set({ lat: latitude, lng: longitude });
          this._error.set(null);
          this.sendLastPosition(false);
        },
      );
    } catch {
      this._error.set('Activa el permiso de ubicación para verte en el mapa.');
    }
  }

  // ---------- Viaje: socket ----------

  /** Abre el socket y entra a la sala del viaje. Llamarlo dos veces no duplica nada. */
  connect(tripId: string): void {
    if (this.socket && this.tripId === tripId) return;
    this.leaveTrip();
    this.tripId = tripId;

    // CONTRATO 1: el token viaja en handshake.auth.token
    const socket = io(`${environment.wsUrl}/tracking`, {
      auth: { token: this.auth.token() },
      transports: ['websocket'],
    });
    this.socket = socket;

    // 'connect' también se dispara en cada reconexión: se vuelve a entrar a la sala.
    socket.on('connect', () => {
      this._connected.set(true);
      this._error.set(null);
      this.joinRoom();
    });

    socket.on('disconnect', () => {
      this._connected.set(false);
      this.joined = false;
    });

    socket.on('connect_error', () => {
      this._connected.set(false);
      this._error.set('No se pudo conectar con el servidor en vivo.');
    });

    socket.on('location:updated', (position: LivePosition) => {
      this._positions.update((current) => new Map(current).set(position.userId, position));
    });

    // CONTRATO 4: member:offline llega como { userId }
    socket.on('member:offline', ({ userId }: { userId: string }) => {
      this._positions.update((current) => {
        const next = new Map(current);
        next.delete(userId);
        return next;
      });
    });

    this.heartbeat = setInterval(() => this.sendLastPosition(true), HEARTBEAT_MS);
  }

  /** Sale del viaje en vivo: cierra el socket pero el GPS sigue encendido. */
  leaveTrip(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.tripId = null;
    this.joined = false;
    this.lastSent = 0;
    this._positions.set(new Map());
    this._connected.set(false);
    this._error.set(null);
  }

  /** Apaga todo: socket y GPS. Se usa al cerrar sesión. */
  disconnect(): void {
    this.leaveTrip();

    if (this.watchId) {
      void Geolocation.clearWatch({ id: this.watchId });
      this.watchId = null;
    }
    this.lastPosition = null;
    this._myPosition.set(null);
  }

  private joinRoom(): void {
    if (!this.socket || !this.tripId) return;

    // CONTRATO 2: trip:join recibe { tripId } y responde { ok, positions }
    this.socket.emit('trip:join', { tripId: this.tripId }, (ack: JoinAck) => {
      if (!ack?.ok) {
        this._error.set(ack?.message ?? 'No se pudo entrar al viaje en vivo.');
        return;
      }
      this.joined = true;
      this._positions.set(new Map((ack.positions ?? []).map((p) => [p.userId, p])));
      // Ya dentro de la sala: ahora sí se envía la posición que estaba esperando.
      this.sendLastPosition(true);
    });
  }

  private sendLastPosition(force: boolean): void {
    if (!this.socket?.connected || !this.joined || !this.lastPosition) return;

    const now = Date.now();
    if (!force && now - this.lastSent < MIN_SEND_MS) return;
    this.lastSent = now;

    // CONTRATO 3: location:update recibe { lat, lng, heading, speed }
    this.socket.emit('location:update', this.lastPosition);
  }
}
