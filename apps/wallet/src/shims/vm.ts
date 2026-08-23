export function runInThisContext(): never {
  throw new Error('Node vm is unavailable in the browser; asn1.js will use its built-in fallback');
}
