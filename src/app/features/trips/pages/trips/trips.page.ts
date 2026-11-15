import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertController, IonContent, IonIcon, IonSpinner, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircleOutline, shareSocialOutline } from 'ionicons/icons';

import type { Vehicle } from '../../../../core/models/trip.model';
import { AuthService } from '../../../../core/services/auth.service';
import { TripsService } from '../../../../core/services/trips.service';
import { toFriendlyError } from '../../../../core/utils/http-error';
import { VEHICLES, memberColor, vehicleInfo } from '../../../../core/utils/trip-ui';

type Tab = 'create' | 'join';
type Field = 'name' | 'destination' | 'code';

// Mismo alfabeto del backend: sin I, L, O, 0 ni 1 para que no se confundan.
const CODE_PATTERN = /^[A-HJKMNP-Z2-9]{6}$/i;

@Component({
  selector: 'app-trips',
  templateUrl: './trips.page.html',
  styleUrls: ['./trips.page.scss'],
  imports: [ReactiveFormsModule, IonContent, IonIcon, IonSpinner],
})
export class TripsPage {
  readonly trips = inject(TripsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly vehicles = VEHICLES;

  readonly loading = signal(true); // primera carga
  readonly busy = signal(false); // una acción en curso
  readonly error = signal<string | null>(null);
  readonly tab = signal<Tab>('create');
  readonly vehicle = signal<Vehicle>('car');

  // Arranca en "crear": el nombre es obligatorio y el código no.
  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    destination: ['', [Validators.maxLength(60)]],
    code: [''],
  });

  /** Integrantes con lo que la plantilla necesita ya calculado. */
  readonly members = computed(() => {
    const trip = this.trips.active();
    if (!trip) return [];
    const myId = this.auth.user()?.id;

    return trip.members.map((member, index) => ({
      ...member,
      initial: member.name.charAt(0).toUpperCase(),
      color: memberColor(index),
      vehicleLabel: vehicleInfo(member.vehicle).label,
      isMe: member.userId === myId,
      isOwner: member.userId === trip.ownerId,
    }));
  });

  constructor() {
    addIcons({ alertCircleOutline, shareSocialOutline });
  }

  /** Cada vez que se entra a la pestaña: así la lista de integrantes se refresca. */
  async ionViewWillEnter(): Promise<void> {
    try {
      await this.trips.loadActive();
      this.error.set(null);
    } catch (err) {
      this.error.set(toFriendlyError(err));
    } finally {
      this.loading.set(false);
    }
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.error.set(null);

    const { name, code } = this.form.controls;
    name.setValidators(tab === 'create' ? [Validators.required] : []);
    code.setValidators(tab === 'join' ? [Validators.required, Validators.pattern(CODE_PATTERN)] : []);
    name.updateValueAndValidity();
    code.updateValueAndValidity();
    this.form.markAsUntouched();
  }

  invalid(field: Field): boolean {
    const control = this.form.controls[field];
    return control.touched && control.invalid;
  }

  async submit(): Promise<void> {
    if (this.busy()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { name, destination, code } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);

    try {
      if (this.tab() === 'create') {
        await this.trips.create(name, this.vehicle(), destination);
      } else {
        await this.trips.join(code, this.vehicle());
      }
      this.form.reset();
    } catch (err) {
      this.error.set(toFriendlyError(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Comparte el código; si el dispositivo no puede compartir, lo copia. */
  async shareCode(): Promise<void> {
    const trip = this.trips.active();
    if (!trip) return;
    const text = `Únete a mi viaje "${trip.name}" en Nodo con el código ${trip.code}`;

    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(trip.code);
      await this.toast('Código copiado');
    } catch {
      // El usuario canceló el diálogo de compartir: no es un error.
    }
  }

  goToMap(): void {
    void this.router.navigateByUrl('/tabs/map');
  }

  /** El creador termina el viaje para todos; un integrante solo sale. */
  async closeTrip(): Promise<void> {
    if (this.busy()) return;
    const owner = this.trips.isOwner();

    const confirmed = await this.confirm(
      owner ? '¿Terminar el viaje?' : '¿Salir del viaje?',
      owner ? 'Se cerrará para todos los integrantes.' : 'Dejarás de ver al grupo en el mapa.',
      owner ? 'Terminar' : 'Salir',
    );
    if (!confirmed) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      if (owner) {
        await this.trips.end();
      } else {
        await this.trips.leave();
      }
    } catch (err) {
      this.error.set(toFriendlyError(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async confirm(header: string, message: string, action: string): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: action, role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 1800, position: 'top' });
    await toast.present();
  }
}
