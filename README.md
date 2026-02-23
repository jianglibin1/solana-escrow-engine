# 🔐 Solana Escrow Engine

> A production Web2 escrow backend system rebuilt as an on-chain Solana program using the Anchor framework.

**Superteam Earn Bounty:** *Rebuild production backend systems as on-chain Rust programs*

## Table of Contents

- [Overview](#overview)
- [How Escrow Works in Web2](#how-escrow-works-in-web2)
- [How It Works on Solana](#how-it-works-on-solana)
- [Architecture Comparison](#architecture-comparison)
- [Account Model](#account-model)
- [Program Instructions](#program-instructions)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Deployment](#deployment)
- [CLI Client](#cli-client)
- [Devnet Transactions](#devnet-transactions)
- [Design Tradeoffs](#design-tradeoffs)

---

## Overview

This project takes a traditional escrow/custody backend — the kind you'd find behind payment platforms like Stripe Connect, Upwork, or freelance marketplaces — and rebuilds it entirely as a Solana on-chain program.

The result is a trustless, transparent, and permissionless escrow engine where:
- Funds are held in PDA-controlled vaults (not a company's bank account)
- State transitions are enforced by on-chain logic (not API middleware)
- Dispute resolution is handled by a designated arbiter (not customer support)
- Auto-release is permissionlessly crankable (not a cron job)

## How Escrow Works in Web2

A traditional escrow backend typically looks like this:

```
┌─────────┐     ┌──────────────┐     ┌──────────┐
│  Buyer  │────▶│  API Server  │────▶│ Database │
└─────────┘     │  (Express/   │     │ (Postgres)│
                │   Django)    │     └──────────┘
┌─────────┐     │              │     ┌──────────┐
│ Seller  │────▶│  Auth, Biz   │────▶│  Stripe  │
└─────────┘     │  Logic, etc  │     │  (Funds) │
                └──────────────┘     └──────────┘
                       │
                ┌──────────────┐
                │  Admin Panel │ (Dispute resolution)
                └──────────────┘
```


### Web2 Escrow Flow:

1. **Create:** Buyer initiates escrow via API → row inserted in `escrows` table
2. **Fund:** Buyer pays via Stripe → funds held in platform's Stripe account
3. **Release:** Buyer confirms delivery → API triggers Stripe payout to seller
4. **Dispute:** Either party contacts support → admin manually resolves via dashboard
5. **Auto-release:** A cron job checks deadlines → triggers payout if expired

### Web2 Pain Points:

| Problem | Description |
|---------|-------------|
| **Trust** | Users must trust the platform won't misuse funds |
| **Opacity** | Fund movements are invisible to users |
| **Single point of failure** | Server downtime = no escrow operations |
| **Censorship** | Platform can freeze funds arbitrarily |
| **Audit cost** | Proving solvency requires expensive third-party audits |

## How It Works on Solana

```
┌─────────┐                    ┌─────────────────┐
│Depositor│───── tx ──────────▶│  Solana Program  │
└─────────┘                    │  (escrow_engine) │
                               │                  │
┌───────────┐                  │  PDA Accounts:   │
│Beneficiary│◀── tx ──────────│  - EscrowAccount │
└───────────┘                  │  - Vault (SPL)   │
                               │  - VaultAuthority│
┌─────────┐                    │                  │
│ Arbiter │───── tx ──────────▶│  On-chain logic  │
└─────────┘                    └─────────────────┘
                                       │
                               ┌───────────────┐
                               │ Solana Ledger  │
                               │ (Immutable log)│
                               └───────────────┘
```

### On-Chain Escrow Flow:

1. **Initialize:** Depositor creates escrow → `EscrowAccount` PDA + vault token account created
2. **Fund:** Depositor transfers SPL tokens → tokens move to PDA-controlled vault
3. **Release:** Depositor signs release tx → vault transfers to beneficiary's token account
4. **Dispute:** Either party signs dispute tx → escrow status frozen to `Disputed`
5. **Resolve:** Arbiter signs resolution → funds sent to winner
6. **Auto-release:** Anyone cranks after deadline slot → permissionless release
7. **Cancel:** Depositor cancels → funds returned from vault

## Architecture Comparison

| Aspect | Web2 (Traditional) | Solana (This Program) |
|--------|--------------------|-----------------------|
| **Fund custody** | Platform's bank/Stripe account | PDA-controlled SPL token vault |
| **State storage** | PostgreSQL/MySQL rows | On-chain `EscrowAccount` PDA |
| **Business logic** | Express/Django middleware | Anchor program instructions |
| **Authentication** | JWT/OAuth tokens | Ed25519 signature verification |
| **Dispute resolution** | Manual admin dashboard | Designated arbiter signs tx |
| **Auto-release** | Cron job + API call | Permissionless crank instruction |
| **Audit trail** | Application logs (mutable) | Solana ledger (immutable) |
| **Availability** | 99.9% SLA (with effort) | Solana network uptime (~100%) |
| **Cost per operation** | $0.01-0.10 (infra) | ~0.000005 SOL (~$0.001) |
| **Deployment** | Docker/K8s + CI/CD | `anchor deploy` to devnet/mainnet |
| **Trust model** | Trust the platform | Trust the code (verifiable) |

## Account Model

```
EscrowAccount (PDA: seeds = ["escrow", depositor, escrow_id])
├── escrow_id: u64              // Unique identifier
├── depositor: Pubkey           // Party depositing funds
├── beneficiary: Pubkey         // Party receiving funds
├── arbiter: Pubkey             // Dispute resolver
├── mint: Pubkey                // SPL token mint
├── vault: Pubkey               // Vault token account
├── amount: u64                 // Expected deposit amount
├── status: EscrowStatus        // Created|Funded|Disputed|Released|Cancelled
├── auto_release_slot: u64      // Slot-based deadline (0 = disabled)
├── created_at_slot: u64        // Creation timestamp (slot)
├── updated_at_slot: u64        // Last update timestamp (slot)
├── dispute_reason: String(128) // Dispute description
├── bump: u8                    // PDA bump
└── vault_authority_bump: u8    // Vault authority PDA bump

Vault (PDA: seeds = ["vault", escrow_pda])
└── SPL TokenAccount owned by VaultAuthority PDA

VaultAuthority (PDA: seeds = ["vault_authority", escrow_pda])
└── Signing authority for vault transfers
```

### State Machine

```
Created ──fund──▶ Funded ──release──▶ Released
   │                 │
   │cancel           │dispute
   ▼                 ▼
Cancelled        Disputed ──resolve──▶ Released / Cancelled
                     │
                 (arbiter decides)
                 
Funded ──auto_release (after deadline)──▶ Released
```

## Program Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `initialize_escrow` | Depositor | Create escrow + vault accounts |
| `fund_escrow` | Depositor | Transfer tokens to vault |
| `release_funds` | Depositor | Release vault to beneficiary |
| `raise_dispute` | Depositor or Beneficiary | Freeze escrow, record reason |
| `resolve_dispute` | Arbiter | Send funds to winner |
| `cancel_escrow` | Depositor | Return funds, close escrow |
| `auto_release` | Anyone (permissionless) | Release after deadline slot |

## Getting Started

### Prerequisites

- Rust 1.79+ (`rustup install stable`)
- Solana CLI 1.18+ (`solana --version`)
- Anchor CLI 0.31.1 (`anchor --version`)
- Node.js 18+ (`node --version`)

### Build

```bash
git clone https://github.com/jianglibin1/solana-escrow-engine.git
cd solana-escrow-engine
npm install
anchor build
```

### Configure Solana

```bash
# Generate a keypair (if you don't have one)
solana-keygen new --outfile ~/.config/solana/id.json

# Set to devnet
solana config set --url devnet

# Airdrop some SOL for deployment
solana airdrop 2
```

### Update Program ID

After building, get your program ID:

```bash
solana-keygen pubkey target/deploy/escrow_engine-keypair.json
```

Update the program ID in:
- `programs/escrow-engine/src/lib.rs` (`declare_id!`)
- `Anchor.toml` (`[programs.devnet]`)

Then rebuild:

```bash
anchor build
```

## Testing

Run the full test suite against a local validator:

```bash
anchor test
```

Tests cover:
- ✅ Escrow initialization with correct account state
- ✅ Funding with SPL token transfer to vault
- ✅ Happy-path release to beneficiary
- ✅ Dispute raising and status freeze
- ✅ Arbiter dispute resolution (refund to depositor)
- ✅ Cancellation of unfunded escrow

## Deployment

Deploy to Solana Devnet:

```bash
anchor deploy --provider.cluster devnet
```

## CLI Client

A minimal CLI client is included for interacting with the deployed program:

```bash
# Setup test tokens (creates mint + token account)
npx ts-node app/src/cli.ts setup-test

# Initialize an escrow
npx ts-node app/src/cli.ts init \
  -i 1 \
  -b <BENEFICIARY_PUBKEY> \
  -r <ARBITER_PUBKEY> \
  -m <MINT_PUBKEY> \
  -a 1000000

# Fund the escrow
npx ts-node app/src/cli.ts fund -i 1 -t <DEPOSITOR_TOKEN_ACCOUNT>

# View escrow details
npx ts-node app/src/cli.ts view -i 1 -d <DEPOSITOR_PUBKEY>

# Release funds
npx ts-node app/src/cli.ts release -i 1 -t <BENEFICIARY_TOKEN_ACCOUNT>

# Raise a dispute
npx ts-node app/src/cli.ts dispute -i 1 -d <DEPOSITOR_PUBKEY> --reason "Service not delivered"
```

## Devnet Transactions

> Transaction links will be added after deployment.

| Action | Transaction |
|--------|-------------|
| Deploy | [`378pFo7Z...`](https://explorer.solana.com/tx/378pFo7ZgjiKYKrY7iciQkMKmrftwnHLb8rYZ3Fu9QN19mSkpnLBuKBrcrFQVdXAmw4sbLBPGEJzRNsy6N8sqAEN?cluster=devnet) |
| Program | [`7Qu9af8F...`](https://explorer.solana.com/address/7Qu9af8FYpL4ULHYADkRK3W3c3HjCr8ZtcShXxtoJXhf?cluster=devnet) |

## Design Tradeoffs

### What We Gained (Web3 Advantages)

1. **Trustless custody:** Funds are held by a PDA, not a company. The program logic is the only authority — no human can move funds outside the defined state machine.

2. **Transparency:** Every state transition is a Solana transaction, visible on-chain. No hidden fund movements.

3. **Permissionless auto-release:** Anyone can crank the auto-release instruction after the deadline. No dependency on a centralized cron job.

4. **Composability:** Other programs can CPI into the escrow engine, enabling complex workflows (e.g., marketplace → escrow → reputation system).

5. **Cost efficiency:** ~$0.001 per transaction vs. $0.01-0.10 for traditional infrastructure.

### What We Lost (Tradeoffs)

1. **No partial releases:** The current design is all-or-nothing. Web2 systems easily support partial refunds. On-chain, this would require additional account modeling.

2. **Slot-based timing:** We use Solana slots instead of wall-clock time. Slots are ~400ms but can vary. Web2 cron jobs use precise timestamps.

3. **Account rent:** Each escrow costs ~0.003 SOL in rent-exempt balance. Web2 database rows are essentially free.

4. **UX complexity:** Users need wallets, SOL for gas, and token accounts. Web2 just needs a credit card.

5. **Immutable disputes:** Once a dispute reason is recorded on-chain, it can't be edited. Web2 support tickets are freely editable.

6. **Arbiter trust:** The arbiter is still a trusted party. True trustless dispute resolution would require an oracle or DAO governance — significantly more complex.

### Design Decisions

- **PDA-controlled vaults** over direct token transfers: Ensures atomic state transitions and prevents fund loss.
- **Separate vault authority PDA**: Clean separation between escrow state and fund control.
- **Slot-based deadlines** over oracle timestamps: Simpler, no external dependency, good enough for most use cases.
- **Single arbiter** over multi-sig: Keeps the account model simple while still enabling dispute resolution.
- **String dispute reasons** over enum codes: More expressive, small on-chain cost, better UX.

---

## License

MIT

## Author

Built for the Superteam Earn bounty: "Rebuild production backend systems as on-chain Rust programs"
