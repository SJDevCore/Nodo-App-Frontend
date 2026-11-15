// src/app/app.routes.ts
import type { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  // Pública: con sesión abierta, guestGuard manda a /tabs/map.
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/pages/login/login.page').then((m) => m.LoginPage),
  },

  // Zona autenticada: el guard en el padre protege las cuatro pestañas.
  {
    path: 'tabs',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'map',
        loadComponent: () => import('./features/map/pages/map/map.page').then((m) => m.MapPage),
      },
      {
        path: 'trips',
        loadComponent: () => import('./features/trips/pages/trips/trips.page').then((m) => m.TripsPage),
      },
      {
        path: 'memories',
        loadComponent: () => import('./features/memories/pages/memories/memories.page').then((m) => m.MemoriesPage),
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/pages/profile/profile.page').then((m) => m.ProfilePage),
      },
      // /tabs a secas → mapa
      { path: '', redirectTo: 'map', pathMatch: 'full' },
    ],
  },

  // Raíz → login. 'full' porque '' es prefijo de cualquier URL:
  // sin él, todas las rutas redirigirían aquí.
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  // Cualquier URL desconocida. Siempre la última: gana la primera que coincide.
  { path: '**', redirectTo: 'login' },
];
