import { Component, computed, inject, signal } from '@angular/core';
import { AlertController, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircleOutline, cameraOutline, locationOutline, trashOutline } from 'ionicons/icons';

import type { MemoryView } from '../../../../core/models/memory.model';
import { MemoriesService } from '../../../../core/services/memories.service';
import { toFriendlyError } from '../../../../core/utils/http-error';

interface Group {
  name: string;
  items: (MemoryView & { when: string; by: string })[];
}

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
  imports: [IonContent, IonIcon, IonSpinner],
})
export class MemoriesPage {
  private readonly memories = inject(MemoriesService);
  private readonly alertCtrl = inject(AlertController);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly total = computed(() => this.memories.items().length);

  /** Recuerdos agrupados por viaje, conservando el orden (más reciente primero). */
  readonly groups = computed<Group[]>(() => {
    const groups = new Map<string, Group>();

    for (const memory of this.memories.items()) {
      const name = memory.trip?.name ?? 'Sin viaje';
      const group = groups.get(name) ?? { name, items: [] };
      group.items.push({
        ...memory,
        when: DATE_FORMAT.format(new Date(memory.takenAt)),
        by: memory.mine ? 'por ti' : `por ${memory.author.name}`,
      });
      groups.set(name, group);
    }
    return [...groups.values()];
  });

  constructor() {
    addIcons({ alertCircleOutline, cameraOutline, locationOutline, trashOutline });
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
    } catch (err) {
      this.error.set(toFriendlyError(err));
    }
  }
}
