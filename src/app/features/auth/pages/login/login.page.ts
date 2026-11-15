import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  arrowForwardOutline,
  chevronBackOutline,
  eyeOffOutline,
  eyeOutline,
  lockClosedOutline,
  mailOutline,
  personOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';

import { AuthService } from '../../../../core/services/auth.service';
import { toFriendlyError } from '../../../../core/utils/http-error';

type Mode = 'welcome' | 'login' | 'register';
type Field = 'name' | 'email' | 'password' | 'confirm';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [ReactiveFormsModule, IonContent, IonIcon, IonSpinner],
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  // Estado de la pantalla. Signals porque la app corre sin Zone.js.
  readonly mode = signal<Mode>('welcome');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly showPassword = signal(false);

  // Mismas reglas que el backend: así el error sale antes de enviar.
  readonly form = this.fb.nonNullable.group({
    name: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
    confirm: [''],
  });

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowForwardOutline,
      chevronBackOutline,
      eyeOffOutline,
      eyeOutline,
      lockClosedOutline,
      mailOutline,
      personOutline,
      shieldCheckmarkOutline,
    });
  }

  /** Cambia de vista y deja el formulario limpio de errores. */
  setMode(mode: Mode): void {
    this.mode.set(mode);
    this.error.set(null);
    this.showPassword.set(false);

    // Nombre y confirmación solo son obligatorios al registrarse.
    const extra = mode === 'register' ? [Validators.required] : [];
    const { name, confirm } = this.form.controls;
    name.setValidators(extra);
    confirm.setValidators(extra);
    name.updateValueAndValidity();
    confirm.updateValueAndValidity();

    this.form.markAsUntouched();
  }

  togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  /** ¿Mostrar el error de este campo? Solo si ya lo tocó y está mal. */
  invalid(field: Field): boolean {
    const control = this.form.controls[field];
    return control.touched && control.invalid;
  }

  async submit(): Promise<void> {
    if (this.loading()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { name, email, password, confirm } = this.form.getRawValue();
    const registering = this.mode() === 'register';

    if (registering && password !== confirm) {
      this.error.set('Las contraseñas no coinciden.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      if (registering) {
        await this.auth.register(name.trim(), email, password);
      } else {
        await this.auth.login(email, password);
      }
      // replaceUrl: el botón atrás no debe volver al login.
      await this.router.navigateByUrl('/tabs/map', { replaceUrl: true });
    } catch (err) {
      this.error.set(toFriendlyError(err));
    } finally {
      this.loading.set(false);
    }
  }
}
