import type { Vehicle } from '../models/trip.model';

export interface VehicleInfo {
  value: Vehicle;
  label: string;
  emoji: string;
}

/** Vehículos disponibles, en el orden en que se muestran. */
export const VEHICLES: readonly VehicleInfo[] = [
  { value: 'car', label: 'Carro', emoji: '🚗' },
  { value: 'motorcycle', label: 'Moto', emoji: '🏍️' },
  { value: 'bicycle', label: 'Bicicleta', emoji: '🚲' },
];

export function vehicleInfo(vehicle: Vehicle): VehicleInfo {
  return VEHICLES.find((v) => v.value === vehicle) ?? VEHICLES[0];
}

const MEMBER_COLORS = ['#6B8AFF', '#FB923C', '#2DD4BF', '#F472B6', '#FACC15', '#A78BFA'];

/**
 * Color de un integrante según su posición en el viaje.
 * Lista y mapa usan esta misma función: cada persona conserva su color.
 */
export function memberColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}
