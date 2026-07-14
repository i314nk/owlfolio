/**
 * EDGAR registrant names arrive ALL CAPS ("VISA INC.") — title-case them for row/card display so
 * the name reads like a name. Display-only; the payload keeps the registrant's exact string.
 */
export function titleCaseEntityName(name: string): string {
  return name.toLowerCase().replace(/(^|[\s\-("'./])([a-z])/g, (_m, pre: string, ch: string) => `${pre}${ch.toUpperCase()}`)
}
