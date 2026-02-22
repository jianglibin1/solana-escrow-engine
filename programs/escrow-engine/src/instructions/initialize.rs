use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::{EscrowAccount, EscrowStatus};
use crate::errors::EscrowError;

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    /// CHECK: Beneficiary does not need to sign at creation time.
    pub beneficiary: UncheckedAccount<'info>,

    /// CHECK: Arbiter does not need to sign at creation time.
    pub arbiter: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = depositor,
        space = 8 + EscrowAccount::INIT_SPACE,
        seeds = [b"escrow", depositor.key().as_ref(), escrow_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        init,
        payer = depositor,
        token::mint = mint,
        token::authority = vault_authority,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA used as vault authority, no data needed.
    #[account(
        seeds = [b"vault_authority", escrow.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeEscrow>,
    escrow_id: u64,
    amount: u64,
    auto_release_slot: Option<u64>,
) -> Result<()> {
    require!(amount > 0, EscrowError::InvalidAmount);

    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;

    escrow.escrow_id = escrow_id;
    escrow.depositor = ctx.accounts.depositor.key();
    escrow.beneficiary = ctx.accounts.beneficiary.key();
    escrow.arbiter = ctx.accounts.arbiter.key();
    escrow.mint = ctx.accounts.mint.key();
    escrow.vault = ctx.accounts.vault.key();
    escrow.amount = amount;
    escrow.status = EscrowStatus::Created;
    escrow.auto_release_slot = auto_release_slot.unwrap_or(0);
    escrow.created_at_slot = clock.slot;
    escrow.updated_at_slot = clock.slot;
    escrow.dispute_reason = String::new();
    escrow.bump = ctx.bumps.escrow;
    escrow.vault_authority_bump = ctx.bumps.vault_authority;

    msg!(
        "Escrow {} initialized: {} -> {}, amount: {}, arbiter: {}",
        escrow_id,
        escrow.depositor,
        escrow.beneficiary,
        amount,
        escrow.arbiter,
    );

    Ok(())
}
