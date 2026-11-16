import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircleOutline, logOutOutline, mailOutline, peopleOutline, timeOutline } from 'ionicons/icons';

import { AuthService } from '../../../../core/services/auth.service';
import { MemoriesService } from '../../../../core/services/memories.service';
import { TrackingService } from '../../../../core/services/tracking.service';
import { TripsService } from '../../../../core/services/trips.service';

const DATE_FORMAT = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  imports: [IonContent, IonIcon, IonSpinner],
})
export class ProfilePage {
  readonly auth = inject(AuthService);
  readonly trips = inject(TripsService);
  private readonly memories = inject(MemoriesService);
  private readonly tracking = inject(TrackingService);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly initial = computed(() => this.auth.user()?.name.charAt(0).toUpperCase() ?? '');

  /** Los tres números de la parte superior. */
  readonly stats = computed(() => {
    const myId = this.auth.user()?.id;
    const history = this.trips.history();

    // Personas distintas con las que he viajado (sin contarme).
    const companions = new Set<string>();
    for (const trip of history) {
      for (const member of trip.members) {
        if (member.userId !== myId) companions.add(member.userId);
      }
    }

    return {
      trips: history.length,
      // Solo las fotos que tomé yo, no todas las del grupo.
      photos: this.memories.mineCount(),
      companions: companions.size,
    };
  });

  /** Historial con los textos ya listos para mostrar. */
  readonly history = computed(() =>
    this.trips.history().map((trip) => ({
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      date: DATE_FORMAT.format(new Date(trip.endedAt ?? trip.createdAt)),
      members: trip.members.length,
      duration: trip.endedAt ? formatDuration(trip.createdAt, trip.endedAt) : null,
    })),
  );

  constructor() {
    addIcons({ alertCircleOutline, logOutOutline, mailOutline, peopleOutline, timeOutline });
  }

  /** Cada vez que se entra: el historial cambia al terminar un viaje. */
  async ionViewWillEnter(): Promise<void> {
    // allSettled: si falla el historial, las fotos igual se cuentan (y al revés).
    const [history] = await Promise.allSettled([this.trips.loadHistory(), this.memories.load()]);

    this.error.set(history.status === 'rejected' ? 'No se pudo cargar tu historial de viajes.' : null);
    this.loading.set(false);
  }

  async logout(): Promise<void> {
    if (this.busy()) return;

    const alert = await this.alertCtrl.create({
      header: '¿Cerrar sesión?',
      message: 'Dejarás de compartir tu ubicación con el grupo.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Cerrar sesión', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    this.busy.set(true);
    // El orden importa: primero se corta el tiempo real (aún con token),
    // luego se olvidan los datos en memoria y por último se borra la sesión.
    this.tracking.disconnect();
    this.trips.clear();
    this.memories.clear();
    await this.auth.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
    this.busy.set(false);
  }
}

/** Duración entre dos fechas ISO, en texto corto. */
function formatDuration(startIso: string, endIso: string): string {
  const minutes = Math.max(1, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 día' : `${days} días`;
}
