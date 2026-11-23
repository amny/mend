// Undoes DOM mutations the structure guard did not allow (requirements 5.4, step 2).

/** Reverts the given records in reverse order. Nodes keep their identity, so the node map stays valid. */
export function revertMutations(records: readonly MutationRecord[]): void {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (!r) continue
    switch (r.type) {
      case 'characterData':
        ;(r.target as CharacterData).data = r.oldValue ?? ''
        break
      case 'attributes': {
        const el = r.target as Element
        const name = r.attributeName
        if (name === null) break
        if (r.oldValue === null) el.removeAttributeNS(r.attributeNamespace, name)
        else el.setAttributeNS(r.attributeNamespace, name, r.oldValue)
        break
      }
      case 'childList': {
        const parent = r.target
        r.addedNodes.forEach((n) => {
          if (n.parentNode === parent) parent.removeChild(n)
        })
        const next = r.nextSibling && r.nextSibling.parentNode === parent ? r.nextSibling : null
        r.removedNodes.forEach((n) => parent.insertBefore(n, next))
        break
      }
    }
  }
}
