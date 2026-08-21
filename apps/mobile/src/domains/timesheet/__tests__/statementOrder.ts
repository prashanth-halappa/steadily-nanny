/**
 * @module domains/timesheet/__tests__/statementOrder
 *
 * Reading order, asserted. The Hours statement's blocks are split across a
 * FlashList's `ListHeaderComponent`, its `data` and its `ListFooterComponent`,
 * and FlashList always paints header → data → footer — so "the money card is
 * above the ledger" is a claim about which of those three slots the block
 * sits in, and `within()`/`getByTestId` cannot see it. Walking the rendered
 * JSON depth-first gives the document order a reader actually scrolls through.
 *
 * Not a `.test.ts` file: `scripts/run-tests-one-file.sh` only executes
 * `*.test.ts(x)`, so this is a plain helper module living next to its callers.
 */

interface RenderedNode {
  props?: Record<string, unknown>;
  children?: unknown;
}

/** Every `testID` in the tree, in depth-first document order. */
export function testIDOrder(tree: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const element = node as RenderedNode;
    const id = element.props?.testID;
    if (typeof id === 'string') found.push(id);
    walk(element.children);
  };
  walk(tree);
  return found;
}

/**
 * Position of `testID` in the rendered tree. Throws when it is absent rather
 * than returning `-1`: a missing block would otherwise satisfy every
 * "comes before X" assertion for free.
 */
export function positionOf(order: string[], testID: string): number {
  const index = order.indexOf(testID);
  if (index === -1) {
    throw new Error(
      `testID "${testID}" is not in the rendered tree. Present: ${order.join(', ')}`
    );
  }
  return index;
}
