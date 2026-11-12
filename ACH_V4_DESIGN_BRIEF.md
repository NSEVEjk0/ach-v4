# ACH v4 — current design and interaction brief

The implementation follows a familiar owner workflow: give agents work, inspect the bills, clear a consenting group, then review wallet balances and history. Research supporting these decisions is recorded in [the UX research notes](docs/design/ux-research.md).

## Visual direction

Warm paper, forest green and generous spacing create a composed financial workspace. Instrument Serif is used for public headlines, Inter for interface text, and a mono face for identifiers. Fonts are self-hosted with their licenses. Text, labels and tables remain readable on small screens; financial states always include words.

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#f6f7f3` | Page background |
| Paper | `#fffefa` | Work surfaces |
| Ink | `#183b2e` | Headings |
| Text | `#283b31` | Interface content |
| Muted | `#58695c` | Supporting content |
| Primary | `#184d3c` | Main actions |
| Forest | `#163e31` | Navigation and financial context |

Sophistication comes from typography, alignment, clear financial meaning and useful interaction. Use consistent Lucide icons, tabular figures, modest corners and restrained motion. Typical controls are at least 44px high. Recheck contrast and actual screenshots after responsive changes.

## Public site

Lead with “The agent economy needs a clearing house.” Explain capital fragmentation and payment commitments in ordinary language. A labelled interactive three-agent example shows bills of 100, 100 and 80 clearing with 20; switching to A and B requires 100 and leaves two bills outstanding.

Explain netting before introducing CLS, 2008 and 2020. Attribute CLS’s funding reduction to CLS, distinguish its PvP settlement from ACH’s one-token invoice clearing, and describe agent liquidity stress as a possible future scenario. Netting does not resolve insolvency or guarantee service quality.

The visitor can start a free session, read the developer guide or inspect live deployment details. The demo has no visitor fees and clearly uses test money.

## App navigation

| Destination | Owner’s purpose |
| --- | --- |
| Overview | See the agent wallets and next useful action |
| Work | Create a brief and review delivered work |
| Wallets | Manage one agent’s available funds, commitments and transfers |
| Payments | Inspect accepted service prices and bill details |
| Clearing | Select bills and follow expandable clearing rounds |
| History | Find recorded work, payments and rounds with filters and exports |
| Settings | Review the selected agent’s permissions and revoke authority |

Navigation uses real URLs, supports browser Back and Forward, and provides visible Back controls. History filters and expanded rounds are URL-backed. Work drafts survive navigation within the app. A direct record link opens its drawer or expanded round.

The wallet picker appears where actions concern one account. Work is commissioned through Research Desk; selecting another wallet must not imply a different purchasing agent. Round actions identify the acting agent.

## Clearing review

1. Choose the public or private invoice set.
2. Choose participants and individual accepted bills.
3. Review each agent’s final payment and the exact available funding.
4. Request the round. Every included participant independently checks and authorizes it.
5. Open the round to inspect its immutable bill set, calculation, approvals and settlement record.

Selecting a subgroup recalculates the funding and requires fresh consent. Excluded bills remain outstanding until another eligible round settles them. The current agents also clear under their standing permissions; the interface must not imply a permanent manual opt-out.

An expanded round shows four numbered steps: included bills, incoming/outgoing/net calculation, approvals and reserved requirements, and settlement record. It provides a transaction link when available, downloadable JSON and expandable full identifiers. Historical reservation requirements are not presented as current available balances.

Private gross values are reconstructed only when the original browser has the complete matching decrypted invoice set. Missing private values stay encrypted. Identities and approved net movements remain visible.

## State and accessibility requirements

Retain the latest confirmed balances during a read failure and disable money actions until synchronization resumes. Unknown amounts are not zero. Explain waits, insufficient funds and missing private browser keys with a useful next step.

Use labelled forms and semantic tables. Round buttons expose `aria-expanded` and `aria-controls`; invoice drawers trap keyboard focus, support Escape and restore focus to the initiating row. Support reduced motion, 1440px desktop, 834px tablet, 390px mobile and 320px narrow screens without global horizontal scrolling.

History presents only records available from the current service snapshot. Missing wallet transfer events and receipt links are documented in the separate workflow audit; invented financial history is never used to fill those gaps.

## Delivery scope

The production application uses the separate revision-2 vault and its existing service identities. Preview, production and public smoke each pass 28 browser checks; the final hosted journey passes 52. The [current validation record](docs/v4/validation-20261112.md) includes the financial checks and reviewed desktop/mobile screenshots.

The reviewed `ach-v4` source and release evidence are published privately under the resumed authorization. Both repositories remain private, and credentials, private work and browser keys stay in their private stores. Preserve the earlier deployment, financial records and historical audit. Mainnet transfer execution and an independent security audit remain unverified.
