use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::{EscrowAccount, EscrowStatus};
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        has_one = depositor @ EscrowError::UnauthorizedDepositor,
        constraint = (
            escrow.status == EscrowStatus::Created || escrow.status == EscrowStatus::Funded
        ) @ EscrowError::InvalidState,
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
        constraint = depositor_token.mint == escrow.mint,
        constraint = depositor_token.owner == depositor.key(),
    )]
    pub depositor_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CancelEscrow>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let vault_amount = ctx.accounts.vault.amount;

    // If funded, return tokens to depositor
    if vault_amount > 0 {
        let escrow_key = escrow.key();
        let seeds: &[&[u8]] = &[
            b"vault_authority",
            escrow_key.as_ref(),
            &[escrow.vault_authority_bump],
        ];
        let signer_seeds = &[seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.depositor_token.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, vault_amount)?;
    }

    escrow.status = EscrowStatus::Cancelled;
    escrow.updated_at_slot = Clock::get()?.slot;

    msg!("Escrow {} cancelled by depositor", escrow.escrow_id);

    Ok(())
}
