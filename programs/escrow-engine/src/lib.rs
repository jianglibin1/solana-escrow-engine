use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("EscW1Ch4iN1111111111111111111111111111111111");

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

#[program]
pub mod escrow_engine {
    use super::*;

    /// Initialize a new escrow between a depositor and a beneficiary.
    /// Funds are locked until conditions are met or a dispute is resolved.
    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        escrow_id: u64,
        amount: u64,
        auto_release_slot: Option<u64>,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, escrow_id, amount, auto_release_slot)
    }

    /// Depositor funds the escrow vault with the agreed amount.
    pub fn fund_escrow(ctx: Context<FundEscrow>) -> Result<()> {
        instructions::fund::handler(ctx)
    }

    /// Depositor releases funds to the beneficiary (happy path).
    pub fn release_funds(ctx: Context<ReleaseFunds>) -> Result<()> {
        instructions::release::handler(ctx)
    }

    /// Either party can raise a dispute, freezing the escrow.
    pub fn raise_dispute(ctx: Context<RaiseDispute>, reason: String) -> Result<()> {
        instructions::dispute::raise_handler(ctx, reason)
    }

    /// Arbiter resolves the dispute, sending funds to the winner.
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        release_to_beneficiary: bool,
    ) -> Result<()> {
        instructions::dispute::resolve_handler(ctx, release_to_beneficiary)
    }

    /// Cancel an unfunded or expired escrow, returning funds to depositor.
    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        instructions::cancel::handler(ctx)
    }

    /// Auto-release after the deadline slot (permissionless crank).
    pub fn auto_release(ctx: Context<AutoRelease>) -> Result<()> {
        instructions::auto_release::handler(ctx)
    }
}
