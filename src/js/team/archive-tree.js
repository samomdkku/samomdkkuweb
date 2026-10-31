// ==============================================
// archive-tree.js — the pure tree helpers of a ทีม SAMO year's list
// (team_archive_nodes), for the ทีมแต่ละปี editor (terms.js, 0270).
// No DOM: the repo has no jsdom, so what can be tested is kept here.
// ==============================================

/** parent id ('' = top level) → children, in the order the public page uses. */
export function childrenMap(nodes) {
  const byParent = new Map();
  for (const n of nodes) {
    const k = n.parent_id || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  }
  for (const kids of byParent.values()) {
    kids.sort((a, b) => (a.position - b.position) || String(a.name).localeCompare(String(b.name), 'th'));
  }
  return byParent;
}

/** Every node depth-first with its breadcrumb — the one ordering the editor,
 *  the move pickers and the public page share. */
export function walkNodes(nodes) {
  const byParent = childrenMap(nodes);
  const out = [];
  const walk = (key, trail, depth) => {
    for (const n of byParent.get(key) || []) {
      const path = trail ? `${trail} › ${n.name}` : n.name;
      out.push({ node: n, trail, path, depth });
      walk(n.id, path, depth + 1);
    }
  };
  walk('', '', 0);
  return out;
}

/** `id` and everything beneath it — what a delete takes, and where a ตำแหน่ง
 *  may NOT move to (the database refuses that too, 0270). */
export function subtreeIds(nodes, id) {
  const byParent = childrenMap(nodes);
  const ids = new Set([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of byParent.get(stack.pop()) || []) {
      if (!ids.has(c.id)) { ids.add(c.id); stack.push(c.id); }
    }
  }
  return ids;
}
