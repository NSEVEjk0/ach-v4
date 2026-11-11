import Link from 'next/link';

export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M5 5h8v8H5zM19 19h8v8h-8z" fill="currentColor" />
      <path d="M9 19v8h8M23 13V5h-8M9 13v6l10 4M23 19v-6l-10-4" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand({ description = false }: { description?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="ACH home">
      <Mark />
      <span className="brand-name">ACH</span>
      {description && <span className="brand-description">Autonomous<br />Clearing House</span>}
    </Link>
  );
}

export function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12H19M13 6L19 12L13 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
