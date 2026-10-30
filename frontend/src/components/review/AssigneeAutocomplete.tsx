import React, { useState, useRef, useEffect, useMemo } from 'react';
import { User, Check, X, Search, UserCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchCurrentUser } from '../../api/auth';
import { fetchAssignablePrincipals } from '../../api/permissions';

export interface UserOption {
  id: string;
  username: string;
  display_name?: string;
  avatar_color?: string;
}

interface AssigneeAutocompleteProps {
  value: string; // The assignee ID or empty string for unassigned
  onChange: (userId: string, user?: UserOption) => void;
  collaborators?: UserOption[];
  testId?: string;
  placeholder?: string;
  initialUser?: UserOption | null;
}

const AVATAR_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f97316', // orange
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#6366f1', // indigo
  '#14b8a6', // teal
];

function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export const AssigneeAutocomplete: React.FC<AssigneeAutocompleteProps> = ({
  value,
  onChange,
  collaborators = [],
  testId = 'task-assignee-select',
  placeholder = 'Type to search user or @username...',
  initialUser,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // 1. Fetch current logged-in user
  const { data: currentUser } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    staleTime: 60000,
  });

  // 2. Fetch all assignable principals (users) from workspace API
  const { data: principals } = useQuery({
    queryKey: ['workspace-principals'],
    queryFn: fetchAssignablePrincipals,
    staleTime: 60000,
  });

  // 3. Combine & deduplicate available users
  const allUsers = useMemo<UserOption[]>(() => {
    const map = new Map<string, UserOption>();

    if (currentUser?.user_id) {
      map.set(currentUser.user_id, {
        id: currentUser.user_id,
        username: currentUser.username,
        display_name: currentUser.display_name || currentUser.username,
        avatar_color: currentUser.avatar_color,
      });
    }

    if (initialUser?.id) {
      map.set(initialUser.id, initialUser);
    }

    for (const c of collaborators) {
      if (c.id && !map.has(c.id)) {
        map.set(c.id, {
          id: c.id,
          username: c.username,
          display_name: c.display_name || c.username,
          avatar_color: c.avatar_color,
        });
      }
    }

    if (principals?.users) {
      for (const u of principals.users) {
        if (u.id && !map.has(u.id)) {
          map.set(u.id, {
            id: u.id,
            username: u.username,
            display_name: u.display_name || u.username,
          });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      (a.display_name || a.username).localeCompare(b.display_name || b.username)
    );
  }, [currentUser, initialUser, collaborators, principals?.users]);

  // Find currently selected user object
  const selectedUser = useMemo(() => {
    if (!value) return null;
    return allUsers.find((u) => u.id === value) || (initialUser?.id === value ? initialUser : null);
  }, [value, allUsers, initialUser]);

  // Filter items based on user search term
  const filteredUsers = useMemo(() => {
    const raw = searchTerm.trim().toLowerCase();
    const query = raw.startsWith('@') ? raw.slice(1) : raw;

    if (!query) {
      return allUsers;
    }

    return allUsers.filter((u) => {
      const uName = (u.username || '').toLowerCase();
      const dName = (u.display_name || '').toLowerCase();
      return uName.includes(query) || dName.includes(query);
    });
  }, [searchTerm, allUsers]);

  // Synchronize input text with selected user when closed
  useEffect(() => {
    if (!isOpen) {
      if (selectedUser) {
        setSearchTerm(selectedUser.display_name || selectedUser.username);
      } else {
        setSearchTerm('');
      }
    }
  }, [isOpen, selectedUser]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset highlight index when results change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredUsers.length, isOpen]);

  // Scroll active item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.children[highlightedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleSelectUser = (user: UserOption | null) => {
    if (!user) {
      onChange('', undefined);
      setSearchTerm('');
    } else {
      onChange(user.id, user);
      setSearchTerm(user.display_name || user.username);
    }
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        setIsOpen(true);
      }
      return;
    }

    // Total options = 1 (Unassigned) + (currentUser if available? already in filteredUsers) + filteredUsers
    const totalOptions = 1 + filteredUsers.length;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % totalOptions);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + totalOptions) % totalOptions);
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        if (highlightedIndex === 0) {
          handleSelectUser(null); // Unassigned
        } else {
          const chosen = filteredUsers[highlightedIndex - 1];
          if (chosen) handleSelectUser(chosen);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Hidden select for backwards compatibility with tests / forms */}
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => {
          const found = allUsers.find((u) => u.id === e.target.value);
          handleSelectUser(found || null);
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      >
        <option value="">Unassigned</option>
        {allUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name || u.username} (@{u.username})
          </option>
        ))}
      </select>

      {/* Main Autocomplete Input */}
      <div className="relative flex items-center">
        <div className="absolute left-2.5 flex items-center pointer-events-none text-cme-text-muted">
          {selectedUser ? (
            <span
              className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white uppercase shadow-xs shrink-0"
              style={{
                backgroundColor:
                  selectedUser.avatar_color || getAvatarColor(selectedUser.username),
              }}
            >
              {(selectedUser.display_name || selectedUser.username).slice(0, 1)}
            </span>
          ) : (
            <User className="w-3.5 h-3.5" />
          )}
        </div>

        <input
          ref={inputRef}
          type="text"
          data-testid={`${testId}-input`}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            // Auto-select text for easy typing over existing user
            inputRef.current?.select();
          }}
          onKeyDown={handleKeyDown}
          placeholder={selectedUser ? `${selectedUser.display_name} (@${selectedUser.username})` : placeholder}
          className="w-full pl-8 pr-7 py-1.5 text-xs bg-cme-bg-elevated border border-cme-border-base rounded-lg text-cme-text-base placeholder-cme-text-muted focus:outline-hidden focus:border-cme-primary focus:ring-1 focus:ring-cme-primary transition-all"
        />

        {/* Clear / Unassign Button */}
        {value ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectUser(null);
              inputRef.current?.focus();
            }}
            className="absolute right-2 p-0.5 rounded text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
            title="Clear assignee"
            data-testid={`${testId}-clear-btn`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div className="absolute right-2.5 pointer-events-none text-cme-text-muted opacity-60">
            <Search className="w-3 h-3" />
          </div>
        )}
      </div>

      {/* Autocomplete Code-Completion Dropdown */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl border border-cme-border-base bg-cme-bg-surface shadow-2xl animate-in fade-in zoom-in-95 duration-100 divide-y divide-cme-border-base/40">
          {/* Quick Action: Assign to Me */}
          {currentUser && currentUser.user_id !== value && (
            <div className="p-1 bg-cme-bg-subtle/50">
              <button
                type="button"
                onClick={() =>
                  handleSelectUser({
                    id: currentUser.user_id,
                    username: currentUser.username,
                    display_name: currentUser.display_name || currentUser.username,
                    avatar_color: currentUser.avatar_color,
                  })
                }
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-cme-primary hover:bg-cme-primary/10 transition-colors text-left"
                data-testid={`${testId}-assign-me-btn`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Assign to me (@{currentUser.username})</span>
              </button>
            </div>
          )}

          <ul ref={listRef} className="p-1 space-y-0.5">
            {/* 1. Unassigned Option */}
            <li
              role="option"
              aria-selected={!value}
              onClick={() => handleSelectUser(null)}
              onMouseEnter={() => setHighlightedIndex(0)}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                highlightedIndex === 0
                  ? 'bg-cme-primary/15 text-cme-text-base'
                  : 'text-cme-text-muted hover:bg-cme-bg-hover hover:text-cme-text-base'
              }`}
              data-testid={`${testId}-option-unassigned`}
            >
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border border-dashed border-cme-border-base flex items-center justify-center text-[9px] text-cme-text-muted">
                  -
                </div>
                <span className="italic">Unassigned</span>
              </div>
              {!value && <Check className="w-3.5 h-3.5 text-cme-primary" />}
            </li>

            {/* 2. Filtered User Options */}
            {filteredUsers.length > 0 ? (
              filteredUsers.map((user, idx) => {
                const isSelected = user.id === value;
                const isHighlighted = highlightedIndex === idx + 1;
                const initials = (user.display_name || user.username).slice(0, 2).toUpperCase();
                const color = user.avatar_color || getAvatarColor(user.username);

                return (
                  <li
                    key={user.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectUser(user)}
                    onMouseEnter={() => setHighlightedIndex(idx + 1)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                      isHighlighted
                        ? 'bg-cme-primary/15 text-cme-text-base'
                        : 'text-cme-text-base hover:bg-cme-bg-hover'
                    }`}
                    data-testid={`${testId}-option-${user.username}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 shadow-2xs"
                        style={{ backgroundColor: color }}
                      >
                        {initials}
                      </span>
                      <div className="truncate flex items-baseline gap-1.5">
                        <span className="font-medium text-cme-text-base truncate">
                          {user.display_name || user.username}
                        </span>
                        <span className="text-[10px] text-cme-text-muted truncate">
                          @{user.username}
                        </span>
                      </div>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-cme-primary shrink-0 ml-1.5" />}
                  </li>
                );
              })
            ) : (
              <li className="px-3 py-2 text-xs text-cme-text-muted italic text-center">
                No matching users found
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
