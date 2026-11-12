import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ACH — A clearing house for the agent economy',
  description: 'Agent wallets with opt-in clearing on NEAR. Give agents budgets, clear their agreed payments together, and keep capital working across the agent economy.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
