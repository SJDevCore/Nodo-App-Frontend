import {
  Component,
  type ElementRef,
  type OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Preferences } from '@capacitor/preferences';
import { IonContent, IonIcon, IonSpinner, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  cameraOutline,
  chevronDownOutline,
  chevronUpOutline,
  closeOutline,
  locateOutline,
  moonOutline,
  navigateOutline,
  sunnyOutline,
} from 'ionicons/icons';
import * as L from 'leaflet';

import type { LatLng } from '../../../../core/models/tracking.model';
import { AuthService } from '../../../../core/services/auth.service';
import { MemoriesService } from '../../../../core/services/memories.service';
import { TrackingService } from '../../../../core/services/tracking.service';
import { TripsService } from '../../../../core/services/trips.service';
import { memberColor, vehicleInfo } from '../../../../core/utils/trip-ui';

type MapTheme = 'dark' | 'light';

interface MemberView {
  userId: string;
  name: string;
  initial: string;
  color: string;
  emoji: string;
  vehicleLabel: string;
  isMe: boolean;
  /** Última posición conocida, o null si nunca la compartió. */
  position: LatLng | null;
  /** ¿Conectado ahora? Si es false y hay posición, es la última que se le conoció. */
  online: boolean;
  /** Texto de estado: "En línea", "Últ. vez hace 5 min", "Sin ubicación". */
  status: string;
}

interface RouteInfo {
  name: string;
  distance: string;
  duration: string;
}

interface OsrmResponse {
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
}

const BOGOTA: L.LatLngTuple = [4.711, -74.0721];
const ROUTE_REFRESH_MS = 10_000;
const CLOCK_MS = 30_000;
const THEME_KEY = 'map_theme';

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  styleUrls: ['./map.page.scss'],
  imports: [IonContent, IonIcon, IonSpinner],
})
export class MapPage implements OnDestroy {
  readonly trips = inject(TripsService);
  readonly tracking = inject(TrackingService);
  private readonly auth = inject(AuthService);
  private readonly memories = inject(MemoriesService);
  private readonly router = inject(Router);
  private readonly toastCtrl = inject(ToastController);

  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');

  // Objetos de Leaflet: viven fuera de Angular, no son signals.
  private map?: L.Map;
  private tiles?: L.TileLayer;
  private readonly markers = new Map<string, L.Marker>();
  /** Aspecto con el que se dibujó cada marcador, para saber cuándo redibujarlo. */
  private readonly markerLooks = new Map<string, string>();
  private routeLine?: L.Polyline;
  private centered = false;
  private lastRouteAt = 0;
  private themeLoaded = false;

  /**
   * Reloj: se actualiza cada 30 s para que los textos "hace X min" avancen solos.
   * Sin esto, el texto quedaría congelado hasta que llegara otra posición.
   */
  private readonly now = signal(Date.now());
  private readonly clock = setInterval(() => this.now.set(Date.now()), CLOCK_MS);

  readonly mapTheme = signal<MapTheme>('dark');
  readonly sheetOpen = signal(true);
  readonly saving = signal(false);
  readonly selectedId = signal<string | null>(null);
  readonly route = signal<RouteInfo | null>(null);
  readonly routeLoading = signal(false);
  readonly routeError = signal<string | null>(null);

  /**
   * Quiénes se pintan en el mapa.
   * Con viaje: todos los integrantes. Sin viaje: solo yo.
   */
  readonly members = computed<MemberView[]>(() => {
    const trip = this.trips.active();
    const user = this.auth.user();
    const mine = this.tracking.myPosition();

    if (!trip) {
      if (!user) return [];
      return [
        {
          userId: user.id,
          name: user.name,
          initial: user.name.charAt(0).toUpperCase(),
          color: memberColor(0),
          emoji: '📍',
          vehicleLabel: '',
          isMe: true,
          position: mine,
          online: mine !== null,
          status: mine ? 'En línea' : 'Buscando ubicación…',
        },
      ];
    }

    const positions = this.tracking.positions();
    const now = this.now();

    return trip.members.map((member, index) => {
      const isMe = member.userId === user?.id;
      const info = vehicleInfo(member.vehicle);
      const base = {
        userId: member.userId,
        name: member.name,
        initial: member.name.charAt(0).toUpperCase(),
        color: memberColor(index),
        emoji: info.emoji,
        vehicleLabel: info.label,
        isMe,
      };

      // La mía sale directo del GPS: no espera al servidor.
      if (isMe) {
        return {
          ...base,
          position: mine,
          online: mine !== null,
          status: mine ? 'En línea' : 'Buscando ubicación…',
        };
      }

      const live = positions.get(member.userId);
      if (!live) {
        return { ...base, position: null, online: false, status: 'Sin ubicación' };
      }
      return {
        ...base,
        position: { lat: live.lat, lng: live.lng },
        online: live.online,
        status: live.online ? 'En línea' : `Últ. vez ${timeAgo(live.at, now)}`,
      };
    });
  });

  readonly onlineCount = computed(() => this.members().filter((m) => m.online).length);

  constructor() {
    addIcons({
      cameraOutline,
      chevronDownOutline,
      chevronUpOutline,
      closeOutline,
      locateOutline,
      moonOutline,
      navigateOutline,
      sunnyOutline,
    });

    // Cada vez que cambian los integrantes o sus posiciones, se repinta el mapa.
    effect(() => {
      const members = this.members();
      untracked(() => this.renderMarkers(members));
    });

    // Si el viaje se termina (aquí o en la pestaña Viaje), se cierra el socket.
    // El GPS sigue: puedo verme en el mapa sin viaje.
    effect(() => {
      if (this.trips.active() === null) {
        untracked(() => {
          this.tracking.leaveTrip();
          this.clearRoute();
        });
      }
    });
  }

  /** Al entrar a la pestaña. El mapa necesita que el contenedor ya tenga tamaño. */
  async ionViewDidEnter(): Promise<void> {
    await this.loadTheme();
    this.initMap();
    this.map?.invalidateSize();

    // El GPS se enciende siempre, haya viaje o no.
    void this.tracking.startSharing();

    try {
      const trip = await this.trips.loadActive();
      if (trip) this.tracking.connect(trip.id);
    } catch {
      // Sin conexión: el mapa sigue visible y el aviso de reconexión lo indica.
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    this.map?.remove();
  }

  toggleSheet(): void {
    this.sheetOpen.update((open) => !open);
  }

  goToTrips(): void {
    void this.router.navigateByUrl('/tabs/trips');
  }

  centerOnMe(): void {
    const me = this.tracking.myPosition();
    if (me) this.map?.flyTo([me.lat, me.lng], 16, { duration: 0.6 });
  }

  /** Cambia el mapa entre oscuro y claro, y recuerda la elección. */
  toggleTheme(): void {
    const next: MapTheme = this.mapTheme() === 'dark' ? 'light' : 'dark';
    this.mapTheme.set(next);
    this.applyTheme();
    void Preferences.set({ key: THEME_KEY, value: next });
  }

  /** Toma una foto y la guarda como recuerdo con el lugar actual. */
  async takePhoto(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);

    let message: string | null = null;
    try {
      if (await this.memories.capture()) message = 'Recuerdo guardado';
    } catch {
      message = 'No se pudo guardar el recuerdo.';
    } finally {
      this.saving.set(false);
    }

    if (message) {
      const toast = await this.toastCtrl.create({ message, duration: 1800, position: 'top' });
      await toast.present();
    }
  }

  /**
   * Tocar un integrante: si soy yo, centra; si es otro, traza la ruta hasta él.
   * Si está desconectado, la ruta va hasta su última posición conocida.
   */
  async selectMember(member: MemberView): Promise<void> {
    if (member.isMe) {
      this.centerOnMe();
      return;
    }

    this.clearRoute();
    if (!member.position) {
      this.routeError.set(`${member.name} aún no comparte su ubicación.`);
      return;
    }

    this.selectedId.set(member.userId);
    await this.refreshRoute(true);
  }

  clearRoute(): void {
    this.selectedId.set(null);
    this.route.set(null);
    this.routeError.set(null);
    this.routeLine?.remove();
    this.routeLine = undefined;
  }

  // ---------- Mapa ----------

  private async loadTheme(): Promise<void> {
    if (this.themeLoaded) return;
    this.themeLoaded = true;
    const { value } = await Preferences.get({ key: THEME_KEY });
    if (value === 'light' || value === 'dark') this.mapTheme.set(value);
  }

  private initMap(): void {
    if (this.map) return;

    this.map = L.map(this.mapEl().nativeElement, { zoomControl: false }).setView(BOGOTA, 12);

    this.tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(this.map);

    this.applyTheme();
    this.renderMarkers(this.members());
  }

  /** El mapa oscuro es el mismo mapa claro con un filtro CSS (ver global.scss). */
  private applyTheme(): void {
    this.tiles?.getContainer()?.classList.toggle('nodo-tiles', this.mapTheme() === 'dark');
  }

  private renderMarkers(members: MemberView[]): void {
    const map = this.map;
    if (!map) return;

    const visible = new Set<string>();

    for (const member of members) {
      if (!member.position) continue;
      visible.add(member.userId);
      const latLng: L.LatLngTuple = [member.position.lat, member.position.lng];
      const look = `${member.color}|${member.emoji}|${member.initial}|${member.online}`;

      const existing = this.markers.get(member.userId);
      if (existing) {
        existing.setLatLng(latLng);
        // Si cambió el color, el vehículo o el estado de conexión, se redibuja.
        if (this.markerLooks.get(member.userId) !== look) {
          existing.setIcon(this.memberIcon(member));
          this.markerLooks.set(member.userId, look);
        }
        continue;
      }

      const marker = L.marker(latLng, {
        icon: this.memberIcon(member),
        zIndexOffset: member.isMe ? 1000 : 0,
      }).addTo(map);

      // El nombre va con textContent: nunca se interpreta como HTML.
      const label = document.createElement('span');
      label.textContent = member.isMe ? 'Tú' : member.name;
      marker.bindTooltip(label, { permanent: true, direction: 'bottom', offset: [0, 36], className: 'nodo-label' });

      // Se busca el integrante al momento del clic: sus datos pueden haber cambiado.
      const userId = member.userId;
      marker.on('click', () => {
        const current = this.members().find((m) => m.userId === userId);
        if (current) void this.selectMember(current);
      });

      this.markers.set(userId, marker);
      this.markerLooks.set(userId, look);
    }

    // Quita los marcadores de quienes ya no están en el viaje.
    for (const [userId, marker] of this.markers) {
      if (!visible.has(userId)) {
        marker.remove();
        this.markers.delete(userId);
        this.markerLooks.delete(userId);
      }
    }

    // La primera vez que llega mi posición, el mapa se centra en mí.
    const me = this.tracking.myPosition();
    if (me && !this.centered) {
      this.centered = true;
      map.setView([me.lat, me.lng], 15);
    }

    // Con una ruta activa, se recalcula cada cierto tiempo mientras nos movemos.
    if (this.selectedId() && Date.now() - this.lastRouteAt > ROUTE_REFRESH_MS) {
      void this.refreshRoute(false);
    }
  }

  private memberIcon(member: MemberView): L.DivIcon {
    const el = document.createElement('div');
    el.className = ['nodo-marker', member.isMe ? 'me' : '', member.online ? '' : 'offline'].filter(Boolean).join(' ');
    el.style.setProperty('--c', member.color);

    const initial = document.createElement('span');
    initial.textContent = member.initial;

    // Insignia con el vehículo, debajo de la letra.
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = member.emoji;

    el.append(initial, badge);
    return L.divIcon({ html: el.outerHTML, className: '', iconSize: [44, 44], iconAnchor: [22, 22] });
  }

  // ---------- Ruta ----------

  /** Pide a OSRM la ruta más corta por carretera entre mi posición y el integrante elegido. */
  private async refreshRoute(fit: boolean): Promise<void> {
    const id = this.selectedId();
    const me = this.tracking.myPosition();
    const target = this.members().find((m) => m.userId === id);

    if (!id || !target?.position) return;
    if (!me) {
      this.routeError.set('Aún no tenemos tu ubicación para trazar la ruta.');
      return;
    }

    this.lastRouteAt = Date.now();
    if (fit) this.routeLoading.set(true);

    try {
      // OSRM usa el orden longitud,latitud.
      const url =
        'https://router.project-osrm.org/route/v1/driving/' +
        `${me.lng},${me.lat};${target.position.lng},${target.position.lat}` +
        '?overview=full&geometries=geojson';

      const res = await fetch(url);
      if (!res.ok) throw new Error('OSRM');
      const data = (await res.json()) as OsrmResponse;
      const best = data.routes?.[0];
      if (!best) throw new Error('Sin ruta');

      // Si mientras tanto eligió a otro o quitó la ruta, esta respuesta ya no sirve.
      if (this.selectedId() !== id || !this.map) return;

      const points = best.geometry.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
      if (this.routeLine) {
        this.routeLine.setLatLngs(points);
      } else {
        this.routeLine = L.polyline(points, { color: '#6B8AFF', weight: 6, opacity: 0.9, lineCap: 'round' }).addTo(
          this.map,
        );
      }

      if (fit) {
        // Margen inferior grande: ahí está la hoja de integrantes.
        this.map.fitBounds(this.routeLine.getBounds(), {
          paddingTopLeft: [40, 80],
          paddingBottomRight: [40, 280],
        });
      }

      this.routeError.set(null);
      this.route.set({
        // Si está desconectado, se aclara que la ruta va a donde estuvo, no a donde está.
        name: target.online ? target.name : `la última ubicación de ${target.name}`,
        distance: formatDistance(best.distance),
        duration: formatDuration(best.duration),
      });
    } catch {
      if (fit) this.routeError.set('No se pudo calcular la ruta. Intenta de nuevo.');
    } finally {
      this.routeLoading.set(false);
    }
  }
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** "hace 5 min", "hace 2 h"… a partir de dos marcas de tiempo en milisegundos. */
function timeAgo(at: number, now: number): string {
  // max(0): el reloj del celular y el del servidor pueden diferir unos segundos.
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}
