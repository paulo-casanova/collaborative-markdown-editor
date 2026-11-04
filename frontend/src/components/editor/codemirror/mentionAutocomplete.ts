import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { fetchMentionCandidates } from '../../../api/mentions';

/**
 * Autocompletion source that triggers when user types '@' in the editor,
 * querying the backend /api/v1/users/mention-candidates endpoint.
 */
export async function mentionCompletionSource(
  context: CompletionContext
): Promise<CompletionResult | null> {
  // Matches '@' followed by word characters, hyphens, periods, or empty string right after '@'
  const match = context.matchBefore(/@[\w.-]*/);
  if (!match) return null;

  // Do not autocomplete inside email addresses (e.g. user@domain.com)
  // Ensure the preceding character is whitespace, punctuation, or start of line
  if (match.from > 0) {
    const prevChar = context.state.doc.sliceString(match.from - 1, match.from);
    if (!/\s|[([{"'`]/.test(prevChar)) {
      return null;
    }
  }

  const query = match.text.slice(1);
  try {
    const candidates = await fetchMentionCandidates(query);
    if (!candidates || candidates.length === 0) return null;

    return {
      from: match.from,
      options: candidates.map((cand) => ({
        label: `@${cand.username}`,
        displayLabel:
          cand.display_name && cand.display_name !== cand.username
            ? `${cand.display_name} (@${cand.username})`
            : `@${cand.username}`,
        detail: cand.display_name !== cand.username ? cand.display_name : undefined,
        type: 'user',
        apply: `@${cand.username} `,
        boost: cand.username.toLowerCase().startsWith(query.toLowerCase()) ? 2 : 1,
      })),
      filter: false,
    };
  } catch {
    return null;
  }
}

/**
 * Creates the CodeMirror 6 autocompletion extension configured for @mentions.
 */
export function createMentionAutocompleteExtension() {
  return autocompletion({
    override: [mentionCompletionSource],
    defaultKeymap: true,
    icons: true,
  });
}
