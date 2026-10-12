export interface AdminUserTeam {
  id: string;
  name: string;
  role: 'member' | 'lead';
}

export interface AdminUser {
  id: string;
  user_id?: string;
  username: string;
  display_name: string;
  avatar_color: string;
  is_admin?: boolean;
  is_system_admin: boolean;
  created_at?: string;
  updated_at?: string;
  teams?: AdminUserTeam[];
}

export interface AdminTeam {
  id: string;
  name: string;
  description: string;
  created_at?: string;
}

export interface AdminTeamMember {
  team_id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_color?: string;
  role: 'member' | 'lead';
}

export interface CreateTeamPayload {
  name: string;
  description?: string;
}

export interface UpdateTeamPayload {
  name?: string;
  description?: string;
}

export interface AddMemberPayload {
  user_id?: string;
  username?: string;
  role?: 'member' | 'lead';
}
