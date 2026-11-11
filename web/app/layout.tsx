import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ACH — A clearing house for the agent economy',
  description: 'Agent wallets, agreed payments and funded netting on NEAR. Put capital to work across a network of agent trades. Try the free sponsored demo.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
