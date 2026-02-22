use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::{EscrowAccount, EscrowStatus};
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct AutoRelease<'info> {
    /// Anyone can crank the auto-release (permissionless).
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(
        mut,
        constraint = escrow.status == EscrowStatus::Funded @ EscrowError::InvalidState,
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

    #[account(
        mut,
        constraint = beneficiary_token.mint == escrow.mint,
        constraint = beneficiary_token.owner == escrow.beneficiary,
    )]
    pub beneficiary_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<AutoRelease>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;

    require!(escrow.auto_release_slot > 0, EscrowError::AutoReleaseDisabled);
    require!(
        clock.slot >= escrow.auto_release_slot,
        EscrowError::AutoReleaseNotReady
    );

    let amount = ctx.accounts.vault.amount;
    let escrow_key = escrow.key();
    let seeds: &[&[u8]] = &[
        b"vault_authority",
        escrow_key.as_ref(),
        &[escrow.vault_authority_bump],
    ];
    let signer_seeds = &[seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.beneficiary_token.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, amount)?;

    escrow.status = EscrowStatus::Released;
    escrow.updated_at_slot = clock.slot;

    msg!(
        "Escrow {} auto-released: {} tokens to beneficiary at slot {}",
        escrow.escrow_id,
        amount,
        clock.slot,
    );

    Ok(())
}
