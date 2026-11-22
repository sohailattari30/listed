export type Id = string | number;
export type Outcome = 'sell' | 'vm' | 'no' | 'skip';
export const CONTACT_STATUSES = ['Hot lead', 'Callback', 'Long-term', 'Met in person'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export type UserRow = {
  id: string;
  name: string | null;
  zip: string | null;
  city: string | null;
};
export type HomeownerRow = {
  id: Id;
  address: string;
  owner_name: string;
  years_owned: number;
  zip: string;
};
export type CallRow = {
  user_id: string;
  homeowner_id: Id;
  outcome: Outcome;
};
export type SessionRow = {
  user_id: string;
  calls_made: number;
  hot_leads: number;
  session_date: string;
};
export type ContactRow = {
  id: Id;
  user_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  status: ContactStatus | string;
  created_at: string;
};

type Table<Row, Insert = Row, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      users: Table<UserRow>;
      homeowners: Table<HomeownerRow>;
      calls: Table<CallRow>;
      sessions: Table<SessionRow>;
      contacts: Table<ContactRow, Omit<ContactRow, 'id' | 'created_at'>>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
