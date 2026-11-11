'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowLeftRight, ChevronDown, Clock3 } from 'lucide-react';
import { api, errorText, money } from '../../lib/v4';
import { PanelHeading } from './Interface';

interface RouteQuote {
  id: string; direction: string; network: string; state: string; dry: boolean;
  request: { recipient: string; refundTo: string; amount: string; deadline: string };
  source: { blockchain: string; symbol: string };
  destination: { blockchain: string; symbol: string };
  response: { quote: { amountOut: string; minAmountOut: string; timeEstimate: number; deadline?: string } };
}

export default function FundingRoutes({ enabled }: { enabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [direction, setDirection] = useState('funding');
  const [amount, setAmount] = useState('10');
  const [recipient, setRecipient] = useState('');
  const [refund, setRefund] = useState('');
  const [quote, setQuote] = useState<RouteQuote | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const operation = useRef<{ id: string; payload: string } | null>(null);
  const expiresAt = quote ? Math.min(Date.parse(quote.request.deadline), Date.parse(quote.response.quote.deadline ?? quote.request.deadline)) : 0;
  const expired = Boolean(quote && expiresAt <= now);

  useEffect(() => {
    if (!quote) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);
  useEffect(() => { operation.current = null; setQuote(null); setError(''); }, [direction, amount, recipient, refund]);

  async function requestQuote() {
    setPending(true); setError('');
    try {
      if (expired) operation.current = null;
      if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(amount)) throw new Error('INVALID_AMOUNT');
      const [whole, fraction = ''] = amount.split('.');
      const units = (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString();
      const payload = JSON.stringify({ direction, amount: units, recipient: recipient.trim(), refund_to: refund.trim() });
      if (operation.current?.payload !== payload) operation.current = { id: crypto.randomUUID().replaceAll('-', ''), payload };
      setQuote(await api<RouteQuote>('intents/quote', { request_id: operation.current.id, ...JSON.parse(payload) }));
    } catch (cause) { setError(errorText(cause instanceof Error ? cause.message : 'INTENTS_UNAVAILABLE')); }
    finally { setPending(false); }
  }

  return <section className="work-surface funding-routes">
    <PanelHeading title="Move funds between chains" description="Preview a USDC route between Base and NEAR."><span className="tag">NEAR Intents</span></PanelHeading>
    <div className="route-introduction"><p>ACH clears bills in one settlement token. For funding and payouts on another chain, NEAR Intents provides a separate route to or from the owner’s account.</p><p className="form-hint">This preview gets a real mainnet quote. Your sponsored test balance stays in the demo. To send real funds, use the owner routing SDK with accounts you control.</p><button className="button secondary" aria-expanded={expanded} aria-controls="route-preview" onClick={() => setExpanded(value => !value)}>{expanded ? 'Close route preview' : 'Preview a route'}<ChevronDown size={16} /></button></div>
    {expanded && <div className="route-body" id="route-preview">
      <form className="route-form" onSubmit={event => { event.preventDefault(); void requestQuote(); }}>
        <label>Direction<select value={direction} onChange={event => setDirection(event.target.value)}><option value="funding">Base to NEAR · funding</option><option value="payout">NEAR to Base · payout</option></select></label>
        <label>Amount in USDC<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label>{direction === 'funding' ? 'Receiving NEAR account' : 'Receiving Base address'}<input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder={direction === 'funding' ? 'your-account.near' : '0x…'} /></label>
        <label>{direction === 'funding' ? 'Refund Base address' : 'Refund NEAR account'}<input value={refund} onChange={event => setRefund(event.target.value)} placeholder={direction === 'funding' ? '0x…' : 'your-account.near'} /></label>
        <p className="form-hint">The quote binds these destinations, the amount and the minimum receipt. Use your own receiving and refund accounts.</p>
        <button className="button primary" type="submit" disabled={pending || !enabled || !recipient || !refund}>{pending ? 'Getting quote…' : 'Get a mainnet quote'}<ArrowRight size={16} /></button>
        {!enabled && <p role="status" className="form-hint">The quote service is reconnecting. You can still use your available test funds.</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </form>
      <div className="route-review" aria-live="polite">{quote ? <>
        <span className={`tag ${expired ? 'warning-tag' : ''}`}>{expired ? <Clock3 size={14} /> : <ArrowLeftRight size={14} />}{expired ? 'Quote expired' : 'No transfer sent'}</span>
        <h3>{money(quote.request.amount, 6)} USDC<br />{quote.source.blockchain === 'base' ? 'Base' : 'NEAR'} to {quote.destination.blockchain === 'base' ? 'Base' : 'NEAR'}</h3>
        <dl className="policy-list"><div><dt>Expected receipt</dt><dd>{money(quote.response.quote.amountOut, 6)} USDC</dd></div><div><dt>Minimum receipt</dt><dd>{money(quote.response.quote.minAmountOut, 6)} USDC</dd></div><div><dt>Slippage cap</dt><dd>1%</dd></div><div><dt>Expires</dt><dd>{new Date(expiresAt).toLocaleTimeString()}</dd></div></dl>
        <p className="destination-label">Receiving account<span className="mono">{quote.request.recipient}</span></p><p className="destination-label">Refund account<span className="mono">{quote.request.refundTo}</span></p>
        <p className="form-hint">{expired ? 'Get a fresh quote to review the current route.' : 'Route costs are included. Incoming funds become an ACH balance after the settlement token arrives and a separate deposit is confirmed.'}</p>
        <Link className="text-button" href="/developers#funding">Read the owner routing guide<ArrowRight size={15} /></Link>
      </> : <><span className="section-kicker">Route review</span><h3>Check where your funds will arrive.</h3><p>Review the minimum receipt, expiry and refund account here. Funding arrives at the owner before an ACH deposit. A payout begins with an ACH withdrawal to the owner.</p></>}</div>
    </div>}
  </section>;
}
