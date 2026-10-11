import { Extension } from '@tiptap/core';
import { defaultSelectionBuilder, yCursorPlugin } from '@tiptap/y-tiptap';
import { Awareness } from 'y-protocols/awareness';

export interface CursorUserData {
  name: string;
  color: string;
}

export interface CollaborationCursorOptions {
  provider: { awareness: Awareness } | null;
  user: CursorUserData;
  render?: (user: CursorUserData) => HTMLElement;
}

export const CollaborationCursor = Extension.create<CollaborationCursorOptions>({
  name: 'collaborationCursor',

  addOptions() {
    return {
      provider: null,
      user: {
        name: 'Anonymous',
        color: '#3b82f6',
      },
      render: (user: CursorUserData) => {
        const cursor = document.createElement('span');
        cursor.classList.add('collaboration-cursor__caret');
        cursor.setAttribute('style', `border-color: ${user.color}`);

        const label = document.createElement('div');
        label.classList.add('collaboration-cursor__label');
        label.setAttribute('style', `background-color: ${user.color}`);
        label.insertBefore(document.createTextNode(user.name), null);

        cursor.insertBefore(label, null);
        return cursor;
      },
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.provider?.awareness) {
      return [];
    }

    const awareness = this.options.provider.awareness;
    awareness.setLocalStateField('user', this.options.user);

    return [
      yCursorPlugin(awareness, {
        cursorBuilder: this.options.render,
        selectionBuilder: defaultSelectionBuilder,
      }),
    ];
  },
});
