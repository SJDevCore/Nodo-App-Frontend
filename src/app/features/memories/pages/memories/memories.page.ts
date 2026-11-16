import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonContent, IonIcon, IonModal, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircleOutline, cameraOutline, closeOutline, locationOutline, trashOutline } from 'ionicons/icons';

import type { MemoryView } from '../../../../core/models/memory.model';
import { MemoriesService } from '../../../../core/services/memories.service';
import { toFriendlyError } from '../../../../core/utils/http-error';

/** Recuerdo con los textos e imágenes que usa esta pantalla. */
type Item = MemoryView & { when: string; by: string; fullUrl: string };

interface Group {
  key: string;
  name: string;
  items: Item[];
}

const NO_TRIP = 'none';

const DATE_FORMAT = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

@Component({
  selector: 'app-memories',
  templateUrl: './memories.page.html',
  styleUrls: ['./memories.page.scss'],
  imports: [IonContent, IonIcon, IonModal, IonSpinner],
})
export class MemoriesPage {
  private readonly memories = inject(MemoriesService);
  private readonly alertCtrl = inject(AlertController);
  private readonly router = inject(Router);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** Foto abierta en grande, o null. */
  readonly selected = signal<Item | null>(null);

  /**
   * Filtro por viaje. Viene en la URL (?trip=<id>&name=<nombre>),
   * así Perfil puede abrir esta pantalla mostrando solo un viaje.
   */
  readonly tripFilter = computed(() => this.params()?.get('trip') ?? null);
  readonly tripFilterName = computed(() => this.params()?.get('name') ?? 'este viaje');

  private readonly items = computed<Item[]>(() =>
    this.memories.items().map((memory) => ({
      ...memory,
      when: DATE_FORMAT.format(new Date(memory.takenAt)),
      by: memory.mine ? 'por ti' : `por ${memory.author.name}`,
      // Versión grande para verla ampliada, comprimida por Cloudinary.
      fullUrl: memory.imageUrl.replace('/upload/', '/upload/c_limit,w_1600,q_auto,f_auto/'),
    })),
  );

  /** Recuerdos agrupados por viaje (más reciente primero), aplicando el filtro si lo hay. */
  readonly groups = computed<Group[]>(() => {
    const filter = this.tripFilter();
    const groups = new Map<string, Group>();

    for (const item of this.items()) {
      // Se agrupa por id y no por nombre: dos viajes pueden llamarse igual.
      const key = item.trip?.id ?? NO_TRIP;
      if (filter && key !== filter) continue;

      const group = groups.get(key) ?? { key, name: item.trip?.name ?? 'Sin viaje', items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  });

  readonly isEmpty = computed(() => this.groups().length === 0);

  constructor() {
    addIcons({ alertCircleOutline, cameraOutline, closeOutline, locationOutline, trashOutline });
  }

  /** Cada vez que se entra: el grupo puede haber subido fotos nuevas. */
  async ionViewWillEnter(): Promise<void> {
    try {
      await this.memories.load();
      this.error.set(null);
    } catch (err) {
      this.error.set(toFriendlyError(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Quita el filtro: vuelve a la misma pantalla sin parámetros. */
  clearFilter(): void {
    void this.router.navigate(['/tabs/memories']);
  }

  open(item: Item): void {
    this.selected.set(item);
  }

  close(): void {
    this.selected.set(null);
  }

  /** El flujo completo (foto → título → subir) vive en el servicio. */
  async add(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    try {
      await this.memories.capture();
    } catch (err) {
      this.error.set(toFriendlyError(err));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(memory: MemoryView): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: '¿Borrar este recuerdo?',
      message: `"${memory.title}" se eliminará para todo el grupo.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Borrar', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    try {
      await this.memories.remove(memory.id);
      this.close();
    } catch (err) {
      this.error.set(toFriendlyError(err));
    }
  }
}
