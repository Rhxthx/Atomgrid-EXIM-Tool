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
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: Role;
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  is_active?: boolean;
  new_password?: string;
}
