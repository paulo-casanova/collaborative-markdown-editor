import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { fetchTags } from '../../../api/tags';

/**
 * Autocompletion source that triggers when user types '#' followed by tag characters,
 * querying the backend /api/v1/tags endpoint.
 */
export async function tagCompletionSource(
  context: CompletionContext
): Promise<CompletionResult | null> {
  // Matches '#' followed by tag characters (letters, numbers, hyphens, underscores, slashes)
  const match = context.matchBefore(/#[a-zA-Z0-9_\-\/]*/);
  if (!match) return null;

  // Do not autocomplete markdown headings:
  // Ensure the '#' is preceded by whitespace, start of line, or open punctuation
  if (match.from > 0) {
    const prevChar = context.state.doc.sliceString(match.from - 1, match.from);
    if (!/\s|[([{"'`]/.test(prevChar)) {
      return null;
    }
  }

  const query = match.text.slice(1);
  try {
    const tags = await fetchTags(query);
    if (!tags || tags.length === 0) return null;

    return {
      from: match.from,
      options: tags.map((t) => ({
        label: `#${t.tag}`,
        displayLabel: `#${t.tag}`,
        detail: `${t.document_count} doc${t.document_count === 1 ? '' : 's'}`,
        apply: `#${t.tag} `,
        boost: t.tag.toLowerCase().startsWith(query.toLowerCase()) ? 2 : 1,
      })),
      filter: false,
    };
  } catch {
    return null;
  }
}
