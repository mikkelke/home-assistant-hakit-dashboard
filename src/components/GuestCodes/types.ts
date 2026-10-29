export type GuestRole = 'admin' | 'guests';
export interface GuestUser {
  user_id: string;
  name: string;
  slot: number | null;
  kind: 'always' | 'temporary' | 'recurring';
  from: string | null;
  to: string | null;
  status: 'active' | 'scheduled' | 'expired' | 'pending' | 'failed';
  last_use: string | null;
  created_by: string | null;
  protected?: boolean;
}
export interface Period {
  from?: string;
  to?: string;
}
