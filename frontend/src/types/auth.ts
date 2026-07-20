export type Role = "admin" | "user";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login?: string | null;
  /** Downloads/day for this user; null = use global default, 0 = blocked. */
  daily_export_limit?: number | null;
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: Role;
  daily_export_limit?: number | null;
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  is_active?: boolean;
  new_password?: string;
  daily_export_limit?: number | null;
}

/** Current user's daily export quota (from /auth/me/quota). */
export interface ExportQuota {
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  resets_at: string;
}
