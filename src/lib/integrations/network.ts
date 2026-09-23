export function pinnedLookup(address: string, family: number) {
  return (_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => callback(null, address, family);
}
