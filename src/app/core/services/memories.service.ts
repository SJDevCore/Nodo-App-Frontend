import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { AlertController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import type { CapturedPhoto, Memory, MemoryView } from '../models/memory.model';
import type { LatLng } from '../models/tracking.model';
import { AuthService } from './auth.service';
import { TrackingService } from './tracking.service';

@Injectable({ providedIn: 'root' })
export class MemoriesService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly tracking = inject(TrackingService);
  private readonly alertCtrl = inject(AlertController);
  private readonly apiUrl = `${environment.apiUrl}/memories`;

  private readonly _items = signal<Memory[]>([]);

  /** Mis recuerdos y los de mis viajes, del más reciente al más antiguo. */
  readonly items = computed<MemoryView[]>(() => {
    const myId = this.auth.user()?.id;
    return this._items().map((memory) => ({
      ...memory,
      thumbUrl: thumbnail(memory.imageUrl),
      mine: memory.author.id === myId,
    }));
  });

  /** Cuántas fotos tomé yo (para el Perfil). */
  readonly mineCount = computed(() => this.items().filter((m) => m.mine).length);

  async load(): Promise<void> {
    const memories = await firstValueFrom(this.http.get<Memory[]>(this.apiUrl));
    this._items.set(memories);
  }

  /**
   * Flujo completo: foto → título → subir.
   * Devuelve true si se guardó y false si el usuario canceló en algún paso.
   * Si la subida falla, lanza el error para que la pantalla lo muestre.
   */
  async capture(): Promise<boolean> {
    let photo: CapturedPhoto | null;
    try {
      photo = await this.takePhoto();
    } catch {
      // Cerró la cámara sin tomar la foto: no es un error.
      return false;
    }
    if (!photo) return false;

    const title = await this.askTitle();
    if (title === null) return false;

    await this.upload(photo, title);
    return true;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${this.apiUrl}/${id}`));
    this._items.update((items) => items.filter((m) => m.id !== id));
  }

  /** Olvida los recuerdos en memoria. Se llama al cerrar sesión. */
  clear(): void {
    this._items.set([]);
  }

  // ---------- Pasos del flujo ----------

  /** Abre la cámara directamente. Lanza un error si el usuario cancela. */
  private async takePhoto(): Promise<CapturedPhoto | null> {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      // En el navegador no hay cámara nativa: usa el selector de archivos.
      webUseInput: true,
      // Tamaño y calidad moderados: sube rápido incluso con datos móviles.
      width: 1280,
      quality: 70,
    });

    if (!photo.base64String) return null;
    return { base64: photo.base64String, format: photo.format };
  }

  /** Pide el título. Devuelve null si el usuario cancela. */
  private async askTitle(): Promise<string | null> {
    const alert = await this.alertCtrl.create({
      header: 'Ponle un nombre',
      inputs: [{ name: 'title', type: 'text', placeholder: 'Ej. Mirador de Silvania', attributes: { maxlength: 40 } }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Guardar', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values?: { title?: string } }>();
    return role === 'confirm' ? (data?.values?.title ?? '') : null;
  }

  /** Envía la foto y sus datos como multipart/form-data. */
  private async upload(photo: CapturedPhoto, title: string): Promise<void> {
    const place = await this.currentPlace();

    const form = new FormData();
    // El nombre del campo ("photo") debe coincidir con el FileInterceptor del backend.
    form.append('photo', toBlob(photo), `recuerdo.${photo.format}`);
    if (title.trim()) form.append('title', title.trim());
    if (place) {
      form.append('lat', String(place.lat));
      form.append('lng', String(place.lng));
    }

    // Sin cabecera Content-Type: el navegador la pone sola, con el "boundary" correcto.
    const created = await firstValueFrom(this.http.post<Memory>(this.apiUrl, form));
    this._items.update((items) => [created, ...items]);
  }

  /** Usa la posición en vivo si existe; si no, le pregunta al GPS. */
  private async currentPlace(): Promise<LatLng | null> {
    const live = this.tracking.myPosition();
    if (live) return live;

    try {
      const { coords } = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8_000 });
      return { lat: coords.latitude, lng: coords.longitude };
    } catch {
      // Sin permiso o sin señal: el recuerdo se guarda sin lugar.
      return null;
    }
  }
}

/** Convierte el base64 de la cámara en un archivo binario para enviar. */
function toBlob(photo: CapturedPhoto): Blob {
  const bytes = Uint8Array.from(atob(photo.base64), (char) => char.charCodeAt(0));
  const type = photo.format === 'jpg' ? 'image/jpeg' : `image/${photo.format}`;
  return new Blob([bytes], { type });
}

/**
 * Cloudinary genera variantes de una imagen según la URL.
 * Aquí se pide una miniatura recortada, comprimida y en el mejor formato para el dispositivo.
 */
function thumbnail(url: string): string {
  return url.replace('/upload/', '/upload/c_fill,w_480,h_360,q_auto,f_auto/');
}
