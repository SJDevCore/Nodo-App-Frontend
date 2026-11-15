// src/app/core/services/auth.service.ts
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import type { LoginResponse, User } from '../models/user.model';

// Claves con las que se guarda la sesión en Preferences.
const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/auth`;

  // Estado privado: solo el servicio puede escribirlo.
  private readonly _user = signal<User | null>(null);
  private readonly _token = signal<string | null>(null);

  // Lo que ven las páginas: solo lectura.
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._token() !== null);

  /** Token actual. Lo usa el interceptor. */
  token(): string | null {
    return this._token();
  }

  /** Inicia sesión y guarda la sesión en el dispositivo. */
  async login(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(this.http.post<LoginResponse>(`${this.apiUrl}/login`, { email, password }));
    await this.setSession(res.accessToken, res.user);
  }

  /** Crea la cuenta y entra de una vez (el registro no devuelve token). */
  async register(name: string, email: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.apiUrl}/register`, { name, email, password }));
    await this.login(email, password);
  }

  /** Cierra sesión: borra lo guardado y limpia el estado. */
  async logout(): Promise<void> {
    await Promise.all([Preferences.remove({ key: TOKEN_KEY }), Preferences.remove({ key: USER_KEY })]);
    this._token.set(null);
    this._user.set(null);
  }

  /**
   * Restaura la sesión guardada. Se llama una vez al arrancar la app
   * (provideAppInitializer), antes de que corran los guards.
   */
  async loadSession(): Promise<void> {
    const [token, user] = await Promise.all([Preferences.get({ key: TOKEN_KEY }), Preferences.get({ key: USER_KEY })]);
    if (!token.value || !user.value) return;

    try {
      this._user.set(JSON.parse(user.value) as User);
      this._token.set(token.value);
    } catch {
      // Datos corruptos: mejor empezar sin sesión que arrancar roto.
      await this.logout();
    }
  }

  private async setSession(token: string, user: User): Promise<void> {
    await Promise.all([
      Preferences.set({ key: TOKEN_KEY, value: token }),
      Preferences.set({ key: USER_KEY, value: JSON.stringify(user) }),
    ]);
    this._token.set(token);
    this._user.set(user);
  }
}
