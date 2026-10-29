import { WorkspaceNode } from '../types/document';
import {
  fetchDocumentByPath,
  fetchWorkspaceTree,
  updateWorkspaceNodesCache,
  resolveWorkspaceRelativePath,
  findWorkspacePath,
} from '../api/documents';

/**
 * Strips leading hierarchical section numbers from a heading text, e.g.
 * "3. Whatever" -> "Whatever"
 * "1.2.3 Subheading" -> "Subheading"
 */
export function stripHeadingNumberPrefix(text: string): string {
  return text
    .replace(/^\s*(?:(?:\d+(?:\.\d+)*\.(?:[-_\s]+|$))|(?:\d+\.)+\d+(?:[-_\s]+|$))/, '')
    .trim();
}

/**
 * Converts heading text into a canonical URL-friendly slug.
 */
export function slugifyHeading(text: string, stripNumbers: boolean = false): string {
  const cleaned = stripNumbers
    ? stripHeadingNumberPrefix(text)
    : text;
  return cleaned
    .replace(/[*_`~[\]]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Checks whether a heading raw text matches a target heading reference (e.g. from [[#Whatever]] or [Link](#whatever)).
 * Matches both with and without leading section numbers (e.g. "3. Whatever" matches "#Whatever" and "#3. Whatever").
 */
export function matchesHeadingTarget(headingRawText: string, targetHeadingRef: string): boolean {
  let cleanRef = targetHeadingRef.replace(/^#+/, '').trim();
  try {
    cleanRef = decodeURIComponent(cleanRef);
  } catch {
    // ignore malformed URI sequence
  }
  cleanRef = cleanRef.replace(/^#+/, '').trim();
  if (!cleanRef) return false;

  const refLower = cleanRef.toLowerCase();
  const refSlug = slugifyHeading(cleanRef, false);
  const refStrippedSlug = slugifyHeading(cleanRef, true);

  const headingClean = headingRawText
    .replace(/\s+#+\s*$/, '')
    .replace(/\{#[^}]+\}\s*$/, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~[\]]/g, '')
    .trim();
  const headingLower = headingClean.toLowerCase();
  const headingStripped = stripHeadingNumberPrefix(headingClean);
  const headingStrippedLower = headingStripped.toLowerCase();

  const headingSlug = slugifyHeading(headingRawText, false);
  const headingStrippedSlug = slugifyHeading(headingRawText, true);

  return (
    headingLower === refLower ||
    headingStrippedLower === refLower ||
    headingLower === refSlug ||
    headingStrippedLower === refSlug ||
    headingSlug === cleanRef ||
    headingStrippedSlug === cleanRef ||
    (refSlug.length > 0 && (headingSlug === refSlug || headingStrippedSlug === refSlug)) ||
    (refStrippedSlug.length > 0 && (headingSlug === refStrippedSlug || headingStrippedSlug === refStrippedSlug))
  );
}

/**
 * Extracts all headings from a markdown document string (ignoring fenced code blocks).
 */
export function extractDocumentHeadings(markdown: string): Array<{
  level: number;
  rawText: string;
  strippedText: string;
  slug: string;
  strippedSlug: string;
  lineNumber: number;
  from: number;
  NumberPrefix: string;
}> {
  const lines = (markdown || '').split('\n');
  const results: Array<{
    level: number;
    rawText: string;
    strippedText: string;
    slug: string;
    strippedSlug: string;
    lineNumber: number;
    from: number;
    NumberPrefix: string;
  }> = [];

  const counters = [0, 0, 0, 0, 0, 0];
  let inCodeFence = false;
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      offset += line.length + 1;
      continue;
    }
    if (!inCodeFence) {
      const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (m) {
        const level = m[1].length;
        const rawText = m[2].trim();
        const strippedText = stripHeadingNumberPrefix(rawText) || rawText;
        counters[level - 1] += 1;
        for (let k = level; k < 6; k++) {
          counters[k] = 0;
        }
        // Build hierarchical number from highest non-zero level down to `level`
        let startIdx = 0;
        while (startIdx < level - 1 && counters[startIdx] === 0) {
          startIdx++;
        }
        const numParts: number[] = [];
        for (let k = startIdx; k < level; k++) {
          numParts.push(counters[k] || 1);
        }
        const numberPrefix = numParts.length === 1 ? `${numParts[0]}.` : `${numParts.join('.')}.`;

        results.push({
          level,
          rawText,
          strippedText,
          slug: slugifyHeading(rawText, false),
          strippedSlug: slugifyHeading(rawText, true),
          lineNumber: i + 1,
          from: offset,
          NumberPrefix: numberPrefix,
        });
      }
    }
    offset += line.length + 1;
  }

  return results;
}

// Global workspace & heading validation registry
let knownWorkspacePaths = new Set<string>();
let workspaceTreeLoaded = false;
let workspaceTreeLoading = false;
const remoteDocHeadingsCache = new Map<string, string[]>(); // normalized path -> raw heading texts
const remoteDocNegativeCache = new Set<string>();
const pendingDocFetches = new Set<string>();
const validationListeners = new Set<() => void>();

export function subscribeLinkValidation(listener: () => void): () => void {
  validationListeners.add(listener);
  return () => {
    validationListeners.delete(listener);
  };
}

function notifyValidationListeners() {
  validationListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

export function normalizeWorkspacePath(p: string): string {
  return (p || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

export function updateKnownWorkspaceNodes(nodes: WorkspaceNode[]) {
  updateWorkspaceNodesCache(nodes);
  const next = new Set<string>();
  for (const n of nodes) {
    const isBundle = Boolean(n.is_bundle && n.path.endsWith('.bundle'));
    if (!n.is_directory || isBundle) {
      const norm = normalizeWorkspacePath(n.path);
      next.add(norm);
      next.add(norm.toLowerCase());
      if (norm.toLowerCase().endsWith('.md')) {
        const withoutMd = norm.slice(0, -3);
        next.add(withoutMd);
        next.add(withoutMd.toLowerCase());
      }
      if (norm.toLowerCase().endsWith('.bundle')) {
        const withoutBundle = norm.slice(0, -7);
        next.add(withoutBundle);
        next.add(withoutBundle.toLowerCase());
      }
      // Also allow matching by basename if unique/obsidian-style
      const slashIdx = norm.lastIndexOf('/');
      const basename = slashIdx >= 0 ? norm.slice(slashIdx + 1) : norm;
      next.add(basename);
      next.add(basename.toLowerCase());
      if (basename.toLowerCase().endsWith('.md')) {
        const stem = basename.slice(0, -3);
        next.add(stem);
        next.add(stem.toLowerCase());
      }
      if (basename.toLowerCase().endsWith('.bundle')) {
        const stem = basename.slice(0, -7);
        next.add(stem);
        next.add(stem.toLowerCase());
      }
    }
  }
  knownWorkspacePaths = next;
  workspaceTreeLoaded = true;
  remoteDocNegativeCache.clear();
  notifyValidationListeners();
}

export function ensureWorkspaceTreeLoaded() {
  if (workspaceTreeLoaded || workspaceTreeLoading) return;
  workspaceTreeLoading = true;
  fetchWorkspaceTree()
    .then((nodes) => {
      updateKnownWorkspaceNodes(nodes);
    })
    .catch(() => {
      // ignore
    })
    .finally(() => {
      workspaceTreeLoading = false;
    });
}

export function updateCachedDocumentHeadings(path: string, markdown: string) {
  if (!path) return;
  const norm = normalizeWorkspacePath(path);
  const headings = extractDocumentHeadings(markdown).map((h) => h.rawText);
  remoteDocHeadingsCache.set(norm, headings);
  remoteDocHeadingsCache.set(norm.toLowerCase(), headings);
  if (norm.toLowerCase().endsWith('.md')) {
    const withoutMd = norm.slice(0, -3);
    remoteDocHeadingsCache.set(withoutMd, headings);
    remoteDocHeadingsCache.set(withoutMd.toLowerCase(), headings);
  }
  if (norm.toLowerCase().endsWith('.bundle')) {
    const withoutBundle = norm.slice(0, -7);
    remoteDocHeadingsCache.set(withoutBundle, headings);
    remoteDocHeadingsCache.set(withoutBundle.toLowerCase(), headings);
  }
  const slashIdx = norm.lastIndexOf('/');
  const basename = slashIdx >= 0 ? norm.slice(slashIdx + 1) : norm;
  remoteDocHeadingsCache.set(basename, headings);
  remoteDocHeadingsCache.set(basename.toLowerCase(), headings);
  if (basename.toLowerCase().endsWith('.md')) {
    const stem = basename.slice(0, -3);
    remoteDocHeadingsCache.set(stem, headings);
    remoteDocHeadingsCache.set(stem.toLowerCase(), headings);
  }
  if (basename.toLowerCase().endsWith('.bundle')) {
    const stem = basename.slice(0, -7);
    remoteDocHeadingsCache.set(stem, headings);
    remoteDocHeadingsCache.set(stem.toLowerCase(), headings);
  }
}

export function isExternalUrl(target: string): boolean {
  const trimmed = (target || '').trim();
  return /^(https?:\/\/|mailto:|tel:|ftp:\/\/)/i.test(trimmed);
}

/**
 * Validates an internal or external link target against the current document's markdown
 * and the workspace file tree.
 * Returns { valid: boolean } — if valid is false, the link is broken and should be rendered in red with a warning icon.
 */
export function validateLinkTarget(
  rawTarget: string,
  currentDocMarkdown?: string,
  currentDocPath?: string
): { valid: boolean; reason?: string } {
  const target = (rawTarget || '').trim();
  if (!target) {
    return { valid: false, reason: 'Empty link target' };
  }

  if (isExternalUrl(target)) {
    return { valid: true };
  }

  // Internal same-document heading link: #Heading
  if (target.startsWith('#')) {
    const headingRef = target.slice(1).trim();
    if (!headingRef) {
      return { valid: false, reason: 'Empty heading anchor' };
    }
    if (currentDocMarkdown === undefined) {
      return { valid: true };
    }
    const headings = extractDocumentHeadings(currentDocMarkdown);
    const found = headings.some((h) => matchesHeadingTarget(h.rawText, headingRef));
    return found ? { valid: true } : { valid: false, reason: `Heading "#${headingRef}" does not exist` };
  }

  // Split path and optional #heading anchor
  const hashIdx = target.indexOf('#');
  const rawFilePart = hashIdx >= 0 ? target.slice(0, hashIdx).trim() : target;
  const headingRef = hashIdx >= 0 ? target.slice(hashIdx + 1).trim() : '';

  const normFile = normalizeWorkspacePath(rawFilePart);
  if (!normFile) {
    return { valid: false, reason: 'Invalid file target' };
  }

  // If referencing current document explicitly
  if (currentDocPath) {
    const normCurrent = normalizeWorkspacePath(currentDocPath).toLowerCase();
    const currentSlash = normCurrent.lastIndexOf('/');
    const currentBasename = currentSlash >= 0 ? normCurrent.slice(currentSlash + 1) : normCurrent;
    let currentStem = currentBasename;
    if (currentStem.endsWith('.md')) currentStem = currentStem.slice(0, -3);
    else if (currentStem.endsWith('.bundle')) currentStem = currentStem.slice(0, -7);

    let normCurrentNoExt = normCurrent;
    if (normCurrentNoExt.endsWith('.md')) normCurrentNoExt = normCurrentNoExt.slice(0, -3);
    else if (normCurrentNoExt.endsWith('.bundle')) normCurrentNoExt = normCurrentNoExt.slice(0, -7);

    const relFile = resolveWorkspaceRelativePath(rawFilePart, currentDocPath).toLowerCase();
    const normFileLower = normFile.toLowerCase();

    const isCurrentDoc =
      normFileLower === normCurrent ||
      `${normFileLower}.md` === normCurrent ||
      `${normFileLower}.bundle` === normCurrent ||
      normFileLower === normCurrentNoExt ||
      relFile === normCurrent ||
      `${relFile}.md` === normCurrent ||
      `${relFile}.bundle` === normCurrent ||
      relFile === normCurrentNoExt ||
      normFileLower === currentBasename ||
      normFileLower === currentStem;

    if (isCurrentDoc) {
      if (!headingRef) return { valid: true };
      if (currentDocMarkdown === undefined) return { valid: true };
      const headings = extractDocumentHeadings(currentDocMarkdown);
      const found = headings.some((h) => matchesHeadingTarget(h.rawText, headingRef));
      return found ? { valid: true } : { valid: false, reason: `Heading "#${headingRef}" does not exist` };
    }
  }

  ensureWorkspaceTreeLoaded();

  const relFile = currentDocPath ? resolveWorkspaceRelativePath(rawFilePart, currentDocPath) : normFile;

  const candidates = [
    normFile,
    normFile.toLowerCase(),
    normFile.toLowerCase().endsWith('.md') ? normFile : `${normFile}.md`,
    normFile.toLowerCase().endsWith('.md') ? normFile.toLowerCase() : `${normFile.toLowerCase()}.md`,
    normFile.toLowerCase().endsWith('.bundle') ? normFile : `${normFile}.bundle`,
    normFile.toLowerCase().endsWith('.bundle') ? normFile.toLowerCase() : `${normFile.toLowerCase()}.bundle`,
    relFile,
    relFile.toLowerCase(),
    relFile.toLowerCase().endsWith('.md') ? relFile : `${relFile}.md`,
    relFile.toLowerCase().endsWith('.md') ? relFile.toLowerCase() : `${relFile.toLowerCase()}.md`,
    relFile.toLowerCase().endsWith('.bundle') ? relFile : `${relFile}.bundle`,
    relFile.toLowerCase().endsWith('.bundle') ? relFile.toLowerCase() : `${relFile.toLowerCase()}.bundle`,
  ];

  const resolvedPath = findWorkspacePath(rawFilePart, currentDocPath);
  if (resolvedPath) {
    const normResolved = normalizeWorkspacePath(resolvedPath);
    candidates.push(normResolved, normResolved.toLowerCase());
    const lastSlash = normResolved.lastIndexOf('/');
    const baseResolved = lastSlash >= 0 ? normResolved.slice(lastSlash + 1) : normResolved;
    candidates.push(baseResolved, baseResolved.toLowerCase());
  }

  // Check if file exists in workspace tree
  if (workspaceTreeLoaded) {
    const fileExists = candidates.some((c) => knownWorkspacePaths.has(c));
    if (!fileExists) {
      if (currentDocMarkdown && !headingRef) {
        const headings = extractDocumentHeadings(currentDocMarkdown);
        const matchesHeading = headings.some((h) => matchesHeadingTarget(h.rawText, rawFilePart));
        if (matchesHeading) {
          return { valid: true };
        }
      }
      return { valid: false, reason: `File "${rawFilePart}" does not exist` };
    }
  } else if (remoteDocNegativeCache.has(normFile.toLowerCase())) {
    if (currentDocMarkdown && !headingRef) {
      const headings = extractDocumentHeadings(currentDocMarkdown);
      const matchesHeading = headings.some((h) => matchesHeadingTarget(h.rawText, rawFilePart));
      if (matchesHeading) {
        return { valid: true };
      }
    }
    return { valid: false, reason: `File "${rawFilePart}" does not exist` };
  }

  // If there's also a #heading on a remote markdown or bundle file, check cached remote headings or fetch asynchronously
  if (headingRef) {
    const candidateKeys = [
      normFile,
      normFile.toLowerCase(),
      `${normFile}.md`,
      `${normFile.toLowerCase()}.md`,
      `${normFile}.bundle`,
      `${normFile.toLowerCase()}.bundle`,
    ];
    if (resolvedPath) {
      const normResolved = normalizeWorkspacePath(resolvedPath);
      candidateKeys.push(
        normResolved,
        normResolved.toLowerCase(),
        resolvedPath,
        resolvedPath.toLowerCase()
      );
      const slashIdx = normResolved.lastIndexOf('/');
      const baseResolved = slashIdx >= 0 ? normResolved.slice(slashIdx + 1) : normResolved;
      candidateKeys.push(baseResolved, baseResolved.toLowerCase());
    }

    let cachedHeadings: string[] | undefined;
    for (const key of candidateKeys) {
      cachedHeadings = remoteDocHeadingsCache.get(key);
      if (cachedHeadings) break;
    }

    if (cachedHeadings) {
      const found = cachedHeadings.some((rawH) => matchesHeadingTarget(rawH, headingRef));
      return found
        ? { valid: true }
        : { valid: false, reason: `Heading "#${headingRef}" not found in "${rawFilePart}"` };
    }

    // Trigger background fetch of remote document to validate its headings
    let fetchPath = resolvedPath || normFile;
    if (!fetchPath.toLowerCase().endsWith('.md') && !fetchPath.toLowerCase().endsWith('.bundle')) {
      fetchPath = `${fetchPath}.md`;
    }
    if (!pendingDocFetches.has(fetchPath.toLowerCase()) && !remoteDocNegativeCache.has(fetchPath.toLowerCase())) {
      pendingDocFetches.add(fetchPath.toLowerCase());
      fetchDocumentByPath(fetchPath)
        .then((doc) => {
          updateCachedDocumentHeadings(doc.path || fetchPath, doc.content || '');
          notifyValidationListeners();
        })
        .catch(() => {
          remoteDocNegativeCache.add(fetchPath.toLowerCase());
          remoteDocNegativeCache.add(normFile.toLowerCase());
          notifyValidationListeners();
        })
        .finally(() => {
          pendingDocFetches.delete(fetchPath.toLowerCase());
        });
    }
  } else if (!workspaceTreeLoaded) {
    // If tree isn't loaded yet, also probe the target path if not already probing
    let fetchPath = resolvedPath || normFile;
    if (!fetchPath.toLowerCase().endsWith('.md') && !fetchPath.toLowerCase().endsWith('.bundle') && !fetchPath.includes('.')) {
      fetchPath = `${fetchPath}.md`;
    }
    if (!pendingDocFetches.has(fetchPath.toLowerCase()) && !remoteDocNegativeCache.has(fetchPath.toLowerCase())) {
      pendingDocFetches.add(fetchPath.toLowerCase());
      fetchDocumentByPath(fetchPath)
        .then((doc) => {
          knownWorkspacePaths.add(normFile.toLowerCase());
          updateCachedDocumentHeadings(doc.path || fetchPath, doc.content || '');
          notifyValidationListeners();
        })
        .catch(() => {
          remoteDocNegativeCache.add(fetchPath.toLowerCase());
          remoteDocNegativeCache.add(normFile.toLowerCase());
          notifyValidationListeners();
        })
        .finally(() => {
          pendingDocFetches.delete(fetchPath.toLowerCase());
        });
    }
  }

  return { valid: true };
}
