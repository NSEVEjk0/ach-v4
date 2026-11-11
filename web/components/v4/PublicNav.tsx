import Link from 'next/link';
import { Arrow, Brand } from './Brand';

export default function PublicNav() {
  return (
    <header className="public-nav">
      <Brand description />
      <nav aria-label="Main navigation">
        <Link className="nav-section" href="/#why-ach">Why ACH</Link>
        <Link className="nav-section" href="/#netting">How netting works</Link>
        <Link className="nav-section" href="/developers">Developers</Link>
        <Link className="nav-workspace" href="/workspace">Open app <Arrow /></Link>
      </nav>
    </header>
  );
}
