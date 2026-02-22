use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::{EscrowAccount, EscrowStatus};
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct RaiseDispute<'info> {
    #[account(mut)]
    pub party: Signer<'info>,

    #[account(
        mut,
        constraint = escrow.status == EscrowStatus::Funded @ EscrowError::InvalidState,
        constraint = (
            party.key() == escrow.depositor || party.key() == escrow.beneficiary
        ) @ EscrowError::UnauthorizedParty,
    )]
    pub escrow: Account<'info, EscrowAccount>,
}

pub fn raise_handler(ctx: Context<RaiseDispute>, reason: String) -> Result<()> {
    require!(reason.len() <= 128, EscrowError::DisputeReasonTooLong);

    let escrow = &mut ctx.accounts.escrow;
    escrow.status = EscrowStatus::Disputed;
    escrow.dispute_reason = reason.clone();
    escrow.updated_at_slot = Clock::get()?.slot;

    msg!(
        "Escrow {} disputed by {}: {}",
        escrow.escrow_id,
        ctx.accounts.party.key(),
        reason,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub arbiter: Signer<'info>,

    #[account(
        mut,
        has_one = arbiter @ EscrowError::UnauthorizedArbiter,
        constraint = escrow.status == EscrowStatus::Disputed @ EscrowError::InvalidState,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        constraint = vault.key() == escrow.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA vault authority.
    #[account(
        seeds = [b"vault_authority", escrow.key().as_ref()],
        bump = escrow.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Beneficiary's token account.
    #[account(
        mut,
        constraint = beneficiary_token.mint == escrow.mint,
        constraint = beneficiary_token.owner == escrow.beneficiary,
    )]
    pub beneficiary_token: Account<'info, TokenAccount>,

    /// Depositor's token account (for refund if dispute lost by beneficiary).
    #[account(
        mut,
        constraint = depositor_token.mint == escrow.mint,
        constraint = depositor_token.owner == escrow.depositor,
    )]
    pub depositor_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn resolve_handler(
    ctx: Context<ResolveDispute>,
    release_to_beneficiary: bool,
) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let amount = ctx.accounts.vault.amount;

    let escrow_key = escrow.key();
    let seeds: &[&[u8]] = &[
        b"vault_authority",
        escrow_key.as_ref(),
        &[escrow.vault_authority_bump],
    ];
    let signer_seeds = &[seeds];

    let destination = if release_to_beneficiary {
        escrow.status = EscrowStatus::Released;
        ctx.accounts.beneficiary_token.to_account_info()
    } else {
        escrow.status = EscrowStatus::Cancelled;
        ctx.accounts.depositor_token.to_account_info()
    };

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: destination,
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, amount)?;

    escrow.updated_at_slot = Clock::get()?.slot;

    msg!(
        "Escrow {} dispute resolved: funds sent to {}",
        escrow.escrow_id,
        if release_to_beneficiary { "beneficiary" } else { "depositor" },
    );

    Ok(())
}
