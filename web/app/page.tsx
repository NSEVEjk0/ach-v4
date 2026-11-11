import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, LockKeyhole, ReceiptText, ShieldCheck, Wallet } from 'lucide-react';
import { Arrow, Brand } from '../components/v4/Brand';
import PublicNav from '../components/v4/PublicNav';
import ExampleSheet from '../components/v4/ExampleSheet';
import StartSession from '../components/v4/StartSession';

const cls = 'https://www.cls-group.com/products/settlement/clssettlement/';
const clsCrisis = 'https://www.cls-group.com/insights/the-fx-ecosystem/covid-19-and-the-importance-of-resilient-financial-market-infrastructures/';

export default function Home() {
  return (
    <main className="landing" id="main-content">
      <a className="skip-link" href="#why-ach">Skip to content</a>
      <PublicNav />

      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker"><span /> Money for an economy of agents</span>
          <h1>The agent economy<br />needs a<br /><em>clearing house.</em></h1>
          <p className="hero-description">ACH gives agents wallets and a shared record of what they owe. Approved payments offset each other, so less cash is needed to clear an agreed group.</p>
          <div className="hero-actions"><StartSession /><a className="text-link" href="#netting">Understand netting <Arrow /></a></div>
          <p className="free-note">Free to try · Three working agents · Sponsored test funds</p>
          <div className="hero-promises"><span><Check size={14} /> Agreed prices</span><span><Check size={14} /> Individual consent</span><span><Check size={14} /> Funded settlement</span></div>
        </div>
        <div className="hero-example"><ExampleSheet /><p className="example-disclosure">Explore an illustrative payment network. The demo uses test money.</p></div>
      </section>

      <section className="economy-statement" aria-label="The ACH opportunity">
        <span className="section-kicker">The next layer of agent commerce</span>
        <p>One owner can run many agents.<br />Their capital should keep working as they trade.</p>
        <a href="#why-ach" aria-label="Read why ACH matters"><ArrowDownRight size={30} /></a>
      </section>

      <section id="why-ach" className="why-section content-section">
        <div className="section-intro"><span className="section-kicker">Why ACH</span><h2>More agents.<br />More trades.<br /><em>Two real pressures.</em></h2><p>Fast blockchains such as NEAR provide the execution layer. An economy of agents also needs a way to manage funding and make payment commitments reliable.</p></div>
        <div className="problem-stories">
          <article><div className="story-icon"><Wallet size={22} /></div><h3>Capital spread across wallets</h3><p>As agents buy compute, data and services, an owner has to keep money ready in many places. Bills may come due while payments for other work are still waiting.</p><div className="story-answer"><strong>ACH brings the payments together.</strong><p>Within an agreed group, amounts owed and amounts due offset. Each agent reserves its final debit, leaving more of its available balance free for other work.</p></div></article>
          <article><div className="story-icon"><ShieldCheck size={22} /></div><h3>Payment rules agents can rely on</h3><p>A malicious participant can try to change a price, reuse a bill, or leave others waiting after they have paid. Agents need clear commitments they can verify before moving money.</p><div className="story-answer"><strong>ACH makes each commitment explicit.</strong><p>Both parties accept a bill. Every included agent approves its exact result. Reserved funds support a round that settles all its bills together.</p></div></article>
        </div>
      </section>

      <section id="netting" className="netting-section content-section">
        <div className="section-intro horizontal-intro"><div><span className="section-kicker">How netting works</span><h2>Every agent gets<br /><em>its exact result.</em></h2></div><p>Netting offsets what an agent owes against what it is owed. The remaining debit or credit is the amount that moves when the group clears.</p></div>
        <div className="netting-explanation">
          <div className="netting-calculation"><div className="calculation-heading"><ReceiptText size={19} /><h3>Three agreed bills</h3><span>USDC</span></div><div><span>A owes B</span><strong>100</strong></div><div><span>B owes C</span><strong>80</strong></div><div><span>C owes A</span><strong>60</strong></div><div className="calculation-total"><span>Gross payments</span><strong>240</strong></div></div>
          <div className="netting-transition"><Arrow /><span>Offset the payments</span></div>
          <div className="netting-calculation final-calculation"><div className="calculation-heading"><Check size={19} /><h3>The final movements</h3><span>USDC</span></div><div><span>A pays <small>100 owed − 60 due</small></span><strong>40</strong></div><div><span>B receives <small>100 due − 80 owed</small></span><strong>20</strong></div><div><span>C receives <small>80 due − 60 owed</small></span><strong>20</strong></div><div className="calculation-total"><span>Funding for this round</span><strong>40</strong></div></div>
        </div>
        <p className="netting-caption">All 240 USDC of agreed bills are cleared. A supplies 40 USDC; B and C each receive 20. The illustration compares gross payments with the cash required for this round.</p>
        <div className="workflow-steps">
          {[
            ['Agree on the work', 'Agents accept the service, delivery and final price.'],
            ['Choose a clearing group', 'Select the agents and bills that will settle together.'],
            ['Approve and reserve', 'Every included agent signs its exact result. Net debtors reserve funds.'],
            ['Settle the round', 'All included balances update together. The money is ready for the next trade.'],
          ].map(([title, description], index) => <article key={title}><span className="step-number">{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}
        </div>
        <div className="subgroup-note"><ShieldCheck size={22} /><p><strong>The group decides who clears.</strong> If C does not participate, A and B can clear their 100 USDC bill with fresh approvals. The remaining bills stay outstanding.</p></div>
      </section>

      <section id="financial-context" className="financial-context">
        <div className="finance-heading"><span className="section-kicker">A lesson from financial markets</span><h2>Liquidity matters<br /><em>most under pressure.</em></h2><p>Foreign exchange already depends on infrastructure that conserves funding and makes settlement dependable. That lesson matters as agents begin to trade continuously.</p></div>
        <article className="cls-story"><div className="cls-story-title"><span>CLS in foreign exchange</span><a href={cls} target="_blank" rel="noreferrer" aria-label="Read CLSSettlement’s explanation"><ArrowUpRight size={21} /></a></div><div className="cls-stat"><strong>96<small>%+</small></strong><span>reduction in funding requirements<br />reported by CLSSettlement</span></div><p>CLS calculates funding needs across participants on a multilaterally netted basis. It settles FX transactions using payment-versus-payment: the two currency payments become final together.</p><p>ACH applies the funding principle to agreed agent invoices, with each round using one settlement token.</p><a className="source-link" href={cls} target="_blank" rel="noreferrer">Source: CLSSettlement <ArrowUpRight size={13} /></a></article>
        <div className="crisis-timeline">
          <article><span className="crisis-year">2008</span><div><h3>A funding and confidence shock</h3><p>Dependence on short-term funding, leverage and uncertain exposures helped turn losses into a wider liquidity crisis. CLS continued to provide final settlement for FX trades.</p><a className="source-link" href="https://www.federalreserve.gov/newsevents/testimony/bernanke20100902a.htm" target="_blank" rel="noreferrer">Federal Reserve’s account <ArrowUpRight size={13} /></a><a className="source-link" href={clsCrisis} target="_blank" rel="noreferrer">CLS on settlement through crises <ArrowUpRight size={13} /></a></div></article>
          <article><span className="crisis-year">2020</span><div><h3>A sudden demand for cash</h3><p>During the pandemic shock, dollar funding costs rose sharply. CLS reported settling higher March volumes without delays, using net funding alongside its settlement and operational controls.</p><a className="source-link" href={clsCrisis} target="_blank" rel="noreferrer">CLS’s account of March 2020 <ArrowUpRight size={13} /></a><a className="source-link" href="https://www.bis.org/publ/bisbull01.htm" target="_blank" rel="noreferrer">BIS on dollar funding pressure <ArrowUpRight size={13} /></a></div></article>
        </div>
        <div className="agent-stress"><span className="section-kicker">A possible pressure in the agent economy</span><h3>What happens when many agents need cash at once?</h3><p>A surge in purchases, delayed incoming payments or a major provider outage could leave agents waiting on one another for funds. Netting can reduce the amount needed where their obligations offset. ACH pairs that calculation with spending limits, explicit consent and funded rounds.</p><p className="finance-boundary">Netting conserves liquidity. A remaining net debit still needs funding, and service quality still needs its own checks.</p></div>
      </section>

      <section className="capabilities-section content-section">
        <div className="section-intro horizontal-intro"><div><span className="section-kicker">Inside ACH</span><h2>A place to manage<br /><em>your agents’ money.</em></h2></div><Link className="text-link" href="/developers">Explore the agent SDK <Arrow /></Link></div>
        <div className="capability-list">
          <article><Wallet size={25} /><h3>Wallets with spending limits</h3><p>Give each agent a funded balance and clear permissions. Owners manage budgets and withdraw available money; agents trade within their authority.</p><Link href="/workspace?view=wallets">Open wallets <Arrow /></Link></article>
          <article><LockKeyhole size={25} /><h3>Private invoice processing</h3><p>Encrypted contributions are verified through OutLayer. Invoice contents stay private while the participants and their approved net payments remain visible.</p><Link href="/developers#privacy">How privacy works <Arrow /></Link></article>
          <article><ArrowUpRight size={25} /><h3>Cross-chain USDC routes</h3><p>Preview Base ↔ NEAR routes through NEAR Intents. The owner SDK connects funding and payouts to separate transfers with their own receipts.</p><Link href="/workspace?view=wallets">Preview a route <Arrow /></Link></article>
        </div>
      </section>

      <section className="questions-section content-section">
        <div className="section-intro"><span className="section-kicker">A few useful answers</span><h2>Understand the<br /><em>commitment.</em></h2></div>
        <div className="questions-list">
          {[
            ['How does money get into ACH?', 'Owners transfer tokens into ACH and credit an agent’s wallet. The free demo does this for you with sponsored test money. Cross-chain funding arrives at the owner first, then enters ACH through a separate deposit.'],
            ['Do agents need to fund every bill in full?', 'For a clearing group, each agent needs enough available money to cover its final payment after the bills offset. In the example above, A needs 40 USDC; B and C need no cash for that round. If a bill clears on its own, its buyer needs the full amount.'],
            ['Can clearing happen without an agent’s permission?', 'Every included agent must approve the round. An owner can also give its agent permission to approve automatically within spending limits. The hosted demo agents have these standing permissions, so eligible bills can clear automatically.'],
            ['Does every agent in the network need to approve?', 'The agents included in a clearing round approve that round. A smaller consenting group can choose its own bills, calculate a new result and provide fresh approvals. Bills left out of the group remain outstanding.'],
            ['What happens to an accepted bill before clearing?', 'It records what the buyer agreed to pay. Accepting a bill does not lock cash. Money is reserved during clearing approvals, and the seller can use its earnings after the round settles.'],
            ['Does netting change the price of the work?', 'Each accepted price stays fixed. Netting preserves every participant’s exact gain or loss while reducing the payments needed when debts offset. A one-way purchase clears for its full amount.'],
            ['Who controls an agent’s wallet?', 'Owners control funding, withdrawals and permissions. Delegated agent keys purchase and approve within their limits. The free demo supplies hosted test identities; the SDK supports independently operated owner and agent signers.'],
            ['What can I try for free?', 'Start a sponsored NEAR testnet session, run a brief through three service agents, download the work, inspect their bills and clear a round. You can also withdraw and redeposit test tokens. Test funds have no monetary value.'],
          ].map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={17} /></summary><p>{answer}</p></details>)}
        </div>
      </section>

      <section className="closing-invitation"><span className="section-kicker">Try the full journey</span><h2>Give your agents work.<br /><em>Follow the money.</em></h2><p>Create a chart, inspect the agreed bills, and open a round to see how it cleared.</p><StartSession /><span className="free-note">Free sponsored demo on NEAR testnet</span></section>
      <footer className="public-footer"><Brand description /><p>Autonomous Clearing House<br /><span>Capital and payment rules for the agent economy.</span></p><div><Link href="/developers">Developers</Link><Link href="/proof">Live deployment <ArrowUpRight size={14} /></Link></div></footer>
    </main>
  );
}
