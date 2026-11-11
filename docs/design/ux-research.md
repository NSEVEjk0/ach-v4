# ACH v4: product, content and interaction research

Research checked on 10 November 2026. The audience is an owner managing agents and a visitor trying the sponsored hackathon deployment. Familiarity with wallets, invoices and account history is sufficient to use the interface.

## The product story

The agent economy creates a network of purchases: compute, research, data, checks and other services. One owner may operate many agents. Capital can be spread across their wallets while payments from other agents remain outstanding. Participants also need enforceable rules for prices, permission and payment.

ACH supplies funded agent balances and clearing rounds. Accepted payments are offset within a consenting group. Each participant approves the exact invoice set and its own result. Net debtors reserve confirmed funds, and settlement updates all included balances and consumes all included invoices atomically.

The capital benefit is conditional on the payment graph. A one-way purchase needs its full payment. Reducing gross payment volume does not prove an equal reduction in an owner's actual peak working capital: timing, reuse, group choice and incoming funds matter. The interface must label the comparison being shown.

Payment protections cover authorization, immutable accepted terms, reservations, atomic clearing and repeat consumption. Whether a service deserves its price still depends on its delivery rules and the buyer's checks.

## Evidence behind the agent-economy narrative

| Primary source | What it supports | Use in ACH |
| --- | --- | --- |
| [Agentic Commerce Protocol repository, maintained by OpenAI and Stripe](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) | An open interaction model for buyers, agents, businesses and payment providers. | Agents conducting commerce is an established infrastructure direction. This source does not establish billions of trading agents. |
| [Stripe: Developing an open standard for agentic commerce](https://stripe.com/blog/developing-an-open-standard-for-agentic-commerce) | Programmatic purchases, permissioned payment credentials, trust, fragmentation and asynchronous commerce. | Explain the infrastructure problem in the owner's language. Stripe's integration fragmentation and ACH's capital fragmentation are distinct issues. |
| [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents) | Tool use, autonomous operation, orchestration, environmental feedback and bounded execution. | Make spending and settlement checks inspectable; do not attribute model intelligence to fixed financial rules. |
| [Anthropic: Project Vend, phase 1](https://www.anthropic.com/research/project-vend-1) | A real experiment in autonomous economic resource management, including hallucinated payment destinations and poor pricing decisions. | Motivate fixed payment terms, controlled destinations and spending permissions. The experiment also shows the limits of relying on a model's commercial judgment. |
| [Dario Amodei: Machines of Loving Grace, October 2024](https://www.darioamodei.com/essay/machines-of-loving-grace) | A speculative framework with millions of independent AI instances that can collaborate. | Cite the scale vision as a forecast. Neither billions of trading agents nor ACH capacity at that scale follows from it. |

## What netting means, and the CLS precedent

Netting offsets payments that participants owe and are owed, yielding each participant's final debit or credit. For A → B 100, B → C 80 and C → A 60, gross payments total 240. A pays 40; B and C each receive 20. Removing C leaves A → B 100, with the other two payments still outstanding. A new group needs a new calculation and approvals.

[CLSSettlement](https://www.cls-group.com/products/settlement/clssettlement/) combines payment-versus-payment settlement of FX transactions with multilateral netting of funding requirements. CLS publishes a reduction in funding requirements of over 96%. That statistic belongs to CLS; it is not an ACH benchmark or promise. FX transactions still settle through PvP. Funding netting and settling only net economic obligations are different operations.

[CLSNet](https://www.cls-group.com/products/processing/clsnet/) is a separate bilateral payment-netting calculation service. Its results support settlement outside CLSSettlement. It must not be described as CLSSettlement's multilateral funding mechanism or as an atomic settlement guarantee.

[CLS's 29 April 2020 account](https://www.cls-group.com/insights/the-fx-ecosystem/covid-19-and-the-importance-of-resilient-financial-market-infrastructures/) states that March volumes averaged about USD7 trillion of daily payments, about 20% above normal, without issues or delays. It references banks' reliance on CLS in 2008. It attributes resilience to operational planning, redundancy and infrastructure as well as risk mitigation and net funding.

[BIS: FX settlement risk, December 2022](https://www.bis.org/publ/qtrpdf/r_qt2212i.htm) distinguishes pre-settlement netting from PvP and identifies losses around Lehman's 2008 collapse and a March 2020 currency-exchange default. These examples concern settlement risk; they are not an explanation of either crisis in its entirety.

[Federal Reserve: Causes of the Recent Financial and Economic Crisis, 2 September 2010](https://www.federalreserve.gov/newsevents/testimony/bernanke20100902a.htm) discusses short-term funding dependence, runs, leverage, weak risk management and inadequate clearing infrastructure in the 2008 crisis.

[BIS Bulletin 1, 1 April 2020](https://www.bis.org/publ/bisbull01.htm) documents dollar funding pressure in the FX swap market during Covid-19, including constrained supply and the effect of central-bank swap lines.

[CPMI's final PvP report, 27 March 2023](https://www.bis.org/cpmi/publ/d216.htm) explains remaining coverage, technical, incentive and legal barriers. A prototype on one chain cannot inherit the scale or institutional guarantees of established financial infrastructure.

For ACH, the analogy is a possible future agent liquidity crunch: concurrent purchases, delayed receivables, a provider outage or a sudden funding withdrawal could cause many agents to need spendable funds together. Netting can lower the amount required where obligations offset. It cannot supply an unfunded net debit, resolve insolvency or ensure service quality. This scenario is a design motivation, not a prediction that a financial crisis is inevitable.

## Research translated into the interface

| Source | Finding | Design decision |
| --- | --- | --- |
| [Nielsen Norman Group: 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | Familiar language, visible status, control, consistency, recognition and recovery improve usability. | Use Overview, Work, Wallets, Payments, Clearing and History. Pair status with the next available action. Keep the selected agent explicit. |
| [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Keep frequent tasks visible; reveal secondary details with clear labels. | Show gross payments, required funding and round state in each summary. Expand a round to inspect its bills, arithmetic, approvals and receipt. Put hashes behind a receipt-details control. |
| [NN/g: How users read on the web](https://www.nngroup.com/articles/how-users-read-on-the-web/) | People scan. Meaningful headings, concise paragraphs, objective language and sources improve comprehension and credibility. | Lead with what ACH does and the owner's benefit. Use concrete payment examples. Avoid clever labels, unsupported superlatives and defensive comparisons. |
| [GOV.UK Design System: Back link](https://design-system.service.gov.uk/components/back-link/) | People need explicit back controls and a return to the previous state. | Use navigable URLs and browser history; preserve drafts and filters when returning. Provide a direct-entry fallback. |
| [GOV.UK: Check answers](https://design-system.service.gov.uk/patterns/check-answers/) | People should be able to review a consequential action and change its inputs before submitting. | Put the participant roster, invoice set, exact net result and available funding together before requesting clearing. |
| [WAI-ARIA accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) | Headers are buttons with an expanded state and associated panels; keyboard interaction is essential. | Clearing-round headers support Enter, Space, Tab and labelled expanded panels. State is also reachable through a deep link. |
| [IBM Carbon: Data table usage](https://carbondesignsystem.com/components/data-table/usage/) | Tables support scanning, filtering, selection and disclosure; actions need separate targets. | Use readable payments tables, explicit detail buttons, history filters and mobile layouts with contained table scrolling. |
| [Stripe: Balances and settlement time](https://docs.stripe.com/payments/balances) | Pending and available funds have different uses. | Distinguish available balance, reserved funds and outstanding receivables. Never render incoming bills as money available to spend. |
| [Wise: Downloading statements](https://wise.com/help/articles/2736049/how-do-i-download-a-statement) | History and exports have clear account, date and transaction scope. | Label history as this session's recorded activity and export only verifiable available records. Keep unknown timestamps and missing private details explicit. |

## Owner journey

1. Understand the two problems: capital spread across agents and trustworthy payment rules.
2. Inspect an interactive netting example, including a smaller consenting group.
3. Start a free test session with three funded service identities.
4. See available money and what needs attention on Overview.
5. Create a brief on Work, inspect the output and download the artifact.
6. Inspect accepted service bills on Payments.
7. Choose the clearing group and inspect the exact financial result on Clearing.
8. Expand a round to follow the invoice set, calculation, approvals and settlement.
9. Return to History to find recorded work, payments and receipts.
10. Manage a selected wallet and its owner permissions when needed.

## Verification and review boundaries

The redesign changes presentation and navigation around the existing financial system. It preserves the deployed vault, token, existing balances, signers, private browser keys and transaction identifiers.

Test browser back/forward, direct entry, draft preservation, filters, round expansion, keyboard focus, private disclosure, failure recovery and 320–1440px layouts. Retain the existing live public/private journey and financial assertions.

The user's separate workflow review asks for testing and recommendations. Additional financial or workflow fixes discovered by that review are not authorized for implementation in this redesign. Record reproductions and recommendations in a separate audit document.
