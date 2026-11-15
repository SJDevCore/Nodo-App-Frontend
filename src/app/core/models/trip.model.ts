export type Vehicle = 'car' | 'motorcycle' | 'bicycle';
export type TripStatus = 'active' | 'ended';

export interface TripMember {
  userId: string;
  name: string;
  vehicle: Vehicle;
  /** Fecha ISO: por JSON llega como texto, no como Date. */
  joinedAt: string;
}

export interface Trip {
  id: string;
  name: string;
  destination?: string;
  /** Código de 6 caracteres para invitar. */
  code: string;
  ownerId: string;
  status: TripStatus;
  members: TripMember[];
  createdAt: string;
  endedAt?: string;
}
