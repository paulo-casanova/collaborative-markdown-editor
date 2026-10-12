import { describe, it, expect } from 'vitest';
import { normalizeUser } from '../../src/api/auth';

describe('User Identity Normalization (Auth & Roles)', () => {
  it('correctly extracts identity and admin role from backend nested user response with is_admin', () => {
    const backendResponse = {
      user: {
        id: 'b98ac5dd-6eed-4571-a1f9-d5e660ead61b',
        username: 'alice',
        display_name: 'Alice Dev',
        avatar_color: '#3b82f6',
        is_admin: true,
      },
      effective_teams: ['team_alpha', 'team_leads'],
    };

    const identity = normalizeUser(backendResponse);

    expect(identity.user_id).toBe('b98ac5dd-6eed-4571-a1f9-d5e660ead61b');
    expect(identity.username).toBe('alice');
    expect(identity.display_name).toBe('Alice Dev');
    expect(identity.avatar_color).toBe('#3b82f6');
    expect(identity.is_system_admin).toBe(true);
    expect(identity.is_admin).toBe(true);
    expect(identity.effective_teams).toEqual(['team_alpha', 'team_leads']);
  });

  it('correctly maps non-admin role when is_admin is false', () => {
    const backendResponse = {
      user: {
        id: 'user-bob-uuid',
        username: 'bob',
        display_name: 'Bob Tester',
        avatar_color: '#10b981',
        is_admin: false,
      },
      effective_teams: [],
    };

    const identity = normalizeUser(backendResponse);

    expect(identity.username).toBe('bob');
    expect(identity.display_name).toBe('Bob Tester');
    expect(identity.is_system_admin).toBe(false);
    expect(identity.is_admin).toBe(false);
  });

  it('correctly handles flat payload with is_system_admin and user_id', () => {
    const flatPayload = {
      user_id: 'charlie-uuid',
      username: 'charlie',
      display_name: 'Charlie Admin',
      is_system_admin: true,
      effective_teams: ['root_admins'],
    };

    const identity = normalizeUser(flatPayload);

    expect(identity.user_id).toBe('charlie-uuid');
    expect(identity.username).toBe('charlie');
    expect(identity.display_name).toBe('Charlie Admin');
    expect(identity.is_system_admin).toBe(true);
    expect(identity.is_admin).toBe(true);
    expect(identity.effective_teams).toEqual(['root_admins']);
  });

  it('falls back to username when display_name is empty or omitted', () => {
    const minimalPayload = {
      user: {
        id: 'dan-uuid',
        username: 'dan_dev',
        avatar_color: '#ec4899',
        is_admin: false,
      },
    };

    const identity = normalizeUser(minimalPayload);

    expect(identity.username).toBe('dan_dev');
    expect(identity.display_name).toBe('dan_dev');
    expect(identity.avatar_color).toBe('#ec4899');
    expect(identity.is_system_admin).toBe(false);
  });

  it('defaults avatar color to #3b82f6 and is_system_admin to false on empty data', () => {
    const identity = normalizeUser({});

    expect(identity.username).toBe('');
    expect(identity.display_name).toBe('');
    expect(identity.avatar_color).toBe('#3b82f6');
    expect(identity.is_system_admin).toBe(false);
    expect(identity.is_admin).toBe(false);
    expect(identity.effective_teams).toEqual([]);
  });
});
