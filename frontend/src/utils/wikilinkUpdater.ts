/**
 * Rewrites Obsidian-style wikilinks in markdown content targeting an old document path/stem to the new path/stem.
 * Skips code blocks and inline code spans. Preserves anchors, labels, and embeds.
 */
export function updateMarkdownWikilinks(
  content: string,
  oldDocPath: string,
  newDocPath: string,
  refDocPath?: string
): string {
  const normOld = (oldDocPath || '').replace(/^\/+/, '');
  const normNew = (newDocPath || '').replace(/^\/+/, '');
  if (!normOld || !normNew || normOld === normNew) {
    return content;
  }

  const getFilename = (p: string) => {
    const idx = p.lastIndexOf('/');
    return idx >= 0 ? p.slice(idx + 1) : p;
  };

  const getStem = (p: string) => {
    const fn = getFilename(p);
    if (fn.endsWith('.bundle')) return fn.slice(0, -7);
    if (fn.endsWith('.md')) return fn.slice(0, -3);
    return fn;
  };

  const getDir = (p: string) => {
    const idx = p.lastIndexOf('/');
    return idx >= 0 ? p.slice(0, idx) : '';
  };

  const oldFilename = getFilename(normOld);
  const newFilename = getFilename(normNew);
  const oldStem = getStem(normOld);
  const newStem = getStem(normNew);
  const oldDir = getDir(normOld);
  const newDir = getDir(normNew);

  const oldPathNoExt = oldDir ? `${oldDir}/${oldStem}` : oldStem;
  const newPathNoExt = newDir ? `${newDir}/${newStem}` : newStem;

  const iequals = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  const urlDecode = (str: string) => {
    try {
      return decodeURIComponent(str);
    } catch {
      return str;
    }
  };

  const matchAndReplace = (rawDoc: string): string | null => {
    let doc = rawDoc;
    let hasDotSlash = false;
    if (doc.startsWith('./')) {
      hasDotSlash = true;
      doc = doc.slice(2);
    }

    const decoded = urlDecode(doc);
    const isEncoded = decoded !== doc;

    let replacement: string | null = null;

    // 1. Full path match (e.g. "guides/intro.md")
    if (iequals(doc, normOld) || iequals(decoded, normOld)) {
      replacement = normNew;
    }
    // 2. Path without extension match (e.g. "guides/intro")
    else if (iequals(doc, oldPathNoExt) || iequals(decoded, oldPathNoExt)) {
      replacement = newPathNoExt;
    }
    // 3. Filename match (e.g. "intro.md")
    else if (iequals(doc, oldFilename) || iequals(decoded, oldFilename)) {
      replacement = oldDir === newDir ? newFilename : normNew;
    }
    // 4. Stem match (e.g. "intro")
    else if (iequals(doc, oldStem) || iequals(decoded, oldStem)) {
      replacement = newStem;
    }
    // 5. Relative path matching from refDocPath
    else if (refDocPath) {
      const refDir = getDir(refDocPath.replace(/^\/+/, ''));
      if (refDir) {
        const cand = `${refDir}/${doc}`;
        const normCand = cand
          .split('/')
          .reduce<string[]>((acc, part) => {
            if (part === '.' || !part) return acc;
            if (part === '..') {
              acc.pop();
              return acc;
            }
            acc.push(part);
            return acc;
          }, [])
          .join('/');

        if (iequals(normCand, normOld)) {
          replacement = normNew;
        } else if (iequals(normCand, oldPathNoExt)) {
          replacement = newPathNoExt;
        }
      }
    }

    if (!replacement) return null;

    if (isEncoded && replacement.includes(' ')) {
      replacement = replacement.replace(/ /g, '%20');
    }

    if (hasDotSlash) {
      replacement = `./${replacement}`;
    }

    return replacement;
  };

  return transformWikilinks(content, matchAndReplace);
}

/**
 * Rewrites Obsidian-style wikilinks in markdown content targeting an old directory prefix to the new directory prefix.
 */
export function updateMarkdownWikilinksForDirectory(
  content: string,
  oldDirPath: string,
  newDirPath: string
): string {
  const normOld = (oldDirPath || '').replace(/^\/+|\/+$/g, '');
  const normNew = (newDirPath || '').replace(/^\/+|\/+$/g, '');
  if (!normOld || !normNew || normOld === normNew) {
    return content;
  }

  const oldPrefix = `${normOld}/`.toLowerCase();
  const newPrefix = `${normNew}/`;

  const matchAndReplace = (rawDoc: string): string | null => {
    let doc = rawDoc;
    let hasDotSlash = false;
    if (doc.startsWith('./')) {
      hasDotSlash = true;
      doc = doc.slice(2);
    }

    if (doc.toLowerCase().startsWith(oldPrefix)) {
      let replaced = newPrefix + doc.slice(oldPrefix.length);
      if (hasDotSlash) replaced = `./${replaced}`;
      return replaced;
    }

    return null;
  };

  return transformWikilinks(content, matchAndReplace);
}

function transformWikilinks(
  content: string,
  matcher: (cleanDoc: string) => string | null
): string {
  let result = '';
  let i = 0;
  const n = content.length;

  let inFencedCode = false;
  let fenceDelim = '';

  while (i < n) {
    // 1. Check for fenced code block at line start
    const isLineStart = i === 0 || content[i - 1] === '\n';
    if (isLineStart) {
      let sp = i;
      while (sp < n && sp < i + 3 && content[sp] === ' ') sp++;
      if (sp + 2 < n) {
        const fchar = content[sp];
        if (fchar === '`' || fchar === '~') {
          let fcount = 0;
          while (sp + fcount < n && content[sp + fcount] === fchar) {
            fcount++;
          }
          if (fcount >= 3) {
            const currentFence = content.slice(sp, sp + fcount);
            if (!inFencedCode) {
              inFencedCode = true;
              fenceDelim = currentFence;
            } else if (fchar === fenceDelim[0] && fcount >= fenceDelim.length) {
              let eol = sp + fcount;
              while (eol < n && content[eol] !== '\n' && (content[eol] === ' ' || content[eol] === '\t')) {
                eol++;
              }
              if (eol === n || content[eol] === '\n' || content[eol] === '\r') {
                inFencedCode = false;
                fenceDelim = '';
              }
            }
          }
        }
      }
    }

    if (inFencedCode) {
      result += content[i++];
      continue;
    }

    // 2. Check for inline code `...`
    if (content[i] === '`') {
      let tickCount = 0;
      while (i + tickCount < n && content[i + tickCount] === '`') {
        tickCount++;
      }
      const ticks = content.slice(i, i + tickCount);
      result += ticks;
      i += tickCount;
      const closePos = content.indexOf(ticks, i);
      if (closePos !== -1) {
        result += content.slice(i, closePos + tickCount);
        i = closePos + tickCount;
      }
      continue;
    }

    // 3. Check for wikilink: "![[" or "[["
    const isEmbed = content[i] === '!' && i + 2 < n && content[i + 1] === '[' && content[i + 2] === '[';
    const isLink = !isEmbed && content[i] === '[' && i + 1 < n && content[i + 1] === '[';

    if (isEmbed || isLink) {
      const openPos = isEmbed ? i + 1 : i;
      const startInner = openPos + 2;
      const closePos = content.indexOf(']]', startInner);
      const nextNl = content.indexOf('\n', startInner);

      if (closePos !== -1 && (nextNl === -1 || closePos < nextNl)) {
        const inner = content.slice(startInner, closePos);
        const pipePos = inner.indexOf('|');
        const targetView = pipePos !== -1 ? inner.slice(0, pipePos) : inner;
        const labelView = pipePos !== -1 ? inner.slice(pipePos) : '';

        const hashPos = targetView.indexOf('#');
        const docView = hashPos !== -1 ? targetView.slice(0, hashPos) : targetView;
        const anchorView = hashPos !== -1 ? targetView.slice(hashPos) : '';

        const match = docView.match(/^(\s*)(.*?)(\s*)$/);
        if (match && match[2]) {
          const leadingWs = match[1];
          const cleanDoc = match[2];
          const trailingWs = match[3];

          const replaced = matcher(cleanDoc);
          if (replaced !== null) {
            if (isEmbed) result += '!';
            result += `[[${leadingWs}${replaced}${trailingWs}${anchorView}${labelView}]]`;
            i = closePos + 2;
            continue;
          }
        }

        const fullLen = closePos + 2 - i;
        result += content.slice(i, i + fullLen);
        i = closePos + 2;
        continue;
      }
    }

    result += content[i++];
  }

  return result;
}
