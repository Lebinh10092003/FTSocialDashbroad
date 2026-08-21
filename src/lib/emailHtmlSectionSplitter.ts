/**
 * Split an email into independently editable HTML sections without flattening
 * its table layout. Email markup uses presentation tables much more heavily
 * than normal web pages, so a row must retain every structural ancestor that
 * supplies its width, padding and inherited typography.
 */

const meaningful = (element: Element) => Boolean(
  element.textContent?.replace(/\u00a0/g, ' ').trim()
  || element.querySelector('img, hr, table'),
);

const directRows = (table: HTMLTableElement) => Array.from(table.rows)
  .filter(row => row.closest('table') === table && meaningful(row));

const elementDepth = (element: Element) => {
  let depth = 0;
  let current: Element | null = element.parentElement;
  while (current) { depth += 1; current = current.parentElement; }
  return depth;
};

const cloneShell = <T extends Element>(element: T): T => element.cloneNode(false) as T;

const pageSurfaceBackground = (element: HTMLElement) => element.getAttribute('bgcolor')
  || element.style.backgroundColor
  || element.style.background
  || '';

/**
 * A full email often has a coloured outer table around a white content card.
 * It is page chrome, not part of any section. Retaining it for every split
 * row duplicates that chrome and makes Gmail render each fragment with a dark
 * frame. Child cell backgrounds are deliberately left untouched.
 */
function clearSplitPageSurface(element: HTMLElement) {
  if (!pageSurfaceBackground(element)) return;
  element.removeAttribute('bgcolor');
  element.style.removeProperty('background');
  element.style.removeProperty('background-color');
}

/** Wrap a fragment in the original ancestry, but omit sibling content. */
function keepLayoutContext(documentNode: Document, source: Element, fragment: Element): string {
  const ancestors: Element[] = [];
  let current = source.parentElement;
  while (current && current !== documentNode.body) {
    ancestors.unshift(current);
    current = current.parentElement;
  }

  let wrapped = fragment;
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const shell = cloneShell(ancestors[index]);
    // Ancestor tables exist only to retain alignment/width. Their background
    // is the source email's page surface and must never be cloned into each
    // fragment. Do not touch TD backgrounds: those can be deliberate cards.
    if (shell.tagName.toLowerCase() === 'table') clearSplitPageSurface(shell as HTMLElement);
    shell.appendChild(wrapped);
    wrapped = shell;
  }
  return wrapped.outerHTML;
}

function splitTableRows(documentNode: Document, table: HTMLTableElement, rows: HTMLTableRowElement[]): string[] {
  return rows.map(row => {
    const tableFragment = cloneShell(table);
    // The selected table can itself be the full-page wrapper. Rows and cells
    // retain their own authored backgrounds; only the wrapper surface is reset.
    clearSplitPageSurface(tableFragment);
    const body = documentNode.createElement('tbody');
    body.appendChild(row.cloneNode(true));
    tableFragment.appendChild(body);
    return keepLayoutContext(documentNode, table, tableFragment);
  });
}

function topLevelSections(documentNode: Document): string[] {
  const elements = Array.from(documentNode.body.children).filter(meaningful);
  if (elements.length < 2) return [];
  return elements.map(element => element.outerHTML);
}

/**
 * Returns visual fragments. It deliberately does not translate HTML into the
 * app's native blocks: each result remains Custom HTML and can be edited
 * without losing table-based email layout.
 */
export function splitEmailHtmlPreservingLayout(html: string): string[] {
  if (typeof DOMParser === 'undefined') return [];
  const documentNode = new DOMParser().parseFromString(html || '', 'text/html');
  const tables = Array.from(documentNode.body.querySelectorAll<HTMLTableElement>('table'));
  const candidates = tables
    .map(table => ({ table, rows: directRows(table) }))
    .filter(candidate => candidate.rows.length >= 2)
    .sort((left, right) => {
      // Prefer the table that actually contains the most independently useful
      // rows. Depth resolves wrapper-table ties in favour of the content table.
      const leftText = left.rows.reduce((total, row) => total + (row.textContent?.trim().length || 0), 0);
      const rightText = right.rows.reduce((total, row) => total + (row.textContent?.trim().length || 0), 0);
      const leftScore = left.rows.length * 100000 + Math.min(leftText, 50000) + elementDepth(left.table);
      const rightScore = right.rows.length * 100000 + Math.min(rightText, 50000) + elementDepth(right.table);
      return rightScore - leftScore;
    });

  if (candidates.length) return splitTableRows(documentNode, candidates[0].table, candidates[0].rows);
  return topLevelSections(documentNode);
}
