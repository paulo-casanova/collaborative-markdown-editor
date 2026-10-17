export interface UserIdentity {
  user_id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  is_system_admin: boolean;
  is_admin?: boolean;
  id?: string;
  effective_teams?: string[];
  created_at?: string;
  authn_provider?: string;
  can_change_password?: boolean;
}

export interface UpdateProfileRequest {
  display_name?: string;
  avatar_color?: string;
  current_password?: string;
  new_password?: string;
}

export interface PatToken {
  id?: string;
  token_hash?: string;
  name?: string;
  token_prefix?: string;
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}

export interface AuthState {
  user: UserIdentity | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}
