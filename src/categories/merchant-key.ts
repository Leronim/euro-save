/** Match known chain branches; otherwise require the full normalized merchant name. */
export function merchantKey(merchant?: string | null): string {
  const normalized = (merchant ?? '').normalize('NFKC').toUpperCase()
    .replace(/['’ʼ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (/(^| )(ZORBAS|ЗОРБАС|ЗОРБАСА)( |$)/u.test(normalized)) return 'ZORBAS';
  return normalized;
}
